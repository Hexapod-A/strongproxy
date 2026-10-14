import { randomBytes } from "node:crypto";

/**
 * In-memory fake of the Proxies.sx reseller PORTS API, shaped after https://api.proxies.sx/v1/reseller/docs/llm
 * (read 2026-10-14). GET /countries/with-devices is unconfirmed for reseller keys; its shape here is our guess.
 */
type Port = { _id: string; customerId: string; countryId: string; displayName: string; httpPort: number; socksPort: number; proxyLogin: string; proxyPassword: string; serverIp: string; expiresAt: number; status: string };

export function mockProxiesSxPorts(
  opts: {
    countries?: { _id: string; code: string; name?: string; availableDevices?: number }[];
    failOn?: string;
    countriesFail?: boolean;
    balance?: number;
    now?: () => number;
  } = {},
) {
  const now = opts.now ?? (() => Date.now());
  const calls: { method: string; path: string; body: Record<string, unknown> | null; idem: string | null }[] = [];
  const customers = new Map<string, { _id: string; externalId: string; email: string; portSlots: number; trafficGB: number }>();
  const ports = new Map<string, Port>();
  const state = { balance: opts.balance ?? 100, failOn: opts.failOn, countriesFail: opts.countriesFail ?? false };
  const countries = opts.countries ?? [
    { _id: "c_us", code: "US", name: "United States", availableDevices: 12 },
    { _id: "c_gb", code: "GB", name: "United Kingdom", availableDevices: 4 },
    { _id: "c_ca", code: "CA", name: "Canada", availableDevices: 0 },
  ];
  const oid = () => randomBytes(12).toString("hex");

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const h = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path, body, idem: h.get("idempotency-key") });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (h.get("x-api-key") !== "psx_api_test") return json(401, { statusCode: 401, message: "Authentication required." });
    if (state.failOn && path.startsWith(state.failOn) && method !== "GET") return json(402, { statusCode: 402, message: "Insufficient balance" });

    if (path === "/countries/with-devices") return state.countriesFail ? json(403, { message: "Forbidden resource" }) : json(200, countries);
    if (path === "/account/summary") return json(200, { balance: state.balance, topUp: 500, spent: 400 });

    let m = path.match(/^\/reseller\/customers\/by-external-id\/(.+)$/);
    if (m) {
      const c = [...customers.values()].find((x) => x.externalId === decodeURIComponent(m![1]));
      return c ? json(200, c) : json(404, { message: "Customer not found" });
    }
    if (path === "/reseller/customers" && method === "POST") {
      const c = { _id: oid(), externalId: body.externalId, email: body.email, portSlots: body.allocatedPortSlots ?? 0, trafficGB: 0, status: "active" };
      customers.set(c._id, c);
      return json(201, c);
    }
    m = path.match(/^\/reseller\/customers\/([^/]+)\/quota$/);
    if (m && method === "PATCH") {
      const c = customers.get(m[1]);
      if (!c) return json(404, { message: "Customer not found" });
      c.portSlots += body.portSlotsDelta ?? 0;
      c.trafficGB += body.trafficGBDelta ?? 0;
      return json(200, { success: true, portSlots: c.portSlots, trafficGB: c.trafficGB });
    }
    if (path === "/reseller/ports/calculate-price" && method === "POST") return json(200, { basePrice: 0, resellerPrice: 0, marginAmount: 0, marginPercent: 20, appliedRules: [] });
    if (path === "/reseller/ports" && method === "POST") {
      const c = customers.get(body.customerId);
      if (!c) return json(404, { message: "Customer not found" });
      const used = [...ports.values()].filter((p) => p.customerId === c._id && p.status === "active").length;
      if (used >= c.portSlots) return json(400, { message: "Quota exceeded" });
      if (!countries.find((x) => x._id === body.countryId && (x.availableDevices ?? 1) > 0)) return json(400, { message: "No devices available" });
      const id = oid();
      const p: Port = {
        _id: id, customerId: c._id, countryId: body.countryId, displayName: `psx_${id.slice(0, 6)}`, httpPort: 10001, socksPort: 10002,
        proxyLogin: `u${id.slice(0, 6)}`, proxyPassword: `p${id.slice(6, 14)}`, serverIp: "185.1.2.3", expiresAt: now() + body.days * 86400_000, status: "active",
      };
      ports.set(id, p);
      return json(201, { port: p, pricing: { costToReseller: 0, resellerPrice: 0, margin: 0 } });
    }
    m = path.match(/^\/reseller\/ports\/([^/]+)(\/extend|\/rotate)?$/);
    if (m) {
      const p = ports.get(m[1]);
      if (!p) return json(404, { message: "Port not found" });
      if (m[2] === "/extend" && method === "POST") {
        p.expiresAt = Math.max(p.expiresAt, now()) + body.days * 86400_000;
        return json(200, { success: true, message: "extended", portId: p._id, daysAdded: body.days, newExpiresAt: new Date(p.expiresAt).toISOString() });
      }
      if (m[2] === "/rotate" && method === "POST") return json(200, { success: true, message: "Port rotated successfully", portId: p._id, newDeviceId: oid() });
      if (!m[2] && method === "GET") return json(200, p);
      if (!m[2] && method === "DELETE") {
        ports.delete(p._id);
        return json(200, { success: true, message: "Port deleted" });
      }
    }
    return json(404, { message: "unknown endpoint in mock" });
  }) as typeof fetch;

  return { impl, calls, customers, ports, state };
}
