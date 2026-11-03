import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNaira } from "@/lib/money";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/server";
import { isModemOrder, orderTitle } from "@/lib/order-label";
import type { Order } from "@/lib/types";
import { refundOrderAction } from "../actions";

export const metadata = { title: "Orders · Admin" };

const TABS = [
  ["all", "All"],
  ["fulfilled", "Delivered"],
  ["refunded", "Failed + refunded"],
  ["processing", "Stuck"],
] as const;
const KINDS = [
  ["all", "All products"],
  ["gb", "Per-GB"],
  ["port", "Daily ports"],
  ["modem", "Private modems"],
] as const;

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const { status = "all", kind = "all" } = await searchParams;
  const db = createAdminClient();
  let q = db.from("orders").select("*").order("created_at", { ascending: false }).limit(100);
  if (status === "fulfilled" || status === "processing" || status === "refunded") q = q.eq("status", status);
  if (kind === "gb") q = q.eq("kind", "gb");
  if (kind === "port") q = q.in("kind", ["port", "port_renewal"]);
  if (kind === "modem") q = q.in("kind", ["modem", "modem_renewal"]);
  const [{ data: orders }, { data: products }, { data: countries }] = await Promise.all([q, db.from("products").select("id,name"), db.from("countries").select("code,name")]);
  const list = (orders ?? []) as Order[];
  const ids = [...new Set(list.map((o) => o.user_id))];
  const { data: profiles } = ids.length ? await db.from("profiles").select("id,email").in("id", ids) : { data: [] };
  const email = (id: string) => profiles?.find((p) => p.id === id)?.email ?? id.slice(0, 8);

  return (
    <>
      <PageTitle
        title="Orders"
        subtitle="Orders are delivered instantly through each product's provider. Failed deliveries are refunded automatically."
      />
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-lg border border-line bg-card p-1 text-sm sm:w-fit">
        {KINDS.map(([k, l]) => (
          <Link
            key={k}
            href={`/admin/orders?status=${status}&kind=${k}`}
            className={`flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-center sm:flex-none ${kind === k ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
          >
            {l}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-line bg-card p-1 text-sm sm:w-fit">
        {TABS.map(([k, l]) => (
          <Link
            key={k}
            href={`/admin/orders?status=${k}&kind=${kind}`}
            className={`flex-1 whitespace-nowrap rounded-md px-4 py-1.5 text-center sm:flex-none ${status === k ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
          >
            {l}
          </Link>
        ))}
      </div>

      {list.length === 0 && <div className="card p-8 text-sm text-muted">Nothing here yet.</div>}

      <div className="space-y-4">
        {list.map((o) => {
          const product = products?.find((p) => p.id === o.product_id);
          const country = isModemOrder(o) ? (o.modem_country_name ?? (o.modem_country ?? "").toUpperCase()) : o.country_code ? (countries?.find((c) => c.code === o.country_code)?.name ?? o.country_code) : "Any country";
          const providerLabel = o.provider ? (getProvider(o.provider)?.label ?? o.provider) : null;
          return (
            <article key={o.id} className="card">
              <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {orderTitle(o, () => product?.name ?? o.product_id ?? "")}{isModemOrder(o) ? "" : ` · ${country}`}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {email(o.user_id)} · {formatNaira(o.total_kobo)}
                    {isModemOrder(o) && o.modem_cost_usd !== null && o.modem_cost_usd !== undefined ? ` · cost $${Number(o.modem_cost_usd).toFixed(2)} / price $${Number(o.modem_price_usd ?? 0).toFixed(2)}` : ""}
                    {providerLabel ? ` · ${providerLabel}` : ""} ·{" "}
                    {new Date(o.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted">{o.id}</p>
                </div>
                <StatusPill status={o.status} failed={Boolean(o.failure_reason)} adminView />
              </header>
              {o.failure_reason && <p className="border-t border-line bg-danger-bg px-5 py-2.5 text-sm break-words text-danger">{o.failure_reason}</p>}
              {o.status === "processing" && (
                <div className="border-t border-line p-5">
                  <p className="mb-3 text-sm text-muted">
                    Still processing. If this is more than a few minutes old the provider call never finished: check the provider dashboard, then refund.
                  </p>
                  <ActionForm action={refundOrderAction} className="flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="order_id" value={o.id} />
                    <input name="note" placeholder="Refund reason" className="input h-10 text-sm sm:max-w-xs" />
                    <SubmitButton className="btn-ghost btn-sm">Refund {formatNaira(o.total_kobo)} to wallet</SubmitButton>
                  </ActionForm>
                </div>
              )}
              {o.admin_note && o.status !== "processing" && <p className="border-t border-line px-5 py-3 text-sm text-muted">Note: {o.admin_note}</p>}
            </article>
          );
        })}
      </div>
    </>
  );
}
