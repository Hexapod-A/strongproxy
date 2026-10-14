import { dataimpulse, proxiesSx } from "@/lib/env";
import { DataImpulseProvider } from "./dataimpulse";
import { genericProxyString } from "./generic";
import { ProxiesSxProvider } from "./proxiessx";
import { ProxiesSxPortsApi } from "./proxiessx-ports";
import type { AccountForString, ProxyProvider, ProxyStringOptions } from "./types";

/**
 * Provider registry. Each product names its provider (products.provider, chosen in Admin > Catalog).
 * To add Proxy-Cheap / CatProxies / others: implement ProxyProvider in its own file, add it here and to the
 * products.provider check constraint.
 */
export const PROVIDER_IDS = ["proxies_sx", "dataimpulse"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const DEFAULT_PROVIDER: ProviderId = "proxies_sx";

let cached: ProxyProvider[] | null = null;

export function getProviders(): ProxyProvider[] {
  if (!cached) {
    cached = [new ProxiesSxProvider(proxiesSx()), new DataImpulseProvider(dataimpulse())];
  }
  return cached;
}

let portsApi: ProxiesSxPortsApi | null = null;
/** Proxies.sx reseller ports API (daily ports + account balance). Same PROXIES_SX_API_KEY as the per-GB adapter. */
export function getPortsApi(): ProxiesSxPortsApi {
  if (!portsApi) {
    const c = proxiesSx();
    portsApi = new ProxiesSxPortsApi({ apiKey: c.apiKey, apiBase: c.apiBase });
  }
  return portsApi;
}

export function getProvider(id: string, providers = getProviders()): ProxyProvider | undefined {
  return providers.find((p) => p.id === id);
}

/** Proxy string for any stored account: provider-specific targeting when we know the provider, else plain. */
export function proxyStringFor(provider: string, account: AccountForString, opts: ProxyStringOptions): string {
  const p = getProvider(provider);
  if (p) return p.buildProxyString(account, opts);
  return genericProxyString(account, opts);
}

export type { ProxyProvider } from "./types";
