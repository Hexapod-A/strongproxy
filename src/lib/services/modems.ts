import { formatNaira } from "@/lib/money";
import type { Notifier } from "@/lib/notify";
import {
  MODEM_PERIODS,
  ModemApiError,
  type MineSnapshot,
  type ModemPeriod,
  type ModemTariff,
  type ProxiesSxModemsApi,
  type PsxModem,
} from "@/lib/providers/proxiessx-modems";
import { StoreError, type Store } from "@/lib/store";
import type { Order, PrivateModem } from "@/lib/types";
import { refuseIfPaused, type BalanceReader } from "./balance-guard";

/**
 * Private modems: a whole Proxies.sx 4G/5G modem rented to one customer for a day, week or month.
 *
 *  Prices  John sets one USD price per period (default $10 / $30 / $115) and can override it per line
 *          (country + carrier + period). Customers pay naira: USD x the admin's NGN-per-USD rate, rounded up to ₦100.
 *  Margin  A line is only sold while Proxies.sx's live price for it is BELOW John's price (by more than the optional
 *          minimum margin). Everything else is hidden from customers and flagged in Admin > Private modems.
 *  Buy     live catalog -> margin + stock check -> auto-pause check -> wallet debit (place_modem_order)
 *          -> POST /private-modems/orders (Idempotency-Key = our order id, expectedPriceUsd = live price)
 *          -> poll /private-modems/mine until the modem is live -> store credentials (fulfil_modem_order).
 *          A definite refusal or a failed setup refunds the wallet at once (fail_and_refund_order).
 *          A slow setup stays "Setting up" and is finished by reconcileModemOrders() on the next page view.
 *  Renew   same, with GET renewal-quote + POST /:id/renew, extending the same modem.
 */
export type ModemDeps = {
  store: Store;
  notify: Notifier;
  api: ProxiesSxModemsApi;
  balance?: BalanceReader;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long a buy waits for the modem to come up before answering "setting up" (default 45 s). */
  setupWaitMs?: number;
  pollMs?: number;
};

export const MODEM_PERIOD_LIST: ModemPeriod[] = MODEM_PERIODS;
export const DEFAULT_MODEM_PRICES: Record<ModemPeriod, number> = { day: 10, week: 30, month: 115 };
export const PERIOD_DAYS: Record<ModemPeriod, number> = { day: 1, week: 7, month: 30 };
export const PERIOD_LABEL: Record<ModemPeriod, string> = { day: "1 day", week: "1 week", month: "1 month" };

export type LineOverride = { priceUsd?: number | null; hidden?: boolean };
export type ModemPricing = {
  enabled: boolean;
  prices: Record<ModemPeriod, number>;
  rate: number; // NGN per USD
  minMarginUsd: number;
  overrides: Record<string, LineOverride>;
};

const n = (v: unknown, d: number) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

export function normalizePricing(raw: { enabled?: unknown; prices?: unknown; rate?: unknown; minMargin?: unknown; overrides?: unknown } | null | undefined): ModemPricing {
  const r = raw ?? {};
  const p = (r.prices && typeof r.prices === "object" ? r.prices : {}) as Record<string, unknown>;
  const ov = (r.overrides && typeof r.overrides === "object" ? r.overrides : {}) as Record<string, LineOverride>;
  return {
    enabled: !(r.enabled === false || r.enabled === "false"),
    prices: { day: n(p.day, DEFAULT_MODEM_PRICES.day), week: n(p.week, DEFAULT_MODEM_PRICES.week), month: n(p.month, DEFAULT_MODEM_PRICES.month) },
    rate: n(r.rate, 1600) > 0 ? n(r.rate, 1600) : 1600,
    minMarginUsd: Math.max(0, n(r.minMargin, 0)),
    overrides: ov,
  };
}

export async function modemPricing(store: Store): Promise<ModemPricing> {
  const [enabled, prices, rate, minMargin, overrides] = await Promise.all([
    store.getSetting("modems_enabled"),
    store.getSetting("modem_prices_usd"),
    store.getSetting("usd_ngn_rate"),
    store.getSetting("modem_min_margin_usd"),
    store.getSetting("modem_line_overrides"),
  ]);
  return normalizePricing({ enabled, prices, rate, minMargin, overrides });
}

