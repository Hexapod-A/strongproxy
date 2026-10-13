/**
 * Proxies.sx adapter (per-GB "Pool Gateway", no reseller deposit).
 *
 * Implemented against Proxies.sx's own MIT reseller kit, read 2026-10-13:
 *   https://github.com/bolivian-peru/proxy-reseller-kit  (packages/sdk/src/client.ts, types.ts, url.ts,
 *   docs/USERNAME-DSL.md) and https://www.proxies.sx/reseller-docs (+ /reseller-docs/reference).
 *
 *   Base  https://api.proxies.sx/v1        auth header  X-API-Key: <reseller API key>
 *   POST  /reseller/pool-keys               { label, trafficCapGB, expiresAt? }  (+ Idempotency-Key header)
 *                                           -> PoolAccessKey { id, key: "pak_...", label, enabled, trafficCapGB,
 *                                              trafficUsedMB, expiresAt, ... }
 *   GET   /reseller/pool-keys/:id           -> PoolAccessKey (usage: trafficUsedMB; GB = MB / 1024 per the SDK)
 *   PATCH /reseller/pool-keys/:id           { enabled?, trafficCapGB?, expiresAt? }
 *   POST  /reseller/pool-keys/:id/topup     { addTrafficGB?, extendDays? }  (+ Idempotency-Key)  atomic $inc of the cap
 *   POST  /reseller/pool-keys/:id/reveal    -> PoolAccessKey with the full key (audit-logged unmask)
 *   GET   /gateway/pool/stock               public, no auth. { pools: { mbl: {cc: n}, peer: {cc: n} },
 *                                              ipTypes: { peer: { cc: { mobile, residential, ... } } }, ... }
 *   Gateway: gw.proxies.sx:7000 (HTTP) / :7001 (SOCKS5).
 *   Proxy user DSL: <proxyUsername>-<pool>-<cc>[-iptype-<t>][-sid-<id>][-rot-<mode>], password = pak_ key.
 *     pool "mbl" = their own 4G/5G modems (6 countries: us gb fr nl pl ge), "peer" = device network.
 *
 * Product mapping (our choice): mobile -> pool "mbl"; residential -> pool "peer" + "-iptype-residential".
 *
 * Facts the SDK states that this adapter relies on:
 *  - A key MUST have a GB cap (> 0, <= 1000 by default) unless the account is a partner account.
 *  - Reaching the cap auto-disables the key; topUp does NOT re-enable it, so we PATCH enabled:true after a top-up.
 *  - Idempotency-Key dedupes create/topup retries for 24h. We pass our order id.
 *
 * UNVERIFIED (confirm with a live key before taking real orders):
 *  - Which API-key scopes the pool-keys endpoints need (the quick start lists customers:/ports: scopes only).
 *  - Whether a key minted by a non-partner reseller with trafficCapGB = N is billed N GB up front from your
 *    Proxies.sx balance, or metered as used. Keep enough balance on Proxies.sx for every GB you sell.
 *  - "Burn rate": their pricing feed bills cheaper countries at a fraction of a GB (Premium tier = 1.0, which covers
 *    US/UK/CA/AU/DE/FR/NL/NO; Spain is "Plus" at 0.375). We assume the cap is in Premium-equivalent GB.
 *  - Error body shape (we treat any non-2xx as a failure and keep the body for the admin alert).
 *  - Webhooks: pool-key events (pak.usage.threshold_crossed, pak.expired, ...) exist only as a design doc in the kit
 *    (packages/sdk/docs/WEBHOOKS-DESIGN.md), so nothing here depends on them; usage is read on demand.
 */
import { ProviderError, type AccountForString, type ProvisionInput, type ProvisionResult, type ProxyProvider, type ProxyStringOptions, type StockSnapshot, type UsageResult } from "./types";

export const PROXIES_SX_API = "https://api.proxies.sx/v1";
export const PSX_GATEWAY_HOST = "gw.proxies.sx";
export const PSX_HTTP_PORT = 7000;
export const PSX_SOCKS5_PORT = 7001;
const MB = 1024 * 1024;
const GB = 1024 * MB;
const STOCK_TTL_MS = 60_000;

