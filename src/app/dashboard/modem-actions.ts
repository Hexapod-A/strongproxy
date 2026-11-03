"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { getModemsApi, getPortsApi } from "@/lib/providers";
import { buyModem, renewModem, rotateModem, type ModemDeps } from "@/lib/services/modems";
import { rateLimit } from "@/lib/services/ratelimit";
import { StoreError } from "@/lib/store";

export type ModemActionState = { error?: string; message?: string } | undefined;

const ERRORS: Record<string, string> = {
  insufficient_balance: "Your wallet balance is too low. Top up first.",
  user_banned: "Your account is suspended.",
  product_unavailable: "Private modems aren't available right now.",
  plan_unavailable: "That plan isn't available right now. Pick another one.",
  out_of_stock: "That one just sold out. Pick another carrier or country.",
  provider_not_configured: "Private modems can't be rented just yet. Your wallet was not charged.",
  sales_paused: "Private modems are temporarily unavailable. Your wallet was not charged. Try again a little later.",
  modem_not_found: "That modem wasn't found.",
  modem_not_renewable: "This modem has ended and can't be renewed. Rent a new one.",
  renewal_in_progress: "A renewal for this modem is already going through.",
};
const msg = (e: unknown) => ERRORS[e instanceof StoreError ? e.code : "x"] ?? "Something went wrong. Your wallet was not charged.";

const deps = (): ModemDeps => ({ store: adminStore(), notify: notifyAdmin, api: getModemsApi(), balance: getPortsApi() });
const period = z.enum(["day", "week", "month"]);

export async function rentModemAction(_: ModemActionState, form: FormData): Promise<ModemActionState> {
  const s = await requireUser();
  const p = z
    .object({ country: z.string().regex(/^[a-z]{2}$/), carrier: z.string().trim().min(1).max(80), period })
    .safeParse({ country: form.get("country"), carrier: form.get("carrier"), period: form.get("period") });
  if (!p.success) return { error: "Pick a country, a carrier and how long you want it." };
  const d = deps();
  if (!(await rateLimit(d.store, `buymodem:${s.userId}`, 60, 4))) return { error: "Too many orders in a minute. Slow down." };
  let outcome: "fulfilled" | "pending";
  try {
    const r = await buyModem(d, { userId: s.userId, countryCode: p.data.country, carrierName: p.data.carrier, period: p.data.period });
    if (r.outcome === "failed") {
      revalidatePath("/dashboard");
      return { error: `We couldn't set up that modem, so ${formatNaira(r.order.total_kobo)} went back to your wallet. ${r.code === "no_stock" ? "It just sold out. Pick another one." : "Try another carrier or try again in a few minutes."}` };
    }
    outcome = r.outcome;
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/dashboard/modems");
  redirect(outcome === "fulfilled" ? "/dashboard/modems?new=1" : "/dashboard/modems?setup=1");
}

export async function renewModemAction(_: ModemActionState, form: FormData): Promise<ModemActionState> {
  const s = await requireUser();
  const p = z.object({ modem_id: z.string().uuid(), period }).safeParse({ modem_id: form.get("modem_id"), period: form.get("period") });
  if (!p.success) return { error: "Pick how long to add." };
  const d = deps();
  if (!(await rateLimit(d.store, `renewmodem:${s.userId}`, 60, 4))) return { error: "Too many attempts in a minute." };
  try {
    const r = await renewModem(d, { userId: s.userId, modemId: p.data.modem_id, period: p.data.period });
    revalidatePath("/dashboard/modems");
    if (r.outcome === "failed") return { error: `The renewal didn't go through, so ${formatNaira(r.order.total_kobo)} went back to your wallet. Try again in a few minutes.` };
    if (r.outcome === "pending") return { message: `Paid ${formatNaira(r.order.total_kobo)}. The new end date shows here in a minute.` };
    return { message: `Renewed. ${formatNaira(r.order.total_kobo)} paid from your wallet.` };
  } catch (e) {
    return { error: msg(e) };
  }
}

export async function rotateModemAction(_: ModemActionState, form: FormData): Promise<ModemActionState> {
  const s = await requireUser();
  const id = String(form.get("modem_id") ?? "");
  const d = deps();
  const modem = /^[0-9a-f-]{36}$/.test(id) ? await d.store.getPrivateModem(id) : null;
  if (!modem || modem.user_id !== s.userId) return { error: "That modem wasn't found." };
  if (modem.status !== "active" || new Date(modem.expires_at).getTime() <= Date.now()) return { error: "This modem has ended." };
  if (!(await rateLimit(d.store, `mrotate:${modem.id}`, 60, 2))) return { error: "One new IP a minute. Wait a moment and try again." };
  try {
    const r = await rotateModem(d, modem);
    revalidatePath("/dashboard/modems");
    return { message: r.message };
  } catch {
    return { error: "Couldn't change the IP just now. Try again in a minute." };
  }
}
