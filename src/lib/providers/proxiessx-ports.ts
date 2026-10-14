/**
 * Proxies.sx reseller PORTS API (per-day dedicated mobile ports) + account balance + webhook signatures.
 *
 * Read 2026-10-14 from https://www.proxies.sx/reseller-docs (Quick Start incl. "Money Flow & Charging"),
 * /reseller-docs/reference and the public LLM reference GET https://api.proxies.sx/v1/reseller/docs/llm.
 * Their open-source kit (bolivian-peru/proxy-reseller-kit) only covers the per-GB Pool Gateway, not ports.
 *
 *   auth header  X-API-Key: psx_...   (scopes: customers:read/write, ports:read/write, ports:rotate, billing:read)
 *   GET   /reseller/customers/by-external-id/:externalId      find our customer
 *   POST  /reseller/customers        { email, name, externalId, allocatedPortSlots }
 *   PATCH /reseller/customers/:id/quota   { portSlotsDelta, trafficGBDelta }
 *   POST  /reseller/ports            { customerId, countryId, days }  -> { port: {...}, pricing: {...} }
 *   GET   /reseller/ports/:portId    full port object
 *   POST  /reseller/ports/:portId/extend   { days }  -> { success, daysAdded, newExpiresAt }
 *   POST  /reseller/ports/:portId/rotate   -> { success, newDeviceId }
 *   POST  /reseller/ports/calculate-price  { customerId, countryId, days } -> { basePrice, resellerPrice, ... }
 *   GET   /account/summary           { balance, topUp, spent }   (documented under "Account Balance Check")
 *   Webhook header  X-Webhook-Signature: sha256=HMAC-SHA256(JSON.stringify(payload), secret)
 *   Events (GET /reseller/webhooks/event-types): port.created, port.deleted, port.rotated, port.suspended,
 *   port.unsuspended, customer.*, balance.topup.  There is NO port.expired event, so expiry is read by polling.
 *
 * UNVERIFIED (confirm with a live key before taking real orders):
 *  - Country ids. The docs say countryId comes "from device availability" but name no reseller endpoint. Their own
 *    dashboard (client.proxies.sx) calls GET /countries/with-devices?pool=dedicated; we try that with the API key
 *    and parse it defensively. If it fails, set the Proxies.sx country id per country in Admin > Daily ports.
 *  - Price. Quick Start says port creation costs "basePrice x days" (their example: $2/day); the pricing page and the
 *    LLM reference say ports are free and traffic is $4/GB. Admin > Daily ports has a "check live cost" button that
 *    calls calculate-price so you can see what your account is really charged.
 *  - extend body: the LLM reference shows {"days": N}; the HTML reference shows {"hours": 720}. We send {days}.
 *  - Whether the customer traffic quota (trafficGB) actually stops traffic when used up.
 *  - expiresAt arrives as epoch ms in the examples; ISO strings are accepted too.
 *  - Idempotency-Key is documented for pool keys, not ports. We still send the order id; it is harmless if ignored.
 */
import crypto from "node:crypto";
import { ProviderError } from "./types";

export const PROXIES_SX_API = "https://api.proxies.sx/v1";

export type PsxPortsConfig = { apiKey?: string; apiBase?: string; fetchImpl?: typeof fetch };

export type PsxPort = {
  id: string;
  serverIp: string;
  httpPort: number | null;
  socksPort: number | null;
  login: string;
  password: string;
  displayName: string | null;
  expiresAt: Date | null;
  status: string | null;
};

export type PsxCountry = { id: string; code: string; name: string | null; available: number | null };

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const n = num(v);
  if (n !== null) return new Date(n < 1e12 ? n * 1000 : n); // seconds or ms
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parsePort(raw: unknown): PsxPort {
  const o = (raw && typeof raw === "object" && "port" in (raw as Json) ? (raw as Json).port : raw) as Json | null;
  if (!o || typeof o !== "object") throw new ProviderError("proxies_sx: port response had no port object", undefined, raw);
  const id = str(o._id) ?? str(o.id);
  const serverIp = str(o.serverIp) ?? str(o.host) ?? str(o.ip);
  const login = str(o.proxyLogin) ?? str(o.login) ?? str(o.username);
  const password = str(o.proxyPassword) ?? str(o.password);
  if (!id || !serverIp || !login || !password) throw new ProviderError("proxies_sx: port response missing id/serverIp/login/password", undefined, raw);
  return {
    id,
    serverIp,
    httpPort: num(o.httpPort),
    socksPort: num(o.socksPort),
    login,
    password,
    displayName: str(o.displayName),
    expiresAt: parseDate(o.expiresAt),
    status: str(o.status),
  };
}

/** Defensive parser for the (unconfirmed) country list: array, {countries: []} or {data: []}. */
export function parseCountries(raw: unknown): PsxCountry[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? ((raw as Json).countries ?? (raw as Json).data ?? (raw as Json).items) : null;
  if (!Array.isArray(list)) return [];
  const out: PsxCountry[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const o = it as Json;
    const id = str(o._id) ?? str(o.id);
    const code = (str(o.code) ?? str(o.isoCode) ?? str(o.iso) ?? str(o.countryCode) ?? str(o.alpha2))?.toLowerCase();
    if (!id || !code || !/^[a-z]{2}$/.test(code)) continue;
    const devices = Array.isArray(o.devices) ? o.devices.length : null;
    const available = num(o.availableDevices) ?? num(o.availableCount) ?? num(o.devicesCount) ?? num(o.available) ?? devices;
    out.push({ id, code: code === "uk" ? "gb" : code, name: str(o.name), available });
  }
  return out;
}

