/**
 * Daily dedicated ports (Proxies.sx reseller ports API, mocked) + low-balance auto-pause, against real Postgres.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxiesSxProvider } from "@/lib/providers/proxiessx";
import { parseCountries, parsePort, ProxiesSxPortsApi, signPsxWebhook, verifyPsxSignature } from "@/lib/providers/proxiessx-ports";
import { resetBalanceCache, salesStatus } from "@/lib/services/balance-guard";
import { purchase } from "@/lib/services/orders";
import { buyPort, handlePsxWebhook, portStock, renewPort, rotatePort, syncPorts } from "@/lib/services/ports";
import { handlePaystackWebhook } from "@/lib/services/payments";
import type { Store } from "@/lib/store";
import type { DedicatedPort } from "@/lib/types";
import crypto from "node:crypto";
import { balance, createUser, freshDatabase, pgStore } from "./helpers/pgStore";
import { mockProxiesSx } from "./helpers/mockProxiesSx";
import { mockProxiesSxPorts } from "./helpers/mockProxiesSxPorts";

const PS_KEY = "sk_test_abc";
let pool: pg.Pool;
let store: Store;

beforeAll(async () => {
  pool = await freshDatabase();
  store = pgStore(pool);
});
afterAll(async () => pool?.end());
beforeEach(() => resetBalanceCache());

const psSign = (raw: string) => crypto.createHmac("sha512", PS_KEY).update(raw).digest("hex");
async function fund(userId: string, kobo: number) {
  const ref = `paystack_${crypto.randomUUID()}`;
  await store.rpc("create_payment", { p_user_id: userId, p_provider: "paystack", p_reference: ref, p_amount_kobo: kobo, p_meta: null });
  const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: kobo, currency: "NGN" } });
  const ok = (async () => new Response(JSON.stringify({ status: true, data: { status: "success", amount: kobo } }), { status: 200 })) as unknown as typeof fetch;
  await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, ok);
}

function setup(mockOpts: Parameters<typeof mockProxiesSxPorts>[0] = {}) {
  const mock = mockProxiesSxPorts(mockOpts);
  const api = new ProxiesSxPortsApi({ apiKey: "psx_api_test", apiBase: "https://api.test/v1", fetchImpl: mock.impl });
  const notify = vi.fn(async () => ({ telegram: true, email: false }));
  return { mock, api, notify, deps: { store, notify, api } };
}
const portRow = async (id: string) => (await pool.query("select * from dedicated_ports where id = $1", [id])).rows[0] as DedicatedPort;
const orderCount = async (u: string) => Number((await pool.query("select count(*) from orders where user_id = $1", [u])).rows[0].count);

describe("daily ports: buy", () => {
  it("charges the wallet, creates the port instantly and stores host:port:user:pass", async () => {
    const { mock, deps } = setup();
    const u = await createUser(pool, "port-buy@example.com");
    await fund(u, 20_000_000);
    const r = await buyPort(deps, { userId: u, email: "port-buy@example.com", planId: "7d", countryCode: "us", protocol: "socks5" });
    expect(r.outcome).toBe("fulfilled");
    if (r.outcome !== "fulfilled") return;
    expect(await balance(pool, u)).toBe(20_000_000 - 10_640_000);
    expect(r.order).toMatchObject({ kind: "port", status: "fulfilled", port_plan_id: "7d", port_days: 7, quantity_gb: 10, product_id: null });
    const p = await portRow(r.portId);
    expect(p).toMatchObject({ user_id: u, protocol: "socks5", server_ip: "185.1.2.3", http_port: 10001, socks_port: 10002, country_code: "us", traffic_gb: 10, status: "active" });
    expect(p.username).toMatch(/^u/);
    expect(p.rotate_token).toMatch(/^[a-f0-9]{36}$/);
    expect(new Date(p.expires_at).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400_000);

    const create = mock.calls.find((c) => c.path === "/reseller/ports" && c.method === "POST")!;
    expect(create.body).toMatchObject({ countryId: "c_us", days: 7 });
    expect(create.idem).toBe(r.order.id);
    const cust = [...mock.customers.values()][0];
    expect(cust).toMatchObject({ externalId: u, portSlots: 1, trafficGB: 10 });

    // A second port reuses the same Proxies.sx customer.
    const r2 = await buyPort(deps, { userId: u, email: "port-buy@example.com", planId: "1d", countryCode: "gb", protocol: "http" });
    expect(r2.outcome).toBe("fulfilled");
    expect(mock.customers.size).toBe(1);
    expect(mock.calls.filter((c) => c.path === "/reseller/customers" && c.method === "POST")).toHaveLength(1);
  });

  it("refuses out-of-stock and unknown countries before charging anything", async () => {
    const { deps } = setup();
    const u = await createUser(pool, "port-oos@example.com");
    await fund(u, 5_000_000);
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "ca", protocol: "http" })).rejects.toThrow("country_out_of_stock");
    // Germany is not in the live list at all => out of stock too.
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "de", protocol: "http" })).rejects.toThrow("country_out_of_stock");
    expect(await balance(pool, u)).toBe(5_000_000);
    expect(await orderCount(u)).toBe(0);
  });

  it("refuses with too little wallet balance, disabled plans and disabled countries", async () => {
    const { deps } = setup();
    const u = await createUser(pool, "port-rules@example.com");
    await fund(u, 1_000_000);
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" })).rejects.toThrow("insufficient_balance");
    await fund(u, 5_000_000);
    await pool.query("update port_plans set is_active = false where id = '30d'");
    await expect(buyPort(deps, { userId: u, email: null, planId: "30d", countryCode: "us", protocol: "http" })).rejects.toThrow("plan_unavailable");
    await pool.query("update port_plans set is_active = true where id = '30d'");
    await pool.query("update countries set ports_enabled = false where code = 'gb'");
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "gb", protocol: "http" })).rejects.toThrow("country_unavailable");
    await pool.query("update countries set ports_enabled = true where code = 'gb'");
    expect(await balance(pool, u)).toBe(6_000_000);
  });

  it("uses an admin-set country id when their country list can't be read", async () => {
    const { deps } = setup({ countriesFail: true });
    const u = await createUser(pool, "port-manual@example.com");
    await fund(u, 5_000_000);
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" })).rejects.toThrow("country_unavailable");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("no Proxies.sx country id"), expect.any(String));
    await pool.query("update countries set psx_country_id = 'c_us' where code = 'us'");
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    expect(r.outcome).toBe("fulfilled");
    await pool.query("update countries set psx_country_id = null where code = 'us'");
  });

  it("provider failure: order refunded in full, admin alerted, port slot given back", async () => {
    const { mock, deps } = setup({ failOn: "/reseller/ports" });
    const u = await createUser(pool, "port-fail@example.com");
    await fund(u, 5_000_000);
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    expect(r.outcome).toBe("refunded");
    expect(await balance(pool, u)).toBe(5_000_000);
    expect(r.order.status).toBe("refunded");
    expect(r.order.failure_reason).toContain("Insufficient balance");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("auto-refunded"), expect.stringContaining("refunded ₦21,280"));
    expect(Number((await pool.query("select count(*) from dedicated_ports where user_id = $1", [u])).rows[0].count)).toBe(0);
    expect([...mock.customers.values()][0]).toMatchObject({ portSlots: 0, trafficGB: 0 });
  });

  it("refuses before charging when no Proxies.sx key is set", async () => {
    const api = new ProxiesSxPortsApi({});
    const notify = vi.fn(async () => ({ telegram: true, email: false }));
    const u = await createUser(pool, "port-nokey@example.com");
    await fund(u, 5_000_000);
    await expect(buyPort({ store, notify, api }, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" })).rejects.toThrow("provider_not_configured");
    expect(await balance(pool, u)).toBe(5_000_000);
    expect(notify).toHaveBeenCalled();
  });
});

describe("daily ports: renew, rotate, expiry", () => {
  it("renews from the wallet and pushes the expiry; a failed renewal is refunded", async () => {
    const { mock, deps } = setup();
    const u = await createUser(pool, "port-renew@example.com");
    await fund(u, 40_000_000);
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    if (r.outcome !== "fulfilled") throw new Error("buy failed");
    const before = new Date((await portRow(r.portId)).expires_at).getTime();

    const rn = await renewPort(deps, { userId: u, portId: r.portId, planId: "7d" });
    expect(rn.outcome).toBe("fulfilled");
    expect(rn.order).toMatchObject({ kind: "port_renewal", status: "fulfilled", dedicated_port_id: r.portId });
    const after = await portRow(r.portId);
    expect(new Date(after.expires_at).getTime() - before).toBeGreaterThan(6.99 * 86400_000);
    expect(after.traffic_gb).toBe(12);
    expect(await balance(pool, u)).toBe(40_000_000 - 2_128_000 - 10_640_000);
    expect(mock.calls.find((c) => c.path.endsWith("/extend"))?.body).toEqual({ days: 7 });

    mock.state.failOn = "/reseller/ports/";
    const bad = await renewPort(deps, { userId: u, portId: r.portId, planId: "1d" });
    expect(bad.outcome).toBe("refunded");
    expect(await balance(pool, u)).toBe(40_000_000 - 2_128_000 - 10_640_000);
    expect(new Date((await portRow(r.portId)).expires_at).getTime()).toBe(new Date(after.expires_at).getTime());
  });

  it("expired ports can't be renewed; someone else's port can't be touched", async () => {
    const { deps } = setup();
    const u = await createUser(pool, "port-exp@example.com");
    const other = await createUser(pool, "port-other@example.com");
    await fund(u, 10_000_000);
    await fund(other, 10_000_000);
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    if (r.outcome !== "fulfilled") throw new Error("buy failed");
    await expect(renewPort(deps, { userId: other, portId: r.portId, planId: "1d" })).rejects.toThrow("port_not_found");
    await pool.query("update dedicated_ports set expires_at = now() - interval '1 minute' where id = $1", [r.portId]);
    const bal = await balance(pool, u);
    await expect(renewPort(deps, { userId: u, portId: r.portId, planId: "1d" })).rejects.toThrow("port_not_renewable");
    // The SQL function refuses too, even if the app check were skipped.
    await expect(store.rpc("place_port_order", { p_user_id: u, p_plan_id: "1d", p_country_code: null, p_protocol: null, p_port_id: r.portId })).rejects.toThrow("port_not_renewable");
    expect(await balance(pool, u)).toBe(bal);
  });

  it("rotates through the API; sync marks ports expired or deleted upstream", async () => {
    const { mock, api, deps } = setup();
    const u = await createUser(pool, "port-sync@example.com");
    await fund(u, 10_000_000);
    const a = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    const b = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "gb", protocol: "http" });
    if (a.outcome !== "fulfilled" || b.outcome !== "fulfilled") throw new Error("buy failed");

    await rotatePort({ store, api }, await portRow(a.portId));
    expect(mock.calls.some((c) => c.path.endsWith("/rotate"))).toBe(true);
    expect((await portRow(a.portId)).last_rotated_at).toBeTruthy();

    const pa = await portRow(a.portId);
    mock.ports.get(pa.external_id)!.expiresAt = Date.now() - 1000;
    mock.ports.delete((await portRow(b.portId)).external_id);
    const n = await syncPorts({ store, api }, [await portRow(a.portId), await portRow(b.portId)], { maxAgeMs: 0 });
    expect(n).toBe(2);
    expect((await portRow(a.portId)).status).toBe("expired");
    expect((await portRow(b.portId)).status).toBe("deleted");
  });

  it("webhook: verifies X-Webhook-Signature and applies port.suspended / port.deleted", async () => {
    const { deps } = setup();
    const u = await createUser(pool, "port-wh@example.com");
    await fund(u, 5_000_000);
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    if (r.outcome !== "fulfilled") throw new Error("buy failed");
    const ext = (await portRow(r.portId)).external_id;
    const secret = "whsec_test";
    const raw = JSON.stringify({ id: "evt_1", type: "port.suspended", created: new Date().toISOString(), data: { portId: ext } });
    expect(await handlePsxWebhook({ store, secret, rawBody: raw, signature: "sha256=" + "0".repeat(64) })).toEqual({ httpStatus: 401, outcome: "bad_signature" });
    expect(await handlePsxWebhook({ store, secret: undefined, rawBody: raw, signature: signPsxWebhook(raw, secret) })).toMatchObject({ httpStatus: 503 });
    expect(await handlePsxWebhook({ store, secret, rawBody: raw, signature: signPsxWebhook(raw, secret) })).toEqual({ httpStatus: 200, outcome: "port.suspended" });
    expect((await portRow(r.portId)).status).toBe("suspended");
    const del = JSON.stringify({ id: "evt_2", type: "port.deleted", data: { portId: ext } });
    await handlePsxWebhook({ store, secret, rawBody: del, signature: signPsxWebhook(del, secret) });
    expect((await portRow(r.portId)).status).toBe("deleted");
  });
});

describe("low-balance auto-pause", () => {
  it("pauses daily ports and per-GB Proxies.sx sales below the threshold, alerts once, resumes on its own", async () => {
    const { mock, api, deps } = setup({ balance: 3 });
    const u = await createUser(pool, "pause@example.com");
    await fund(u, 30_000_000);
    await expect(buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" })).rejects.toThrow("sales_paused");
    const gb = mockProxiesSx();
    const psx = new ProxiesSxProvider({ apiKey: "psx_api_test", proxyUsername: "psx_abc123", apiBase: "https://api.test/v1", fetchImpl: gb.impl });
    await expect(
      purchase({ store, notify: deps.notify, providers: [psx], balance: api }, { userId: u, productId: "mobile", countryCode: "us", quantityGb: 1 }),
    ).rejects.toThrow("sales_paused");
    expect(await balance(pool, u)).toBe(30_000_000);
    expect(await orderCount(u)).toBe(0);
    expect(deps.notify.mock.calls.filter((c) => String((c as unknown[])[0]).includes("PAUSED"))).toHaveLength(1);
    expect((await salesStatus({ store, notify: deps.notify, reader: api })).paused).toBe(true);
    // Read at most once a minute.
    expect(mock.calls.filter((c) => c.path === "/account/summary")).toHaveLength(1);

    mock.state.balance = 500;
    resetBalanceCache(); // the 60s cache expiring
    const r = await buyPort(deps, { userId: u, email: null, planId: "1d", countryCode: "us", protocol: "http" });
    expect(r.outcome).toBe("fulfilled");
    expect(deps.notify.mock.calls.some((c) => String((c as unknown[])[0]).includes("resumed"))).toBe(true);
    const g = await purchase({ store, notify: deps.notify, providers: [psx], balance: api }, { userId: u, productId: "mobile", countryCode: "us", quantityGb: 1 });
    expect(g.outcome).toBe("fulfilled");
  });

  it("refuses an order that costs more than the balance, and can be switched off", async () => {
    const { api, deps } = setup({ balance: 20 });
    const u = await createUser(pool, "pause2@example.com");
    await fund(u, 40_000_000);
    // 30-day plan includes 30 GB = $120 upstream > $20 balance.
    await expect(buyPort(deps, { userId: u, email: null, planId: "30d", countryCode: "us", protocol: "http" })).rejects.toThrow("sales_paused");
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining("too low for one order"), expect.any(String));
    expect((await salesStatus({ store, notify: deps.notify, reader: api })).paused).toBe(false); // the shop itself stays open
    await store.setSetting("psx_autopause_enabled", false);
    const r = await buyPort(deps, { userId: u, email: null, planId: "30d", countryCode: "us", protocol: "http" });
    expect(r.outcome).toBe("fulfilled");
    await store.setSetting("psx_autopause_enabled", true);
  });

  it("stays open (fail-open) when the balance can't be read", async () => {
    const notify = vi.fn(async () => ({ telegram: true, email: false }));
    const reader = { isConfigured: () => true, getBalanceUsd: async () => Promise.reject(new Error("HTTP 403")) };
    const st = await salesStatus({ store, notify, reader });
    expect(st).toMatchObject({ paused: false, balanceUsd: null, error: "HTTP 403" });
  });
});

describe("Proxies.sx ports API parsing", () => {
  it("parses ports, country lists and signatures defensively", async () => {
    const p = parsePort({ port: { _id: "p1", serverIp: "1.2.3.4", httpPort: 1, socksPort: 2, proxyLogin: "u", proxyPassword: "x", expiresAt: 1740000000000 } });
    expect(p.expiresAt?.toISOString()).toBe("2025-02-19T21:20:00.000Z");
    expect(() => parsePort({ port: { _id: "p1" } })).toThrow();
    expect(parseCountries({ countries: [{ _id: "a", isoCode: "uk", availableCount: 3 }, { id: "b", code: "US" }, { foo: 1 }] })).toEqual([
      { id: "a", code: "gb", name: null, available: 3 },
      { id: "b", code: "us", name: null, available: null },
    ]);
    const body = JSON.stringify({ type: "port.created", data: { portId: "x" } });
    expect(verifyPsxSignature(body, signPsxWebhook(body, "s"), "s")).toBe(true);
    expect(verifyPsxSignature(body, signPsxWebhook(body, "s"), "t")).toBe(false);
    const pretty = JSON.stringify(JSON.parse(body), null, 2); // they sign JSON.stringify(payload)
    expect(verifyPsxSignature(pretty, signPsxWebhook(body, "s"), "s")).toBe(true);

    const { api } = setup();
    const st = await portStock(api, [{ code: "us", psx_country_id: null }, { code: "ca", psx_country_id: null }]);
    expect(st.live).toBe(true);
    expect(st.countries.us).toMatchObject({ psxId: "c_us", state: "in_stock", available: 12 });
    expect(st.countries.ca.state).toBe("out_of_stock");
  });
});
