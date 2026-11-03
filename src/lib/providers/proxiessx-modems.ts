/**
 * Proxies.sx PRIVATE MODEMS API (a whole 4G/5G modem rented by day, week or month; unlimited traffic).
 *
 * Read 2026-11-03 from the contract https://agents.proxies.sx/modems/skill.md ("Last verified: 2026-10-28"),
 * https://www.proxies.sx/llms.txt and the public price list GET https://api.proxies.sx/v1/pricing.
 *
 *   auth header  X-API-Key: psx_...   buying and renewing need the scope modems:purchase (else 403 scope_missing)
 *   GET  /private-modems/catalog       {maxCartModems, tariffs:[{tariffId, period, countryCode, countryName, carrierId,
 *                                        carrierName, stock, priceUsd, openvpn, p0f, regions:[...]}]}
 *   POST /private-modems/orders        {tariffId, expectedPriceUsd} + Idempotency-Key -> 201 {orderId, status:"pending", modemId:null, ...}
 *                                      errors (with `code`): price_changed 409, no_stock 409, insufficient_balance 400,
 *                                      recent_checkout 409, scope_missing 403, expected_price_required 400
 *   GET  /private-modems/mine          {openOrders, recentFailed, modems:[{id, status, countryCode, countryName, carrierName,
 *                                        period, expiresAt, online, currentIp, credentials:{http:{host,port,username,password},
 *                                        socks5:{...}}, rotationToken, autoRenew, ...}]}
 *   POST /private-modems/:id/rotate    {rotated, pending, message}
 *   GET  /private-modems/:id/renewal-quote  {options:[{period, days, priceUsd, available, reason, extendsTo}]}
 *   POST /private-modems/:id/renew     {expectedPriceUsd, period} + Idempotency-Key -> 201 {orderId, kind:"renew", status}
 *   GET  /pricing (public, no key)     privateModems.plans[] {countryCode, countryName, carrierName, period, priceUsd, stock}
 *
 * UNVERIFIED (confirm with a live key before taking real orders):
 *  - How a finished order points at its modem. The contract shows `modemId` on the order (null while pending) but no
 *    "get one order" call. We try GET /private-modems/orders/:orderId, then look for the order id on /mine
 *    (openOrders / recentFailed / a modem's orderId), and as a last resort take the newest modem on /mine that no
 *    StrongProxy rental owns yet and matches the country, carrier and period.
 *  - The exact shape of items inside openOrders / recentFailed (we read orderId or id).
 *  - Whether the reseller pays exactly the catalog priceUsd (the contract calls it "retail per plan"); the margin guard
 *    uses it as the cost. A reseller discount would only make the margin bigger.
 */
import { ProviderError } from "./types";
import { PROXIES_SX_API, parseDate } from "./proxiessx-ports";

export type ModemPeriod = "day" | "week" | "month";
export const MODEM_PERIODS: ModemPeriod[] = ["day", "week", "month"];

export type ModemTariff = {
  tariffId: string | null; // null when read from the public price list (display only)
  period: ModemPeriod;
  countryCode: string; // lower-case ISO (gb, de, us ...)
  countryName: string;
  carrierName: string;
  priceUsd: number; // what Proxies.sx charges John
  stock: number;
};

export type ModemCreds = { host: string; port: number | null; username: string; password: string };

export type PsxModem = {
  id: string;
  status: string;
  countryCode: string | null;
  countryName: string | null;
  carrierName: string | null;
  period: string | null;
  expiresAt: Date | null;
  online: boolean | null;
  http: ModemCreds | null;
  socks5: ModemCreds | null;
  orderId: string | null;
};

export type ModemOrderRef = { orderId: string; status: string; modemId: string | null; error: string | null; refunded: boolean };

export type MineSnapshot = { modems: PsxModem[]; openOrders: ModemOrderRef[]; recentFailed: ModemOrderRef[] };

export type RenewalOption = { period: ModemPeriod; priceUsd: number; available: boolean; reason: string | null; extendsTo: Date | null };

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const isPeriod = (v: unknown): v is ModemPeriod => v === "day" || v === "week" || v === "month";
const cc = (v: unknown) => {
  const c = str(v)?.toLowerCase() ?? null;
  return c === "uk" ? "gb" : c;
};

