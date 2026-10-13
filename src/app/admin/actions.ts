"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, requireAdmin } from "@/lib/auth";
import { toKobo } from "@/lib/money";
import { getProviders, PROVIDER_IDS } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/server";
import { StoreError } from "@/lib/store";

export type AdminState = { error?: string; message?: string } | undefined;
const fail = (e: unknown): AdminState => ({ error: e instanceof StoreError ? e.code : e instanceof Error ? e.message : "error" });

export async function refundOrderAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  try {
    await adminStore().rpc("refund_order", { p_order_id: String(form.get("order_id")), p_note: String(form.get("note") || "Refunded by admin"), p_actor: s.userId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin/orders");
  return { message: "Refunded to the customer's wallet." };
}

export async function adjustBalanceAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z
    .object({ user_id: z.string().uuid(), amount: z.coerce.number().refine((n) => n !== 0, "Amount can't be zero"), note: z.string().trim().min(3, "Add a short note") })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try {
    await adminStore().rpc("admin_adjust_balance", { p_user_id: p.data.user_id, p_amount_kobo: toKobo(p.data.amount), p_note: p.data.note, p_actor: s.userId });
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/admin/users");
  return { message: "Balance updated." };
}

export async function setBanAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const userId = String(form.get("user_id"));
  const ban = form.get("ban") === "true";
  const reason = String(form.get("reason") ?? "").slice(0, 300) || null;
  if (userId === s.userId) return { error: "You can't ban yourself." };
  const db = createAdminClient();
  const { error } = await db.from("profiles").update({ is_banned: ban, banned_reason: ban ? reason : null }).eq("id", userId);
  if (error) return { error: error.message };
  await db.from("audit_log").insert({ actor_id: s.userId, action: ban ? "user.ban" : "user.unban", target: userId, details: { reason } });

  // Block / unblock the user's upstream accounts too, so banned users can't keep using delivered proxies.
  const { data: accs } = await db.from("proxy_accounts").select("provider, external_id").eq("user_id", userId).not("external_id", "is", null);
  const providers = getProviders();
  const upstreamErrors: string[] = [];
  for (const a of accs ?? []) {
    const p = providers.find((x) => x.id === a.provider);
    if (p?.setBlocked && p.isConfigured()) {
      try {
        await p.setBlocked(a.external_id, ban);
      } catch (e) {
        upstreamErrors.push(`${a.provider}:${a.external_id} ${(e as Error).message}`);
      }
    }
  }
  revalidatePath("/admin/users");
  if (upstreamErrors.length) return { error: `Saved, but upstream block failed: ${upstreamErrors.join("; ")}` };
  return { message: ban ? "User banned and their provider keys disabled." : "User unbanned." };
}

export async function updateProductAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z
    .object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(40),
      description: z.string().trim().max(200),
      price: z.coerce.number().positive(),
      min_gb: z.coerce.number().int().min(1),
      max_gb: z.coerce.number().int().min(1),
      is_active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (p.data.max_gb < p.data.min_gb) return { error: "Max GB must be at least min GB." };
  const db = createAdminClient();
  const { error } = await db
    .from("products")
    .update({
      name: p.data.name,
      description: p.data.description,
      price_per_gb_kobo: toKobo(p.data.price),
      min_gb: p.data.min_gb,
      max_gb: p.data.max_gb,
      is_active: p.data.is_active === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.data.id);
  if (error) return { error: error.message };
  await db.from("audit_log").insert({ actor_id: s.userId, action: "product.update", target: p.data.id, details: { price: p.data.price } });
  revalidatePath("/admin/catalog");
  revalidatePath("/");
  return { message: `${p.data.name} saved.` };
}

export async function setProductProviderAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z.object({ product_id: z.string().min(1), provider: z.enum(PROVIDER_IDS) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Pick a provider." };
  const db = createAdminClient();
  const { data: product } = await db.from("products").select("provider_pool").eq("id", p.data.product_id).maybeSingle();
  const provider = getProviders().find((x) => x.id === p.data.provider);
  if (!product || !provider) return { error: "Unknown product or provider." };
  if (!provider.supportsPool(product.provider_pool)) return { error: `${provider.label} doesn't sell ${product.provider_pool}.` };
  const { error } = await db.from("products").update({ provider: p.data.provider, updated_at: new Date().toISOString() }).eq("id", p.data.product_id);
  if (error) return { error: error.message };
  await db.from("audit_log").insert({ actor_id: s.userId, action: "product.provider", target: p.data.product_id, details: { provider: p.data.provider } });
  revalidatePath("/admin");
  revalidatePath("/dashboard/buy");
  return {
    message: provider.isConfigured()
      ? `Saved. New orders use ${provider.label}. Existing customers keep their current credentials.`
      : `Saved, but ${provider.label} has no keys in env yet, so this product can't be bought until you add them.`,
  };
}

export async function upsertCountryAction(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const p = z
    .object({
      code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, "Use a 2-letter country code (e.g. it)"),
      name: z.string().trim().min(2).max(60),
      sort_order: z.coerce.number().int().default(100),
      is_active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { error } = await createAdminClient()
    .from("countries")
    .upsert({ code: p.data.code, name: p.data.name, sort_order: p.data.sort_order, is_active: p.data.is_active === "on" });
  if (error) return { error: error.message };
  revalidatePath("/admin/catalog");
  revalidatePath("/");
  return { message: `${p.data.name} saved.` };
}

export async function updateSettingsAction(_: AdminState, form: FormData): Promise<AdminState> {
  const s = await requireAdmin();
  const p = z
    .object({
      usd_ngn_rate: z.coerce.number().positive(),
      min_topup: z.coerce.number().int().min(100),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db.from("settings").upsert([
    { key: "usd_ngn_rate", value: p.data.usd_ngn_rate, updated_at: now },
    { key: "min_topup_kobo", value: toKobo(p.data.min_topup), updated_at: now },
  ]);
  if (error) return { error: error.message };
  await db.from("audit_log").insert({ actor_id: s.userId, action: "settings.update", target: "settings", details: p.data });
  revalidatePath("/admin");
  return { message: "Settings saved." };
}
