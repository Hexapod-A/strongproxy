/**
 * DataImpulse reseller adapter.
 *
 * Implemented against DataImpulse's own docs, read 2026-10-13:
 *  - Reseller API (Postman): https://documenter.getpostman.com/view/6095389/2s9YC7UC2x
 *    base https://api.dataimpulse.com/reseller
 *    POST /user/token/get            form fields login, password -> { token }  (token TTL 24h)
 *    POST /sub-user/create           JSON { label, threads, sticky_range?, default_pool_parameters?, pool_type? }
 *                                    -> { id, login, password, balance, sticky_range, ... }
 *                                    pool_type: "residential" | "mobile" | "datacenter", permanent after creation
 *    POST /sub-user/balance/add      JSON { subuser_id, traffic } -> { success, message }
 *    GET  /sub-user/balance/get      ?subuser_id= -> { balance, balance_total, balance_used, ... } (bytes)
 *    POST /sub-user/set-blocked      JSON { subuser_id, blocked }
 *    All calls except token/get use "Authorization: Bearer <token>".
 *  - Help article: https://help.dataimpulse.com/en/articles/15931697-managing-sub-users-via-api
 *  - Proxy syntax: https://docs.dataimpulse.com/proxies/parameters/country (login__cr.de),
 *    /proxies/parameters/session-id (login__cr.au;sessid.123), /proxies/types-of-connections
 *    (rotating 823 HTTP / 824 SOCKS5, sticky ports 10000+), /proxies/connection-hosts (gw.dataimpulse.com).
 *
 * UNVERIFIED (not stated explicitly in the docs; confirm with a live key before going auto):
 *  - UNIT of `traffic` in /sub-user/balance/add. The docs only say "int, the amount of traffic". The
 *    addition-history example shows traffic_added == balance_charged (1 -> 1, 2 -> 2), which matches whole GB
 *    at $1/GB residential; we therefore send whole GB. TEST WITH 1 GB FIRST.
 *  - Whether mobile sub-users use the same gateway host/ports as residential (docs show one gateway).
 *  - The shape of error responses (we treat any non-2xx or {success:false} as an error).
 */
import { ProviderError, type AccountForString, type ProvisionInput, type ProvisionResult, type ProxyProvider, type ProxyStringOptions, type UsageResult } from "./types";

export const DATAIMPULSE_API = "https://api.dataimpulse.com/reseller";
export const DI_ROTATING_HTTP_PORT = 823;
export const DI_ROTATING_SOCKS_PORT = 824;
const DEFAULT_STICKY = { start: 10000, end: 10999 };

export type DataImpulseConfig = {
  login?: string;
  password?: string;
  proxyHost: string;
  threads: number;
  fetchImpl?: typeof fetch;
  apiBase?: string;
};

type TokenCache = { token: string; expiresAt: number } | null;

export class DataImpulseProvider implements ProxyProvider {
  readonly id = "dataimpulse";
  readonly label = "DataImpulse";
  private token: TokenCache = null;

  constructor(private readonly cfg: DataImpulseConfig) {}

