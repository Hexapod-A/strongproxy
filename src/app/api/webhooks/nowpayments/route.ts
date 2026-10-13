import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { nowpayments } from "@/lib/env";
import { handleNowPaymentsWebhook } from "@/lib/services/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = nowpayments().ipnSecret;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  const r = await handleNowPaymentsWebhook({ store: adminStore(), ipnSecret: secret, rawBody: raw, signature: req.headers.get("x-nowpayments-sig") });
  console.log("nowpayments ipn", r.outcome);
  return NextResponse.json({ outcome: r.outcome }, { status: r.httpStatus });
}