export type ProxiesSxConfig = {
  apiKey?: string;
  /** Your reseller proxy username, e.g. psx_abc123 (client.proxies.sx). */
  proxyUsername?: string;
  gatewayHost?: string;
  /** Optional: days until a key expires. Unset = no expiry (bought GB never expires). */
  keyExpiryDays?: number | null;
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

type PoolAccessKey = {
  id: string;
  key?: string;
  enabled?: boolean;
  trafficCapGB?: number | null;
  trafficUsedMB?: number;
};

/** Our product pool -> their gateway pool token. */
export function psxPoolFor(pool: string): "mbl" | "peer" | null {
  if (pool === "mobile") return "mbl";
  if (pool === "residential") return "peer";
  return null;
}

export class ProxiesSxProvider implements ProxyProvider {
  readonly id = "proxies_sx";
  readonly label = "Proxies.sx";
  private stockCache: { at: number; snap: StockSnapshot } | null = null;

  constructor(private readonly cfg: ProxiesSxConfig) {}

  private get f(): typeof fetch {
    return this.cfg.fetchImpl ?? fetch;
  }
  private get base(): string {
    return (this.cfg.apiBase ?? PROXIES_SX_API).replace(/\/+$/, "");
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.proxyUsername);
  }

  supportsPool(pool: string): boolean {
    return psxPoolFor(pool) !== null;
  }

  private async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!this.cfg.apiKey) throw new ProviderError("proxies_sx_not_configured");
    const headers: Record<string, string> = { "X-API-Key": this.cfg.apiKey, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await this.f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : `HTTP ${res.status}`;
      throw new ProviderError(`proxies_sx ${method} ${path.replace(/[a-f0-9]{24}/g, ":id")} failed: ${msg}`, res.status, data);
    }
    return data as T;
  }

  private username(pool: string): string {
    const token = psxPoolFor(pool);
    if (!token) throw new ProviderError(`proxies_sx_unsupported_pool:${pool}`);
    return `${this.cfg.proxyUsername}-${token}`;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (!Number.isInteger(input.gb) || input.gb < 1) throw new ProviderError("invalid_gb");
    const username = this.username(input.pool);
    const idem = input.idempotencyKey;
    let k: PoolAccessKey;
    let toppedUp = false;

    if (input.existingExternalId) {
      const id = encodeURIComponent(input.existingExternalId);
      const extendDays = this.cfg.keyExpiryDays ?? undefined;
      k = await this.call<PoolAccessKey>("POST", `/reseller/pool-keys/${id}/topup`, { addTrafficGB: input.gb, ...(extendDays ? { extendDays } : {}) }, idem ? `topup_${idem}` : undefined);
      // A key that hit its cap was auto-disabled, and topup does not re-enable it (SDK docs).
      if (k.enabled === false) k = await this.call<PoolAccessKey>("PATCH", `/reseller/pool-keys/${id}`, { enabled: true });
      toppedUp = true;
    } else {
      const expiresAt = this.cfg.keyExpiryDays ? new Date(Date.now() + this.cfg.keyExpiryDays * 86400_000).toISOString() : undefined;
      k = await this.call<PoolAccessKey>(
        "POST",
        "/reseller/pool-keys",
        { label: `strongproxy:${input.customerRef}:${input.pool}`.slice(0, 100), trafficCapGB: input.gb, ...(expiresAt ? { expiresAt } : {}) },
        idem ? `mint_${idem}` : undefined,
      );
    }
    if (!k || typeof k.id !== "string") throw new ProviderError("proxies_sx_unexpected_response", 200, k);
    // On top-ups the stored credentials are kept; the key is only needed on mint (and is returned there).
    if (!toppedUp && !(typeof k.key === "string" && /^pak_[A-Za-z0-9]+$/.test(k.key))) {
      k = { ...k, ...(await this.call<PoolAccessKey>("POST", `/reseller/pool-keys/${encodeURIComponent(k.id)}/reveal`)) };
      if (!(typeof k.key === "string" && k.key.startsWith("pak_"))) throw new ProviderError("proxies_sx_key_missing", 200, { id: k.id });
    }
    return {
      externalId: k.id,
      host: this.cfg.gatewayHost ?? PSX_GATEWAY_HOST,
      port: PSX_HTTP_PORT,
      username,
      password: k.key ?? "",
      protocol: "http",
      stickyPortStart: null,
      stickyPortEnd: null,
      toppedUp,
    };
  }

  async getUsage(externalId: string): Promise<UsageResult> {
    const k = await this.call<PoolAccessKey>("GET", `/reseller/pool-keys/${encodeURIComponent(externalId)}`);
    const used = Math.round(Number(k.trafficUsedMB ?? 0) * MB);
    const total = k.trafficCapGB === null || k.trafficCapGB === undefined ? null : Math.round(Number(k.trafficCapGB) * GB);
    return { usedBytes: used, totalBytes: total, remainingBytes: total === null ? 0 : Math.max(0, total - used) };
  }

  async setBlocked(externalId: string, blocked: boolean): Promise<void> {
    await this.call("PATCH", `/reseller/pool-keys/${encodeURIComponent(externalId)}`, { enabled: !blocked });
  }

  /** Live device counts per country from the public stock feed, cached for a minute. */
  async getStock(): Promise<StockSnapshot> {
    if (this.stockCache && Date.now() - this.stockCache.at < STOCK_TTL_MS) return this.stockCache.snap;
    const res = await this.f(`${this.base}/gateway/pool/stock`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new ProviderError("proxies_sx_stock_unavailable", res.status);
    const d = (await res.json()) as {
      pools?: { mbl?: Record<string, number>; peer?: Record<string, number> };
      ipTypes?: { peer?: Record<string, { residential?: number } | null> };
    };
    const mobile: Record<string, number> = { ...(d.pools?.mbl ?? {}) };
    const residential: Record<string, number> = {};
    for (const [cc, n] of Object.entries(d.pools?.peer ?? {})) {
      const t = d.ipTypes?.peer?.[cc];
      // Under -iptype-residential only classified residential peers are served (stock feed note).
      residential[cc] = t && typeof t.residential === "number" ? t.residential : Number(n);
    }
    const snap: StockSnapshot = { byPool: { mobile, residential }, fetchedAt: new Date().toISOString() };
    this.stockCache = { at: Date.now(), snap };
    return snap;
  }

  buildProxyString(a: AccountForString, o: ProxyStringOptions): string {
    return buildProxiesSxString(a, o);
  }
}

