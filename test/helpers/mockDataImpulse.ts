/** In-memory fake of the DataImpulse reseller API endpoints we use (shapes copied from their Postman docs). */
export function mockDataImpulse(opts: { failOn?: string } = {}) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const subs = new Map<number, { id: number; login: string; password: string; balance: number; label: string; pool_type?: string }>();
  let nextId = 4050;
  const GB = 1073741824;

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/reseller", "");
    const auth = new Headers(init?.headers).get("authorization");
    let body: unknown = null;
    if (init?.body instanceof FormData) body = Object.fromEntries(init.body.entries());
    else if (typeof init?.body === "string") body = JSON.parse(init.body);
    calls.push({ method: init?.method ?? "GET", path: path + url.search, body, auth });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

    if (opts.failOn && path.startsWith(opts.failOn)) return json(500, { success: false, message: "Internal error" });
    if (path === "/user/token/get") return json(200, { token: "tok_test_123" });
    if (auth !== "Bearer tok_test_123") return json(401, { message: "Unauthenticated." });

    if (path === "/sub-user/create") {
      const b = body as { label: string; pool_type?: string };
      const id = nextId++;
      const sub = { id, login: `login${id}`, password: `pw${id}`, balance: 0, label: b.label, pool_type: b.pool_type };
      subs.set(id, sub);
      return json(200, { ...sub, threads: 50, sticky_range: { start: 10000, end: 10999 }, blocked: false });
    }
    if (path === "/sub-user/balance/add") {
      const b = body as { subuser_id: number; traffic: number };
      const s = subs.get(b.subuser_id);
      if (!s) return json(404, { success: false, message: "not found" });
      s.balance += b.traffic * GB;
      return json(200, { success: true, message: "Success." });
    }
    if (path === "/sub-user/get") {
      const s = subs.get(Number(url.searchParams.get("subuser_id")));
      return s ? json(200, { ...s, sticky_range: { start: 10000, end: 10999 } }) : json(404, { success: false });
    }
    if (path === "/sub-user/balance/get") {
      const s = subs.get(Number(url.searchParams.get("subuser_id")));
      return s ? json(200, { balance: s.balance, balance_total: s.balance, balance_used: 0 }) : json(404, { success: false });
    }
    if (path === "/sub-user/set-blocked") return json(200, { success: true });
    return json(404, { message: "unknown endpoint in mock" });
  }) as typeof fetch;

  return { impl, calls, subs };
}
