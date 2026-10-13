import "server-only";
import { createPublicClient } from "@/lib/supabase/server";
import type { Country, Product } from "@/lib/types";

// Shown only if the database is unreachable (e.g. first boot before migrations). Mirrors supabase/seed.sql.
const FALLBACK_PRODUCTS: Product[] = [
  { id: "mobile", name: "Mobile", description: "Real 4G/5G carrier IPs. Highest trust for social and app traffic.", price_per_gb_kobo: 1000000, provider_pool: "mobile", provider: "proxies_sx", min_gb: 1, max_gb: 100, is_active: true, sort_order: 1 },
  { id: "residential", name: "Residential", description: "Home ISP IPs in the country you pick. Rotating or sticky.", price_per_gb_kobo: 650000, provider_pool: "residential", provider: "proxies_sx", min_gb: 1, max_gb: 500, is_active: true, sort_order: 2 },
];
const FALLBACK_COUNTRIES: Country[] = [
  ["us", "United States"], ["gb", "United Kingdom"], ["ca", "Canada"], ["au", "Australia"], ["de", "Germany"],
  ["fr", "France"], ["es", "Spain"], ["nl", "Netherlands"], ["no", "Norway"],
].map(([code, name], i) => ({ code, name, is_active: true, sort_order: i + 1 }));

export async function getCatalog(): Promise<{ products: Product[]; countries: Country[]; live: boolean }> {
  const sb = createPublicClient();
  if (!sb) return { products: FALLBACK_PRODUCTS, countries: FALLBACK_COUNTRIES, live: false };
  try {
    const [p, c] = await Promise.all([
      sb.from("products").select("*").eq("is_active", true).order("sort_order"),
      sb.from("countries").select("*").eq("is_active", true).order("sort_order"),
    ]);
    if (p.error || c.error) throw p.error ?? c.error;
    return { products: p.data as Product[], countries: c.data as Country[], live: true };
  } catch (e) {
    console.error("catalog fetch failed", e);
    return { products: FALLBACK_PRODUCTS, countries: FALLBACK_COUNTRIES, live: false };
  }
}

export const flag = (code: string) =>
  /^[a-z]{2}$/i.test(code)
    ? String.fromCodePoint(...code.toUpperCase().split("").map((ch) => 0x1f1a5 + ch.charCodeAt(0)))
    : "🌐";
