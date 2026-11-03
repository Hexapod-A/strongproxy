"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, requireAdmin } from "@/lib/auth";
import { resetBalanceCache } from "@/lib/services/balance-guard";
import { MODEM_PERIOD_LIST, resetModemCatalogCache, type LineOverride } from "@/lib/services/modems";
import { createAdminClient } from "@/lib/supabase/server";

export type AdminState = { error?: string; message?: string } | undefined;

function revalidateAll() {
  for (const p of ["/admin/modems", "/dashboard/modems", "/dashboard/modems/rent", "/pricing", "/"]) revalidatePath(p);
}

export async function updateModemSettingsAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const usd = z.coerce.number().positive("Prices must be above $0").max(10000);
  const p = z
    .object({
      modems_enabled: z.string().optional(),
      price_day: usd,
      price_week: usd,
      price_month: usd,
      min_margin: z.coerce.number().min(0).max(1000),
      psx_autopause_enabled: z.string().optional(),
      psx_autopause_threshold_usd: z.coerce.number().min(0).max(100000),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the numbers." };
  const store = adminStore();
  const prices = { day: p.data.price_day, week: p.data.price_week, month: p.data.price_month };
  await Promise.all([
    store.setSetting("modems_enabled", p.data.modems_enabled === "on"),
    store.setSetting("modem_prices_usd", prices),
    store.setSetting("modem_min_margin_usd", p.data.min_margin),
    store.setSetting("psx_autopause_enabled", p.data.psx_autopause_enabled === "on"),
    store.setSetting("psx_autopause_threshold_usd", p.data.psx_autopause_threshold_usd),
  ]);
  await createAdminClient().from("audit_log").insert({ actor_id: s.userId, action: "modems.settings", target: "modems", details: { ...prices, min_margin: p.data.min_margin } });
  resetBalanceCache();
  revalidateAll();
  return { message: `Saved: $${prices.day}/day, $${prices.week}/week, $${prices.month}/month.` };
}

/** One form for every line: price_<key> (blank = default price) and hide_<key>. Keys are "CC|Carrier|period". */
export async function updateModemLinesAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const store = adminStore();
  // Lines not on the form (not in Proxies.sx's list right now) keep what they had.
  const overrides: Record<string, LineOverride> = { ...((await store.getSetting<Record<string, LineOverride>>("modem_line_overrides")) ?? {}) };
  const keys = new Set<string>();
  for (const k of form.keys()) {
    const m = /^(price|hide)_(.+)$/.exec(k);
    if (m) keys.add(m[2]);
  }
  for (const key of keys) {
    const [cc, carrier, period] = key.split("|");
    if (!cc || !carrier || !MODEM_PERIOD_LIST.includes(period as never)) continue;
    const raw = String(form.get(`price_${key}`) ?? "").trim();
    const price = raw === "" ? null : Number(raw);
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 10000)) return { error: `Check the price for ${cc} ${carrier} (${period}).` };
    const hidden = form.get(`hide_${key}`) === "on";
    if (price !== null || hidden) overrides[key] = { priceUsd: price, hidden };
    else delete overrides[key];
  }
  await store.setSetting("modem_line_overrides", overrides);
  await createAdminClient().from("audit_log").insert({ actor_id: s.userId, action: "modems.lines", target: "modems", details: { overrides: Object.keys(overrides).length } });
  resetModemCatalogCache();
  revalidateAll();
  return { message: Object.keys(overrides).length ? `Saved ${Object.keys(overrides).length} line setting(s).` : "Saved. Every line uses your default prices." };
}
