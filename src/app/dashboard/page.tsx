import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { ProxyCard } from "@/components/ProxyCard";
import { StatusPill } from "@/components/StatusPill";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { orderTitle } from "@/lib/order-label";
import type { Country, Order, Product, ProxyAccount } from "@/lib/types";

/** Failed + refunded orders stay visible on the overview for a day. */
function dayAgoIso() {
  return new Date(Date.now() - 86400_000).toISOString();
}

export default async function Overview() {
  const s = await requireUser();
  const sb = await createClient();
  const [{ data: accounts }, { data: pending }, { data: products }, { data: countries }] = await Promise.all([
    sb.from("proxy_accounts").select("*").order("created_at", { ascending: false }),
    sb
      .from("orders")
      .select("*")
      .or(`status.eq.processing,and(status.eq.refunded,failure_reason.not.is.null,created_at.gte.${dayAgoIso()})`)
      .order("created_at", { ascending: false }),
    sb.from("products").select("id,name"),
    sb.from("countries").select("code,name").eq("is_active", true).order("sort_order"),
  ]);
  const pname = (id: string) => (products as Pick<Product, "id" | "name">[] | null)?.find((p) => p.id === id)?.name ?? id;
  const accs = (accounts ?? []) as ProxyAccount[];
  const pend = (pending ?? []) as Order[];

  return (
    <>
      <PageTitle title={`Hi${s.profile.full_name ? ", " + s.profile.full_name.split(" ")[0] : ""}`} subtitle="Your balance, proxies and usage." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.3fr_1fr] [&>*]:min-w-0">
        <div className="card flex flex-col justify-between gap-6 p-6">
          <div>
            <p className="text-sm text-muted">Wallet balance</p>
            <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.03em]">{formatNaira(s.profile.balance_kobo)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/wallet" className="btn-ghost btn-sm">Top up</Link>
            <Link href="/dashboard/buy" className="btn-primary btn-sm">Buy GB</Link>
            <Link href="/dashboard/ports" className="btn-ghost btn-sm">Daily ports</Link>
          </div>
        </div>
        <div className="card p-6">
          <p className="text-sm text-muted">Active proxies</p>
          <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.03em]">{accs.length}</p>
          <p className="mt-4 text-sm text-muted">{accs.reduce((n, a) => n + a.traffic_gb_purchased, 0)} GB bought in total</p>
        </div>
      </div>

      {pend.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-muted">Recent orders</h2>
          <div className="card divide-y divide-line">
            {pend.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <div>
                  <p className="font-medium">{orderTitle(o, pname)}</p>
                  <p className="text-muted">
                    {o.status === "refunded"
                      ? `We couldn't deliver this order, so ${formatNaira(o.total_kobo)} went back to your wallet. Try again or pick another country.`
                      : "Paid. Delivering your credentials now; refresh in a moment."}
                  </p>
                </div>
                <StatusPill status={o.status} failed={Boolean(o.failure_reason)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted">My proxies</h2>
        {accs.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 p-8">
            <p className="font-medium">No proxies yet</p>
            <p className="max-w-md text-sm text-muted">Top up your wallet, then buy mobile or residential GB. Your credentials will show up here with copy buttons.</p>
            <Link href="/dashboard/buy" className="btn-primary btn-sm">Buy your first GB</Link>
          </div>
        ) : (
          <div className="space-y-5">
            {accs.map((a) => (
              <ProxyCard
                key={a.id}
                countries={(countries ?? []) as Pick<Country, "code" | "name">[]}
                account={{ ...a, productName: pname(a.product_id), defaultCountry: null }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