/** Session ids must be [a-z0-9_]{1,64} (no hyphen) per the gateway DSL. */
export function psxSid(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64);
  return s || "s1";
}

/**
 * Username DSL: base already carries the pool (psx_x-mbl / psx_x-peer); we append country, ip type and session.
 * Rotating = gateway default (new IP about every 10 min). Sticky = -sid-<id>-rot-sticky.
 */
export function buildProxiesSxString(a: AccountForString, o: ProxyStringOptions): string {
  const tokens: string[] = [a.username];
  const isPeer = a.username.endsWith("-peer");
  // Country is positional (3rd field); "any" is the documented wildcard (docs/USERNAME-DSL.md).
  tokens.push(o.country ? o.country.toLowerCase() : "any");
  if (isPeer) tokens.push("iptype", "residential");
  if (o.mode === "sticky") {
    tokens.push("sid", psxSid(o.sessionId ?? `s${o.stickyPort ?? 1}`), "rot", "sticky");
  }
  const user = tokens.join("-");
  const port = o.protocol === "socks5" ? PSX_SOCKS5_PORT : PSX_HTTP_PORT;
  if (o.format === "url") return `${o.protocol}://${encodeURIComponent(user)}:${encodeURIComponent(a.password)}@${a.host}:${port}`;
  return `${a.host}:${port}:${user}:${a.password}`;
}
