import { PageTitle } from "@/components/PageTitle";
import { requireUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
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
  return (
    <>
      <PageTitle title="Buy GB" subtitle="Paid from your wallet. Delivered instantly. One price per GB in every country." />
      <BuyForm products={prods} countries={ctry} stock={stock} balanceKobo={s.profile.balance_kobo} />
    </>
  );
}
