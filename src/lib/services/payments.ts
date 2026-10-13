import crypto from "node:crypto";
import { nairaToUsd } from "@/lib/money";
import type { Store } from "@/lib/store";

/* ----------------------------------------------------------------------------
 * Paystack (NGN). Docs: https://paystack.com/docs/payments/webhooks/ and
 * https://paystack.com/docs/api/transaction/
 *  - Webhook: header x-paystack-signature = HMAC-SHA512(raw body, secret key), hex.
 *  - Amounts are in kobo.
 * -------------------------------------------------------------------------- */

export function newReference(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

export async function initPaystack(
  args: { store: Store; secretKey: string; userId: string; email: string; amountKobo: number; callbackUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ reference: string; authorizationUrl: string }> {
  const reference = newReference("ps");
  await args.store.rpc("create_payment", {
    p_user_id: args.userId,
    p_provider: "paystack",
    p_reference: reference,
    p_amount_kobo: args.amountKobo,
    p_meta: null,
  });
  const res = await fetchImpl("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: args.email,
      amount: args.amountKobo,
      currency: "NGN",
      reference,
      callback_url: args.callbackUrl,
      metadata: { user_id: args.userId },
    }),
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { authorization_url?: string } } | null;
  if (!res.ok || !body?.status || !body.data?.authorization_url) {
    throw new Error("paystack_init_failed");
  }
  await args.store.rpc("set_payment_checkout", { p_reference: reference, p_checkout_url: body.data.authorization_url, p_meta: null });
  return { reference, authorizationUrl: body.data.authorization_url };
}

type PaystackEvent = {
  event?: string;
  data?: { reference?: string; amount?: number; currency?: string; status?: string };
};

export type WebhookResult = { httpStatus: number; outcome: string };

/**
 * Handle a Paystack webhook. Signature first, then (defence in depth) re-verify the transaction with
 * Paystack's API before crediting. Crediting is idempotent in SQL (confirm_payment).
 */
