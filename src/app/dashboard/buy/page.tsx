import { PageTitle } from "@/components/PageTitle";
import { adminStore, requireUser } from "@/lib/auth";
import { notifyAdmin } from "@/lib/notify";
import { getPortsApi, getProvider } from "@/lib/providers";
import { salesStatus } from "@/lib/services/balance-guard";
import { productStock, type ProductStock } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import type { Country, Product } from "@/lib/types";
import { BuyForm } from "./BuyForm";

export const metadata = { title: "Buy GB" };
export const dynamic = "force-dynamic";

export default async function BuyPage() {
  const s = await requireUser();
  const sb = await createClient();
  const [{ data: products }, { data: countries }] = await Promise.all([
    sb.from("products").select("*").eq("is_active", true).order("sort_order"),
    sb.from("countries").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const prods = (products ?? []) as Product[];
  const ctry = (countries ?? []) as Country[];
  // Live stock from providers that publish it (Proxies.sx). Out-of-stock countries can't be picked.
  const stockEntries = await Promise.all(
    prods.map(async (p) => [p.id, await productStock(getProvider(p.provider), p.provider_pool, ctry.map((c) => c.code))] as const),
  );
  const stock: Record<string, ProductStock> = Object.fromEntries(stockEntries);
  // Low-balance auto-pause: Proxies.sx products show "temporarily unavailable" while John's Proxies.sx balance is low.
  const psxPaused = prods.some((p) => p.provider === "proxies_sx")
    ? (await salesStatus({ store: adminStore(), notify: notifyAdmin, reader: getPortsApi() })).paused
    : false;
  const paused: Record<string, boolean> = Object.fromEntries(prods.map((p) => [p.id, psxPaused && p.provider === "proxies_sx"]));
  return (
    <>
      <PageTitle title="Buy GB" subtitle="Paid from your wallet. Delivered instantly. One price per GB in every country." />
      <BuyForm products={prods} countries={ctry} stock={stock} paused={paused} balanceKobo={s.profile.balance_kobo} />
    </>
  );
}
