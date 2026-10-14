import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { PortCard } from "@/components/PortCard";
import { adminStore, requireUser } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { notifyAdmin } from "@/lib/notify";
import { getPortsApi } from "@/lib/providers";
import { salesStatus } from "@/lib/services/balance-guard";
import { syncPorts } from "@/lib/services/ports";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country, DedicatedPort, PortPlan } from "@/lib/types";

export const metadata = { title: "Daily ports" };
export const dynamic = "force-dynamic";

function stillRunning(ports: DedicatedPort[]) {
  const now = Date.now();
  return ports.filter((p) => new Date(p.expires_at).getTime() > now);
}

export default async function PortsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const s = await requireUser();
  const { new: fresh } = await searchParams;
  const db = createAdminClient();
  const load = async () =>
    ((await db.from("dedicated_ports").select("*").eq("user_id", s.userId).in("status", ["active", "suspended"]).order("expires_at", { ascending: true })).data ?? []) as DedicatedPort[];

  // Proxies.sx sends no "expired" webhook, so ports are re-read from their API on page view (at most every 5 min).
  let ports = await load();
  const api = getPortsApi();
  if (await syncPorts({ store: adminStore(), api }, ports)) ports = await load();
  // Expired ports can't be renewed, so they stop showing once the time is up.
  ports = stillRunning(ports);

  const [{ data: plans }, { data: countries }, sales] = await Promise.all([
    db.from("port_plans").select("*").eq("is_active", true).order("sort_order"),
    db.from("countries").select("code,name"),
    salesStatus({ store: adminStore(), notify: notifyAdmin, reader: api }),
  ]);
  const cname = (c: string | null) => (countries as Pick<Country, "code" | "name">[] | null)?.find((x) => x.code === c)?.name ?? (c ?? "").toUpperCase();

  return (
    <>
      <PageTitle
        title="Daily ports"
        subtitle="Your own dedicated mobile port for 1, 7 or 30 days. Rotate the IP whenever you want."
        action={<Link href="/dashboard/ports/buy" className="btn-primary btn-sm">Buy a daily port</Link>}
      />
      {fresh && ports.length > 0 && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-ok-bg px-5 py-4 text-sm text-accent-ink">Your port is ready. Copy the login below.</div>
      )}
      {ports.length === 0 ? (
        <div className="card flex flex-col items-start gap-4 p-8">
          <p className="font-medium">No active ports</p>
          <p className="max-w-md text-sm text-muted">Pick a country and a duration. Your port is created instantly and paid from your wallet.</p>
          <Link href="/dashboard/ports/buy" className="btn-primary btn-sm">Buy a daily port</Link>
        </div>
      ) : (
        <div className="space-y-5">
          {ports.map((p) => (
            <PortCard
              key={p.id}
              plans={(plans ?? []) as PortPlan[]}
              balanceKobo={s.profile.balance_kobo}
              renewBlocked={sales.paused}
              port={{
                id: p.id,
                countryName: cname(p.country_code),
                protocol: p.protocol,
                server_ip: p.server_ip,
                http_port: p.http_port,
                socks_port: p.socks_port,
                username: p.username,
                password: p.password,
                traffic_gb: p.traffic_gb,
                status: p.status,
                expires_at: p.expires_at,
                rotateUrl: `${siteUrl()}/api/ports/rotate/${p.rotate_token}`,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