/** Catalog ({tariffs}) or public price list ({privateModems:{plans}}) -> tariffs. Lines without a price are skipped. */
export function parseTariffs(raw: unknown): ModemTariff[] {
  const o = (raw ?? {}) as Json;
  const pm = o.privateModems as Json | undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(o.tariffs) ? o.tariffs : Array.isArray(pm?.plans) ? pm.plans : Array.isArray(o.plans) ? o.plans : [];
  const out: ModemTariff[] = [];
  for (const it of list as unknown[]) {
    if (!it || typeof it !== "object") continue;
    const t = it as Json;
    const code = cc(t.countryCode);
    const priceUsd = num(t.priceUsd);
    if (!code || !/^[a-z]{2}$/.test(code) || !isPeriod(t.period) || priceUsd === null || priceUsd <= 0) continue;
    out.push({
      tariffId: str(t.tariffId),
      period: t.period,
      countryCode: code,
      countryName: str(t.countryName) ?? code.toUpperCase(),
      carrierName: str(t.carrierName) ?? "Any carrier",
      priceUsd,
      stock: Math.max(0, num(t.stock) ?? 0),
    });
  }
  return out;
}

function parseCreds(raw: unknown): ModemCreds | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Json;
  const host = str(o.host);
  const username = str(o.username) ?? str(o.login);
  const password = str(o.password);
  if (!host || !username || !password) return null;
  return { host, port: num(o.port), username, password };
}

export function parseModem(raw: unknown): PsxModem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Json;
  const id = str(o.id) ?? str(o._id) ?? str(o.modemId);
  if (!id) return null;
  const creds = (o.credentials ?? {}) as Json;
  return {
    id,
    status: str(o.status) ?? "active",
    countryCode: cc(o.countryCode),
    countryName: str(o.countryName),
    carrierName: str(o.carrierName),
    period: str(o.period),
    expiresAt: parseDate(o.expiresAt),
    online: bool(o.online),
    http: parseCreds(creds.http),
    socks5: parseCreds(creds.socks5 ?? creds.socks),
    orderId: str(o.orderId) ?? str(o.lastOrderId),
  };
}

function parseOrderRef(raw: unknown): ModemOrderRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Json;
  const orderId = str(o.orderId) ?? str(o.id);
  if (!orderId) return null;
  return { orderId, status: str(o.status) ?? "pending", modemId: str(o.modemId), error: str(o.error), refunded: o.refunded === true };
}

export function parseMine(raw: unknown): MineSnapshot {
  const o = (raw ?? {}) as Json;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    modems: arr(o.modems).map(parseModem).filter((m): m is PsxModem => m !== null),
    openOrders: arr(o.openOrders).map(parseOrderRef).filter((m): m is ModemOrderRef => m !== null),
    recentFailed: arr(o.recentFailed).map(parseOrderRef).filter((m): m is ModemOrderRef => m !== null),
  };
}

export function parseRenewalQuote(raw: unknown): RenewalOption[] {
  const o = (raw ?? {}) as Json;
  const list = Array.isArray(o.options) ? o.options : [];
  const out: RenewalOption[] = [];
  for (const it of list as unknown[]) {
    const r = (it ?? {}) as Json;
    const priceUsd = num(r.priceUsd);
    if (!isPeriod(r.period) || priceUsd === null) continue;
    out.push({ period: r.period, priceUsd, available: r.available !== false, reason: str(r.reason), extendsTo: parseDate(r.extendsTo) });
  }
  return out;
}

/** Error from Proxies.sx with its documented `code` (price_changed, no_stock, insufficient_balance, ...). */
export class ModemApiError extends ProviderError {
  constructor(message: string, status: number | undefined, public readonly code: string | null, body: unknown) {
    super(message, status, body);
    this.name = "ModemApiError";
  }
  /** A definite "no": the order was not placed and nothing was charged upstream. */
  get definite(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500;
  }
}

export type PsxModemsConfig = { apiKey?: string; apiBase?: string; fetchImpl?: typeof fetch };