export const lineKey = (countryCode: string, carrier: string, period: ModemPeriod) => `${countryCode.toUpperCase()}|${carrier}|${period}`;

/** Naira price in kobo: USD x rate, rounded UP to the next ₦100. */
export function modemPriceKobo(usd: number, rate: number): number {
  return Math.ceil((usd * rate) / 100) * 100 * 100;
}

export type LineState = "selling" | "out_of_stock" | "blocked" | "hidden";
export type ModemLine = ModemTariff & {
  key: string;
  sellUsd: number;
  priceKobo: number;
  marginUsd: number;
  overridden: boolean;
  state: LineState;
};

export function sellPriceUsd(pricing: ModemPricing, countryCode: string, carrier: string, period: ModemPeriod): { usd: number; overridden: boolean; hidden: boolean } {
  const o = pricing.overrides[lineKey(countryCode, carrier, period)];
  const custom = o && o.priceUsd !== null && o.priceUsd !== undefined && Number(o.priceUsd) > 0 ? Number(o.priceUsd) : null;
  return { usd: custom ?? pricing.prices[period], overridden: custom !== null, hidden: Boolean(o?.hidden) };
}

/** Margin guard: a line sells only while its upstream cost is below John's price by more than the minimum margin. */
export function isProfitable(costUsd: number, sellUsd: number, minMarginUsd: number): boolean {
  return sellUsd - costUsd > minMarginUsd + 1e-9;
}

export function evaluateLines(tariffs: ModemTariff[], pricing: ModemPricing): ModemLine[] {
  return tariffs
    .map((t) => {
      const sp = sellPriceUsd(pricing, t.countryCode, t.carrierName, t.period);
      const marginUsd = Math.round((sp.usd - t.priceUsd) * 100) / 100;
      const state: LineState = sp.hidden ? "hidden" : !isProfitable(t.priceUsd, sp.usd, pricing.minMarginUsd) ? "blocked" : t.stock < 1 ? "out_of_stock" : "selling";
      return { ...t, key: lineKey(t.countryCode, t.carrierName, t.period), sellUsd: sp.usd, priceKobo: modemPriceKobo(sp.usd, pricing.rate), marginUsd, overridden: sp.overridden, state };
    })
    .sort((a, b) => a.countryName.localeCompare(b.countryName) || a.carrierName.localeCompare(b.carrierName) || MODEM_PERIODS.indexOf(a.period) - MODEM_PERIODS.indexOf(b.period));
}

export type CarrierOffer = { name: string; periods: Partial<Record<ModemPeriod, { priceKobo: number; inStock: boolean; stock: number }>>; inStock: boolean };
export type CountryOffer = { code: string; name: string; carriers: CarrierOffer[]; inStock: boolean; fromKobo: number | null; fromPeriod: ModemPeriod | null };

/**
 * What customers see: only lines John makes money on. Out-of-stock lines stay visible (greyed); blocked or hidden
 * lines are left out entirely. Countries with nothing left are dropped.
 */
