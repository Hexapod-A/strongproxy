"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatNaira } from "@/lib/money";
import { IconArrow, IconCheck, IconHome, IconPhone } from "./Icons";

export type PriceProduct = { id: string; name: string; description: string; price_per_gb_kobo: number; min_gb: number; max_gb: number };

const FEATURES: Record<string, string[]> = {
  mobile: ["Real 4G/5G carrier IPs", "Best for social media, ads and apps", "Rotating or sticky sessions", "HTTP(S) and SOCKS5", "Pick your country", "Pay only for what you use"],
  residential: ["Home broadband IPs", "Best for scraping, research and price checks", "Rotating or sticky sessions", "HTTP(S) and SOCKS5", "Pick your country", "Pay only for what you use"],
};
const STEPS = [1, 2, 5, 10, 20, 50, 100];

export function Pricing({ products, countryCount }: { products: PriceProduct[]; countryCount: number }) {
  const maxGb = Math.max(...products.map((p) => p.max_gb), 1);
  const steps = useMemo(() => STEPS.filter((s) => s <= maxGb), [maxGb]);
  const [idx, setIdx] = useState(Math.min(2, steps.length - 1));
  const gb = steps[idx] ?? 1;
  const sorted = [...products].sort((a, b) => a.price_per_gb_kobo - b.price_per_gb_kobo);

  return (
    <div>
      {/* Estimator */}
      <div data-reveal className="mx-auto max-w-3xl rounded-2xl border border-line bg-card p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-ink-2">Estimate your cost</p>
          <p className="rounded-full bg-paper px-3 py-1 font-mono text-sm font-semibold">{gb} GB</p>
        </div>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          aria-label="Data amount in GB"
          className="mt-5 w-full cursor-pointer accent-[#145c3a]"
        />
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
          {steps.map((s, i) => (
            <button key={s} type="button" onClick={() => setIdx(i)} className={`rounded px-1 py-0.5 transition-colors hover:text-ink ${i === idx ? "text-ink" : ""}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {sorted.map((p) => {
            const below = gb < p.min_gb;
            return (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{p.name}</p>
                  <p className="text-xs text-muted">{formatNaira(p.price_per_gb_kobo)}/GB</p>
                </div>
                <p className="text-xl font-semibold tracking-tight tabular-nums">{below ? `Min ${p.min_gb} GB` : formatNaira(p.price_per_gb_kobo * gb)}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plans */}
      <div data-reveal-stagger className="mx-auto mt-6 grid max-w-5xl gap-4 md:grid-cols-2">
        {sorted.map((p) => {
          const dark = p.id === "mobile";
          const feats = FEATURES[p.id] ?? ["Rotating or sticky sessions", "HTTP(S) and SOCKS5", "Pick your country", "Pay only for what you use"];
          return (
            <div
              key={p.id}
              data-reveal
              className={`group relative flex flex-col rounded-2xl border p-7 transition-[transform,translate,scale,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 sm:p-8 ${
                dark ? "border-ink bg-ink text-white hover:shadow-[0_30px_60px_-30px_rgba(14,15,12,0.7)]" : "border-line bg-card hover:border-ink/30 hover:shadow-[0_24px_48px_-28px_rgba(14,15,12,0.35)]"
              }`}
            >
              {dark && <span className="absolute right-6 top-6 rounded-full bg-lime px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink">Most trusted</span>}
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${dark ? "bg-white/10 text-lime" : "bg-paper text-accent"}`}>
                {p.id === "mobile" ? <IconPhone /> : <IconHome />}
              </span>
              <h3 className="mt-5 text-xl font-semibold">{p.name}</h3>
              <p className={`mt-1 text-[15px] ${dark ? "text-white/60" : "text-muted"}`}>{p.description}</p>
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-[44px] font-semibold leading-none tracking-[-0.04em]">{formatNaira(p.price_per_gb_kobo)}</span>
                <span className={dark ? "text-white/60" : "text-muted"}>/GB</span>
              </p>
              <p className={`mt-2 text-sm ${dark ? "text-white/50" : "text-muted"}`}>
                Buy {p.min_gb} to {p.max_gb} GB at a time · {countryCount} countries
              </p>
              <ul className="mt-7 flex-1 space-y-3 text-[15px]">
                {feats.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${dark ? "bg-lime text-ink" : "bg-ok-bg text-accent"}`}>
                      <IconCheck className="h-3 w-3" />
                    </span>
                    <span className={dark ? "text-white/85" : "text-ink-2"}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className={`${dark ? "btn-lime" : "btn-primary"} group/btn mt-8 w-full`}>
                Buy {p.name.toLowerCase()}
                <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
              </Link>
            </div>
          );
        })}
      </div>
      <p data-reveal className="mt-6 text-center text-sm text-muted">
        Prices are per GB of data, in naira. No subscription. An order we can’t deliver is refunded to your wallet.
      </p>
    </div>
  );
}
