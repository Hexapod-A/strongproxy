import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { SubmitButton } from "@/components/SubmitButton";
import { adminStore } from "@/lib/auth";
import { notifyConfig, nowpayments, paystack } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { getProvider, getProviders } from "@/lib/providers";
import { productStock } from "@/lib/stock";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country, Product } from "@/lib/types";
import { setProductProviderAction, updateSettingsAction } from "./actions";

export const metadata = { title: "Admin" };

function Status({ ok, yes = "Configured", no = "Not set" }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={`pill ${ok ? "bg-ok-bg text-accent-ink" : "bg-paper text-muted border border-line"}`}>{ok ? yes : no}</span>;
}

function dayAgoIso() {
  return new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

export default async function AdminHome() {
  const db = createAdminClient();
  const store = adminStore();
  const since = dayAgoIso();
  const [delivered, failed, users, topups, rate, minTopup, productsRes, countriesRes] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("status", "fulfilled").gte("created_at", since),
    db.from("orders").select("id", { count: "exact", head: true }).not("failure_reason", "is", null).gte("created_at", since),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("payments").select("amount_kobo").eq("status", "success").gte("credited_at", since),
    store.getSetting<number>("usd_ngn_rate"),
    store.getSetting<number>("min_topup_kobo"),
    db.from("products").select("*").order("sort_order"),
    db.from("countries").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const topupSum = (topups.data ?? []).reduce((n, p) => n + Number(p.amount_kobo), 0);
  const providers = getProviders();
  const n = notifyConfig();
  const products = ((productsRes.data ?? []) as Product[]).filter((p) => p.is_active);
  const countries = (countriesRes.data ?? []) as Country[];
  const stockByProduct = Object.fromEntries(
    await Promise.all(products.map(async (p) => [p.id, await productStock(getProvider(p.provider), p.provider_pool, countries.map((c) => c.code))] as const)),
  );

  const stats = [
    ["Delivered, last 24h", String(delivered.count ?? 0), "/admin/orders?status=fulfilled"],
    ["Failed + refunded, 24h", String(failed.count ?? 0), "/admin/orders?status=refunded"],
    ["Users", String(users.count ?? 0), "/admin/users"],
    ["Top-ups, last 24h", formatNaira(topupSum), null],
  ] as const;

  return (
    <>
      <PageTitle title="Admin" subtitle="Orders, money and provider status at a glance." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value, href]) => {
          const inner = (
            <>
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-[-0.02em]">{value}</p>
            </>
          );
          return href ? (
            <Link key={label} href={href} className="card p-4 hover:border-line-2">{inner}</Link>
          ) : (
            <div key={label} className="card p-4">{inner}</div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="card p-5 lg:col-span-2">
          <h2 className="font-semibold">Delivery provider per product</h2>
          <p className="mt-1 text-sm text-muted">
            Every paid order is delivered instantly through the product&rsquo;s provider. If the provider call fails, the order is
            marked failed, the customer&rsquo;s wallet is refunded automatically and you get an alert.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {products.map((p) => {
              const st = stockByProduct[p.id];
              const out = countries.filter((c) => st?.countries[c.code] === "out_of_stock").map((c) => c.name);
              const current = providers.find((x) => x.id === p.provider);
              return (
                <ActionForm key={p.id} action={setProductProviderAction} className="rounded-xl border border-line p-4">
                  <input type="hidden" name="product_id" value={p.id} />
                  <p className="font-medium">{p.name}</p>
                  <div className="mt-3 space-y-2">
                    {providers.map((x) => (
                      <label key={x.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2.5">
                          <input type="radio" name="provider" value={x.id} defaultChecked={p.provider === x.id} disabled={!x.supportsPool(p.provider_pool)} className="accent-[#0e0f0c]" />
                          {x.label}
                        </span>
                        <Status ok={x.isConfigured()} />
                      </label>
                    ))}
                  </div>
                  {current && !current.isConfigured() && (
                    <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">{current.label} has no keys in env, so {p.name} can&rsquo;t be bought right now.</p>
                  )}
                  <p className="mt-3 text-xs text-muted">
                    {st?.live
                      ? out.length
                        ? `Live stock: out of stock in ${out.join(", ")} (hidden from buyers).`
                        : "Live stock: every listed country is in stock."
                      : "This provider doesn't publish stock. Turn countries on/off in Catalog."}
                  </p>
                  <SubmitButton className="btn-ghost btn-sm mt-3">Save</SubmitButton>
                </ActionForm>
              );
            })}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Settings</h2>
          <ActionForm action={updateSettingsAction} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="usd_ngn_rate">₦ per $1 (crypto)</label>
                <input id="usd_ngn_rate" name="usd_ngn_rate" type="number" step="0.01" defaultValue={Number(rate ?? 1600)} className="input" />
              </div>
              <div>
                <label className="label" htmlFor="min_topup">Min top-up (₦)</label>
                <input id="min_topup" name="min_topup" type="number" defaultValue={Number(minTopup ?? 100000) / 100} className="input" />
              </div>
            </div>
            <SubmitButton className="btn-primary btn-sm">Save settings</SubmitButton>
          </ActionForm>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Integrations</h2>
          <p className="mt-1 text-sm text-muted">Keys are read from environment variables only. They are never stored in the database or shown here.</p>
          <ul className="mt-4 divide-y divide-line text-sm">
            {providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-3">
                <span>{p.label} <span className="text-muted">· provider</span></span>
                <Status ok={p.isConfigured()} />
              </li>
            ))}
            <li className="flex items-center justify-between py-3"><span>Paystack <span className="text-muted">· naira</span></span><Status ok={Boolean(paystack().secretKey)} /></li>
            <li className="flex items-center justify-between py-3"><span>NOWPayments <span className="text-muted">· USDT</span></span><Status ok={Boolean(nowpayments().apiKey && nowpayments().ipnSecret)} /></li>
            <li className="flex items-center justify-between py-3"><span>Telegram alerts</span><Status ok={Boolean(n.telegramToken && n.telegramChatId)} /></li>
            <li className="flex items-center justify-between py-3"><span>Email alerts</span><Status ok={Boolean(n.to && (n.resendKey || n.smtpHost))} /></li>
          </ul>
        </section>
      </div>
    </>
  );
}