export function customerOffers(lines: ModemLine[]): CountryOffer[] {
  const byCountry = new Map<string, CountryOffer>();
  for (const l of lines) {
    if (l.state !== "selling" && l.state !== "out_of_stock") continue;
    let c = byCountry.get(l.countryCode);
    if (!c) {
      c = { code: l.countryCode, name: l.countryName, carriers: [], inStock: false, fromKobo: null, fromPeriod: null };
      byCountry.set(l.countryCode, c);
    }
    let car = c.carriers.find((x) => x.name === l.carrierName);
    if (!car) {
      car = { name: l.carrierName, periods: {}, inStock: false };
      c.carriers.push(car);
    }
    const inStock = l.state === "selling";
    car.periods[l.period] = { priceKobo: l.priceKobo, inStock, stock: l.stock };
    if (inStock) {
      car.inStock = true;
      c.inStock = true;
      if (c.fromKobo === null || l.priceKobo < c.fromKobo) {
        c.fromKobo = l.priceKobo;
        c.fromPeriod = l.period;
      }
    }
  }
  return [...byCountry.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------
// Live catalog (cached 60 s for page views; buys always read it fresh)

export const CATALOG_TTL_MS = 60_000;
let catCache: { at: number; api: ProxiesSxModemsApi; tariffs: ModemTariff[]; buyable: boolean } | null = null;
export function resetModemCatalogCache() {
  catCache = null;
}

export async function loadModemCatalog(api: ProxiesSxModemsApi, opts: { fresh?: boolean; now?: number } = {}): Promise<{ tariffs: ModemTariff[]; buyable: boolean }> {
  const now = opts.now ?? Date.now();
  if (!opts.fresh && catCache && catCache.api === api && now - catCache.at < CATALOG_TTL_MS) return { tariffs: catCache.tariffs, buyable: catCache.buyable };
  const r = await api.catalog();
  catCache = { at: now, api, ...r };
  return r;
}

/** Everything a page needs: the evaluated lines + customer offers. Never throws (live: false when the feed is down). */
export async function modemOffers(api: ProxiesSxModemsApi, pricing: ModemPricing): Promise<{ live: boolean; buyable: boolean; lines: ModemLine[]; offers: CountryOffer[]; error?: string }> {
  try {
    const { tariffs, buyable } = await loadModemCatalog(api);
    const lines = evaluateLines(tariffs, pricing);
    return { live: true, buyable, lines, offers: customerOffers(lines) };
  } catch (e) {
    console.error("private modem catalog unavailable", e);
    return { live: false, buyable: false, lines: [], offers: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Buy / renew

export type ModemBuyResult =
  | { outcome: "fulfilled"; order: Order; modemId: string }
  | { outcome: "pending"; order: Order }
  | { outcome: "failed"; order: Order; reason: string; code: string | null; balanceKobo: number };

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const wait = (deps: ModemDeps, ms: number) => (deps.sleep ? deps.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms)));

const FAIL_TEXT: Record<string, string> = {
  no_stock: "That modem just sold out at the supplier.",
  price_changed: "The supplier changed the price a moment ago.",
  insufficient_balance: "Private modems are temporarily unavailable.",
  scope_missing: "Private modems are temporarily unavailable.",
  recent_checkout: "The same modem was ordered under 2 minutes ago.",
};

async function refund(deps: ModemDeps, order: Order, reason: string, code: string | null): Promise<ModemBuyResult> {
  const balanceKobo = await deps.store.rpc<number>("fail_and_refund_order", { p_order_id: order.id, p_reason: reason });
  const what = `${order.kind === "modem_renewal" ? "renewal of a private modem" : "private modem"} ${(order.modem_country ?? "").toUpperCase()} ${order.modem_carrier ?? ""} (1 ${order.modem_period})`;
  const urgent = code === "insufficient_balance" || code === "scope_missing";
  await deps.notify(
    urgent ? `ACTION NEEDED: Proxies.sx refused a private modem (${code})` : `Private modem order failed, refunded ${formatNaira(order.total_kobo)}`,
    `Order ${order.id}: ${what}.\nReason: ${reason}\nThe customer's wallet was refunded ${formatNaira(order.total_kobo)} automatically.` +
      (code === "insufficient_balance" ? "\nYour Proxies.sx balance is too low for this rental. Top up Proxies.sx." : "") +
      (code === "scope_missing" ? "\nYour Proxies.sx API key needs the modems:purchase scope (client.proxies.sx > Account > API keys)." : ""),
  );
  return { outcome: "failed", order, reason, code, balanceKobo };
}

type Resolution = { state: "live"; modem: PsxModem } | { state: "failed"; error: string } | { state: "pending" };

function hasCreds(m: PsxModem) {
  return Boolean(m.http || m.socks5);
}

/** Where does a Proxies.sx BUY order stand? (See the UNVERIFIED note in proxiessx-modems.ts.) */
async function resolveBuy(deps: ModemDeps, order: Order, mine: MineSnapshot): Promise<Resolution> {
  const id = order.upstream_order_id;
  if (!id) return { state: "pending" };
  const failed = mine.recentFailed.find((o) => o.orderId === id);
  if (failed) return { state: "failed", error: failed.error ?? "Setup failed at the supplier" };
  const ref = await deps.api.getOrder(id);
  if (ref && /fail|cancel|refund/i.test(ref.status)) return { state: "failed", error: ref.error ?? `Supplier order ${ref.status}` };
  const open = mine.openOrders.find((o) => o.orderId === id);
  const modemId = ref?.modemId ?? open?.modemId ?? mine.modems.find((m) => m.orderId === id)?.id ?? null;
  if (modemId) {
    const m = mine.modems.find((x) => x.id === modemId);
    return m && m.status === "active" && hasCreds(m) ? { state: "live", modem: m } : { state: "pending" };
  }
  if (open || ref) return { state: "pending" };
  // Last resort: the order has left openOrders and no call names its modem. Take the unowned modem on the account
  // that matches this order's line and whose expiry fits a rental that started with this order.
  const period = (order.modem_period ?? "day") as ModemPeriod;
  const expected = new Date(order.created_at).getTime() + PERIOD_DAYS[period] * 86_400_000;
  const candidates: PsxModem[] = [];
  for (const m of mine.modems) {
    if (m.status !== "active" || !hasCreds(m) || !m.expiresAt) continue;
    if (m.period && m.period !== period) continue;
    if (m.countryCode ? m.countryCode !== order.modem_country : !sameText(m.countryName, order.modem_country_name)) continue;
    if (order.modem_carrier && m.carrierName && !sameText(m.carrierName, order.modem_carrier)) continue;
    if (Math.abs(m.expiresAt.getTime() - expected) > 3 * 3_600_000) continue;
    if (await deps.store.findPrivateModem({ provider: "proxies_sx", externalId: m.id })) continue;
    candidates.push(m);
  }
  candidates.sort((a, b) => Math.abs(a.expiresAt!.getTime() - expected) - Math.abs(b.expiresAt!.getTime() - expected));
  return candidates[0] ? { state: "live", modem: candidates[0] } : { state: "pending" };
}

async function fulfilBuy(deps: ModemDeps, order: Order, m: PsxModem): Promise<string> {
  return deps.store.rpc<string>("fulfil_modem_order", {
    p_order_id: order.id,
    p_external_id: m.id,
    p_expires_at: (m.expiresAt ?? new Date((deps.now?.() ?? Date.now()) + PERIOD_DAYS[(order.modem_period ?? "day") as ModemPeriod] * 86_400_000)).toISOString(),
    p_http_host: m.http?.host ?? null,
    p_http_port: m.http?.port ?? null,
    p_http_username: m.http?.username ?? null,
    p_http_password: m.http?.password ?? null,
    p_socks_host: m.socks5?.host ?? null,
    p_socks_port: m.socks5?.port ?? null,
    p_socks_username: m.socks5?.username ?? null,
    p_socks_password: m.socks5?.password ?? null,
    p_country_name: m.countryName,
    p_carrier: m.carrierName,
    p_online: m.online,
  });
}

/** Where does a RENEW order stand? Done when the modem's expiry has moved past what we had. */
async function resolveRenewal(deps: ModemDeps, order: Order, mine: MineSnapshot): Promise<Resolution & { expiresAt?: Date }> {
  const id = order.upstream_order_id;
  if (!id) return { state: "pending" };
  const failed = mine.recentFailed.find((o) => o.orderId === id);
  if (failed) return { state: "failed", error: failed.error ?? "Renewal failed at the supplier" };
  const ours = order.private_modem_id ? await deps.store.getPrivateModem(order.private_modem_id) : null;
  if (!ours) return { state: "failed", error: "modem_not_found" };
  const m = mine.modems.find((x) => x.id === ours.external_id);
  const stillOpen = mine.openOrders.some((o) => o.orderId === id);
  if (m?.expiresAt && m.expiresAt.getTime() > new Date(ours.expires_at).getTime() + 3_600_000 && !stillOpen) return { state: "live", modem: m, expiresAt: m.expiresAt };
  return { state: "pending" };
}

async function settle(deps: ModemDeps, order: Order, kind: "buy" | "renew"): Promise<ModemBuyResult | null> {
  const mine = await deps.api.mine();
  if (kind === "buy") {
    const r = await resolveBuy(deps, order, mine);
    if (r.state === "live") return { outcome: "fulfilled", order, modemId: await fulfilBuy(deps, order, r.modem) };
    if (r.state === "failed") return refund(deps, order, r.error, null);
    return null;
  }
  const r = await resolveRenewal(deps, order, mine);
  if (r.state === "live") return { outcome: "fulfilled", order, modemId: await deps.store.rpc<string>("fulfil_modem_renewal", { p_order_id: order.id, p_expires_at: r.expiresAt!.toISOString() }) };
  if (r.state === "failed") return refund(deps, order, r.error, null);
  return null;
}

async function waitForSetup(deps: ModemDeps, order: Order, kind: "buy" | "renew"): Promise<ModemBuyResult> {
  const deadline = (deps.now?.() ?? Date.now()) + (deps.setupWaitMs ?? 45_000);
  const step = deps.pollMs ?? 4_000;
  for (;;) {
    try {
      const done = await settle(deps, order, kind);
      if (done) return done;
    } catch (e) {
      console.error("private modem poll failed", order.id, e);
    }
    if ((deps.now?.() ?? Date.now()) + step > deadline) break;
    await wait(deps, step);
  }
  return { outcome: "pending", order };
}

/** POST to Proxies.sx; definite refusal -> refund; unknown outcome -> one retry with the same key, then "pending". */
async function submit(deps: ModemDeps, order: Order, post: () => Promise<{ orderId: string }>): Promise<ModemBuyResult | { orderId: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await post();
    } catch (e) {
      const err = e instanceof ModemApiError ? e : new ModemApiError(e instanceof Error ? e.message : String(e), undefined, null, null);
      if (err.definite) {
        const text = (err.code && FAIL_TEXT[err.code]) ?? "The supplier couldn't set it up.";
        return refund(deps, order, `${text} (${err.message})`, err.code);
      }
      console.error("private modem order: unknown outcome", order.id, err.message);
    }
  }
  return { outcome: "pending", order };
}

export async function buyModem(deps: ModemDeps, input: { userId: string; countryCode: string; carrierName: string; period: ModemPeriod }): Promise<ModemBuyResult> {
  if (!deps.api.isConfigured()) throw new StoreError("provider_not_configured");
  const pricing = await modemPricing(deps.store);
  if (!pricing.enabled) throw new StoreError("product_unavailable");
  const { tariffs, buyable } = await loadModemCatalog(deps.api, { fresh: true });
  if (!buyable) throw new StoreError("provider_not_configured");
  const cc = input.countryCode.toLowerCase();
  const lines = evaluateLines(
    tariffs.filter((t) => t.countryCode === cc && t.carrierName === input.carrierName && t.period === input.period),
    pricing,
  );
  const line = lines.find((l) => l.state === "selling") ?? lines[0];
  if (!line || line.state === "blocked" || line.state === "hidden" || !line.tariffId) throw new StoreError("plan_unavailable");
  if (line.state === "out_of_stock") throw new StoreError("out_of_stock");

  if (deps.balance) {
    await refuseIfPaused({ store: deps.store, notify: deps.notify, reader: deps.balance, now: deps.now }, line.priceUsd, `a private modem (${line.countryName} ${line.carrierName}, ${PERIOD_LABEL[line.period]})`);
  }

  const order = await deps.store.rpc<Order>("place_modem_order", {
    p_user_id: input.userId,
    p_country_code: cc,
    p_country_name: line.countryName,
    p_carrier: line.carrierName,
    p_period: line.period,
    p_price_kobo: line.priceKobo,
    p_price_usd: line.sellUsd,
    p_cost_usd: line.priceUsd,
    p_tariff_id: line.tariffId,
    p_modem_id: null,
  });

  const sent = await submit(deps, order, () => deps.api.createOrder({ tariffId: line.tariffId!, expectedPriceUsd: line.priceUsd }, order.id));
  if ("outcome" in sent) return sent;
  await deps.store.rpc("set_modem_upstream_order", { p_order_id: order.id, p_upstream_order_id: sent.orderId });
  return waitForSetup(deps, { ...order, upstream_order_id: sent.orderId }, "buy");
}

export async function renewModem(deps: ModemDeps, input: { userId: string; modemId: string; period: ModemPeriod }): Promise<ModemBuyResult> {
  if (!deps.api.isConfigured()) throw new StoreError("provider_not_configured");
  const modem = await deps.store.getPrivateModem(input.modemId);
  if (!modem || modem.user_id !== input.userId) throw new StoreError("modem_not_found");
  if (modem.status !== "active" || new Date(modem.expires_at).getTime() <= (deps.now?.() ?? Date.now())) throw new StoreError("modem_not_renewable");
  const pricing = await modemPricing(deps.store);
  if (!pricing.enabled) throw new StoreError("product_unavailable");

  const quote = await deps.api.renewalQuote(modem.external_id);
  const opt = quote.find((o) => o.period === input.period);
  if (!opt || !opt.available) throw new StoreError("plan_unavailable");
  const sp = sellPriceUsd(pricing, modem.country_code, modem.carrier_name ?? "", input.period);
  if (sp.hidden || !isProfitable(opt.priceUsd, sp.usd, pricing.minMarginUsd)) throw new StoreError("plan_unavailable");

  if (deps.balance) {
    await refuseIfPaused({ store: deps.store, notify: deps.notify, reader: deps.balance, now: deps.now }, opt.priceUsd, `a private modem renewal (${PERIOD_LABEL[input.period]})`);
  }

  const order = await deps.store.rpc<Order>("place_modem_order", {
    p_user_id: input.userId,
    p_country_code: modem.country_code,
    p_country_name: modem.country_name,
    p_carrier: modem.carrier_name,
    p_period: input.period,
    p_price_kobo: modemPriceKobo(sp.usd, pricing.rate),
    p_price_usd: sp.usd,
    p_cost_usd: opt.priceUsd,
    p_tariff_id: null,
    p_modem_id: modem.id,
  });

  const sent = await submit(deps, order, () => deps.api.renew(modem.external_id, { period: input.period, expectedPriceUsd: opt.priceUsd }, order.id));
  if ("outcome" in sent) return sent;
  await deps.store.rpc("set_modem_upstream_order", { p_order_id: order.id, p_upstream_order_id: sent.orderId });
  return waitForSetup(deps, { ...order, upstream_order_id: sent.orderId }, "renew");
}

/** Orders older than this with no Proxies.sx order id and no answer from Proxies.sx are refunded. */
export const UNKNOWN_ORDER_REFUND_MS = 30 * 60_000;

/**
 * Finish what a slow setup left open: on each dashboard/admin page view, every 'processing' modem order is checked.
 * No upstream id yet -> the same POST is repeated with the same Idempotency-Key (Proxies.sx returns the same order,
 * never a second one). Delivered -> stored. Failed upstream -> refunded.
 */
export async function reconcileModemOrders(deps: ModemDeps, userId: string | null): Promise<number> {
  if (!deps.api.isConfigured()) return 0;
  const open = await deps.store.listOpenModemOrders(userId);
  let changed = 0;
  for (const o of open) {
    try {
      const age = (deps.now?.() ?? Date.now()) - new Date(o.created_at).getTime();
      const kind = o.kind === "modem_renewal" ? "renew" : "buy";
      let order = o;
      if (!o.upstream_order_id) {
        if (age < 60_000) continue; // a buy in another request may still be running
        const cost = Number(o.modem_cost_usd ?? 0);
        const post =
          kind === "buy"
            ? () => deps.api.createOrder({ tariffId: o.modem_tariff_id ?? "", expectedPriceUsd: cost }, o.id)
            : async () => {
                const m = o.private_modem_id ? await deps.store.getPrivateModem(o.private_modem_id) : null;
                if (!m) throw new ModemApiError("modem_not_found", 404, "modem_not_found", null);
                return deps.api.renew(m.external_id, { period: (o.modem_period ?? "day") as ModemPeriod, expectedPriceUsd: cost }, o.id);
              };
        const sent = await submit(deps, o, post);
        if ("outcome" in sent) {
          if (sent.outcome === "failed") changed++;
          else if (age > UNKNOWN_ORDER_REFUND_MS) {
            await refund(deps, o, "Proxies.sx never confirmed the order. Check client.proxies.sx/private-modems for a stray rental.", null);
            changed++;
          }
          continue;
        }
        await deps.store.rpc("set_modem_upstream_order", { p_order_id: o.id, p_upstream_order_id: sent.orderId });
        order = { ...o, upstream_order_id: sent.orderId };
      }
      if (await settle(deps, order, kind)) changed++;
    } catch (e) {
      console.error("private modem reconcile failed", o.id, e);
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------------------------
// Sync + rotate

const STATUS_MAP: Record<string, PrivateModem["status"]> = { active: "active", expired: "expired", dead: "dead", replaced: "replaced", cancelled: "cancelled" };
export const MODEM_SYNC_MS = 2 * 60_000;

/** Re-read the customer's modems from /mine (at most every 2 minutes per modem). Returns true when anything changed. */
export async function syncModems(deps: Pick<ModemDeps, "store" | "api" | "now">, modems: PrivateModem[]): Promise<boolean> {
  if (!deps.api.isConfigured() || modems.length === 0) return false;
  const now = deps.now?.() ?? Date.now();
  const due = modems.filter((m) => !m.last_synced_at || now - new Date(m.last_synced_at).getTime() > MODEM_SYNC_MS);
  if (due.length === 0) return false;
  let mine: MineSnapshot;
  try {
    mine = await deps.api.mine();
  } catch (e) {
    console.error("private modem sync failed", e);
    return false;
  }
  let changed = false;
  for (const ours of due) {
    const m = mine.modems.find((x) => x.id === ours.external_id);
    if (!m) {
      const expired = new Date(ours.expires_at).getTime() <= now;
      await deps.store.rpc("sync_private_modem", { p_id: ours.id, p_status: expired ? "expired" : null, p_expires_at: null, p_online: null, p_rotated: false, p_creds: null });
      changed ||= expired;
      continue;
    }
    const creds: Record<string, unknown> = {};
    if (m.http && (m.http.host !== ours.http_host || m.http.port !== ours.http_port || m.http.username !== ours.http_username || m.http.password !== ours.http_password)) {
      Object.assign(creds, { http_host: m.http.host, http_port: m.http.port, http_username: m.http.username, http_password: m.http.password });
    }
    if (m.socks5 && (m.socks5.host !== ours.socks_host || m.socks5.port !== ours.socks_port || m.socks5.username !== ours.socks_username || m.socks5.password !== ours.socks_password)) {
      Object.assign(creds, { socks_host: m.socks5.host, socks_port: m.socks5.port, socks_username: m.socks5.username, socks_password: m.socks5.password });
    }
    const status = STATUS_MAP[m.status] ?? null;
    await deps.store.rpc("sync_private_modem", {
      p_id: ours.id,
      p_status: status,
      p_expires_at: m.expiresAt ? m.expiresAt.toISOString() : null,
      p_online: m.online,
      p_rotated: false,
      p_creds: Object.keys(creds).length ? creds : null,
    });
    changed ||= Boolean(Object.keys(creds).length) || (status !== null && status !== ours.status) || (m.expiresAt !== null && m.expiresAt.getTime() !== new Date(ours.expires_at).getTime()) || m.online !== ours.online;
  }
  return changed;
}

export async function rotateModem(deps: Pick<ModemDeps, "store" | "api">, modem: PrivateModem): Promise<{ message: string }> {
  const r = await deps.api.rotate(modem.external_id);
  await deps.store.rpc("sync_private_modem", { p_id: modem.id, p_status: null, p_expires_at: null, p_online: null, p_rotated: true, p_creds: null });
  return { message: r.message };
}
