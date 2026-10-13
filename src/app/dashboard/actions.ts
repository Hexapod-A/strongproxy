"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminStore, clientIp, requireUser } from "@/lib/auth";
import { nowpayments, paystack, siteUrl } from "@/lib/env";
import { formatNaira, toKobo } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { purchase } from "@/lib/services/orders";
import { initNowPayments, initPaystack } from "@/lib/services/payments";
import { rateLimit } from "@/lib/services/ratelimit";
import { StoreError } from "@/lib/store";

export type ActionState = { error?: string; message?: string } | undefined;

const ERRORS: Record<string, string> = {
  insufficient_balance: "Your wallet balance is too low. Top up first.",
  user_banned: "Your account is suspended.",
  product_unavailable: "That product isn't available right now.",
  invalid_quantity: "Pick a quantity within the allowed range.",
  country_unavailable: "That country isn't available right now.",
  country_out_of_stock: "That country is out of stock right now. Pick another country or \"Any country\".",
  provider_not_configured: "This product can't be delivered right now. We've been alerted. Your wallet was not charged.",
};

const buySchema = z.object({
  product_id: z.string().min(1),
  country: z.string().regex(/^([a-z]{2})?$/),
  quantity: z.coerce.number().int().min(1).max(10000),
});

export async function buyAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireUser();
  const parsed = buySchema.safeParse({ product_id: form.get("product_id"), country: form.get("country") ?? "", quantity: form.get("quantity") });
  if (!parsed.success) return { error: "Check your selection." };

  const store = adminStore();
  if (!(await rateLimit(store, `buy:${s.userId}`, 60, 6))) return { error: "Too many orders in a minute. Slow down." };

  let orderId: string;
  try {
    const r = await purchase(
      { store, notify: notifyAdmin },
      { userId: s.userId, productId: parsed.data.product_id, countryCode: parsed.data.country || null, quantityGb: parsed.data.quantity },
    );
    orderId = r.order.id;
    if (r.outcome === "refunded") {
      revalidatePath("/dashboard");
      return {
        error: `We couldn't deliver this order right now, so your wallet was refunded ${formatNaira(r.order.total_kobo)} in full. Try another country or try again in a few minutes.`,
      };
    }
  } catch (e) {
    const code = e instanceof StoreError ? e.code : "unknown_error";
    return { error: ERRORS[code] ?? "Something went wrong. Your wallet was not charged." };
  }
  revalidatePath("/dashboard");
  redirect(`/dashboard/orders?placed=${orderId}`);
}

const topupSchema = z.object({
  amount: z.coerce.number().int().min(1),
  method: z.enum(["paystack", "crypto"]),
});

export async function topUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireUser();
  const parsed = topupSchema.safeParse({ amount: form.get("amount"), method: form.get("method") });
  if (!parsed.success) return { error: "Enter an amount in naira." };

  const store = adminStore();
  const minKobo = Number((await store.getSetting<number>("min_topup_kobo")) ?? 100000);
  const amountKobo = toKobo(parsed.data.amount);
  if (amountKobo < minKobo) return { error: `The minimum top-up is ₦${(minKobo / 100).toLocaleString("en-NG")}.` };
  if (amountKobo > toKobo(5_000_000)) return { error: "For top-ups above ₦5,000,000 contact support." };

  const ip = await clientIp();
  if (!(await rateLimit(store, `topup:${s.userId}`, 600, 10)) || !(await rateLimit(store, `topup-ip:${ip}`, 600, 20))) {
    return { error: "Too many top-up attempts. Try again in a few minutes." };
  }

  let url: string;
  try {
    if (parsed.data.method === "paystack") {
      const key = paystack().secretKey;
      if (!key) return { error: "Card and bank payments aren't set up yet. Use USDT or contact support." };
      const r = await initPaystack({
        store,
        secretKey: key,
        userId: s.userId,
        email: s.email,
        amountKobo,
        callbackUrl: `${siteUrl()}/dashboard/wallet`,
      });
      url = r.authorizationUrl;
    } else {
      const np = nowpayments();
      if (!np.apiKey) return { error: "Crypto payments aren't set up yet. Use Paystack or contact support." };
      const rate = Number((await store.getSetting<number>("usd_ngn_rate")) ?? 0);
      const r = await initNowPayments({
        store,
        apiKey: np.apiKey,
        baseUrl: np.baseUrl,
        payCurrency: np.payCurrency,
        userId: s.userId,
        amountKobo,
        ngnPerUsd: rate,
        siteUrl: siteUrl(),
      });
      url = r.invoiceUrl;
    }
  } catch (e) {
    console.error("top-up init failed", e);
    return { error: "We couldn't reach the payment provider. Try again in a moment." };
  }
  redirect(url);
}
