import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDataImpulseString, DataImpulseProvider } from "@/lib/providers/dataimpulse";
import { genericProxyString } from "@/lib/providers/generic";
import { buildProxiesSxString, ProxiesSxProvider, psxSid } from "@/lib/providers/proxiessx";
import { productStock } from "@/lib/stock";
import { formatNaira, nairaToUsd } from "@/lib/money";
import { signNowPayments, sortKeysDeep, verifyPaystackSignature } from "@/lib/services/payments";
import { mockDataImpulse } from "./helpers/mockDataImpulse";
import { mockProxiesSx } from "./helpers/mockProxiesSx";

const acc = { host: "gw.dataimpulse.com", port: 823, username: "abc", password: "pw", sticky_port_start: 10000, sticky_port_end: 10999 };

describe("DataImpulse proxy strings (syntax from docs.dataimpulse.com)", () => {
  it("rotating, any country", () => {
    expect(buildDataImpulseString(acc, { mode: "rotating", protocol: "http", format: "hostport" })).toBe("gw.dataimpulse.com:823:abc:pw");
  });
  it("country targeting goes in the login as __cr.xx", () => {
    expect(buildDataImpulseString(acc, { country: "de", mode: "rotating", protocol: "http", format: "url" })).toBe("http://abc__cr.de:pw@gw.dataimpulse.com:823");
  });
  it("SOCKS5 rotating uses port 824", () => {
    expect(buildDataImpulseString(acc, { mode: "rotating", protocol: "socks5", format: "url" })).toBe("socks5://abc:pw@gw.dataimpulse.com:824");
  });
  it("sticky with a session id: __cr.au;sessid.123", () => {
    expect(buildDataImpulseString(acc, { country: "au", mode: "sticky", sessionId: "123", protocol: "http", format: "hostport" })).toBe(
      "gw.dataimpulse.com:823:abc__cr.au;sessid.123:pw",
    );
  });
  it("sticky by port stays inside the sub-user's sticky range", () => {
    expect(buildDataImpulseString(acc, { mode: "sticky", stickyPort: 50000, protocol: "http", format: "hostport" })).toBe("gw.dataimpulse.com:10999:abc:pw");
  });
  it("generic string for providers without targeting syntax", () => {
    expect(genericProxyString({ ...acc, host: "1.2.3.4", port: 8000 }, { protocol: "http", format: "hostport" })).toBe("1.2.3.4:8000:abc:pw");
  });
});

describe("DataImpulse adapter requests", () => {
  it("is unconfigured without env keys", () => {
    expect(new DataImpulseProvider({ proxyHost: "x", threads: 1 }).isConfigured()).toBe(false);
  });
  it("gets a token with form fields, then uses Bearer auth; caches the token", async () => {
    const api = mockDataImpulse();
    const di = new DataImpulseProvider({ login: "L", password: "P", proxyHost: "gw.dataimpulse.com", threads: 10, fetchImpl: api.impl });
    const r = await di.provision({ customerRef: "user-1", pool: "mobile", gb: 3 });
    expect(r).toMatchObject({ externalId: "4050", username: "login4050", password: "pw4050", port: 823, toppedUp: false, stickyPortStart: 10000 });
    await di.getUsage("4050");
    expect(api.calls.filter((c) => c.path === "/user/token/get")).toHaveLength(1);
    expect(api.calls.slice(1).every((c) => c.auth === "Bearer tok_test_123")).toBe(true);
    expect(api.calls[1].body).toMatchObject({ pool_type: "mobile", threads: 10 });
  });
  it("surfaces upstream errors", async () => {
    const api = mockDataImpulse({ failOn: "/sub-user/balance/add" });
    const di = new DataImpulseProvider({ login: "L", password: "P", proxyHost: "h", threads: 1, fetchImpl: api.impl });
    await expect(di.provision({ customerRef: "u", pool: "residential", gb: 1 })).rejects.toThrow("dataimpulse_/sub-user/balance/add_failed");
  });
});

const psxAcc = { host: "gw.proxies.sx", port: 7000, username: "psx_abc123-mbl", password: "pak_0123", sticky_port_start: null, sticky_port_end: null };

