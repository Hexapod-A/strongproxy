import { randomBytes } from "node:crypto";

/**
 * In-memory fake of the Proxies.sx endpoints we use. Shapes copied from their MIT reseller kit
 * (packages/sdk/src/types.ts PoolAccessKey; GET /gateway/pool/stock as served live on 2026-10-13).
 */
export function mockProxiesSx(
  opts: { failOn?: string; stock?: { mbl?: Record<string, number>; peer?: Record<string, number>; residential?: Record<string, number> } } = {},
) {
  const calls: { method: string; path: string; body: unknown; apiKey: string | null; idem: string | null }[] = [];
  const keys = new Map<string, { id: string; key: string; label: string; enabled: boolean; trafficCapGB: number; trafficUsedMB: number; expiresAt: string | null }>();
  const idemCache = new Map<string, unknown>();
  const stock = {
    mbl: opts.stock?.mbl ?? { us: 26, gb: 19, fr: 23, nl: 24 },
    peer: opts.stock?.peer ?? { us: 80, gb: 8, ca: 2, de: 8, fr: 4, nl: 27, no: 3 },
    residential: opts.stock?.residential ?? opts.stock?.peer ?? { us: 78, gb: 8, ca: 2, de: 8, fr: 4, nl: 27, no: 3 },
  };

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const h = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path, body, apiKey: h.get("x-api-key"), idem: h.get("idempotency-key") });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

    if (path === "/gateway/pool/stock") {
      if (opts.failOn === "stock") return json(503, { message: "unavailable" });
      const ipTypes: Record<string, unknown> = {};
      for (const cc of Object.keys(stock.peer)) ipTypes[cc] = { mobile: 0, residential: stock.residential[cc] ?? 0, datacenter: 0, unclassified: 0 };
      return json(200, { pools: { mbl: stock.mbl, peer: stock.peer }, ipTypes: { peer: ipTypes }, stale: false });
    }
    if (opts.failOn && path.startsWith(opts.failOn)) return json(402, { statusCode: 402, message: "Insufficient traffic balance" });
    if (h.get("x-api-key") !== "psx_api_test") return json(401, { message: "Invalid API key" });

    const idem = h.get("idempotency-key");
    if (idem && idemCache.has(idem)) return json(200, idemCache.get(idem));

    if (path === "/reseller/pool-keys" && method === "POST") {
      if (!body?.label || !(body.trafficCapGB > 0)) return json(400, { message: "An unlimited pool-access-key requires a partner account. Set a GB cap for this key." });
      const id = randomBytes(12).toString("hex"); // 24 hex chars, like a Mongo ObjectId
      const k = { id, key: `pak_${id}`, label: body.label, enabled: true, trafficCapGB: body.trafficCapGB, trafficUsedMB: 0, expiresAt: body.expiresAt ?? null };
      keys.set(id, k);
      if (idem) idemCache.set(idem, k);
      return json(201, k);
    }
    const m = path.match(/^\/reseller\/pool-keys\/([^/]+)(\/topup)?$/);
    const k = m ? keys.get(decodeURIComponent(m[1])) : undefined;
    if (m && !k) return json(404, { message: "Pool access key not found" });
    if (m && k && m[2] === "/topup" && method === "POST") {
      k.trafficCapGB += body.addTrafficGB ?? 0;
      const out = { ...k, key: `pak_${"*".repeat(4)}` }; // top-up response: masked key, like list()
      if (idem) idemCache.set(idem, out);
      return json(200, out);
    }
    if (m && k && method === "PATCH") {
      Object.assign(k, body);
      return json(200, k);
    }
    if (m && k && method === "GET") return json(200, { ...k, key: "pak_****…****" });
    return json(404, { message: "unknown endpoint in mock" });
  }) as typeof fetch;

  return { impl, calls, keys };
}