export class ProxiesSxPortsApi {
  readonly label = "Proxies.sx";
  constructor(private readonly cfg: PsxPortsConfig) {}

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey);
  }
  private get base() {
    return (this.cfg.apiBase ?? PROXIES_SX_API).replace(/\/+$/, "");
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, idempotencyKey?: string, allow404 = false): Promise<T | null> {
    if (!this.cfg.apiKey) throw new ProviderError("proxies_sx_not_configured");
    const headers: Record<string, string> = { "X-API-Key": this.cfg.apiKey, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await (this.cfg.fetchImpl ?? fetch)(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      const m = data && typeof data === "object" && "message" in data ? (data as Json).message : null;
      const msg = Array.isArray(m) ? m.join("; ") : m ? String(m) : `HTTP ${res.status}`;
      throw new ProviderError(`proxies_sx ${method} ${path.replace(/\/[a-f0-9]{24}(?=\/|$)/g, "/:id")} failed (${res.status}): ${msg}`, res.status, data);
    }
    return data as T;
  }

  async findCustomerByExternalId(externalId: string): Promise<string | null> {
    const r = await this.call<Json>("GET", `/reseller/customers/by-external-id/${encodeURIComponent(externalId)}`, undefined, undefined, true);
    return r ? (str(r._id) ?? str(r.id) ?? str((r.customer as Json | undefined)?._id)) : null;
  }

  async createCustomer(input: { email: string; name: string; externalId: string }): Promise<string> {
    const r = await this.call<Json>("POST", "/reseller/customers", { ...input, allocatedPortSlots: 0 });
    const id = r ? (str(r._id) ?? str(r.id) ?? str((r.customer as Json | undefined)?._id)) : null;
    if (!id) throw new ProviderError("proxies_sx: create customer returned no id", undefined, r);
    return id;
  }

  async adjustQuota(customerId: string, delta: { portSlotsDelta?: number; trafficGBDelta?: number }): Promise<void> {
    await this.call("PATCH", `/reseller/customers/${encodeURIComponent(customerId)}/quota`, delta);
  }

  /** UNCONFIRMED endpoint for reseller API keys (seen in their own dashboard code). */
  async listCountries(): Promise<PsxCountry[]> {
    return parseCountries(await this.call("GET", "/countries/with-devices?pool=dedicated"));
  }

  async createPort(input: { customerId: string; countryId: string; days: number }, idempotencyKey?: string): Promise<PsxPort> {
    return parsePort(await this.call("POST", "/reseller/ports", { ...input, exclusive: false, isPrivate: false }, idempotencyKey));
  }

  async getPort(portId: string): Promise<PsxPort | null> {
    const r = await this.call("GET", `/reseller/ports/${encodeURIComponent(portId)}`, undefined, undefined, true);
    return r ? parsePort(r) : null;
  }

  async extendPort(portId: string, days: number, idempotencyKey?: string): Promise<Date | null> {
    const r = await this.call<Json>("POST", `/reseller/ports/${encodeURIComponent(portId)}/extend`, { days }, idempotencyKey);
    if (r && r.success === false) throw new ProviderError(`proxies_sx extend refused: ${str(r.message) ?? "no reason"}`, undefined, r);
    return parseDate(r?.newExpiresAt ?? (r?.port as Json | undefined)?.expiresAt ?? r?.expiresAt);
  }

  async rotatePort(portId: string): Promise<void> {
    const r = await this.call<Json>("POST", `/reseller/ports/${encodeURIComponent(portId)}/rotate`);
    if (r && r.success === false) throw new ProviderError(`proxies_sx rotate refused: ${str(r.message) ?? "no reason"}`, undefined, r);
  }

  async deletePort(portId: string): Promise<void> {
    await this.call("DELETE", `/reseller/ports/${encodeURIComponent(portId)}`, undefined, undefined, true);
  }

  async calculatePrice(input: { customerId: string; countryId: string; days: number }): Promise<{ basePrice: number | null; resellerPrice: number | null; raw: unknown }> {
    const r = await this.call<Json>("POST", "/reseller/ports/calculate-price", input);
    return { basePrice: num(r?.basePrice), resellerPrice: num(r?.resellerPrice), raw: r };
  }

  /** Reseller balance in USD from GET /account/summary. */
  async getBalanceUsd(): Promise<number> {
    const r = await this.call<Json>("GET", "/account/summary");
    const b = num(r?.balance) ?? num((r?.data as Json | undefined)?.balance);
    if (b === null) throw new ProviderError("proxies_sx: /account/summary had no balance", undefined, r);
    return b;
  }
}

/** Verify X-Webhook-Signature: "sha256=<hex HMAC-SHA256>". Accepts the raw body or its JSON.stringify form. */
export function verifyPsxSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(given)) return false;
  const candidates = [rawBody];
  try {
    candidates.push(JSON.stringify(JSON.parse(rawBody)));
  } catch {
    return false;
  }
  return candidates.some((c) => {
    const want = crypto.createHmac("sha256", secret).update(c).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(given, "hex"));
  });
}

export function signPsxWebhook(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}
