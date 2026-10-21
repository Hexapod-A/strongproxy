import Link from "next/link";
import type { Country } from "@/lib/types";
import { IconArrow, IconChart, IconCode, IconEye, IconGlobe, IconMail, IconSearch, IconShield, IconTag, IconUsers } from "./Icons";

const USES = [
  { icon: <IconUsers />, t: "Social media", d: "Run your pages from trusted mobile IPs." },
  { icon: <IconCode />, t: "Web scraping", d: "Collect public data with a fresh IP on every request." },
  { icon: <IconTag />, t: "Price tracking", d: "See the prices shoppers see in each country." },
  { icon: <IconEye />, t: "Ad checks", d: "Check that your ads show up the right way, in the right place." },
  { icon: <IconSearch />, t: "Search rankings", d: "Check search results as a local user would see them." },
  { icon: <IconShield />, t: "Privacy", d: "Keep your own IP private while you research." },
  { icon: <IconGlobe />, t: "Local content", d: "Open sites the way people in another country see them." },
  { icon: <IconChart />, t: "Market research", d: "Study markets and competitors from inside each region." },
];

export function UseCases() {
  return (
    <section id="use-cases" className="section-y">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center">
          <p data-reveal className="eyebrow">Use cases</p>
          <h2 data-reveal className="h-section mt-4">Built for real work</h2>
          <p data-reveal className="mt-4 text-[17px] text-ink-2">A few of the things people use StrongProxy for.</p>
        </div>
        <div data-reveal-stagger className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map((u) => (
            <div key={u.t} data-reveal className="lift group rounded-2xl border border-line bg-card p-5 hover:border-ink/25">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-paper text-accent transition-colors duration-300 group-hover:bg-ink group-hover:text-lime">{u.icon}</span>
              <h3 className="mt-4 font-semibold">{u.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{u.d}</p>
            </div>
          ))}
        </div>
        <p data-reveal className="mt-8 text-center text-sm text-muted">
          Fraud, carding, spam and mass account creation are not allowed. See the{" "}
          <Link href="/acceptable-use" className="link-u text-ink-2">Acceptable Use Policy</Link>.
        </p>
      </div>
    </section>
  );
}

export function Locations({ countries, flags }: { countries: Country[]; flags: Record<string, string> }) {
  return (
    <section id="locations" className="section-y border-t border-line bg-card">
      <div className="container-x">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p data-reveal className="eyebrow">Locations</p>
            <h2 data-reveal className="h-section mt-4">Pick your country</h2>
            <p data-reveal className="mt-4 text-[17px] text-ink-2">
              Residential and mobile IPs in these countries. Stock is live: a country that&rsquo;s sold out shows as greyed out at checkout.
            </p>
          </div>
          <div data-reveal>
            <Link href="/signup" className="btn-ghost group">
              Start now
              <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
        <div data-reveal-stagger className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {countries.map((c) => (
            <Link
              key={c.code}
              href="/signup"
              data-reveal
              className="group flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-4 transition-[transform,translate,scale,border-color,background-color] duration-300 hover:-translate-y-0.5 hover:border-ink hover:bg-card"
            >
              <span className="flex items-center gap-3">
                <span aria-hidden className="text-2xl leading-none">{flags[c.code]}</span>
                <span>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{c.code}</span>
                </span>
              </span>
              <IconArrow className="h-4 w-4 text-muted transition-[transform,translate,scale,color] duration-200 group-hover:translate-x-1 group-hover:text-ink" />
            </Link>
          ))}
        </div>
        <p data-reveal className="mt-6 text-sm text-muted">Don&rsquo;t mind where? Choose &ldquo;any country&rdquo; and get a random location.</p>
      </div>
    </section>
  );
}

export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <section id="faq" className="section-y">
      <div className="container-x grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p data-reveal className="eyebrow">FAQ</p>
          <h2 data-reveal className="h-section mt-4">Questions, answered</h2>
          <p data-reveal className="mt-4 text-[17px] text-ink-2">Can&rsquo;t find what you need? Write to us and we&rsquo;ll help.</p>
        </div>
        <div data-reveal-stagger className="divide-y divide-line border-y border-line">
          {items.map((f, i) => (
            <details key={f.q} data-reveal className="faq group" open={i === 0}>
              <summary className="flex items-center justify-between gap-6 py-5 text-left text-[17px] font-medium transition-colors hover:text-accent">
                {f.q}
                <span aria-hidden className="faq-icon grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-2 text-lg leading-none transition-colors group-hover:border-ink">+</span>
              </summary>
              <div className="faq-body pb-6 pr-12 text-[15px] leading-relaxed text-ink-2">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBand({ email }: { email: string }) {
  return (
    <section className="pb-20 sm:pb-28">
      <div className="container-x">
        <div data-reveal className="relative overflow-hidden rounded-3xl bg-ink px-6 py-14 text-center text-white sm:px-12 sm:py-20">
          <div aria-hidden className="bg-grid-dark pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div aria-hidden className="absolute -bottom-24 left-1/2 h-48 w-[70%] -translate-x-1/2 rounded-full bg-lime/20 blur-3xl" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl">Ready when you are</h2>
            <p className="mx-auto mt-4 max-w-lg text-[17px] text-white/65">Create an account, top up in naira, and get your first proxy in minutes.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/signup" className="btn-lime btn-lg group w-full sm:w-auto">
                Get started
                <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
              <a href={`mailto:${email}`} className="btn-dark-ghost btn-lg group w-full sm:w-auto">
                <IconMail className="h-4 w-4" />
                Talk to us
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
