/**
 * Core money/order flows against a real Postgres running the real migration.
 * Requires the local Supabase DB (npx supabase start) or TEST_DATABASE_URL.
 */
import crypto from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataImpulseProvider } from "@/lib/providers/dataimpulse";
import { ProxiesSxProvider } from "@/lib/providers/proxiessx";
import { purchase } from "@/lib/services/orders";
import { handleNowPaymentsWebhook, handlePaystackWebhook, signNowPayments } from "@/lib/services/payments";
import { rateLimit } from "@/lib/services/ratelimit";
import type { Store } from "@/lib/store";
import { balance, createUser, freshDatabase, pgStore } from "./helpers/pgStore";
import { mockDataImpulse } from "./helpers/mockDataImpulse";
import { mockProxiesSx } from "./helpers/mockProxiesSx";

/** A configured Proxies.sx provider backed by the in-memory mock. */
const okPsx = () => new ProxiesSxProvider({ apiKey: "psx_api_test", proxyUsername: "psx_abc123", apiBase: "https://api.test/v1", fetchImpl: mockProxiesSx().impl });

const PS_KEY = "sk_test_abc";
const NP_SECRET = "ipn_secret_xyz";
let pool: pg.Pool;
let store: Store;

beforeAll(async () => {
  pool = await freshDatabase();
  store = pgStore(pool);
});
afterAll(async () => pool?.end());

const psSign = (raw: string) => crypto.createHmac("sha512", PS_KEY).update(raw).digest("hex");
const psVerifyOk = (amount: number) =>
  (async () => new Response(JSON.stringify({ status: true, data: { status: "success", amount } }), { status: 200 })) as unknown as typeof fetch;

async function pendingPayment(userId: string, provider: "paystack" | "nowpayments", amountKobo: number, meta: unknown = null) {
  const ref = `${provider}_${crypto.randomUUID()}`;
  await store.rpc("create_payment", { p_user_id: userId, p_provider: provider, p_reference: ref, p_amount_kobo: amountKobo, p_meta: meta });
  return ref;
}

async function fund(userId: string, kobo: number) {
  const ref = await pendingPayment(userId, "paystack", kobo);
  const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: kobo, currency: "NGN" } });
  await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, psVerifyOk(kobo));
}

describe("signup", () => {
  it("creates a profile with ToS acceptance recorded", async () => {
    const id = await createUser(pool, "tos@example.com", true);
    const p = await store.getProfile(id);
    expect(p?.tos_accepted_at).toBeTruthy();
    expect(Number(p?.balance_kobo)).toBe(0);
  });
});

describe("wallet top-up via Paystack webhook", () => {
  it("credits the wallet once for a valid signed charge.success", async () => {
    const u = await createUser(pool, "ps@example.com");
    const ref = await pendingPayment(u, "paystack", 1_000_000);
    const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 1_000_000, currency: "NGN" } });

    const r1 = await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, psVerifyOk(1_000_000));
    expect(r1).toEqual({ httpStatus: 200, outcome: "credited" });
    expect(await balance(pool, u)).toBe(1_000_000);

    // Paystack retries webhooks: replay must not double-credit.
    const r2 = await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, psVerifyOk(1_000_000));
    expect(r2.outcome).toBe("already_credited");
    expect(await balance(pool, u)).toBe(1_000_000);
    const tx = await pool.query("select kind, amount_kobo from wallet_transactions where user_id = $1", [u]);
    expect(tx.rows).toEqual([{ kind: "topup", amount_kobo: 1_000_000 }]);
  });

  it("rejects a bad signature and does not credit", async () => {
    const u = await createUser(pool, "ps-bad@example.com");
    const ref = await pendingPayment(u, "paystack", 500_000);
    const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 500_000, currency: "NGN" } });
    const r = await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: "deadbeef" }, psVerifyOk(500_000));
    expect(r).toEqual({ httpStatus: 401, outcome: "bad_signature" });
    expect(await balance(pool, u)).toBe(0);
  });

  it("does not credit when Paystack's verify API reports less than expected", async () => {
    const u = await createUser(pool, "ps-short@example.com");
    const ref = await pendingPayment(u, "paystack", 500_000);
    const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 500_000, currency: "NGN" } });
    const r = await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, psVerifyOk(100));
    expect(r.outcome).toBe("amount_mismatch");
    expect(await balance(pool, u)).toBe(0);
  });

  it("does not credit when the verify API says the charge did not succeed", async () => {
    const u = await createUser(pool, "ps-verify@example.com");
    const ref = await pendingPayment(u, "paystack", 500_000);
    const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: 500_000, currency: "NGN" } });
    const failing = (async () => new Response(JSON.stringify({ status: true, data: { status: "abandoned" } }))) as unknown as typeof fetch;
    const r = await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, failing);
    expect(r.outcome).toBe("verify_failed");
    expect(await balance(pool, u)).toBe(0);
  });
});

