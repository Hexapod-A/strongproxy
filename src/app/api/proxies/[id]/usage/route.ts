import { NextResponse, type NextRequest } from "next/server";
import { adminStore } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { rateLimit } from "@/lib/services/ratelimit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // RLS: the user can only read their own proxy accounts.
  const { data: acc } = await sb.from("proxy_accounts").select("id, provider, external_id").eq("id", id).maybeSingle();
  if (!acc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await rateLimit(adminStore(), `usage:${user.id}`, 60, 30))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const provider = getProvider(acc.provider);
  if (!provider || !provider.isConfigured() || !acc.external_id) return NextResponse.json({ error: "not_tracked" }, { status: 404 });
  try {
    const usage = await provider.getUsage(acc.external_id);
    return NextResponse.json(usage, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    console.error("usage fetch failed", e);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
