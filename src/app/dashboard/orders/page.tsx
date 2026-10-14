import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { StatusPill } from "@/components/StatusPill";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { orderGb, orderTitle } from "@/lib/order-label";
import type { Order } from "@/lib/types";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ placed?: string }> }) {
  await requireUser();
  const { placed } = await searchParams;
  const sb = await createClient();
  const [{ data: orders }, { data: products }, { data: countries }] = await Promise.all([
    sb.from("orders").select("*").order("created_at", { ascending: false }).limit(100),
    sb.from("products").select("id,name"),
    sb.from("countries").select("code,name"),
  ]);
  const list = (orders ?? []) as Order[];
  const pname = (id: string) => products?.find((p) => p.id === id)?.name ?? id;
  const cname = (c: string | null) => (c ? countries?.find((x) => x.code === c)?.name ?? c.toUpperCase() : "Any");
  const placedOrder = list.find((o) => o.id === placed);

  return (
    <>
      <PageTitle title="Orders" subtitle="Everything you've bought." action={<Link href="/dashboard/buy" className="btn-primary btn-sm">Buy GB</Link>} />
      {placedOrder && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-ok-bg px-5 py-4 text-sm text-accent-ink">
          {placedOrder.status === "fulfilled" ? (
            <>Order placed and delivered. <Link href="/dashboard" className="font-medium underline underline-offset-2">See your credentials</Link>.</>
          ) : (
            <>Order placed. Your credentials will appear on your <Link href="/dashboard" className="font-medium underline underline-offset-2">dashboard</Link> in a moment.</>
          )}
        </div>
      )}
      {list.length === 0 ? (
        <div className="card p-8 text-sm text-muted">No orders yet.</div>
      ) : (
        <>
          <ul className="card divide-y divide-line sm:hidden">
            {list.map((o) => (
              <li key={o.id} className="px-4 py-3.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{orderTitle(o, pname)}</span>
                  <StatusPill status={o.status} failed={Boolean(o.failure_reason)} />
                </div>
                <div className="mt-1 flex justify-between text-muted">
                  <span>{cname(o.country_code)} · {new Date(o.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</span>
                  <span className="font-mono text-ink">{formatNaira(o.total_kobo)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-x-auto sm:block">
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Product</th><th>Country</th><th>GB</th><th>Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap text-muted">{new Date(o.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="font-medium">{o.kind === "gb" || !o.kind ? pname(o.product_id ?? "") : orderTitle(o, pname)}</td>
                    <td>{cname(o.country_code)}</td>
                    <td>{orderGb(o)}</td>
                    <td className="font-mono">{formatNaira(o.total_kobo)}</td>
                    <td><StatusPill status={o.status} failed={Boolean(o.failure_reason)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
