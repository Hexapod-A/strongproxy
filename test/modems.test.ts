/**
 * Private modems (Proxies.sx private-modems API, mocked) against real Postgres: pricing, margin guard, buy, refunds,
 * slow setups, renew, rotate, sync and the low-balance auto-pause.
 */
import type pg from "pg";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderGb, orderTitle } from "@/lib/order-label";
import { parseMine, parseTariffs, ProxiesSxModemsApi } from "@/lib/providers/proxiessx-modems";
import { resetBalanceCache } from "@/lib/services/balance-guard";
import {
  buyModem,
  customerOffers,
  evaluateLines,
  modemPriceKobo,
  normalizePricing,
  reconcileModemOrders,
  renewModem,
  resetModemCatalogCache,
  rotateModem,
  syncModems,
  type ModemDeps,
} from "@/lib/services/modems";
import { handlePaystackWebhook } from "@/lib/services/payments";
import type { Store } from "@/lib/store";
import type { Order, PrivateModem } from "@/lib/types";
import { balance, createUser, freshDatabase, pgStore } from "./helpers/pgStore";
import { DEFAULT_TARIFFS, mockProxiesSxModems, type ModemMockOpts } from "./helpers/mockProxiesSxModems";

const PS_KEY = "sk_test_abc";
let pool: pg.Pool;
let store: Store;

beforeAll(async () => {
  pool = await freshDatabase();
  store = pgStore(pool);
});
afterAll(async () => pool?.end());
beforeEach(() => {
  resetBalanceCache();
  resetModemCatalogCache();
});

const psSign = (raw: string) => crypto.createHmac("sha512", PS_KEY).update(raw).digest("hex");
async function fund(userId: string, kobo: number) {
  const ref = `paystack_${crypto.randomUUID()}`;
  await store.rpc("create_payment", { p_user_id: userId, p_provider: "paystack", p_reference: ref, p_amount_kobo: kobo, p_meta: null });
  const raw = JSON.stringify({ event: "charge.success", data: { reference: ref, amount: kobo, currency: "NGN" } });
  const ok = (async () => new Response(JSON.stringify({ status: true, data: { status: "success", amount: kobo } }), { status: 200 })) as unknown as typeof fetch;
  await handlePaystackWebhook({ store, secretKey: PS_KEY, rawBody: raw, signature: psSign(raw) }, ok);
}

function setup(mockOpts: ModemMockOpts = {}, extra: Partial<ModemDeps> = {}) {
  const mock = mockProxiesSxModems(mockOpts);
  const api = new ProxiesSxModemsApi({ apiKey: "psx_api_test", apiBase: "https://api.test/v1", fetchImpl: mock.impl });
  const notify = vi.fn(async () => ({ telegram: true, email: false }));
  let t = Date.now();
  const deps: ModemDeps = { store, notify, api, now: () => t, sleep: async (ms) => void (t += ms), pollMs: 1000, setupWaitMs: 10_000, ...extra };
  return { mock, api, notify, deps };
}
const modemRow = async (id: string) => (await pool.query("select * from private_modems where id = $1", [id])).rows[0] as PrivateModem;
const orderRow = async (id: string) => (await pool.query("select * from orders where id = $1", [id])).rows[0] as Order;
const orderCount = async (u: string) => Number((await pool.query("select count(*) from orders where user_id = $1", [u])).rows[0].count);
const posts = (mock: ReturnType<typeof mockProxiesSxModems>) => mock.calls.filter((c) => c.method === "POST" && c.path === "/private-modems/orders");

// John's prices (Nov 3 2026): $10/day, $30/week, $115/month at the seeded ₦1,600 per $1.
const DAY_KOBO = 1_600_000;

