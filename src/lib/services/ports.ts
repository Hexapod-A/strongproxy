import { formatNaira } from "@/lib/money";
import type { Notifier } from "@/lib/notify";
import type { ProxiesSxPortsApi, PsxCountry } from "@/lib/providers/proxiessx-ports";
import { verifyPsxSignature } from "@/lib/providers/proxiessx-ports";
import { StoreError, type Store } from "@/lib/store";
import type { Country, DedicatedPort, Order, PortPlan } from "@/lib/types";
import { guardSettings, portOrderCostUsd, refuseIfPaused, type BalanceReader } from "./balance-guard";

/**
 * Daily dedicated mobile ports on the Proxies.sx reseller ports API.
 *  buy:   refuse before charging (no keys / out of stock / no country id / low upstream balance)
 *         -> place_port_order (wallet debit + order 'processing', one transaction)
 *         -> ensure Proxies.sx customer, +1 port slot (+ plan GB as traffic quota) -> POST /reseller/ports
 *         -> fulfil_port_order stores host:port:login:pass; any upstream error -> fail_and_refund_order + admin alert.
 *  renew: same, with POST /reseller/ports/:id/extend, only while the port has not expired.
 */
export type PortDeps = { store: Store; notify: Notifier; api: ProxiesSxPortsApi; balance?: BalanceReader; now?: () => number };

export type PortCountryState = { code: string; psxId: string | null; available: number | null; state: "in_stock" | "out_of_stock" | "unknown" };
export type PortStock = { live: boolean; countries: Record<string, PortCountryState>; error?: string };

const STOCK_TTL_MS = 60_000;
const stockCache = new WeakMap<object, { at: number; list: PsxCountry[] }>();

