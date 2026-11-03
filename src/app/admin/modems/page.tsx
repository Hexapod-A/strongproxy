import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { SubmitButton } from "@/components/SubmitButton";
import { adminStore, requireAdmin } from "@/lib/auth";
import { flag } from "@/lib/catalog";
import { formatNaira } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { getModemsApi, getPortsApi } from "@/lib/providers";
import { guardSettings, salesStatus } from "@/lib/services/balance-guard";
import { modemOffers, modemPriceKobo, modemPricing, reconcileModemOrders, type LineState } from "@/lib/services/modems";
import { createAdminClient } from "@/lib/supabase/server";
import type { PrivateModem } from "@/lib/types";
import { updateModemLinesAction, updateModemSettingsAction } from "../modem-actions";

export const metadata = { title: "Private modems · Admin" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE: Record<LineState, { label: string; cls: string }> = {
  selling: { label: "Selling", cls: "bg-ok-bg text-accent-ink" },
  out_of_stock: { label: "Out of stock", cls: "bg-paper text-muted" },
  blocked: { label: "Blocked: no profit", cls: "bg-danger-bg text-danger" },
  hidden: { label: "Hidden by you", cls: "bg-paper text-muted" },
};
const PERIOD = { day: "Day", week: "Week", month: "Month" } as const;
const minutesAgo = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export default async function AdminModems() {
  await requireAdmin();
  const db = createAdminClient();
  const store = adminStore();
  const api = getModemsApi();
  const reader = getPortsApi();
  await reconcileModemOrders({ store, notify: notifyAdmin, api, balance: reader }, null);
  const [pricing, gs, sales, open, { data: rentals }] = await Promise.all([
    modemPricing(store),
    guardSettings(store),
    salesStatus({ store, notify: notifyAdmin, reader }),
    store.listOpenModemOrders(null),
    db.from("private_modems").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  const feed = await modemOffers(api, pricing);
  const selling = feed.lines.filter((l) => l.state === "selling").length;
  const rows = (rentals ?? []) as PrivateModem[];
  const ids = [...new Set([...rows.map((r) => r.user_id), ...open.map((o) => o.user_id)])];
  const { data: profiles } = ids.length ? await db.from("profiles").select("id,email").in("id", ids) : { data: [] };
  const email = (id: string) => profiles?.find((p) => p.id === id)?.email ?? id.slice(0, 8);

  return (
    <>
      <PageTitle
        title="Private modems"
        subtitle="Whole 4G/5G modems from Proxies.sx, rented by the day, week or month. Your prices, live stock, and a guard that never sells below cost."
      />

      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Prices &amp; sales</h2>
          <span className={`pill ${!api.isConfigured() ? "bg-warn-bg text-warn" : sales.paused || !pricing.enabled ? "bg-danger-bg text-danger" : "bg-ok-bg text-accent-ink"}`}>
            {!api.isConfigured() ? "API key not set" : !pricing.enabled ? "Switched off" : sales.paused ? "Sales PAUSED" : "Sales open"}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Customers pay your USD price × ₦{pricing.rate.toLocaleString("en-NG")} per $1 (the rate on the Admin overview), rounded up to the next ₦100.
          A line is only sold while Proxies.sx charges you less than your price{pricing.minMarginUsd > 0 ? ` by more than ${usd(pricing.minMarginUsd)}` : ""}.
          {" "}Proxies.sx balance: {sales.balanceUsd === null ? (sales.error ? `couldn't read it (${sales.error})` : "not read") : `$${sales.balanceUsd.toFixed(2)}`}.
        </p>
        <ActionForm action={updateModemSettingsAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          {(["day", "week", "month"] as const).map((p) => (
            <div key={p}>
              <label className="label" htmlFor={`price_${p}`}>Price per {p} (USD)</label>
              <input id={`price_${p}`} name={`price_${p}`} type="number" step="0.01" min="0.01" defaultValue={pricing.prices[p]} className="input" />
              <p className="mt-1 text-xs text-muted">Customer pays {formatNaira(modemPriceKobo(pricing.prices[p], pricing.rate))}</p>
            </div>
          ))}
          <div>
            <label className="label" htmlFor="min_margin">Minimum profit per rental (USD)</label>
            <input id="min_margin" name="min_margin" type="number" step="0.01" min="0" defaultValue={pricing.minMarginUsd} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="psx_autopause_threshold_usd">Pause sales below balance (USD)</label>
            <input id="psx_autopause_threshold_usd" name="psx_autopause_threshold_usd" type="number" step="0.01" min="0" defaultValue={gs.thresholdUsd} className="input" />
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="modems_enabled" defaultChecked={pricing.enabled} /> Sell private modems</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="psx_autopause_enabled" defaultChecked={gs.enabled} /> Auto-pause on low balance</label>
          </div>
          <div className="sm:col-span-3"><SubmitButton className="btn-primary btn-sm">Save prices</SubmitButton></div>
        </ActionForm>
      </section>

      <section className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 className="font-semibold">Lines from Proxies.sx</h2>
          {feed.live && <span className="text-sm text-muted">{selling} of {feed.lines.length} selling</span>}
        </div>
        <p className="mt-1 px-5 text-sm text-muted">
          {feed.live
            ? `Live ${feed.buyable ? "catalog" : "public price list"} (refreshed every minute). Cost is what Proxies.sx takes from your balance. Set your own price on any line, or leave it blank to use the default above.`
            : `Proxies.sx's list couldn't be read${feed.error ? ` (${feed.error})` : ""}. Customers see "couldn't load" until it's back.`}
        </p>
        {feed.lines.length > 0 && (
          <ActionForm action={updateModemLinesAction} className="mt-4">
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr><th>Line</th><th>Period</th><th>Stock</th><th>Cost</th><th>Your price</th><th>Profit</th><th>Status</th><th>Hide</th></tr>
                </thead>
                <tbody>
                  {feed.lines.map((l) => (
                    <tr key={l.key}>
                      <td className="whitespace-nowrap font-medium">
                        <span aria-hidden className="mr-1.5">{flag(l.countryCode)}</span>
                        {l.countryName} · {l.carrierName}
                      </td>
                      <td>{PERIOD[l.period]}</td>
                      <td className="tabular-nums">{l.stock}</td>
                      <td className="font-mono">{usd(l.priceUsd)}</td>
                      <td>
                        <input
                          name={`price_${l.key}`}
                          type="number"
                          step="0.01"
                          min="0.01"
                          defaultValue={l.overridden ? l.sellUsd : ""}
                          placeholder={String(pricing.prices[l.period])}
                          aria-label={`Your price for ${l.countryName} ${l.carrierName} per ${l.period}`}
                          className="input h-9 w-24 text-sm"
                        />
                      </td>
                      <td className={`font-mono ${l.marginUsd > pricing.minMarginUsd ? "text-accent" : "text-danger"}`}>{l.marginUsd >= 0 ? "+" : "−"}{usd(Math.abs(l.marginUsd))}</td>
                      <td><span className={`pill whitespace-nowrap ${STATE[l.state].cls}`}>{STATE[l.state].label}</span></td>
                      <td><input type="checkbox" name={`hide_${l.key}`} defaultChecked={l.state === "hidden"} aria-label="Hide this line" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-5 py-4"><SubmitButton className="btn-ghost btn-sm">Save line prices</SubmitButton></div>
          </ActionForm>
        )}
      </section>

      {open.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="font-semibold">Being set up</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {open.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 py-2.5">
                <span>{email(o.user_id)} · {o.modem_country_name} {o.modem_carrier} · {o.modem_period}{o.kind === "modem_renewal" ? " (renewal)" : ""}</span>
                <span className="text-muted">{formatNaira(o.total_kobo)} · {minutesAgo(o.created_at)} min · {o.upstream_order_id ?? "not sent yet"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Checked again each time this page or the customer&apos;s page loads. Failed setups are refunded automatically.</p>
        </section>
      )}

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 font-semibold">Recent rentals</h2>
        {rows.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-sm text-muted">No rentals yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="data-table min-w-[640px]">
              <thead>
                <tr><th>Customer</th><th>Line</th><th>Ends</th><th>Status</th><th>Proxies.sx id</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>{email(m.user_id)}</td>
                    <td className="whitespace-nowrap">{m.country_name} · {m.carrier_name}</td>
                    <td className="whitespace-nowrap text-muted">{new Date(m.expires_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{m.status}</td>
                    <td className="font-mono text-xs">{m.external_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-muted">
        Needs PROXIES_SX_API_KEY with the <code className="font-mono">modems:purchase</code> scope (client.proxies.sx → Account → API keys). Rentals are paid from your Proxies.sx balance at the cost shown.
        Leave auto-renew off in the Proxies.sx dashboard: customers renew from their wallet here.
      </p>
    </>
  );
}