describe("wallet top-up via NOWPayments IPN", () => {
  it("credits on 'finished', ignores 'partially_paid', rejects bad signatures", async () => {
    const u = await createUser(pool, "np@example.com");
    const ref = await pendingPayment(u, "nowpayments", 1_600_000, { usd: 10, ngn_per_usd: 1600 });

    const partial = { payment_id: 1, payment_status: "partially_paid", order_id: ref, price_amount: 10, price_currency: "usd" };
    let raw = JSON.stringify(partial);
    expect((await handleNowPaymentsWebhook({ store, ipnSecret: NP_SECRET, rawBody: raw, signature: signNowPayments(partial, NP_SECRET) })).outcome).toBe(
      "waiting_partially_paid",
    );
    expect(await balance(pool, u)).toBe(0);

    const finished = { ...partial, payment_status: "finished", actually_paid: 10.02, pay_currency: "usdttrc20" };
    raw = JSON.stringify(finished);
    expect((await handleNowPaymentsWebhook({ store, ipnSecret: NP_SECRET, rawBody: raw, signature: "nope" })).httpStatus).toBe(401);
    const r = await handleNowPaymentsWebhook({ store, ipnSecret: NP_SECRET, rawBody: raw, signature: signNowPayments(finished, NP_SECRET) });
    expect(r.outcome).toBe("credited");
    expect(await balance(pool, u)).toBe(1_600_000);
  });
});

describe("purchase rules (nothing charged on refusal)", () => {
  it("refuses when the balance is too low and charges nothing", async () => {
    const u = await createUser(pool, "poor@example.com");
    await fund(u, 500_000);
    const notify = vi.fn(async () => ({ telegram: false, email: false }));
    await expect(purchase({ store, notify, providers: [okPsx()] }, { userId: u, productId: "residential", countryCode: null, quantityGb: 1 })).rejects.toThrow(
      "insufficient_balance",
    );
    expect(await balance(pool, u)).toBe(500_000);
    expect((await pool.query("select count(*)::int as n from orders where user_id = $1", [u])).rows[0].n).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses banned users, inactive products and inactive countries", async () => {
    const u = await createUser(pool, "rules@example.com");
    await fund(u, 5_000_000);
    const deps = { store, notify: vi.fn(async () => ({ telegram: false, email: false })), providers: [okPsx()] };
    await expect(purchase(deps, { userId: u, productId: "datacenter", countryCode: null, quantityGb: 1 })).rejects.toThrow("product_unavailable");
    await expect(purchase(deps, { userId: u, productId: "residential", countryCode: "zz", quantityGb: 1 })).rejects.toThrow(/country_(unavailable|out_of_stock)/);
    await expect(purchase(deps, { userId: u, productId: "residential", countryCode: null, quantityGb: 0 })).rejects.toThrow("invalid_quantity");
    await pool.query("update profiles set is_banned = true where id = $1", [u]);
    await expect(purchase(deps, { userId: u, productId: "residential", countryCode: null, quantityGb: 1 })).rejects.toThrow("user_banned");
    expect(await balance(pool, u)).toBe(5_000_000);
  });
});