describe("private modems: pricing and margin guard", () => {
  const pricing = normalizePricing({ prices: { day: 10, week: 30, month: 115 }, rate: 1600 });
  const lines = evaluateLines(parseTariffs({ tariffs: DEFAULT_TARIFFS }), pricing);
  const line = (key: string) => lines.find((l) => l.key === key)!;

  it("parses the catalog and the public price list", () => {
    const fromCatalog = parseTariffs({ tariffs: DEFAULT_TARIFFS });
    expect(fromCatalog).toHaveLength(DEFAULT_TARIFFS.length);
    expect(fromCatalog[0]).toMatchObject({ tariffId: "t_de_o2_d", countryCode: "de", carrierName: "O2", period: "day", priceUsd: 8, stock: 48 });
    const pub = parseTariffs({ privateModems: { plans: [{ countryCode: "GB", countryName: "United Kingdom", carrierName: "Three", period: "month", priceUsd: 107, stock: 16 }] } });
    expect(pub).toEqual([{ tariffId: null, countryCode: "gb", countryName: "United Kingdom", carrierName: "Three", period: "month", priceUsd: 107, stock: 16 }]);
    expect(parseTariffs({ tariffs: [{ countryCode: "XX1", period: "day", priceUsd: 5 }, { countryCode: "DE", period: "year", priceUsd: 5 }] })).toEqual([]);
  });

  it("prices in naira from the admin rate, rounded up to ₦100", () => {
    expect(modemPriceKobo(10, 1600)).toBe(1_600_000);
    expect(modemPriceKobo(115, 1600)).toBe(18_400_000);
    expect(modemPriceKobo(10, 1555.5)).toBe(1_560_000); // ₦15,555 -> ₦15,600
  });

  it("sells only lines that cost John less than his price; blocks the rest", () => {
    expect(line("DE|O2|day")).toMatchObject({ state: "selling", sellUsd: 10, marginUsd: 2, priceKobo: DAY_KOBO });
    expect(line("DE|O2|week")).toMatchObject({ state: "blocked", marginUsd: -2 }); // $32 cost > $30
    expect(line("NL|Vodafone NL|day")).toMatchObject({ state: "blocked", marginUsd: 0 }); // cost == price is blocked too
    expect(line("NL|Vodafone NL|week")).toMatchObject({ state: "selling", marginUsd: 5 });
    expect(line("US|Verizon|day")).toMatchObject({ state: "blocked" });
    expect(line("FR|Free|day")).toMatchObject({ state: "out_of_stock" });
  });

  it("per-line overrides open or hide lines; a minimum margin tightens the guard", () => {
    const p2 = normalizePricing({ prices: { day: 10, week: 30, month: 115 }, rate: 1600, overrides: { "US|Verizon|day": { priceUsd: 28 }, "DE|O2|day": { hidden: true } } });
    const l2 = evaluateLines(parseTariffs({ tariffs: DEFAULT_TARIFFS }), p2);
    expect(l2.find((l) => l.key === "US|Verizon|day")).toMatchObject({ state: "selling", sellUsd: 28, overridden: true, priceKobo: 4_480_000 });
    expect(l2.find((l) => l.key === "DE|O2|day")).toMatchObject({ state: "hidden" });
    const p3 = normalizePricing({ prices: { day: 10, week: 30, month: 115 }, minMargin: 3 });
    expect(evaluateLines(parseTariffs({ tariffs: DEFAULT_TARIFFS }), p3).find((l) => l.key === "DE|O2|day")?.state).toBe("blocked"); // +$2 < $3
  });

  it("customers see sellable and out-of-stock lines only", () => {
    const offers = customerOffers(lines);
    expect(offers.map((o) => o.code)).toEqual(["de", "nl", "fr"]); // US dropped (all blocked); FR last (sold out)
    const de = offers.find((o) => o.code === "de")!;
    expect(de.carriers[0].periods).toEqual({ day: { priceKobo: DAY_KOBO, inStock: true, stock: 48 } }); // week/month blocked -> absent
    expect(de.fromKobo).toBe(DAY_KOBO);
    expect(de.fromPeriod).toBe("day");
    expect(offers.find((o) => o.code === "fr")).toMatchObject({ inStock: false, fromKobo: null });
  });

  it("reads /mine defensively", () => {
    const m = parseMine({ modems: [{ id: "m_1", status: "active", countryCode: "UK", expiresAt: "2026-11-04T10:00:00.000Z", credentials: { http: { host: "h", port: 1, username: "u", password: "p" } } }], openOrders: [{ orderId: "o_1" }], recentFailed: "x" });
    expect(m.modems[0]).toMatchObject({ id: "m_1", countryCode: "gb", http: { host: "h", port: 1, username: "u", password: "p" }, socks5: null });
    expect(m.openOrders[0].orderId).toBe("o_1");
    expect(m.recentFailed).toEqual([]);
  });

  it("labels modem orders", () => {
    const o = { kind: "modem", modem_period: "week", modem_country_name: "Netherlands", modem_carrier: "Vodafone NL", quantity_gb: 0 } as unknown as Order;
    expect(orderTitle(o, () => "")).toBe("Private modem · 1 week · Netherlands Vodafone NL");
    expect(orderGb(o)).toBe("Unlimited");
  });
});

