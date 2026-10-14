import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { getPortsApi } from "@/lib/providers";
import { rotatePort } from "@/lib/services/ports";
import { rateLimit } from "@/lib/services/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Customer rotate link: GET or POST /api/ports/rotate/<token> changes the port's IP (POST /reseller/ports/:id/rotate).
 * The token is a random 36-hex secret per port, shown on the dashboard. Limited to 6 rotations a minute per port.
 */
async function handle(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!/^[a-f0-9]{36}$/.test(token)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const store = adminStore();
  const port = await store.findDedicatedPort({ rotateToken: token });
  if (!port) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (port.status !== "active" || new Date(port.expires_at).getTime() <= Date.now()) return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  if (!(await rateLimit(store, `rotate:${port.id}`, 60, 6))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  try {
    await rotatePort({ store, api: getPortsApi() }, port);
    return NextResponse.json({ ok: true, message: "IP rotation requested" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("rotate failed", port.id, e);
    return NextResponse.json({ ok: false, error: "upstream_error" }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
