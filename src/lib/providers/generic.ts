import type { AccountForString, ProxyStringOptions } from "./types";

/** Plain credential string for accounts whose provider has no targeting syntax. */
export function genericProxyString(a: AccountForString, opts: Pick<ProxyStringOptions, "format" | "protocol">): string {
  if (opts.format === "url") {
    return `${opts.protocol}://${encodeURIComponent(a.username)}:${encodeURIComponent(a.password)}@${a.host}:${a.port}`;
  }
  return `${a.host}:${a.port}:${a.username}:${a.password}`;
}
