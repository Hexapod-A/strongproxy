// Client-safe: builds proxy strings without importing any server code.
import { buildDataImpulseString } from "./providers/dataimpulse";
import { genericProxyString } from "./providers/generic";
import { buildProxiesSxString } from "./providers/proxiessx";
import type { AccountForString, ProxyStringOptions } from "./providers/types";

export function formatProxy(provider: string, account: AccountForString, opts: ProxyStringOptions): string {
  if (provider === "proxies_sx") return buildProxiesSxString(account, opts);
  if (provider === "dataimpulse") return buildDataImpulseString(account, opts);
  return genericProxyString(account, opts);
}

/** Providers whose targeting syntax we know get the country/sticky generator and a live usage meter. */
export const supportsTargeting = (provider: string) => provider === "proxies_sx" || provider === "dataimpulse";

export const stickyNote = (provider: string) =>
  provider === "proxies_sx" ? "keeps the same device (and IP) while it stays online, up to an hour" : "keeps the same IP for about 30 minutes";
