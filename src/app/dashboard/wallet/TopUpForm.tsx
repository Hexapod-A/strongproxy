"use client";

import { useActionState, useState } from "react";
import { topUpAction } from "../actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

const PRESETS = [5000, 10000, 20000, 50000];

export function TopUpForm({ minNaira, cryptoEnabled, paystackEnabled }: { minNaira: number; cryptoEnabled: boolean; paystackEnabled: boolean }) {
  const [state, action] = useActionState(topUpAction, undefined);
  const [amount, setAmount] = useState<number | "">(10000);
  const [method, setMethod] = useState<"paystack" | "crypto">(paystackEnabled || !cryptoEnabled ? "paystack" : "crypto");

  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="label" htmlFor="amount">Amount (₦)</label>
        <input
          id="amount"
          name="amount"
          type="number"
          inputMode="numeric"
          min={minNaira}
          step={100}
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
          className="input text-lg"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              className={`rounded-md border px-3 py-1.5 text-sm ${amount === p ? "border-ink bg-ink text-white" : "border-line-2 bg-card text-ink-2 hover:border-ink"}`}
            >
              ₦{p.toLocaleString("en-NG")}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Minimum ₦{minNaira.toLocaleString("en-NG")}.</p>
      </div>

      <fieldset>
        <legend className="label">Pay with</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["paystack", "Paystack", "Naira card, bank transfer, USSD", paystackEnabled],
            ["crypto", "USDT", "Crypto via NOWPayments", cryptoEnabled],
          ] as const).map(([v, t, d, enabled]) => (
            <label
              key={v}
              className={`card flex cursor-pointer items-start gap-3 p-4 ${method === v && enabled ? "border-ink ring-1 ring-ink" : ""} ${enabled ? "" : "opacity-50"}`}
            >
              <input type="radio" name="method" value={v} checked={method === v} disabled={!enabled} onChange={() => setMethod(v)} className="mt-1 accent-[#0e0f0c]" />
              <span>
                <span className="block font-medium">{t}</span>
                <span className="block text-sm text-muted">{enabled ? d : "Not available yet"}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pendingText="Opening checkout…">Continue to payment</SubmitButton>
    </form>
  );
}
