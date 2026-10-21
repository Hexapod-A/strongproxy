import Link from "next/link";
import { IconArrow, IconCheck } from "./Icons";

export function HowItWorks() {
  return (
    <section id="how" className="section-y border-t border-line bg-card">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center">
          <p data-reveal className="eyebrow">Getting started</p>
          <h2 data-reveal className="h-section mt-4">How it works</h2>
          <p data-reveal className="mt-4 text-[17px] text-ink-2">Three steps from sign-up to your first connection.</p>
        </div>

        <ol data-reveal-stagger className="mt-14 grid gap-4 lg:grid-cols-3">
          <li data-reveal className="lift group flex flex-col rounded-2xl border border-line bg-paper p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-muted">01</span>
              <span className="rounded-full bg-card px-2.5 py-1 text-xs text-muted">Takes a minute</span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em]">Create an account</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Sign up with your email and a password. That&rsquo;s it.</p>
            <div className="mt-6 flex-1 rounded-xl border border-line bg-card p-4">
              <div className="space-y-2">
                <div className="h-9 rounded-lg border border-line-2 bg-paper px-3 font-mono text-[12px] leading-9 text-muted">you@email.com</div>
                <div className="h-9 rounded-lg border border-line-2 bg-paper px-3 font-mono text-[12px] leading-9 text-muted">••••••••••</div>
                <div className="h-9 rounded-lg bg-ink text-center text-[13px] font-medium leading-9 text-white transition-colors group-hover:bg-accent">Create account</div>
              </div>
            </div>
          </li>

          <li data-reveal className="lift group flex flex-col rounded-2xl border border-line bg-paper p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-muted">02</span>
              <span className="rounded-full bg-card px-2.5 py-1 text-xs text-muted">Naira or USDT</span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em]">Top up your wallet</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Pay with Paystack by card, bank transfer or USSD, or send USDT.</p>
            <div className="mt-6 flex-1 rounded-xl border border-line bg-card p-4">
              <ul className="space-y-2 text-sm">
                {["Paystack: card, transfer, USSD", "Crypto: USDT"].map((m, i) => (
                  <li key={m} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${i === 0 ? "border-ink" : "border-line-2 group-hover:border-ink/40"}`}>
                    {m}
                    <span className={`grid h-4 w-4 place-items-center rounded-full border ${i === 0 ? "border-ink bg-ink" : "border-line-2"}`}>{i === 0 && <span className="h-1.5 w-1.5 rounded-full bg-lime" />}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>

          <li data-reveal className="lift group flex flex-col rounded-2xl border border-line bg-paper p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-muted">03</span>
              <span className="rounded-full bg-card px-2.5 py-1 text-xs text-muted">Instant</span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-[-0.02em]">Buy GB and connect</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">Pick a type and a country. Your login details show up right away.</p>
            <div className="mt-6 flex-1 rounded-xl border border-ink bg-ink p-4 font-mono text-[12px] leading-6 text-white/80">
              <p className="text-white/40">$ curl -x HOST:PORT api.ipify.org</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-lime"><IconCheck className="h-3.5 w-3.5" />connected</p>
            </div>
          </li>
        </ol>

        <div data-reveal className="mt-10 text-center">
          <Link href="/signup" className="btn-primary group">
            Create your account
            <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </section>
  );
}
