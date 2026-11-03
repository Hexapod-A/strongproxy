import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { getModemsApi } from "@/lib/providers";
import { rotateModem } from "@/lib/services/modems";
import { rateLimit } from "@/lib/services/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Customer rotate link for a private modem: GET or POST /api/modems/rotate/<token> asks for a new IP
 * (POST /private-modems/:id/rotate). The token is a random 36-hex secret per modem shown on the dashboard, so the
 * supplier's own rotation link is never shown to customers. One rotation per minute per modem (the supplier's limit).
 */
async function handle(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[a-f0-9]{36}$/.test(token)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const store = adminStore();
  const modem = await store.findPrivateModem({ rotateToken: token });
  if (!modem) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (modem.status !== "active" || new Date(modem.expires_at).getTime() <= Date.now()) return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  if (!(await rateLimit(store, `mrotate:${modem.id}`, 60, 2))) return NextResponse.json({ ok: false, error: "rate_limited", message: "One rotation per minute." }, { status: 429 });
  try {
    const r = await rotateModem({ store, api: getModemsApi() }, modem);
    return NextResponse.json({ ok: true, message: r.message }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("modem rotate failed", modem.id, e);
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
