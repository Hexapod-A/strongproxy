"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, requireAdmin } from "@/lib/auth";
import { toKobo } from "@/lib/money";
import { getPortsApi } from "@/lib/providers";
import { resetBalanceCache } from "@/lib/services/balance-guard";
import { portStock, resetPortStockCache } from "@/lib/services/ports";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country } from "@/lib/types";

export type AdminState = { error?: string; message?: string } | undefined;

export async function updatePortPlanAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z
    .object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(30),
      price: z.coerce.number().positive("Price must be above ₦0"),
      traffic_gb: z.coerce.number().int().min(0).max(10000),
      is_active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const db = createAdminClient();
  const { error } = await db
    .from("port_plans")
    .update({ name: p.data.name, price_kobo: toKobo(p.data.price), traffic_gb: p.data.traffic_gb, is_active: p.data.is_active === "on", updated_at: new Date().toISOString() })
    .eq("id", p.data.id);
  if (error) return { error: error.message };
  await db.from("audit_log").insert({ actor_id: s.userId, action: "port_plan.update", target: p.data.id, details: { price: p.data.price, traffic_gb: p.data.traffic_gb } });
  revalidatePath("/admin/ports");
  revalidatePath("/dashboard/ports/buy");
  return { message: `${p.data.name} saved.` };
}

export async function updatePortCountryAction(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const p = z
    .object({ code: z.string().regex(/^[a-z]{2}$/), psx_country_id: z.string().trim().max(64).optional(), ports_enabled: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Check the country." };
  const { error } = await createAdminClient()
    .from("countries")
    .update({ ports_enabled: p.data.ports_enabled === "on", psx_country_id: p.data.psx_country_id || null })
    .eq("code", p.data.code);
  if (error) return { error: error.message };
  resetPortStockCache(getPortsApi());
  revalidatePath("/admin/ports");
  return { message: "Saved." };
}

export async function updatePortSettingsAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z
    .object({
      ports_enabled: z.string().optional(),
      port_usd_ngn_rate: z.coerce.number().positive(),
      psx_cost_usd_per_gb: z.coerce.number().min(0),
      psx_port_cost_usd_per_day: z.coerce.number().min(0),
      psx_autopause_enabled: z.string().optional(),
      psx_autopause_threshold_usd: z.coerce.number().min(0),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const now = new Date().toISOString();
  const d = p.data;
  const { error } = await createAdminClient()
    .from("settings")
    .upsert([
      { key: "ports_enabled", value: d.ports_enabled === "on", updated_at: now },
      { key: "port_usd_ngn_rate", value: d.port_usd_ngn_rate, updated_at: now },
      { key: "psx_cost_usd_per_gb", value: d.psx_cost_usd_per_gb, updated_at: now },
      { key: "psx_port_cost_usd_per_day", value: d.psx_port_cost_usd_per_day, updated_at: now },
      { key: "psx_autopause_enabled", value: d.psx_autopause_enabled === "on", updated_at: now },
      { key: "psx_autopause_threshold_usd", value: d.psx_autopause_threshold_usd, updated_at: now },
    ]);
  if (error) return { error: error.message };
  resetBalanceCache();
  await createAdminClient().from("audit_log").insert({ actor_id: s.userId, action: "port_settings.update", target: "settings", details: d });
  revalidatePath("/admin/ports");
  revalidatePath("/dashboard/buy");
  return { message: "Settings saved." };
}

/** Ask Proxies.sx what a port really costs your account (POST /reseller/ports/calculate-price, 1 and 30 days). */
export async function checkLiveCostAction(): Promise<AdminState> {
  const s = await requireAdmin();
  const api = getPortsApi();
  if (!api.isConfigured()) return { error: "Set PROXIES_SX_API_KEY first." };
  const db = createAdminClient();
  const { data } = await db.from("countries").select("*").eq("is_active", true).order("sort_order");
  const countries = (data ?? []) as Country[];
  const stock = await portStock(api, countries);
  const store = adminStore();
  try {
    let customerId = await store.getProviderCustomer(s.userId, "proxies_sx");
    if (!customerId) {
      const [local, domain] = s.email.split("@");
      customerId =
        (await api.findCustomerByExternalId(s.userId)) ??
        (await api.createCustomer({ email: domain ? `${local}+pricecheck@${domain}` : `${s.userId}@customers.invalid`, name: "Price check", externalId: s.userId }));
      await store.rpc("set_provider_customer", { p_user_id: s.userId, p_provider: "proxies_sx", p_external_id: customerId });
    }
    const lines: string[] = [];
    for (const c of countries) {
      const id = stock.countries[c.code]?.psxId;
      if (!id) {
        lines.push(`${c.name}: no Proxies.sx country id`);
        continue;
      }
      const d1 = await api.calculatePrice({ customerId, countryId: id, days: 1 });
      const d30 = await api.calculatePrice({ customerId, countryId: id, days: 30 });
      lines.push(`${c.name}: 1 day $${d1.basePrice ?? "?"} · 30 days $${d30.basePrice ?? "?"}`);
    }
    return { message: `Your cost (basePrice) from Proxies.sx: ${lines.join(" | ")}` };
  } catch (e) {
    return { error: `Proxies.sx: ${e instanceof Error ? e.message : String(e)}` };
  }
}