describe("private modems: buy", () => {
  it("charges the wallet, rents the modem and stores both logins", async () => {
    const { mock, deps } = setup();
    const u = await createUser(pool, "modem-buy@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r.outcome).toBe("fulfilled");
    if (r.outcome !== "fulfilled") return;
    expect(await balance(pool, u)).toBe(5_000_000 - DAY_KOBO);
    const o = await orderRow(r.order.id);
    expect(o).toMatchObject({ kind: "modem", status: "fulfilled", modem_period: "day", modem_country: "de", modem_carrier: "O2", total_kobo: DAY_KOBO, product_id: null });
    expect(Number(o.modem_cost_usd)).toBe(8);
    expect(Number(o.modem_price_usd)).toBe(10);
    expect(o.upstream_order_id).toMatch(/^o_/);
    const m = await modemRow(r.modemId);
    expect(m).toMatchObject({ user_id: u, country_code: "de", carrier_name: "O2", period: "day", status: "active", http_host: "modem-host.example", http_username: "u_2" });
    expect(m.external_id).toMatch(/^m_/);
    expect(m.socks_port).toBe(m.http_port! + 1);
    expect(m.rotate_token).toMatch(/^[a-f0-9]{36}$/);
    const post = posts(mock)[0];
    expect(post.body).toEqual({ tariffId: "t_de_o2_d", expectedPriceUsd: 8 });
    expect(post.idem).toBe(r.order.id);
  });

  it("uses the order lookup when Proxies.sx offers one", async () => {
    const { mock, deps } = setup({ orderLookup: true });
    const u = await createUser(pool, "modem-lookup@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "nl", carrierName: "Vodafone NL", period: "week" });
    expect(r.outcome).toBe("fulfilled");
    expect(mock.calls.some((c) => c.path.startsWith("/private-modems/orders/o_"))).toBe(true);
    expect(await balance(pool, u)).toBe(5_000_000 - 4_800_000); // $30 x 1600
  });

  it("refuses unprofitable, sold-out and unknown lines before charging anything", async () => {
    const { mock, deps } = setup();
    const u = await createUser(pool, "modem-guard@example.com");
    await fund(u, 10_000_000);
    await expect(buyModem(deps, { userId: u, countryCode: "us", carrierName: "Verizon", period: "day" })).rejects.toMatchObject({ code: "plan_unavailable" });
    await expect(buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "week" })).rejects.toMatchObject({ code: "plan_unavailable" });
    await expect(buyModem(deps, { userId: u, countryCode: "fr", carrierName: "Free", period: "day" })).rejects.toMatchObject({ code: "out_of_stock" });
    await expect(buyModem(deps, { userId: u, countryCode: "zz", carrierName: "X", period: "day" })).rejects.toMatchObject({ code: "plan_unavailable" });
    expect(await balance(pool, u)).toBe(10_000_000);
    expect(await orderCount(u)).toBe(0);
    expect(posts(mock)).toHaveLength(0);
  });

  it("the database itself refuses to sell at or below cost", async () => {
    const u = await createUser(pool, "modem-sql@example.com");
    await fund(u, 5_000_000);
    await expect(
      store.rpc("place_modem_order", { p_user_id: u, p_country_code: "us", p_country_name: "United States", p_carrier: "Verizon", p_period: "day", p_price_kobo: DAY_KOBO, p_price_usd: 10, p_cost_usd: 21, p_tariff_id: "t", p_modem_id: null }),
    ).rejects.toMatchObject({ code: "plan_unavailable" });
    expect(await balance(pool, u)).toBe(5_000_000);
  });

  it("refuses when the wallet is short", async () => {
    const { deps } = setup();
    const u = await createUser(pool, "modem-poor@example.com");
    await fund(u, 100_000);
    await expect(buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" })).rejects.toMatchObject({ code: "insufficient_balance" });
  });

  it("refunds at once when Proxies.sx refuses the order", async () => {
    const { deps, notify } = setup({ orderError: { status: 409, code: "no_stock" } });
    const u = await createUser(pool, "modem-nostock@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r).toMatchObject({ outcome: "failed", code: "no_stock" });
    expect(await balance(pool, u)).toBe(5_000_000);
    expect((await orderRow(r.order.id)).status).toBe("refunded");
    expect(notify).toHaveBeenCalledOnce();
  });

  it("alerts the admin loudly when his Proxies.sx balance is too low", async () => {
    const { deps, notify } = setup({ orderError: { status: 400, code: "insufficient_balance" } });
    const u = await createUser(pool, "modem-lowbal@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r.outcome).toBe("failed");
    expect(await balance(pool, u)).toBe(5_000_000);
    expect((notify.mock.calls[0] as unknown as string[])[0]).toMatch(/ACTION NEEDED/);
  });

  it("refunds when the modem fails to come up", async () => {
    const { deps } = setup({ failSetup: true });
    const u = await createUser(pool, "modem-failsetup@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r.outcome).toBe("failed");
    expect(await balance(pool, u)).toBe(5_000_000);
  });

  it("a slow setup answers 'pending' and is finished on the next page view", async () => {
    const { mock, deps } = setup({ setupPolls: 50 }, { setupWaitMs: 3_000 });
    const u = await createUser(pool, "modem-slow@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r.outcome).toBe("pending");
    expect(await balance(pool, u)).toBe(5_000_000 - DAY_KOBO);
    expect((await store.listOpenModemOrders(u)).map((o) => o.id)).toEqual([r.order.id]);
    for (const o of mock.orders.values()) o.polls = 49; // the modem comes up
    expect(await reconcileModemOrders(deps, u)).toBe(1);
    expect((await orderRow(r.order.id)).status).toBe("fulfilled");
    expect(await store.listOpenModemOrders(u)).toEqual([]);
  });

  it("an unknown outcome is retried with the same Idempotency-Key, never a second rental", async () => {
    const { mock, deps } = setup({ networkErrors: 2 });
    const u = await createUser(pool, "modem-net@example.com");
    await fund(u, 5_000_000);
    const r = await buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    expect(r.outcome).toBe("pending");
    expect((await orderRow(r.order.id)).upstream_order_id).toBeNull();
    const later = { ...deps, now: () => Date.now() + 120_000 };
    expect(await reconcileModemOrders(later, u)).toBe(1);
    expect((await orderRow(r.order.id)).status).toBe("fulfilled");
    expect(new Set(posts(mock).map((c) => c.idem))).toEqual(new Set([r.order.id]));
    expect(mock.orders.size).toBe(1);
  });

  it("respects the low-balance auto-pause: nothing is charged", async () => {
    const reader = { isConfigured: () => true, getBalanceUsd: async () => 3 };
    const { mock, deps } = setup({}, { balance: reader });
    const u = await createUser(pool, "modem-paused@example.com");
    await fund(u, 5_000_000);
    await expect(buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" })).rejects.toMatchObject({ code: "sales_paused" });
    expect(await balance(pool, u)).toBe(5_000_000);
    expect(posts(mock)).toHaveLength(0);
  });

  it("refuses when switched off or without an API key", async () => {
    const u = await createUser(pool, "modem-off@example.com");
    const noKey = new ProxiesSxModemsApi({ fetchImpl: mockProxiesSxModems().impl, apiBase: "https://api.test/v1" });
    const { deps } = setup();
    await expect(buyModem({ ...deps, api: noKey }, { userId: u, countryCode: "de", carrierName: "O2", period: "day" })).rejects.toMatchObject({ code: "provider_not_configured" });
    await store.setSetting("modems_enabled", false);
    try {
      await expect(buyModem(deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" })).rejects.toMatchObject({ code: "product_unavailable" });
    } finally {
      await store.setSetting("modems_enabled", true);
    }
  });

  it("the public price list works with no key (display only)", async () => {
    const api = new ProxiesSxModemsApi({ fetchImpl: mockProxiesSxModems().impl, apiBase: "https://api.test/v1" });
    const r = await api.catalog();
    expect(r.buyable).toBe(false);
    expect(r.tariffs.every((t) => t.tariffId === null)).toBe(true);
    expect(r.tariffs.find((t) => t.countryCode === "fr")).toBeUndefined(); // the public list only has lines in stock
  });
});

describe("private modems: renew, rotate, sync", () => {
  async function rented(email: string, opts: ModemMockOpts = {}) {
    const s = setup(opts);
    const u = await createUser(pool, email);
    await fund(u, 10_000_000);
    const r = await buyModem(s.deps, { userId: u, countryCode: "de", carrierName: "O2", period: "day" });
    if (r.outcome !== "fulfilled") throw new Error("setup failed");
    return { ...s, u, modem: await modemRow(r.modemId) };
  }

  it("renews from the wallet and pushes the end date", async () => {
    const { deps, u, modem, mock } = await rented("modem-renew@example.com");
    const before = new Date(modem.expires_at).getTime();
    const r = await renewModem(deps, { userId: u, modemId: modem.id, period: "day" });
    expect(r.outcome).toBe("fulfilled");
    expect(await balance(pool, u)).toBe(10_000_000 - 2 * DAY_KOBO);
    expect(new Date((await modemRow(modem.id)).expires_at).getTime()).toBeGreaterThan(before + 23 * 3_600_000);
    const call = mock.calls.find((c) => c.path.endsWith("/renew"))!;
    expect(call.body).toEqual({ period: "day", expectedPriceUsd: 8 });
    expect(call.idem).toBe(r.order.id);
    expect((await orderRow(r.order.id)).kind).toBe("modem_renewal");
  });

  it("won't renew a period that would sell below cost, or someone else's modem", async () => {
    const { deps, u, modem } = await rented("modem-renew2@example.com");
    await expect(renewModem(deps, { userId: u, modemId: modem.id, period: "week" })).rejects.toMatchObject({ code: "plan_unavailable" }); // $32 > $30
    const other = await createUser(pool, "modem-thief@example.com");
    await expect(renewModem(deps, { userId: other, modemId: modem.id, period: "day" })).rejects.toMatchObject({ code: "modem_not_found" });
    expect(await balance(pool, u)).toBe(10_000_000 - DAY_KOBO);
  });

  it("rotates through the API and records the time", async () => {
    const { deps, modem, mock } = await rented("modem-rotate@example.com");
    const r = await rotateModem(deps, modem);
    expect(r.message).toBe("New IP assigned.");
    expect(mock.calls.some((c) => c.method === "POST" && c.path === `/private-modems/${modem.external_id}/rotate`)).toBe(true);
    expect((await modemRow(modem.id)).last_rotated_at).not.toBeNull();
  });

  it("sync picks up expiry, status and replaced credentials", async () => {
    const { deps, modem, mock } = await rented("modem-sync@example.com");
    const up = mock.modems.get(modem.external_id)!;
    up.credentials.http.password = "p_new";
    up.online = false;
    const stale = { ...modem, last_synced_at: new Date(Date.now() - 10 * 60_000).toISOString() };
    expect(await syncModems(deps, [stale])).toBe(true);
    let row = await modemRow(modem.id);
    expect(row.http_password).toBe("p_new");
    expect(row.online).toBe(false);
    up.status = "expired";
    expect(await syncModems(deps, [{ ...row, last_synced_at: new Date(Date.now() - 10 * 60_000).toISOString() }])).toBe(true);
    row = await modemRow(modem.id);
    expect(row.status).toBe("expired");
    await expect(renewModem(deps, { userId: row.user_id, modemId: row.id, period: "day" })).rejects.toMatchObject({ code: "modem_not_renewable" });
  });
});
