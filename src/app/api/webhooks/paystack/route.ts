import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { paystack } from "@/lib/env";
import { handlePaystackWebhook } from "@/lib/services/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = paystack().secretKey;
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text(); // raw body: the signature is over the exact bytes
  const r = await handlePaystackWebhook({ store: adminStore(), secretKey: key, rawBody: raw, signature: req.headers.get("x-paystack-signature") });
  if (r.outcome !== "ignored") console.log("paystack webhook", r.outcome);
  return NextResponse.json({ outcome: r.outcome }, { status: r.httpStatus });
}
