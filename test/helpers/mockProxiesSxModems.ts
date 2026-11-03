/**
 * In-memory Proxies.sx PRIVATE MODEMS API, shaped after https://agents.proxies.sx/modems/skill.md (2026-10-28).
 */
type Tariff = { tariffId: string; period: "day" | "week" | "month"; countryCode: string; countryName: string; carrierName: string; priceUsd: number; stock: number };
type Modem = {
  id: string;
  status: string;
  countryCode: string;
  countryName: string;
  carrierName: string;
  period: string;
  expiresAt: string;
  online: boolean;
  credentials: { http: { host: string; port: number; username: string; password: string }; socks5: { host: string; port: number; username: string; password: string } };
};
type Order = { orderId: string; kind: "buy" | "renew"; status: "pending" | "succeeded" | "failed"; tariffId?: string; modemId: string | null; polls: number; period: string; error: string | null; refunded: boolean };

export const DEFAULT_TARIFFS: Tariff[] = [
  { tariffId: "t_de_o2_d", period: "day", countryCode: "DE", countryName: "Germany", carrierName: "O2", priceUsd: 8, stock: 48 },
  { tariffId: "t_de_o2_w", period: "week", countryCode: "DE", countryName: "Germany", carrierName: "O2", priceUsd: 32, stock: 48 },
  { tariffId: "t_de_o2_m", period: "month", countryCode: "DE", countryName: "Germany", carrierName: "O2", priceUsd: 131, stock: 48 },
  { tariffId: "t_nl_vf_d", period: "day", countryCode: "NL", countryName: "Netherlands", carrierName: "Vodafone NL", priceUsd: 10, stock: 8 },
  { tariffId: "t_nl_vf_w", period: "week", countryCode: "NL", countryName: "Netherlands", carrierName: "Vodafone NL", priceUsd: 25, stock: 8 },
  { tariffId: "t_us_vz_d", period: "day", countryCode: "US", countryName: "United States", carrierName: "Verizon", priceUsd: 21, stock: 26 },
  { tariffId: "t_fr_free_d", period: "day", countryCode: "FR", countryName: "France", carrierName: "Free", priceUsd: 9, stock: 0 },
];

export type ModemMockOpts = {
  tariffs?: Tariff[];
  /** /mine calls an order stays pending before it resolves. */
  setupPolls?: number;
  /** The order ends in recentFailed instead of delivering a modem. */
  failSetup?: boolean;
  /** POST /private-modems/orders answers this error. */
  orderError?: { status: number; code: string };
  /** POST /private-modems/orders throws a network error this many times first. */
  networkErrors?: number;
  /** Whether GET /private-modems/orders/:id exists (unverified upstream). */
  orderLookup?: boolean;
};