describe("Proxies.sx proxy strings (username DSL from their reseller kit)", () => {
  it("rotating mobile, any country: <user>-mbl-any on :7000", () => {
    expect(buildProxiesSxString(psxAcc, { mode: "rotating", protocol: "http", format: "hostport" })).toBe("gw.proxies.sx:7000:psx_abc123-mbl-any:pak_0123");
  });
  it("country is the 3rd positional token; SOCKS5 uses :7001", () => {
    expect(buildProxiesSxString(psxAcc, { country: "GB", mode: "rotating", protocol: "socks5", format: "url" })).toBe("socks5://psx_abc123-mbl-gb:pak_0123@gw.proxies.sx:7001");
  });
  it("residential adds -iptype-residential; sticky adds -sid-<id>-rot-sticky with a DSL-safe id", () => {
    const res = { ...psxAcc, username: "psx_abc123-peer" };
    expect(buildProxiesSxString(res, { country: "us", mode: "sticky", sessionId: "Ab-9!x", protocol: "http", format: "hostport" })).toBe(
      "gw.proxies.sx:7000:psx_abc123-peer-us-iptype-residential-sid-ab9x-rot-sticky:pak_0123",
    );
    expect(psxSid("---")).toBe("s1");
  });
});

describe("Proxies.sx adapter", () => {
  const cfg = (api: ReturnType<typeof mockProxiesSx>) => ({ apiKey: "psx_api_test", proxyUsername: "psx_abc123", apiBase: "https://api.test/v1", fetchImpl: api.impl });
  it("needs both the API key and the proxy username", () => {
    expect(new ProxiesSxProvider({ apiKey: "k" }).isConfigured()).toBe(false);
    expect(new ProxiesSxProvider({ apiKey: "k", proxyUsername: "psx_1" }).isConfigured()).toBe(true);
    expect(new ProxiesSxProvider({}).supportsPool("datacenter")).toBe(false);
  });
  it("sets an expiry only when PROXIES_SX_KEY_EXPIRY_DAYS is configured, and surfaces upstream errors", async () => {
    const api = mockProxiesSx();
    await new ProxiesSxProvider({ ...cfg(api), keyExpiryDays: 30 }).provision({ customerRef: "u1", pool: "residential", gb: 5 });
    expect(api.calls[0].body).toMatchObject({ trafficCapGB: 5, expiresAt: expect.any(String) });
    const bad = mockProxiesSx({ failOn: "/reseller" });
    await expect(new ProxiesSxProvider(cfg(bad)).provision({ customerRef: "u", pool: "mobile", gb: 1 })).rejects.toThrow("Insufficient traffic balance");
  });
  it("stock: mobile reads the mbl pool, residential the classified residential peers; feed outage = unknown, not blocked", async () => {
    const p = new ProxiesSxProvider(cfg(mockProxiesSx()));
    const m = await productStock(p, "mobile", ["us", "de", "ca"]);
    expect(m).toEqual({ live: true, countries: { "": "in_stock", us: "in_stock", de: "out_of_stock", ca: "out_of_stock" } });
    const r = await productStock(p, "residential", ["de", "au"]);
    expect(r.countries).toMatchObject({ de: "in_stock", au: "out_of_stock" });
    const down = await productStock(new ProxiesSxProvider(cfg(mockProxiesSx({ failOn: "stock" }))), "mobile", ["us"]);
    expect(down).toEqual({ live: false, countries: { "": "unknown", us: "unknown" } });
    expect((await productStock(new DataImpulseProvider({ proxyHost: "x", threads: 1 }), "mobile", ["us"])).live).toBe(false);
  });
});

describe("signatures", () => {
  it("Paystack: HMAC-SHA512 of the raw body with the secret key", () => {
    const raw = '{"event":"charge.success"}';
    const sig = crypto.createHmac("sha512", "sk").update(raw).digest("hex");
    expect(verifyPaystackSignature(raw, sig, "sk")).toBe(true);
    expect(verifyPaystackSignature(raw + " ", sig, "sk")).toBe(false);
    expect(verifyPaystackSignature(raw, null, "sk")).toBe(false);
  });
  it("NOWPayments: keys sorted recursively before HMAC-SHA512 (as in their Node example)", () => {
    const body = { b: 1, a: { d: 2, c: 3 } };
    expect(JSON.stringify(sortKeysDeep(body))).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(signNowPayments(body, "s")).toBe(crypto.createHmac("sha512", "s").update('{"a":{"c":3,"d":2},"b":1}').digest("hex"));
  });
});

describe("money", () => {
  it("formats kobo as naira", () => {
    expect(formatNaira(1_000_000)).toBe("₦10,000");
  });
  it("converts naira to USD at the admin rate, rounding up to the cent", () => {
    expect(nairaToUsd(1_000_000, 1600)).toBe(6.25);
    expect(nairaToUsd(100_000, 1550)).toBe(0.65);
  });
});