/** Live country list (cached 60s). live=false when their list could not be read; admin-set ids still work then. */
export async function portStock(api: ProxiesSxPortsApi, countries: Pick<Country, "code" | "psx_country_id">[], now = Date.now()): Promise<PortStock> {
  let list: PsxCountry[] | null = null;
  let error: string | undefined;
  if (api.isConfigured()) {
    const c = stockCache.get(api);
    if (c && now - c.at < STOCK_TTL_MS) list = c.list;
    else {
      try {
        list = await api.listCountries();
        if (list.length === 0) {
          error = "country list was empty or in an unknown shape";
          list = null;
        } else stockCache.set(api, { at: now, list });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  const out: Record<string, PortCountryState> = {};
  for (const c of countries) {
    const live = list?.find((x) => x.code === c.code) ?? null;
    const psxId = c.psx_country_id?.trim() || live?.id || null;
    const state: PortCountryState["state"] = live
      ? live.available === null
        ? "unknown"
        : live.available > 0
          ? "in_stock"
          : "out_of_stock"
      : list
        ? "out_of_stock"
        : "unknown";
    out[c.code] = { code: c.code, psxId, available: live?.available ?? null, state };
  }
  return { live: Boolean(list), countries: out, error };
}

export const isBuyable = (s: PortCountryState | undefined) => Boolean(s && s.psxId && s.state !== "out_of_stock");

export function resetPortStockCache(api: ProxiesSxPortsApi) {
  stockCache.delete(api);
}

async function ensureCustomer(deps: PortDeps, userId: string, email: string | null): Promise<string> {
  const known = await deps.store.getProviderCustomer(userId, "proxies_sx");
  if (known) return known;
  const id =
    (await deps.api.findCustomerByExternalId(userId)) ??
    (await deps.api.createCustomer({ email: email || `${userId}@customers.invalid`, name: (email ?? "customer").split("@")[0] || "customer", externalId: userId }));
  await deps.store.rpc("set_provider_customer", { p_user_id: userId, p_provider: "proxies_sx", p_external_id: id });
  return id;
}

export type PortPurchaseResult = { outcome: "fulfilled"; order: Order; portId: string } | { outcome: "refunded"; order: Order; error: string };

async function notConfigured(deps: PortDeps) {
  await deps.notify(
    "Sales blocked: daily ports have no Proxies.sx key",
    "A customer tried to buy a daily port, but PROXIES_SX_API_KEY is not set.\nNothing was charged.",
  );
  throw new StoreError("provider_not_configured");
}

async function guard(deps: PortDeps, plan: PortPlan, what: string) {
  const s = await guardSettings(deps.store);
  await refuseIfPaused({ store: deps.store, notify: deps.notify, reader: deps.balance ?? deps.api, now: deps.now }, portOrderCostUsd(s, plan), what);
}

async function refund(deps: PortDeps, order: Order, title: string, lines: string[], msg: string): Promise<PortPurchaseResult> {
  await deps.store.rpc("fail_and_refund_order", { p_order_id: order.id, p_reason: `proxies_sx: ${msg}` });
  await deps.notify(title, [`Order ${order.id}`, ...lines, `Proxies.sx said: ${msg}`, `The customer's wallet was refunded ${formatNaira(order.total_kobo)} automatically.`, "Check your Proxies.sx balance and keys."].join("\n"));
  return { outcome: "refunded", order: (await deps.store.getOrder(order.id)) ?? order, error: msg };
}

export async function buyPort(
  deps: PortDeps,
  input: { userId: string; email: string | null; planId: string; countryCode: string; protocol: "http" | "socks5" },
): Promise<PortPurchaseResult> {
  const { store, api } = deps;
  if (!api.isConfigured()) await notConfigured(deps);
  const enabled = await store.getSetting<unknown>("ports_enabled");
  if (enabled === false || enabled === "false") throw new StoreError("product_unavailable");
  const plan = await store.getPortPlan(input.planId);
  if (!plan || !plan.is_active) throw new StoreError("plan_unavailable");
  const country = await store.getCountry(input.countryCode);
  if (!country || !country.is_active || country.ports_enabled === false) throw new StoreError("country_unavailable");

  const st = (await portStock(api, [country], deps.now?.())).countries[country.code];
  if (st?.state === "out_of_stock") throw new StoreError("country_out_of_stock");
  if (!st?.psxId) {
    await deps.notify(`Daily port refused: no Proxies.sx country id for ${country.name}`, `Their country list didn't give an id for ${country.code}. Set it in Admin > Daily ports, or disable the country there. Nothing was charged.`);
    throw new StoreError("country_unavailable");
  }
  const what = `a ${plan.name} port in ${country.name}`;
  await guard(deps, plan, what);

  const order = await store.rpc<Order>("place_port_order", {
    p_user_id: input.userId,
    p_plan_id: plan.id,
    p_country_code: country.code,
    p_protocol: input.protocol,
    p_port_id: null,
  });

  let customerId: string | null = null;
  let quotaAdded = false;
  let createdPortId: string | null = null;
  try {
    customerId = await ensureCustomer(deps, input.userId, input.email);
    await api.adjustQuota(customerId, { portSlotsDelta: 1, ...(plan.traffic_gb > 0 ? { trafficGBDelta: plan.traffic_gb } : {}) });
    quotaAdded = true;
    const port = await api.createPort({ customerId, countryId: st.psxId, days: plan.days }, order.id);
    createdPortId = port.id;
    const expires = port.expiresAt ?? new Date((deps.now?.() ?? Date.now()) + plan.days * 86400_000);
    const portId = await store.rpc<string>("fulfil_port_order", {
      p_order_id: order.id,
      p_external_id: port.id,
      p_server_ip: port.serverIp,
      p_http_port: port.httpPort,
      p_socks_port: port.socksPort,
      p_username: port.login,
      p_password: port.password,
      p_display_name: port.displayName,
      p_expires_at: expires.toISOString(),
    });
    return { outcome: "fulfilled", order: (await store.getOrder(order.id)) ?? order, portId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Best-effort clean-up upstream so nothing keeps running (or billing) for a refunded order.
    if (createdPortId) await api.deletePort(createdPortId).catch(() => undefined);
    else if (quotaAdded && customerId)
      await api.adjustQuota(customerId, { portSlotsDelta: -1, ...(plan.traffic_gb > 0 ? { trafficGBDelta: -plan.traffic_gb } : {}) }).catch(() => undefined);
    return refund(deps, order, `Daily port FAILED and auto-refunded: ${plan.name} ${country.name}`, [`${what}, ${input.protocol.toUpperCase()}`], msg);
  }
}

export async function renewPort(deps: PortDeps, input: { userId: string; portId: string; planId: string }): Promise<PortPurchaseResult> {
  const { store, api } = deps;
  if (!api.isConfigured()) await notConfigured(deps);
  const port = await store.getDedicatedPort(input.portId);
  if (!port || port.user_id !== input.userId) throw new StoreError("port_not_found");
  const now = deps.now?.() ?? Date.now();
  if (port.status !== "active" || new Date(port.expires_at).getTime() <= now) throw new StoreError("port_not_renewable");
  const plan = await store.getPortPlan(input.planId);
  if (!plan || !plan.is_active) throw new StoreError("plan_unavailable");
  const what = `a ${plan.name} renewal of port ${port.server_ip}`;
  await guard(deps, plan, what);

  const order = await store.rpc<Order>("place_port_order", {
    p_user_id: input.userId,
    p_plan_id: plan.id,
    p_country_code: null,
    p_protocol: null,
    p_port_id: port.id,
  });
  try {
    if (plan.traffic_gb > 0) {
      const customerId = await store.getProviderCustomer(input.userId, "proxies_sx");
      if (customerId) await api.adjustQuota(customerId, { trafficGBDelta: plan.traffic_gb });
    }
    const fromApi = await api.extendPort(port.external_id, plan.days, order.id);
    const expires = fromApi ?? new Date(Math.max(now, new Date(port.expires_at).getTime()) + plan.days * 86400_000);
    await store.rpc("fulfil_port_renewal", { p_order_id: order.id, p_expires_at: expires.toISOString() });
    return { outcome: "fulfilled", order: (await store.getOrder(order.id)) ?? order, portId: port.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return refund(deps, order, `Port renewal FAILED and auto-refunded: ${plan.name}`, [what], msg);
  }
}

export async function rotatePort(deps: Pick<PortDeps, "store" | "api">, port: DedicatedPort): Promise<void> {
  if (port.status !== "active" || new Date(port.expires_at).getTime() <= Date.now()) throw new StoreError("port_not_renewable");
  await deps.api.rotatePort(port.external_id);
  await deps.store.rpc("sync_port", { p_port_id: port.id, p_status: null, p_expires_at: null, p_rotated: true });
}

const STATUS: Record<string, DedicatedPort["status"]> = { active: "active", expired: "expired", suspended: "suspended", deleted: "deleted" };

/**
 * Poll-on-page-view (Proxies.sx has no port.expired webhook): refresh ports not synced in the last 5 minutes,
 * at most `limit` per call. Upstream errors keep the local copy.
 */
export async function syncPorts(deps: Pick<PortDeps, "store" | "api" | "now">, ports: DedicatedPort[], opts: { maxAgeMs?: number; limit?: number } = {}): Promise<number> {
  if (!deps.api.isConfigured()) return 0;
  const now = deps.now?.() ?? Date.now();
  const maxAge = opts.maxAgeMs ?? 5 * 60_000;
  const due = ports
    .filter((p) => p.status === "active" || p.status === "suspended")
    .filter((p) => !p.last_synced_at || now - new Date(p.last_synced_at).getTime() > maxAge || (new Date(p.expires_at).getTime() <= now && new Date(p.last_synced_at).getTime() < new Date(p.expires_at).getTime()))
    .slice(0, opts.limit ?? 10);
  let n = 0;
  for (const p of due) {
    try {
      const up = await deps.api.getPort(p.external_id);
      let status: DedicatedPort["status"] = up ? (STATUS[(up.status ?? "active").toLowerCase()] ?? p.status) : "deleted";
      const exp = up?.expiresAt ?? new Date(p.expires_at);
      if (status === "active" && exp.getTime() <= now) status = "expired";
      await deps.store.rpc("sync_port", { p_port_id: p.id, p_status: status, p_expires_at: exp.toISOString(), p_rotated: false });
      n++;
    } catch (e) {
      console.error("port sync failed", p.id, e);
    }
  }
  return n;
}

/** Proxies.sx webhook: X-Webhook-Signature: sha256=HMAC-SHA256(body, secret). */
export async function handlePsxWebhook(input: { store: Store; secret: string | undefined; rawBody: string; signature: string | null }): Promise<{ httpStatus: number; outcome: string }> {
  if (!input.secret) return { httpStatus: 503, outcome: "not_configured" };
  if (!verifyPsxSignature(input.rawBody, input.signature, input.secret)) return { httpStatus: 401, outcome: "bad_signature" };
  let evt: { type?: string; data?: { portId?: string } };
  try {
    evt = JSON.parse(input.rawBody);
  } catch {
    return { httpStatus: 400, outcome: "bad_json" };
  }
  const portId = evt.data?.portId;
  if (!evt.type?.startsWith("port.") || !portId) return { httpStatus: 200, outcome: "ignored" };
  const port = await input.store.findDedicatedPort({ provider: "proxies_sx", externalId: String(portId) });
  if (!port) return { httpStatus: 200, outcome: "unknown_port" };
  const map: Record<string, [DedicatedPort["status"] | null, boolean]> = {
    "port.deleted": ["deleted", false],
    "port.suspended": ["suspended", false],
    "port.unsuspended": ["active", false],
    "port.rotated": [null, true],
  };
  const m = map[evt.type];
  if (!m) return { httpStatus: 200, outcome: "ignored" };
  await input.store.rpc("sync_port", { p_port_id: port.id, p_status: m[0], p_expires_at: null, p_rotated: m[1] });
  return { httpStatus: 200, outcome: evt.type };
}
