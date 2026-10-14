import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { SubmitButton } from "@/components/SubmitButton";
import { adminStore, requireAdmin } from "@/lib/auth";
import { proxiesSx, siteUrl } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { getPortsApi } from "@/lib/providers";
import { guardSettings, portOrderCostUsd, salesStatus } from "@/lib/services/balance-guard";
import { portStock } from "@/lib/services/ports";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country, PortPlan } from "@/lib/types";
import { checkLiveCostAction, updatePortCountryAction, updatePortPlanAction, updatePortSettingsAction } from "../port-actions";

export const metadata = { title: "Daily ports · Admin" };
export const dynamic = "force-dynamic";

const val = (rows: { key: string; value: unknown }[] | null, k: string, d: unknown) => rows?.find((r) => r.key === k)?.value ?? d;

export default async function AdminPorts() {
  await requireAdmin();
  const db = createAdminClient();
  const store = adminStore();
  const api = getPortsApi();
  const [{ data: plans }, { data: countries }, { data: settings }, gs] = await Promise.all([
    db.from("port_plans").select("*").order("sort_order"),
    db.from("countries").select("*").order("sort_order"),
    db.from("settings").select("key,value"),
    guardSettings(store),
  ]);
  const ctry = (countries ?? []) as Country[];
  const [stock, sales] = await Promise.all([portStock(api, ctry), salesStatus({ store, notify: notifyAdmin, reader: api })]);
  const rate = Number(val(settings, "port_usd_ngn_rate", 1330));
  const portsOn = !(val(settings, "ports_enabled", true) === false || val(settings, "ports_enabled", true) === "false");
  const webhookSet = Boolean(proxiesSx().webhookSecret);

  return (
    <>
      <PageTitle title="Daily ports" subtitle="Dedicated Proxies.sx mobile ports rented per day. Prices, data allowance, countries and the low-balance auto-pause." />

      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Proxies.sx balance &amp; auto-pause</h2>
          <span className={`pill ${sales.paused ? "bg-danger-bg text-danger" : "bg-ok-bg text-accent-ink"}`}>
            {!api.isConfigured() ? "API key not set" : sales.paused ? "Sales PAUSED" : "Sales open"}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Balance: {sales.balanceUsd === null ? (sales.error ? `couldn't read it (${sales.error})` : "not read") : `$${sales.balanceUsd.toFixed(2)}`} · threshold ${gs.thresholdUsd.toFixed(2)} ·
          auto-pause {gs.enabled ? "ON" : "OFF"}. Read from GET /account/summary, cached 60 s. When paused, Proxies.sx products and daily ports show
          &quot;temporarily unavailable&quot; and nobody is charged; you get a Telegram/email alert, and sales resume by themselves once you top up.
        </p>
        <ActionForm action={updatePortSettingsAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ports_enabled" defaultChecked={portsOn} /> Sell daily ports</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="psx_autopause_enabled" defaultChecked={gs.enabled} /> Auto-pause on low balance</label>
          <div />
          <div><label className="label">Pause below (USD)</label><input name="psx_autopause_threshold_usd" type="number" step="0.01" min="0" defaultValue={gs.thresholdUsd} className="input" /></div>
          <div><label className="label">Proxies.sx cost per GB (USD)</label><input name="psx_cost_usd_per_gb" type="number" step="0.01" min="0" defaultValue={gs.costPerGbUsd} className="input" /></div>
          <div><label className="label">Port cost per day (USD, 0 = free)</label><input name="psx_port_cost_usd_per_day" type="number" step="0.01" min="0" defaultValue={gs.portCostPerDayUsd} className="input" /></div>
          <div><label className="label">₦ per $ (for suggested prices)</label><input name="port_usd_ngn_rate" type="number" step="1" min="1" defaultValue={rate} className="input" /></div>
          <div className="flex items-end sm:col-span-2"><SubmitButton className="btn-primary btn-sm">Save settings</SubmitButton></div>
        </ActionForm>
      </section>

      <section className="card mb-6 p-5">
        <h2 className="font-semibold">Plans</h2>
        <p className="mt-1 text-sm text-muted">
          Proxies.sx charges traffic ($ per GB) from your balance; their pricing page says ports themselves are free. Each plan&apos;s data allowance is set as the
          customer&apos;s Proxies.sx traffic quota. 0 GB = no cap (risky: you pay for every GB). Suggested price = 2 × your cost × ₦{rate.toLocaleString("en-NG")}.
        </p>
        <div className="mt-4 space-y-3">
          {((plans ?? []) as PortPlan[]).map((p) => {
            const cost = portOrderCostUsd(gs, p);
            return (
              <ActionForm key={p.id} action={updatePortPlanAction} className="grid items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                <input type="hidden" name="id" value={p.id} />
                <div><label className="label">Name ({p.days} days)</label><input name="name" defaultValue={p.name} className="input" /></div>
                <div><label className="label">Price (₦)</label><input name="price" type="number" step="1" min="1" defaultValue={p.price_kobo / 100} className="input" /></div>
                <div><label className="label">Data included (GB)</label><input name="traffic_gb" type="number" step="1" min="0" defaultValue={p.traffic_gb} className="input" /></div>
                <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={p.is_active} /> On sale</label>
                <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                <p className="text-xs text-muted sm:col-span-5">
                  Your cost ≈ ${cost.toFixed(2)} · suggested {cost > 0 ? formatNaira(Math.round(cost * 2 * rate) * 100) : "— (set a data allowance or a per-day cost)"} · now {formatNaira(p.price_kobo)}
                </p>
              </ActionForm>
            );
          })}
        </div>
        <ActionForm action={checkLiveCostAction} className="mt-4">
          <SubmitButton className="btn-ghost btn-sm" pendingText="Asking Proxies.sx…">Check live cost from Proxies.sx</SubmitButton>
        </ActionForm>
      </section>

      <section className="card mb-6 p-5">
        <h2 className="font-semibold">Countries for daily ports</h2>
        <p className="mt-1 text-sm text-muted">
          {stock.live
            ? "Live list from Proxies.sx (cached 60 s). Countries without free devices are hidden from customers."
            : `Proxies.sx's country list couldn't be read${stock.error ? ` (${stock.error})` : ""}. Customers only see countries that have a Proxies.sx country id set here.`}
        </p>
        <div className="mt-4 space-y-2">
          {ctry.map((c) => {
            const st = stock.countries[c.code];
            return (
              <ActionForm key={c.code} action={updatePortCountryAction} className="grid items-center gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1.2fr_1fr_1.4fr_auto_auto]">
                <input type="hidden" name="code" value={c.code} />
                <span className="text-sm font-medium">{c.name}{c.is_active ? "" : " (inactive)"}</span>
                <span className="text-xs text-muted">
                  {st?.state === "in_stock" ? `In stock${st.available !== null ? ` · ${st.available} free` : ""}` : st?.state === "out_of_stock" ? "Out of stock" : "Stock unknown"}
                </span>
                <input name="psx_country_id" defaultValue={c.psx_country_id ?? ""} placeholder={st?.psxId ? `auto: ${st.psxId}` : "Proxies.sx country id"} className="input h-9 text-xs" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ports_enabled" defaultChecked={c.ports_enabled !== false} /> Sell</label>
                <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
              </ActionForm>
            );
          })}
        </div>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="font-semibold">Webhook</h2>
        <p className="mt-1 text-muted">
          Secret: {webhookSet ? "Configured" : "Not set"} (PROXIES_SX_WEBHOOK_SECRET). Register{" "}
          <code className="font-mono">{siteUrl()}/api/webhooks/proxiessx</code> with POST /reseller/webhooks for port.deleted, port.suspended,
          port.unsuspended and port.rotated, using the same secret. Proxies.sx has no &quot;expired&quot; event, so expiry is also re-read from their API whenever a customer opens Daily ports.
        </p>
      </section>
    </>
  );
}