export function mockProxiesSxModems(opts: ModemMockOpts = {}) {
  const tariffs = (opts.tariffs ?? DEFAULT_TARIFFS).map((t) => ({ ...t }));
  const modems = new Map<string, Modem>();
  const orders = new Map<string, Order>(); // by Idempotency-Key
  const calls: { method: string; path: string; body: unknown; idem: string | null; key: string | null }[] = [];
  let networkErrors = opts.networkErrors ?? 0;
  let seq = 0;
  const tag = Math.random().toString(36).slice(2, 8); // modem ids unique across mocks sharing one database
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const days = (p: string) => (p === "week" ? 7 : p === "month" ? 30 : 1);

  function advance() {
    for (const o of orders.values()) {
      if (o.status !== "pending") continue;
      o.polls += 1;
      if (o.polls < (opts.setupPolls ?? 1)) continue;
      if (opts.failSetup) {
        o.status = "failed";
        o.error = "Modem did not come online";
        o.refunded = true;
        continue;
      }
      if (o.kind === "buy") {
        const t = tariffs.find((x) => x.tariffId === o.tariffId)!;
        const id = `m_${tag}${++seq}`;
        modems.set(id, {
          id,
          status: "active",
          countryCode: t.countryCode,
          countryName: t.countryName,
          carrierName: t.carrierName,
          period: t.period,
          expiresAt: new Date(Date.now() + days(t.period) * 86_400_000).toISOString(),
          online: true,
          credentials: {
            http: { host: "modem-host.example", port: 10000 + seq * 2, username: `u_${seq}`, password: `p_${seq}` },
            socks5: { host: "modem-host.example", port: 10001 + seq * 2, username: `u_${seq}`, password: `p_${seq}` },
          },
        });
        o.modemId = id;
        t.stock -= 1;
      } else {
        const m = modems.get(o.modemId!)!;
        m.expiresAt = new Date(new Date(m.expiresAt).getTime() + days(o.period) * 86_400_000).toISOString();
      }
      o.status = "succeeded";
    }
  }

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body, idem: headers["Idempotency-Key"] ?? null, key: headers["X-API-Key"] ?? null });

    if (path === "/pricing" && method === "GET") {
      return json(200, { privateModems: { available: true, plans: tariffs.filter((t) => t.stock > 0).map(({ tariffId: _t, ...rest }) => rest) } });
    }
    if (!headers["X-API-Key"]) return json(401, { code: "unauthorized", message: "API key required" });
    if (path === "/private-modems/catalog" && method === "GET") return json(200, { maxCartModems: 10, tariffs });
    if (path === "/private-modems/orders" && method === "POST") {
      if (networkErrors > 0) {
        networkErrors -= 1;
        throw new TypeError("fetch failed");
      }
      if (opts.orderError) return json(opts.orderError.status, { code: opts.orderError.code, message: opts.orderError.code, fix: "do something" });
      const idem = headers["Idempotency-Key"];
      if (!idem) return json(400, { code: "idempotency_key_required" });
      const t = tariffs.find((x) => x.tariffId === body.tariffId);
      if (!t) return json(404, { code: "not_found" });
      if (body.expectedPriceUsd !== t.priceUsd) return json(409, { code: "price_changed", priceUsd: t.priceUsd });
      let o = orders.get(idem);
      if (!o) {
        if (t.stock < 1) return json(409, { code: "no_stock" });
        o = { orderId: `o_${++seq}`, kind: "buy", status: "pending", tariffId: t.tariffId, modemId: null, polls: 0, period: t.period, error: null, refunded: false };
        orders.set(idem, o);
      }
      return json(201, { orderId: o.orderId, kind: "buy", status: o.status, priceUsd: t.priceUsd, modemId: o.modemId, error: null, refunded: false });
    }
    let m = /^\/private-modems\/orders\/([^/]+)$/.exec(path);
    if (m && method === "GET") {
      if (!opts.orderLookup) return json(404, { message: "Cannot GET" });
      const o = [...orders.values()].find((x) => x.orderId === m![1]);
      return o ? json(200, { orderId: o.orderId, status: o.status, modemId: o.modemId, error: o.error, refunded: o.refunded }) : json(404, {});
    }
    if (path === "/private-modems/mine" && method === "GET") {
      advance();
      const list = [...orders.values()];
      return json(200, {
        liveError: null,
        openOrders: list.filter((o) => o.status === "pending").map((o) => ({ orderId: o.orderId, status: o.status, modemId: null })),
        recentFailed: list.filter((o) => o.status === "failed").map((o) => ({ orderId: o.orderId, status: "failed", error: o.error, refunded: true })),
        modems: [...modems.values()].map((x) => ({ ...x, rotationToken: "rt_secret", capabilities: { rotate: true } })),
      });
    }
    m = /^\/private-modems\/(m_[^/]+)\/(rotate|renewal-quote|renew)$/.exec(path);
    if (m) {
      const modem = modems.get(m[1]);
      if (!modem) return json(404, { code: "not_found" });
      if (m[2] === "rotate" && method === "POST") return json(200, { rotated: true, pending: false, message: "New IP assigned." });
      const line = (p: string) => tariffs.find((t) => t.countryCode === modem.countryCode && t.carrierName === modem.carrierName && t.period === p);
      if (m[2] === "renewal-quote" && method === "GET") {
        return json(200, {
          defaultPeriod: "day",
          options: ["day", "week", "month"].map((p) => ({ period: p, days: days(p), priceUsd: line(p)?.priceUsd ?? 999, available: Boolean(line(p)), reason: null })),
        });
      }
      if (m[2] === "renew" && method === "POST") {
        const t = line(body.period);
        if (!t || body.expectedPriceUsd !== t.priceUsd) return json(409, { code: "price_changed" });
        const idem = headers["Idempotency-Key"];
        let o = orders.get(idem);
        if (!o) {
          o = { orderId: `o_${++seq}`, kind: "renew", status: "pending", modemId: modem.id, polls: 0, period: body.period, error: null, refunded: false };
          orders.set(idem, o);
        }
        return json(201, { orderId: o.orderId, kind: "renew", status: o.status });
      }
    }
    return json(404, { message: `no mock for ${method} ${path}` });
  }) as typeof fetch;

  return { impl, calls, modems, orders, tariffs };
}
