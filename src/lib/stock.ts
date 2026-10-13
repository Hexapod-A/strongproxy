import type { ProxyProvider } from "@/lib/providers/types";

/**
 * Country availability for a product. Providers that publish live stock (Proxies.sx) gate countries on it;
 * providers that don't (DataImpulse) fall back to the admin's country toggles.
 *  - "in_stock" / "out_of_stock": from the provider's live feed
 *  - "unknown": the provider has no feed, or the feed could not be read just now
 */
export type Availability = "in_stock" | "out_of_stock" | "unknown";

export type ProductStock = {
  live: boolean;
  /** per country code; "" = any country */
  countries: Record<string, Availability>;
};

export async function productStock(provider: ProxyProvider | undefined, pool: string, codes: string[]): Promise<ProductStock> {
  const all = ["", ...codes];
  const unknown = (): ProductStock => ({ live: false, countries: Object.fromEntries(all.map((c) => [c, "unknown" as Availability])) });
  if (!provider?.getStock) return unknown();
  try {
    const snap = await provider.getStock();
    const byCc = snap.byPool[pool] ?? {};
    const countries: Record<string, Availability> = {};
    for (const c of codes) countries[c] = Number(byCc[c] ?? 0) > 0 ? "in_stock" : "out_of_stock";
    // "Any country" draws from every country the provider has, not just the ones we list.
    countries[""] = Object.values(byCc).some((n) => Number(n) > 0) ? "in_stock" : "out_of_stock";
    return { live: true, countries };
  } catch (e) {
    console.error("stock feed unavailable", e);
    return unknown();
  }
}
