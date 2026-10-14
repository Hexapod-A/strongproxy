import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { proxiesSx } from "@/lib/env";
import { handlePsxWebhook } from "@/lib/services/ports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies.sx reseller webhook (port.deleted / suspended / unsuspended / rotated). Signature: X-Webhook-Signature. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const r = await handlePsxWebhook({ store: adminStore(), secret: proxiesSx().webhookSecret, rawBody: raw, signature: req.headers.get("x-webhook-signature") });
  if (r.outcome !== "ignored") console.log("proxies.sx webhook", r.outcome);
  return NextResponse.json({ outcome: r.outcome }, { status: r.httpStatus });
}
