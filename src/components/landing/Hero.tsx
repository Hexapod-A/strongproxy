import Link from "next/link";
import { formatNaira } from "@/lib/money";
import type { Country, Product } from "@/lib/types";
import { IconArrow, IconCheck } from "./Icons";

const EXAMPLE_GB = 5;

export function Hero({ products, countries, flags }: { products: Product[]; countries: Country[]; flags: Record<string, string> }) {
  const cheapest = products.reduce<Product | null>((m, p) => (!m || p.price_per_gb_kobo < m.price_per_gb_kobo ? p : m), null);
  const pick = products.find((p) => p.id === "mobile") ?? products[0];
  const shown = countries.slice(0, 6);
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <div className="container-x relative pb-16 pt-14 text-center sm:pb-24 sm:pt-20">
        <div data-reveal>
          <Link
            href="/#pricing"
            className="group inline-flex items-center gap-2 rounded-full border border-line-2 bg-card py-1.5 pl-1.5 pr-3.5 text-[13px] text-ink-2 transition-[border-color,transform,translate,scale] duration-200 hover:-translate-y-0.5 hover:border-ink"
          >
            <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink">New</span>
            One price per GB, mobile or residential
            <IconArrow className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
        <h1 data-reveal className="mx-auto mt-7 max-w-5xl text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[64px] lg:text-[76px]">
          {cheapest && <span className="block text-accent">From {formatNaira(cheapest.price_per_gb_kobo)}/GB</span>}
          <span className="block">Residential &amp; mobile proxies</span>
        </h1>
        <p data-reveal className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-lg">
          Real home and mobile IPs in {countries.length} countries. Top up in naira, buy only the GB you need, and get your
          login details in seconds.
        </p>
        <div data-reveal className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="btn-primary btn-lg group w-full sm:w-auto">
            Get started now
            <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
          <Link href="/#pricing" className="btn-ghost btn-lg w-full sm:w-auto">
            View pricing
          </Link>
        </div>
        <ul data-reveal className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
          {["No subscription", "Paystack or USDT", "HTTP(S) and SOCKS5"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5"><IconCheck className="h-4 w-4 text-accent" />{t}</li>
          ))}
        </ul>

        {/* Product preview: a calm drawing of the buy screen, built from the live catalog. */}
        <div data-reveal className="relative mx-auto mt-14 max-w-5xl sm:mt-20">
          <div aria-hidden className="absolute -inset-x-10 -bottom-10 top-10 rounded-[40px] bg-lime/25 blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-ink/90 bg-ink text-left shadow-[0_40px_80px_-40px_rgba(14,15,12,0.6)]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              <span className="mx-auto rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-white/50">strongproxy / dashboard / buy</span>
            </div>
            <div className="grid md:grid-cols-[200px_1fr]">
              <aside className="hidden border-r border-white/10 p-4 md:block">
                <p className="px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">Menu</p>
                <ul className="mt-2 space-y-0.5 text-[13px]">
                  {["Overview", "Buy GB", "Wallet", "Orders"].map((l) => (
                    <li key={l} className={`rounded-md px-2 py-1.5 ${l === "Buy GB" ? "bg-white/10 text-white" : "text-white/55"}`}>{l}</li>
                  ))}
                </ul>
              </aside>
              <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[1.2fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">1 · Pick a type</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {products.map((p) => (
                      <div key={p.id} className={`rounded-lg border p-3 ${p.id === pick?.id ? "border-lime bg-lime/10" : "border-white/10"}`}>
                        <p className="text-sm font-medium text-white">{p.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-white/60">{formatNaira(p.price_per_gb_kobo)}/GB</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">2 · Pick a country</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {shown.map((c, i) => (
                      <span key={c.code} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${i === 0 ? "border-lime/70 text-white" : "border-white/10 text-white/60"}`}>
                        <span aria-hidden>{flags[c.code]}</span>{c.name}
                      </span>
                    ))}
                    {countries.length > shown.length && <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/40">+{countries.length - shown.length} more</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">3 · Pay from wallet</p>
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <p className="text-xs text-white/50">Example: {EXAMPLE_GB} GB {pick?.name.toLowerCase()}</p>
                        <p className="mt-1 text-2xl font-semibold tracking-tight text-white">{pick && formatNaira(pick.price_per_gb_kobo * EXAMPLE_GB)}</p>
                      </div>
                      <span className="rounded-lg bg-lime px-3 py-2 text-xs font-semibold text-ink">Buy now</span>
                    </div>
                  </div>
                  <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Your proxy</p>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-lime"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-lime" />Ready</span>
                    </div>
                    <p className="mt-3 break-all rounded-lg bg-black/40 px-3 py-2.5 font-mono text-[12px] text-white/80">host:port:username:password</p>
                    <div className="mt-3 flex gap-2 text-[11px]">
                      {["HTTP(S)", "SOCKS5", "Rotating", "Sticky"].map((t) => (
                        <span key={t} className="rounded border border-white/10 px-1.5 py-0.5 text-white/55">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FactStrip({ products, countries }: { products: Product[]; countries: Country[] }) {
  const cheapest = products.reduce<Product | null>((m, p) => (!m || p.price_per_gb_kobo < m.price_per_gb_kobo ? p : m), null);
  const facts = [
    { k: cheapest ? formatNaira(cheapest.price_per_gb_kobo) : "Per GB", v: "Lowest price per GB" },
    { k: String(countries.length), v: "Countries to pick from" },
    { k: String(products.length), v: "Proxy types to choose from" },
    { k: "₦ / USDT", v: "Pay with Paystack or crypto" },
  ];
  return (
    <section className="border-y border-line bg-card">
      <div data-reveal-stagger className="container-x grid grid-cols-2 lg:grid-cols-4">
        {facts.map((f, i) => (
          <div
            key={f.v}
            data-reveal
            className={`px-2 py-7 text-center sm:py-9 ${i % 2 === 1 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
          >
            <p className="text-[28px] font-semibold tracking-[-0.03em] sm:text-4xl">{f.k}</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{f.v}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
