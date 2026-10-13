import { PageTitle } from "@/components/PageTitle";
import { StatusPill } from "@/components/StatusPill";
import { adminStore, requireUser } from "@/lib/auth";
import { nowpayments, paystack } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Payment, WalletTx } from "@/lib/types";
import { TopUpForm } from "./TopUpForm";

export const metadata = { title: "Wallet" };

const KIND: Record<string, string> = {
  topup: "Top-up",
  purchase: "Purchase",
  refund: "Refund",
  admin_credit: "Credit",
  admin_debit: "Adjustment",
};

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ ref?: string; reference?: string; trxref?: string }> }) {
  const s = await requireUser();
  const sp = await searchParams;
  const ref = sp.ref ?? sp.reference ?? sp.trxref;
  const sb = await createClient();
  const [{ data: txs }, { data: pays }, { data: justPaid }] = await Promise.all([
    sb.from("wallet_transactions").select("*").order("created_at", { ascending: false }).limit(50),
    sb.from("payments").select("*").order("created_at", { ascending: false }).limit(10),
    ref ? sb.from("payments").select("*").eq("reference", ref).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const minNaira = Number((await adminStore().getSetting<number>("min_topup_kobo")) ?? 100000) / 100;
  const paid = justPaid as Payment | null;

  return (
    <>
      <PageTitle title="Wallet" subtitle="Top up once, buy GB whenever you need it." />

      {paid && (
        <div className={`mb-6 rounded-xl border px-5 py-4 text-sm ${paid.status === "success" ? "border-accent/30 bg-ok-bg text-accent-ink" : "border-warn/30 bg-warn-bg text-warn"}`}>
          {paid.status === "success"
            ? `${formatNaira(paid.amount_kobo)} was added to your wallet.`
            : paid.status === "failed"
              ? "That payment failed. You were not charged."
              : "We're waiting for the payment provider to confirm your payment. This page updates when you refresh; crypto can take a few minutes."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
        <div className="card p-6">
          <p className="text-sm text-muted">Balance</p>
          <p className="mt-1 text-[36px] font-semibold leading-none tracking-[-0.03em]">{formatNaira(s.profile.balance_kobo)}</p>
          <div className="mt-6 border-t border-line pt-6">
            <TopUpForm minNaira={minNaira} paystackEnabled={Boolean(paystack().secretKey)} cryptoEnabled={Boolean(nowpayments().apiKey)} />
          </div>
        </div>

        <div className="space-y-6">
          <section className="card">
            <h2 className="border-b border-line px-5 py-4 font-semibold">Transactions</h2>
            {(txs ?? []).length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No transactions yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {((txs ?? []) as WalletTx[]).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{KIND[t.kind] ?? t.kind}</p>
                      <p className="truncate text-xs text-muted">{t.note ?? ""} · {new Date(t.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                    <span className={`shrink-0 font-mono ${t.amount_kobo > 0 ? "text-accent" : "text-ink"}`}>
                      {t.amount_kobo > 0 ? "+" : "−"}{formatNaira(Math.abs(t.amount_kobo))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(pays ?? []).length > 0 && (
            <section className="card">
              <h2 className="border-b border-line px-5 py-4 font-semibold">Recent payments</h2>
              <ul className="divide-y divide-line">
                {((pays ?? []) as Payment[]).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{p.provider === "paystack" ? "Paystack" : "USDT"} · {formatNaira(p.amount_kobo)}</p>
                      <p className="truncate font-mono text-xs text-muted">{p.reference}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.status === "pending" && p.checkout_url && (
                        <a href={p.checkout_url} className="text-xs underline underline-offset-2">Resume</a>
                      )}
                      <StatusPill status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