  private get f(): typeof fetch {
    return this.cfg.fetchImpl ?? fetch;
  }
  private get base(): string {
    return this.cfg.apiBase ?? DATAIMPULSE_API;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.login && this.cfg.password);
  }

  supportsPool(pool: string): boolean {
    return pool === "residential" || pool === "mobile" || pool === "datacenter";
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.token;
    if (!this.isConfigured()) throw new ProviderError("dataimpulse_not_configured");
    const form = new FormData();
    form.set("login", this.cfg.login!);
    form.set("password", this.cfg.password!);
    const res = await this.f(`${this.base}/user/token/get`, { method: "POST", body: form });
    const body = await safeJson(res);
    if (!res.ok || !body || typeof body.token !== "string") {
      throw new ProviderError("dataimpulse_auth_failed", res.status, body);
    }
    // Docs: TTL 24h. Refresh an hour early.
    this.token = { token: body.token, expiresAt: Date.now() + 23 * 3600 * 1000 };
    return body.token;
  }

  private async call(method: "GET" | "POST", path: string, payload?: Record<string, unknown>, retry = true): Promise<Record<string, unknown>> {
    const token = await this.getToken();
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await safeJson(res);
    if (res.status === 401 && retry) {
      this.token = null;
      return this.call(method, path, payload, false);
    }
    if (!res.ok || (body && body.success === false)) {
      throw new ProviderError(`dataimpulse_${path}_failed`, res.status, body);
    }
    return body ?? {};
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (!Number.isInteger(input.gb) || input.gb < 1) throw new ProviderError("invalid_gb");
    let id: string;
    let sub: Record<string, unknown>;
    let toppedUp = false;

    if (input.existingExternalId) {
      id = input.existingExternalId;
      toppedUp = true;
    } else {
      sub = await this.call("POST", "/sub-user/create", {
        label: `sp-${input.customerRef}`.slice(0, 60),
        threads: this.cfg.threads,
        sticky_range: DEFAULT_STICKY,
        pool_type: input.pool,
      });
      if (sub.id === undefined || typeof sub.login !== "string" || typeof sub.password !== "string") {
        throw new ProviderError("dataimpulse_create_unexpected_response", 200, sub);
      }
      id = String(sub.id);
    }

    await this.call("POST", "/sub-user/balance/add", { subuser_id: Number(id), traffic: input.gb });

    if (toppedUp) {
      sub = await this.call("GET", `/sub-user/get?subuser_id=${encodeURIComponent(id)}`);
    }
    const range = (sub!.sticky_range as { start?: number; end?: number } | undefined) ?? DEFAULT_STICKY;
    return {
      externalId: id,
      host: this.cfg.proxyHost,
      port: DI_ROTATING_HTTP_PORT,
      username: String(sub!.login),
      password: String(sub!.password),
      protocol: "http",
      stickyPortStart: range.start ?? null,
      stickyPortEnd: range.end ?? null,
      toppedUp,
    };
  }

  async getUsage(externalId: string): Promise<UsageResult> {
    const b = await this.call("GET", `/sub-user/balance/get?subuser_id=${encodeURIComponent(externalId)}`);
    return {
      remainingBytes: Number(b.balance ?? 0),
      usedBytes: b.balance_used === undefined ? null : Number(b.balance_used),
      totalBytes: b.balance_total === undefined ? null : Number(b.balance_total),
    };
  }

  async setBlocked(externalId: string, blocked: boolean): Promise<void> {
    await this.call("POST", "/sub-user/set-blocked", { subuser_id: Number(externalId), blocked });
  }

  buildProxyString(a: AccountForString, o: ProxyStringOptions): string {
    return buildDataImpulseString(a, o);
  }
}

/** DataImpulse targeting goes in the login: login__cr.us;sessid.abc */
export function buildDataImpulseString(a: AccountForString, o: ProxyStringOptions): string {
  const params: string[] = [];
  if (o.country) params.push(`cr.${o.country.toLowerCase()}`);
  if (o.mode === "sticky" && o.sessionId) params.push(`sessid.${o.sessionId.replace(/[^A-Za-z0-9]/g, "")}`);
  const user = params.length ? `${a.username}__${params.join(";")}` : a.username;

  let port: number;
  if (o.mode === "sticky" && !o.sessionId) {
    const start = a.sticky_port_start ?? 10000;
    const end = a.sticky_port_end ?? start;
    port = Math.min(Math.max(o.stickyPort ?? start, start), end);
  } else {
    port = o.protocol === "socks5" ? DI_ROTATING_SOCKS_PORT : DI_ROTATING_HTTP_PORT;
  }

  if (o.format === "url") return `${o.protocol}://${user}:${a.password}@${a.host}:${port}`;
  return `${a.host}:${port}:${user}:${a.password}`;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