export class ProxiesSxModemsApi {
  readonly label = "Proxies.sx";
  constructor(private readonly cfg: PsxModemsConfig) {}

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey);
  }
  private get base() {
    return (this.cfg.apiBase ?? PROXIES_SX_API).replace(/\/+$/, "");
  }

  private async call<T = unknown>(method: string, path: string, opts: { body?: unknown; idem?: string; auth?: boolean; allow404?: boolean } = {}): Promise<T | null> {
    const auth = opts.auth ?? true;
    if (auth && !this.cfg.apiKey) throw new ModemApiError("proxies_sx_not_configured", undefined, "not_configured", null);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth && this.cfg.apiKey) headers["X-API-Key"] = this.cfg.apiKey;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idem) headers["Idempotency-Key"] = opts.idem;
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(`${this.base}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // The public price list may be cached by Next for a minute (keeps the landing page static); account calls never are.
        ...(auth ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // Network error / timeout: the outcome is unknown (status undefined -> not "definite").
      throw new ModemApiError(`proxies_sx ${method} ${path} network error: ${e instanceof Error ? e.message : String(e)}`, undefined, null, null);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (opts.allow404 && res.status === 404) return null;
    if (!res.ok) {
      const d = (data && typeof data === "object" ? data : {}) as Json;
      const code = str(d.code) ?? str(d.error) ?? null;
      const m = d.message ?? d.error ?? d.fix;
      const msg = Array.isArray(m) ? m.join("; ") : m ? String(m) : `HTTP ${res.status}`;
      throw new ModemApiError(`proxies_sx ${method} ${path.replace(/\/m_[^/]+/, "/:id")} failed (${res.status}${code ? ` ${code}` : ""}): ${msg}`, res.status, code, data);
    }
    return data as T;
  }

  /** Live tariffs. With a key: the catalog (has tariffIds, buyable). Without: the public price list (display only). */
  async catalog(): Promise<{ tariffs: ModemTariff[]; buyable: boolean }> {
    if (this.isConfigured()) return { tariffs: parseTariffs(await this.call("GET", "/private-modems/catalog")), buyable: true };
    return { tariffs: parseTariffs(await this.call("GET", "/pricing", { auth: false })), buyable: false };
  }

  async createOrder(input: { tariffId: string; expectedPriceUsd: number }, idempotencyKey: string): Promise<ModemOrderRef> {
    const r = await this.call("POST", "/private-modems/orders", { body: input, idem: idempotencyKey });
    const ref = parseOrderRef(r);
    if (!ref) throw new ModemApiError("proxies_sx: order response had no orderId", 502, "bad_response", r);
    return ref;
  }

  /** UNVERIFIED endpoint (not in the contract); returns null when it doesn't exist. */
  async getOrder(orderId: string): Promise<ModemOrderRef | null> {
    try {
      return parseOrderRef(await this.call("GET", `/private-modems/orders/${encodeURIComponent(orderId)}`, { allow404: true }));
    } catch {
      return null;
    }
  }

  async mine(): Promise<MineSnapshot> {
    return parseMine(await this.call("GET", "/private-modems/mine"));
  }

  async rotate(modemId: string): Promise<{ rotated: boolean; pending: boolean; message: string }> {
    const r = ((await this.call("POST", `/private-modems/${encodeURIComponent(modemId)}/rotate`)) ?? {}) as Json;
    return { rotated: r.rotated === true, pending: r.pending === true, message: str(r.message) ?? "Rotation requested." };
  }

  async renewalQuote(modemId: string): Promise<RenewalOption[]> {
    return parseRenewalQuote(await this.call("GET", `/private-modems/${encodeURIComponent(modemId)}/renewal-quote`));
  }

  async renew(modemId: string, input: { period: ModemPeriod; expectedPriceUsd: number }, idempotencyKey: string): Promise<ModemOrderRef> {
    const r = await this.call("POST", `/private-modems/${encodeURIComponent(modemId)}/renew`, { body: input, idem: idempotencyKey });
    const ref = parseOrderRef(r);
    if (!ref) throw new ModemApiError("proxies_sx: renew response had no orderId", 502, "bad_response", r);
    return ref;
  }
}