describe("purchase → Proxies.sx adapter (mocked API, instant delivery)", () => {
  const psx = (api: ReturnType<typeof mockProxiesSx>) =>
    new ProxiesSxProvider({ apiKey: "psx_api_test", proxyUsername: "psx_abc123", gatewayHost: "gw.proxies.sx", apiBase: "https://api.test/v1", fetchImpl: api.impl });

  it("mints a capped key with the order id as idempotency key, stores credentials; a second order tops up the same key", async () => {
    const api = mockProxiesSx();
    const p = psx(api);
    const u = await createUser(pool, "psx@example.com");
    await fund(u, 3_000_000);
    const notify = vi.fn(async () => ({ telegram: false, email: false }));

    const r1 = await purchase({ store, notify, providers: [p] }, { userId: u, productId: "mobile", countryCode: "us", quantityGb: 2 });
    expect(r1.outcome).toBe("fulfilled");
    expect(r1.order).toMatchObject({ status: "fulfilled", provider: "proxies_sx" });
    expect(notify).not.toHaveBeenCalled();
    expect(await balance(pool, u)).toBe(1_600_000);

    const mint = api.calls.find((c) => c.path === "/reseller/pool-keys" && c.method === "POST");
    expect(mint).toMatchObject({ apiKey: "psx_api_test", idem: `mint_${r1.order.id}`, body: { label: `strongproxy:${u}:mobile`, trafficCapGB: 2 } });
    expect(mint?.body).not.toHaveProperty("expiresAt"); // bought GB never expires by default

    const acc = (await pool.query("select * from proxy_accounts where user_id = $1", [u])).rows;
    expect(acc).toHaveLength(1);
    const keyId = acc[0].external_id;
    expect(acc[0]).toMatchObject({ provider: "proxies_sx", host: "gw.proxies.sx", port: 7000, username: "psx_abc123-mbl", password: `pak_${keyId}`, traffic_gb_purchased: 2 });

    // Key hit its cap and was auto-disabled upstream; a reorder tops up AND re-enables it.
    api.keys.get(keyId)!.enabled = false;
    api.keys.get(keyId)!.trafficUsedMB = 2048;
    const r2 = await purchase({ store, notify, providers: [p] }, { userId: u, productId: "mobile", countryCode: null, quantityGb: 1 });
    expect(r2.outcome).toBe("fulfilled");
    expect(api.calls.filter((c) => c.path === "/reseller/pool-keys" && c.method === "POST")).toHaveLength(1); // no second key
    expect(api.calls.find((c) => c.path.endsWith("/topup"))).toMatchObject({ body: { addTrafficGB: 1 }, idem: `topup_${r2.order.id}` });
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ enabled: true });
    expect(api.keys.get(keyId)).toMatchObject({ trafficCapGB: 3, enabled: true });
    const acc2 = (await pool.query("select traffic_gb_purchased, password from proxy_accounts where user_id = $1", [u])).rows;
    expect(acc2).toEqual([{ traffic_gb_purchased: 3, password: `pak_${keyId}` }]); // stored key untouched by the masked top-up reply

    const usage = await p.getUsage(keyId);
    expect(usage).toEqual({ usedBytes: 2048 * 1048576, totalBytes: 3 * 1073741824, remainingBytes: 1073741824 });
  });

  it("residential uses the peer pool with the residential ip-type filter", async () => {
    const api = mockProxiesSx();
    const u = await createUser(pool, "psx-res@example.com");
    await fund(u, 700_000);
    const r = await purchase({ store, notify: vi.fn(async () => ({ telegram: false, email: false })), providers: [psx(api)] }, { userId: u, productId: "residential", countryCode: "de", quantityGb: 1 });
    expect(r.outcome).toBe("fulfilled");
    const acc = (await pool.query("select username from proxy_accounts where user_id = $1", [u])).rows[0];
    expect(acc.username).toBe("psx_abc123-peer");
  });

  it("provider failure: order marked failed + refunded in full, admin alerted, customer told", async () => {
    const api = mockProxiesSx({ failOn: "/reseller/pool-keys" });
    const u = await createUser(pool, "psx-fail@example.com");
    await fund(u, 1_000_000);
    const notify = vi.fn(async () => ({ telegram: true, email: true }));
    const r = await purchase({ store, notify, providers: [psx(api)] }, { userId: u, productId: "mobile", countryCode: "gb", quantityGb: 1 });
    expect(r.outcome).toBe("refunded");
    expect(r.order.status).toBe("refunded");
    expect(r.order.failure_reason).toContain("proxies_sx");
    expect(r.order.failure_reason).toContain("Insufficient traffic balance");
    expect(await balance(pool, u)).toBe(1_000_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String((notify.mock.calls[0] as unknown[])[0])).toContain("auto-refunded");
    expect((await pool.query("select count(*)::int as n from proxy_accounts where user_id = $1", [u])).rows[0].n).toBe(0);
    const tx = (await pool.query("select kind, amount_kobo from wallet_transactions where user_id = $1 order by created_at", [u])).rows;
    expect(tx.map((t) => t.kind)).toEqual(["topup", "purchase", "refund"]);
    // A refunded order can't be refunded or auto-refunded again.
    await expect(store.rpc("fail_and_refund_order", { p_order_id: r.order.id, p_reason: "again" })).rejects.toThrow("order_not_refundable");
    await expect(store.rpc("refund_order", { p_order_id: r.order.id, p_note: "again", p_actor: null })).rejects.toThrow("already_refunded");
    expect(await balance(pool, u)).toBe(1_000_000);
  });

  it("out-of-stock countries can't be bought (nothing charged); live stock gates mobile and residential separately", async () => {
    const api = mockProxiesSx();
    const u = await createUser(pool, "psx-stock@example.com");
    await fund(u, 2_000_000);
    const deps = { store, notify: vi.fn(async () => ({ telegram: false, email: false })), providers: [psx(api)] };
    await expect(purchase(deps, { userId: u, productId: "mobile", countryCode: "de", quantityGb: 1 })).rejects.toThrow("country_out_of_stock");
    await expect(purchase(deps, { userId: u, productId: "residential", countryCode: "au", quantityGb: 1 })).rejects.toThrow("country_out_of_stock");
    expect(await balance(pool, u)).toBe(2_000_000);
    expect((await pool.query("select count(*)::int as n from orders where user_id = $1", [u])).rows[0].n).toBe(0);
    expect(api.calls.filter((c) => c.path.startsWith("/reseller"))).toHaveLength(0);
    // Germany residential is in stock, so the same country works on the other product.
    expect((await purchase(deps, { userId: u, productId: "residential", countryCode: "de", quantityGb: 1 })).outcome).toBe("fulfilled");
  });

  it("refuses before charging when the product's provider has no keys, and alerts the admin", async () => {
    const u = await createUser(pool, "psx-nokeys@example.com");
    await fund(u, 700_000);
    const notify = vi.fn(async () => ({ telegram: true, email: false }));
    await expect(
      purchase({ store, notify, providers: [new ProxiesSxProvider({})] }, { userId: u, productId: "residential", countryCode: null, quantityGb: 1 }),
    ).rejects.toThrow("provider_not_configured");
    expect(await balance(pool, u)).toBe(700_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("purchase → DataImpulse adapter (mocked API), chosen per product", () => {
  it("creates a sub-user, adds traffic, stores credentials; second order tops up the same sub-user", async () => {
    await pool.query(`update products set provider = 'dataimpulse' where id = 'residential'`);
    try {
      const api = mockDataImpulse();
      const di = new DataImpulseProvider({ login: "me", password: "secret", proxyHost: "gw.dataimpulse.com", threads: 50, fetchImpl: api.impl });
      const u = await createUser(pool, "auto@example.com");
      await fund(u, 3_000_000);
      const notify = vi.fn(async () => ({ telegram: false, email: false }));

      const r1 = await purchase({ store, notify, providers: [di] }, { userId: u, productId: "residential", countryCode: "us", quantityGb: 2 });
      expect(r1.outcome).toBe("fulfilled");
      expect(r1.order.status).toBe("fulfilled");
      expect(r1.order.provider).toBe("dataimpulse");
      expect(notify).not.toHaveBeenCalled();
      expect(await balance(pool, u)).toBe(3_000_000 - 1_400_000);

      const create = api.calls.find((c) => c.path === "/sub-user/create");
      expect(create?.body).toMatchObject({ pool_type: "residential", threads: 50, label: `sp-${u}`.slice(0, 60) });
      expect(api.calls.find((c) => c.path === "/sub-user/balance/add")?.body).toEqual({ subuser_id: 4050, traffic: 2 });
      expect(api.calls[0]).toMatchObject({ path: "/user/token/get", body: { login: "me", password: "secret" } });

      const acc = (await pool.query("select * from proxy_accounts where user_id = $1", [u])).rows;
      expect(acc).toHaveLength(1);
      expect(acc[0]).toMatchObject({ provider: "dataimpulse", external_id: "4050", host: "gw.dataimpulse.com", port: 823, username: "login4050", password: "pw4050", traffic_gb_purchased: 2 });

      const r2 = await purchase({ store, notify, providers: [di] }, { userId: u, productId: "residential", countryCode: null, quantityGb: 1 });
      expect(r2.outcome).toBe("fulfilled");
      expect(api.calls.filter((c) => c.path === "/sub-user/create")).toHaveLength(1);
      expect(api.calls.filter((c) => c.path === "/sub-user/balance/add").map((c) => c.body)).toEqual([
        { subuser_id: 4050, traffic: 2 },
        { subuser_id: 4050, traffic: 1 },
      ]);
      expect((await pool.query("select traffic_gb_purchased from proxy_accounts where user_id = $1", [u])).rows).toEqual([{ traffic_gb_purchased: 3 }]);
      expect(api.subs.get(4050)?.balance).toBe(3 * 1073741824);
      expect((await di.getUsage("4050")).remainingBytes).toBe(3 * 1073741824);
    } finally {
      await pool.query(`update products set provider = 'proxies_sx' where id = 'residential'`);
    }
  });

  it("an upstream failure auto-refunds the wallet and alerts the admin", async () => {
    await pool.query(`update products set provider = 'dataimpulse' where id = 'mobile'`);
    try {
      const api = mockDataImpulse({ failOn: "/sub-user/create" });
      const di = new DataImpulseProvider({ login: "me", password: "secret", proxyHost: "gw.dataimpulse.com", threads: 50, fetchImpl: api.impl });
      const u = await createUser(pool, "auto-fail@example.com");
      await fund(u, 1_000_000);
      const notify = vi.fn(async () => ({ telegram: true, email: true }));
      const r = await purchase({ store, notify, providers: [di] }, { userId: u, productId: "mobile", countryCode: null, quantityGb: 1 });
      expect(r.outcome).toBe("refunded");
      expect(r.order.failure_reason).toContain("dataimpulse");
      expect(notify).toHaveBeenCalledTimes(1);
      expect(await balance(pool, u)).toBe(1_000_000);
    } finally {
      await pool.query(`update products set provider = 'proxies_sx' where id = 'mobile'`);
    }
  });
});

describe("admin money tools", () => {
  it("credits and debits with an audit trail, never below zero", async () => {
    const u = await createUser(pool, "adj@example.com");
    await store.rpc("admin_adjust_balance", { p_user_id: u, p_amount_kobo: 250_000, p_note: "goodwill", p_actor: null });
    expect(await balance(pool, u)).toBe(250_000);
    await expect(store.rpc("admin_adjust_balance", { p_user_id: u, p_amount_kobo: -300_000, p_note: "x", p_actor: null })).rejects.toThrow("insufficient_balance");
    await store.rpc("admin_adjust_balance", { p_user_id: u, p_amount_kobo: -50_000, p_note: "fix", p_actor: null });
    expect(await balance(pool, u)).toBe(200_000);
    const log = await pool.query("select count(*)::int as n from audit_log where target = $1 and action = 'wallet.adjust'", [u]);
    expect(log.rows[0].n).toBe(2);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within the window, then blocks", async () => {
    const key = `t:${crypto.randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(store, key, 60, 3));
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("row level security", () => {
  it("customers read only their own rows and cannot write balances or call money functions", async () => {
    const a = await createUser(pool, "rls-a@example.com");
    const b = await createUser(pool, "rls-b@example.com");
    await fund(a, 700_000);
    await purchase({ store, notify: async () => ({ telegram: false, email: false }), providers: [okPsx()] }, { userId: a, productId: "residential", countryCode: null, quantityGb: 1 });

    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [b]);
      expect((await c.query("select * from orders")).rows).toHaveLength(0);
      expect((await c.query("select * from wallet_transactions")).rows).toHaveLength(0);
      expect((await c.query("select id from profiles")).rows).toEqual([{ id: b }]);
      expect((await c.query("select * from settings")).rows).toHaveLength(0);
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [a]);
      expect((await c.query("select * from orders")).rows).toHaveLength(1);
      await c.query("savepoint s1");
      await expect(c.query("update profiles set balance_kobo = 99999999 where id = $1", [a])).rejects.toThrow(/permission denied/);
      await c.query("rollback to savepoint s1");
      await expect(c.query(`select public.admin_adjust_balance($1, 100, 'hack', null)`, [a])).rejects.toThrow(/permission denied/);
      await c.query("rollback");
    } finally {
      c.release();
    }
    expect(await balance(pool, a)).toBe(0);
  });
});
