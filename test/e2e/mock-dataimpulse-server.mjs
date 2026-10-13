// Local stand-in for the DataImpulse reseller API (endpoint shapes copied from their Postman docs),
// used to exercise auto mode end-to-end without real keys:
//   node test/e2e/mock-dataimpulse-server.mjs 3900
//   DATAIMPULSE_API_BASE=http://127.0.0.1:3900/reseller DATAIMPULSE_LOGIN=x DATAIMPULSE_PASSWORD=y npm start
import http from "node:http";

const GB = 1073741824;
const subs = new Map();
let nextId = 7001;
const port = Number(process.argv[2] ?? 3900);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace("/reseller", "");
    let raw = "";
    for await (const c of req) raw += c;
    console.log(req.method, path + url.search);
    if (path === "/user/token/get") return send(res, 200, { token: "mock-token" });
    if (req.headers.authorization !== "Bearer mock-token") return send(res, 401, { message: "Unauthenticated." });
    const body = raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : {};
    if (path === "/sub-user/create") {
      const id = nextId++;
      const s = { id, label: body.label, login: Math.random().toString(16).slice(2, 22).padEnd(20, "0"), password: Math.random().toString(16).slice(2, 18), balance: 0, used: 0 };
      subs.set(id, s);
      return send(res, 200, { ...s, threads: body.threads, sticky_range: body.sticky_range, blocked: false });
    }
    if (path === "/sub-user/balance/add") {
      const s = subs.get(Number(body.subuser_id));
      if (!s) return send(res, 404, { success: false });
      s.balance += body.traffic * GB;
      s.used = Math.round(s.balance * 0.27); // pretend some traffic was used, so the meter shows something
      return send(res, 200, { success: true, message: "Success." });
    }
    const id = Number(url.searchParams.get("subuser_id"));
    const s = subs.get(id);
    if (path === "/sub-user/get") return s ? send(res, 200, { ...s, sticky_range: { start: 10000, end: 10999 } }) : send(res, 404, {});
    if (path === "/sub-user/balance/get")
      return s ? send(res, 200, { balance: s.balance - s.used, balance_total: s.balance, balance_used: s.used }) : send(res, 404, {});
    if (path === "/sub-user/set-blocked") return send(res, 200, { success: true });
    send(res, 404, { message: "not mocked" });
  })
  .listen(port, "127.0.0.1", () => console.log("mock dataimpulse on", port));
