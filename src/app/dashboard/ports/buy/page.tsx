import { redirect } from "next/navigation";
import { PageTitle } from "@/components/PageTitle";
import { DAILY_PORTS_ENABLED } from "@/lib/features";
import { adminStore, requireUser } from "@/lib/auth";
import { notifyAdmin } from "@/lib/notify";
import { getPortsApi } from "@/lib/providers";
import { salesStatus } from "@/lib/services/balance-guard";
import { isBuyable, portStock } from "@/lib/services/ports";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country, PortPlan } from "@/lib/types";
import { PortBuyForm } from "./PortBuyForm";

export const metadata = { title: "Buy a daily port" };
export const dynamic = "force-dynamic";

export default async function BuyPortPage() {
  if (!DAILY_PORTS_ENABLED) redirect("/dashboard/buy");
  const s = await requireUser();
  const db = createAdminClient();
  const [{ data: plans }, { data: countries }, { data: enabled }] = await Promise.all([
    db.from("port_plans").select("*").eq("is_active", true).order("sort_order"),
    db.from("countries").select("*").eq("is_active", true).eq("ports_enabled", true).order("sort_order"),
    db.from("settings").select("value").eq("key", "ports_enabled").maybeSingle(),
  ]);
  const api = getPortsApi();
  const ctry = (countries ?? []) as Country[];
  const [stock, sales] = await Promise.all([portStock(api, ctry), salesStatus({ store: adminStore(), notify: notifyAdmin, reader: api })]);
  // Only countries with free ports (live list) or an admin-set Proxies.sx id when their list can't be read.
  const inStock = ctry.filter((c) => isBuyable(stock.countries[c.code])).map((c) => ({ code: c.code, name: c.name }));
  const off = enabled?.value === false || enabled?.value === "false" || !api.isConfigured();

  return (
    <>
      <PageTitle title="Buy a daily port" subtitle="A dedicated real-SIM mobile port. Paid from your wallet, created instantly." />
      <PortBuyForm plans={(plans ?? []) as PortPlan[]} countries={inStock} balanceKobo={s.profile.balance_kobo} unavailable={off || sales.paused} />
    </>
  );
}
