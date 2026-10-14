"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { buyPortAction } from "../../port-actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNaira } from "@/lib/money";
import type { PortPlan } from "@/lib/types";

export function PortBuyForm({
  plans,
  countries,
  balanceKobo,
  unavailable,
}: {
  plans: PortPlan[];
  countries: { code: string; name: string }[];
  balanceKobo: number;
  unavailable: boolean;
}) {
  const [state, action] = useActionState(buyPortAction, undefined);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [country, setCountry] = useState(countries[0]?.code ?? "");
  const [protocol, setProtocol] = useState<"http" | "socks5">("http");
  const plan = plans.find((p) => p.id === planId);
  const total = plan?.price_kobo ?? 0;
  const short = total > balanceKobo;
  const none = countries.length === 0 || plans.length === 0;

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <div className="space-y-6">
        <fieldset>
          <legend className="label">Duration</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <label key={p.id} className={`card cursor-pointer p-4 transition-colors ${planId === p.id ? "border-ink ring-1 ring-ink" : "hover:border-line-2"}`}>
                <input type="radio" name="plan_id" value={p.id} checked={planId === p.id} onChange={() => setPlanId(p.id)} className="sr-only" />
                <span className="block font-semibold">{p.name}</span>
                <span className="mt-1 block text-sm font-medium">{formatNaira(p.price_kobo)}</span>
                <span className="mt-1 block text-xs text-muted">{p.traffic_gb > 0 ? `${p.traffic_gb} GB data included` : "No data cap"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="country">Country</label>
            <select id="country" name="country" className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted">Only countries with free ports right now are listed.</p>
          </div>
          <fieldset>
            <legend className="label">Protocol</legend>
            <div className="flex gap-2">
              {(["http", "socks5"] as const).map((p) => (
                <label key={p} className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-center text-sm font-medium ${protocol === p ? "border-ink bg-ink text-white" : "border-line-2"}`}>
                  <input type="radio" name="protocol" value={p} checked={protocol === p} onChange={() => setProtocol(p)} className="sr-only" />
                  {p === "http" ? "HTTP" : "SOCKS5"}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <aside className="card h-fit p-5">
        <h2 className="font-semibold">Summary</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Daily port · {plan?.name ?? "—"}</dt><dd>{formatNaira(total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Wallet balance</dt><dd>{formatNaira(balanceKobo)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2.5 font-medium"><dt>After purchase</dt><dd className={short ? "text-danger" : ""}>{short ? "Not enough" : formatNaira(balanceKobo - total)}</dd></div>
        </dl>
        <div className="mt-5 space-y-3">
          <FormMessage state={state} />
          {unavailable ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">Daily ports are temporarily unavailable. Check back soon.</p>
          ) : none ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">No ports free right now. Check back soon.</p>
          ) : short ? (
            <Link href="/dashboard/wallet" className="btn-primary w-full">Top up {formatNaira(total - balanceKobo)}</Link>
          ) : (
            <SubmitButton pendingText="Creating your port…">Pay {formatNaira(total)} from wallet</SubmitButton>
          )}
        </div>
      </aside>
    </form>
  );
}
