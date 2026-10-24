"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/money";
import { DAILY_PORTS_ENABLED } from "@/lib/features";
import { notifyAdmin } from "@/lib/notify";
import { getPortsApi } from "@/lib/providers";
import { buyPort, renewPort, rotatePort } from "@/lib/services/ports";
import { rateLimit } from "@/lib/services/ratelimit";
import { StoreError } from "@/lib/store";

export type PortActionState = { error?: string; message?: string } | undefined;

const ERRORS: Record<string, string> = {
  insufficient_balance: "Your wallet balance is too low. Top up first.",
  user_banned: "Your account is suspended.",
  product_unavailable: "Daily ports aren't available right now.",
  plan_unavailable: "That plan isn't available right now.",
  country_unavailable: "That country isn't available for daily ports right now.",
  country_out_of_stock: "No ports free in that country right now. Pick another country.",
  invalid_protocol: "Pick HTTP or SOCKS5.",
  provider_not_configured: "Daily ports can't be delivered right now. We've been alerted. Your wallet was not charged.",
  sales_paused: "Daily ports are temporarily unavailable. Your wallet was not charged. Try again a little later.",
  port_not_found: "That port wasn't found.",
  port_not_renewable: "This port has expired and can't be renewed. Buy a new one.",
};
const msg = (e: unknown) => ERRORS[e instanceof StoreError ? e.code : "x"] ?? "Something went wrong. Your wallet was not charged.";

const buySchema = z.object({
  plan_id: z.string().min(1).max(20),
  country: z.string().regex(/^[a-z]{2}$/),
  protocol: z.enum(["http", "socks5"]),
});

export async function buyPortAction(_: PortActionState, form: FormData): Promise<PortActionState> {
  const s = await requireUser();
  if (!DAILY_PORTS_ENABLED) return { error: ERRORS.product_unavailable };
  const p = buySchema.safeParse({ plan_id: form.get("plan_id"), country: form.get("country"), protocol: form.get("protocol") });
  if (!p.success) return { error: "Pick a country, a duration and a protocol." };
  const store = adminStore();
  if (!(await rateLimit(store, `buyport:${s.userId}`, 60, 5))) return { error: "Too many orders in a minute. Slow down." };
  try {
    const r = await buyPort(
      { store, notify: notifyAdmin, api: getPortsApi() },
      { userId: s.userId, email: s.email, planId: p.data.plan_id, countryCode: p.data.country, protocol: p.data.protocol },
    );
    if (r.outcome === "refunded") {
      revalidatePath("/dashboard");
      return { error: `We couldn't create your port right now, so your wallet was refunded ${formatNaira(r.order.total_kobo)} in full. Try another country or try again in a few minutes.` };
    }
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/dashboard/ports");
  redirect("/dashboard/ports?new=1");
}

export async function renewPortAction(_: PortActionState, form: FormData): Promise<PortActionState> {
  const s = await requireUser();
  const p = z.object({ port_id: z.string().uuid(), plan_id: z.string().min(1).max(20) }).safeParse({ port_id: form.get("port_id"), plan_id: form.get("plan_id") });
  if (!p.success) return { error: "Pick a duration." };
  const store = adminStore();
  if (!(await rateLimit(store, `renewport:${s.userId}`, 60, 5))) return { error: "Too many attempts in a minute." };
  try {
    const r = await renewPort({ store, notify: notifyAdmin, api: getPortsApi() }, { userId: s.userId, portId: p.data.port_id, planId: p.data.plan_id });
    revalidatePath("/dashboard/ports");
    if (r.outcome === "refunded") return { error: `Renewal didn't go through, so ${formatNaira(r.order.total_kobo)} went back to your wallet. Try again in a few minutes.` };
    return { message: `Renewed. ${formatNaira(r.order.total_kobo)} paid from your wallet.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function rotatePortAction(_: PortActionState, form: FormData): Promise<PortActionState> {
  const s = await requireUser();
  const id = String(form.get("port_id") ?? "");
  const store = adminStore();
  const port = /^[0-9a-f-]{36}$/.test(id) ? await store.getDedicatedPort(id) : null;
  if (!port || port.user_id !== s.userId) return { error: "That port wasn't found." };
  if (!(await rateLimit(store, `rotate:${port.id}`, 60, 6))) return { error: "Rotating too often. Wait a minute." };
  try {
    await rotatePort({ store, api: getPortsApi() }, port);
  } catch (e) {
    return { error: e instanceof StoreError ? msg(e) : "Rotation failed upstream. Try again in a moment." };
  }
  revalidatePath("/dashboard/ports");
  return { message: "New IP requested. Give it a few seconds." };
}