export async function handlePaystackWebhook(
  args: { store: Store; secretKey: string; rawBody: string; signature: string | null; verifyWithApi?: boolean },
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookResult> {
  if (!verifyPaystackSignature(args.rawBody, args.signature, args.secretKey)) {
    return { httpStatus: 401, outcome: "bad_signature" };
  }
  let evt: PaystackEvent;
  try {
    evt = JSON.parse(args.rawBody);
  } catch {
    return { httpStatus: 400, outcome: "bad_json" };
  }
  if (evt.event !== "charge.success" || !evt.data?.reference) {
    return { httpStatus: 200, outcome: "ignored" };
  }
  if (evt.data.currency && evt.data.currency !== "NGN") {
    return { httpStatus: 200, outcome: "ignored_currency" };
  }
  let amount = Number(evt.data.amount ?? 0);
  if (args.verifyWithApi !== false) {
    const res = await fetchImpl(`https://api.paystack.co/transaction/verify/${encodeURIComponent(evt.data.reference)}`, {
      headers: { Authorization: `Bearer ${args.secretKey}` },
    });
    const body = (await res.json().catch(() => null)) as { status?: boolean; data?: { status?: string; amount?: number } } | null;
    if (!res.ok || !body?.status || body.data?.status !== "success") {
      return { httpStatus: 200, outcome: "verify_failed" };
    }
    amount = Number(body.data.amount ?? 0);
  }
  const outcome = await args.store.rpc<string>("confirm_payment", {
    p_reference: evt.data.reference,
    p_provider: "paystack",
    p_paid_amount_kobo: amount,
    p_success: true,
    p_payload: evt as unknown as Record<string, unknown>,
  });
  return { httpStatus: 200, outcome };
}

/* ----------------------------------------------------------------------------
 * NOWPayments (crypto, USDT). Docs: https://documenter.getpostman.com/view/7907941/2s93JusNJt
 *  - POST /v1/invoice  (x-api-key) { price_amount, price_currency, order_id, ipn_callback_url, ... } -> { invoice_url }
 *  - IPN: header x-nowpayments-sig = HMAC-SHA512(JSON.stringify(body with keys sorted recursively), IPN secret)
 *  - payment_status "finished" = paid. "partially_paid" is NOT credited.
 * -------------------------------------------------------------------------- */

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

export function signNowPayments(body: unknown, ipnSecret: string): string {
  return crypto.createHmac("sha512", ipnSecret).update(JSON.stringify(sortKeysDeep(body))).digest("hex");
}

export function verifyNowPaymentsSignature(body: unknown, signature: string | null, ipnSecret: string): boolean {
  if (!signature) return false;
  return safeEqualHex(signNowPayments(body, ipnSecret), signature);
}

export async function initNowPayments(
  args: {
    store: Store;
    apiKey: string;
    baseUrl: string;
    payCurrency?: string;
    userId: string;
    amountKobo: number;
    ngnPerUsd: number;
    siteUrl: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ reference: string; invoiceUrl: string; usd: number }> {
  const reference = newReference("np");
  const usd = nairaToUsd(args.amountKobo, args.ngnPerUsd);
  await args.store.rpc("create_payment", {
    p_user_id: args.userId,
    p_provider: "nowpayments",
    p_reference: reference,
    p_amount_kobo: args.amountKobo,
    p_meta: { usd, ngn_per_usd: args.ngnPerUsd },
  });
  const res = await fetchImpl(`${args.baseUrl}/invoice`, {
    method: "POST",
    headers: { "x-api-key": args.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      price_amount: usd,
      price_currency: "usd",
      ...(args.payCurrency ? { pay_currency: args.payCurrency } : {}),
      order_id: reference,
      order_description: "StrongProxy wallet top-up",
      ipn_callback_url: `${args.siteUrl}/api/webhooks/nowpayments`,
      success_url: `${args.siteUrl}/dashboard/wallet?ref=${reference}`,
      cancel_url: `${args.siteUrl}/dashboard/wallet`,
      is_fee_paid_by_user: false,
    }),
  });
  const body = (await res.json().catch(() => null)) as { invoice_url?: string; id?: string } | null;
  if (!res.ok || !body?.invoice_url) throw new Error("nowpayments_init_failed");
  await args.store.rpc("set_payment_checkout", {
    p_reference: reference,
    p_checkout_url: body.invoice_url,
    p_meta: { invoice_id: body.id ?? null },
  });
  return { reference, invoiceUrl: body.invoice_url, usd };
}

type NowPaymentsIpn = {
  payment_id?: number | string;
  payment_status?: string;
  order_id?: string | null;
  price_amount?: number | string;
  price_currency?: string;
  parent_payment_id?: number | string | null;
};

export async function handleNowPaymentsWebhook(args: {
  store: Store;
  ipnSecret: string;
  rawBody: string;
  signature: string | null;
}): Promise<WebhookResult> {
  let body: NowPaymentsIpn;
  try {
    body = JSON.parse(args.rawBody);
  } catch {
    return { httpStatus: 400, outcome: "bad_json" };
  }
  if (!verifyNowPaymentsSignature(body, args.signature, args.ipnSecret)) {
    return { httpStatus: 401, outcome: "bad_signature" };
  }
  if (!body.order_id) return { httpStatus: 200, outcome: "ignored" };
  // Re-deposits carry parent_payment_id; NOWPayments recommends not auto-crediting them.
  if (body.parent_payment_id) return { httpStatus: 200, outcome: "ignored_redeposit" };

  const status = body.payment_status;
  if (status === "failed" || status === "expired") {
    const outcome = await args.store.rpc<string>("confirm_payment", {
      p_reference: body.order_id,
      p_provider: "nowpayments",
      p_paid_amount_kobo: 0,
      p_success: false,
      p_payload: body as unknown as Record<string, unknown>,
    });
    return { httpStatus: 200, outcome };
  }
  if (status !== "finished") return { httpStatus: 200, outcome: `waiting_${status ?? "unknown"}` };

  // price_amount is the USD price of the invoice we created. Compare against what we recorded.
  const pay = await getPaymentMeta(args.store, body.order_id);
  if (!pay) return { httpStatus: 200, outcome: "unknown_reference" };
  const paidUsd = Number(body.price_amount ?? 0);
  const okAmount = String(body.price_currency ?? "usd").toLowerCase() === "usd" && paidUsd + 1e-9 >= Number(pay.meta?.usd ?? Infinity);
  const outcome = await args.store.rpc<string>("confirm_payment", {
    p_reference: body.order_id,
    p_provider: "nowpayments",
    p_paid_amount_kobo: okAmount ? pay.amount_kobo : 0,
    p_success: true,
    p_payload: body as unknown as Record<string, unknown>,
  });
  return { httpStatus: 200, outcome };
}

async function getPaymentMeta(store: Store, reference: string): Promise<{ amount_kobo: number; meta: { usd?: number } | null } | null> {
  return store.rpc("payment_meta", { p_reference: reference });
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b.trim().toLowerCase(), "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
