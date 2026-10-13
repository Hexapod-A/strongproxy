import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getCatalog, flag } from "@/lib/catalog";
import { formatNaira } from "@/lib/money";

export const revalidate = 300;

const FEATURES: Record<string, string[]> = {
  mobile: ["4G/5G carrier IPs", "Best for social, ads and app traffic", "Rotating or sticky sessions", "HTTP(S) and SOCKS5"],
  residential: ["Home broadband IPs", "Best for scraping, research, sneakers", "Rotating or sticky sessions", "HTTP(S) and SOCKS5"],
};

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Mobile or residential, which do I need?",
    a: "Residential IPs come from home broadband connections and suit most work: research, scraping, price checks. Mobile IPs come from cellular networks; platforms trust them the most, so pick mobile for social media and app traffic.",
  },
  {
    q: "How do I pay?",
    a: "Top up your wallet in naira with Paystack (card, bank transfer or USSD), or in USDT. Then buy GB from your wallet balance. No subscription.",
  },
  {
    q: "How fast do I get my proxies?",
    a: "Instantly. The moment you pay from your wallet, your host, port, username and password appear on your dashboard with copy buttons. If an order can't be delivered, it is refunded to your wallet automatically.",
  },
  {
    q: "Can I pick the country?",
    a: "Yes. Choose the United States, United Kingdom, Canada, Australia, Germany, France, Spain, the Netherlands or Norway, or leave it on any country for a random location. Stock is live: a country that is sold out right now is greyed out at checkout. You can change targeting per connection with the string generator.",
  },
  {
    q: "HTTP or SOCKS5?",
    a: "Both. Your dashboard gives you ready-to-paste strings for HTTP(S) and SOCKS5, rotating (a new IP per request) or sticky (the same IP for a while).",
  },
  {
    q: "What am I not allowed to do?",
    a: (
      <>
        No fraud, carding, spam, mass account creation, or anything illegal. Accounts that break the{" "}
        <Link href="/acceptable-use" className="underline underline-offset-2">Acceptable Use Policy</Link> are banned without refund.
      </>
    ),
  },
];

export default async function Home() {
  const { products, countries } = await getCatalog();

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="container-x grid gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16 lg:pb-24">
          <div>
            <p className="eyebrow">Residential · Mobile · Pay per GB</p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[56px]">
              Clean proxies.
              <br />
              Priced in naira.
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-2">
              Residential and mobile IPs in the US, UK, Canada, Australia and Europe. Fund your wallet with Paystack or USDT, pick
              a country, and copy your credentials.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="btn-primary h-12 px-6">
                Create an account
              </Link>
              <Link href="#pricing" className="btn-ghost h-12 px-6">
                See pricing
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6 text-sm">
              {products.slice(0, 2).map((p) => (
                <div key={p.id}>
                  <dt className="text-muted">{p.name}</dt>
                  <dd className="mt-1 font-medium">{formatNaira(p.price_per_gb_kobo)}/GB</dd>
                </div>
              ))}
              <div>
                <dt className="text-muted">Minimum</dt>
                <dd className="mt-1 font-medium">1 GB</dd>
              </div>
            </dl>
          </div>

          {/* Credential card: illustrates the format customers receive (example values only) */}
          <div className="relative">
            <div className="rounded-2xl bg-ink p-5 text-white shadow-[0_30px_60px_-30px_rgba(14,15,12,0.55)] sm:p-7">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">Your proxy · example</span>
                <span className="pill bg-lime text-ink">Residential</span>
              </div>
              <div className="mt-6 space-y-3 font-mono text-[13px]">
                {[
                  ["host", "gateway.example"],
                  ["port", "823"],
                  ["user", "yourlogin__cr.gb"],
                  ["pass", "••••••••••••"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 rounded-lg bg-white/[0.06] px-3.5 py-2.5">
                    <span className="text-white/45">{k}</span>
                    <span className="truncate text-white/90">{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">Target</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {["Any", "US", "UK", "CA", "AU", "DE"].map((c, i) => (
                    <span
                      key={c}
                      className={`rounded-md px-2.5 py-1 text-xs ${i === 2 ? "bg-white text-ink" : "bg-white/[0.08] text-white/70"}`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
                <span className="rounded-md border border-white/15 px-3 py-2 text-center text-white">Rotating</span>
                <span className="rounded-md px-3 py-2 text-center text-white/55">Sticky session</span>
              </div>
            </div>
          </div>
        </section>

        {/* Payment strip */}
        <section className="border-y border-line bg-card">
          <div className="container-x flex flex-col gap-3 py-5 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-muted">Pay your way</span>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <span>Naira card</span>
              <span>Bank transfer</span>
              <span>USSD</span>
              <span>USDT (TRC20 and more)</span>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="container-x scroll-mt-20 py-20">
          <div className="max-w-xl">
            <p className="eyebrow">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">One price per GB. Every country.</h2>
            <p className="mt-4 text-ink-2">No plans, no monthly fee. Buy the GB you need and top up when you run low.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {products.map((p, i) => (
              <div key={p.id} className={`card flex flex-col p-6 sm:p-8 ${i === 0 ? "border-ink" : ""}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  {i === 0 && <span className="pill bg-ink text-white">Highest trust</span>}
                </div>
                <p className="mt-2 text-sm text-muted">{p.description}</p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-[-0.03em]">{formatNaira(p.price_per_gb_kobo)}</span>
                  <span className="text-muted">/ GB</span>
                </p>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {(FEATURES[p.id] ?? ["HTTP(S) and SOCKS5", "Country targeting"]).map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 8.5l3 3 7-7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`${i === 0 ? "btn-primary" : "btn-ghost"} mt-8 w-full`}>
                  Buy {p.name.toLowerCase()}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-line bg-card">
          <div className="container-x py-20">
            <p className="eyebrow">How it works</p>
            <div className="mt-8 grid gap-10 md:grid-cols-3">
              {[
                ["01", "Fund your wallet", "Pay in naira with Paystack or send USDT. Your balance updates once the payment is confirmed."],
                ["02", "Choose your proxies", "Pick mobile or residential, a country (or any), and how many GB."],
                ["03", "Copy and connect", "Your host, port, username and password appear on your dashboard, with a generator for country and sticky sessions."],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span className="font-mono text-sm text-muted">{n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Countries */}
        <section className="container-x py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="eyebrow">Locations</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Where your traffic comes from</h2>
              <p className="mt-4 text-ink-2">Target a country, or leave it on any for a random location.</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {countries.map((c) => (
                <li key={c.code} className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm">
                  <span aria-hidden className="text-lg leading-none">{flag(c.code)}</span>
                  {c.name}
                </li>
              ))}
              <li className="flex items-center gap-3 rounded-lg border border-dashed border-line-2 px-4 py-3 text-sm text-ink-2">
                <span aria-hidden className="text-lg leading-none">🌐</span>
                Any country
              </li>
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-line">
          <div className="container-x grid gap-10 py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="eyebrow">FAQ</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Questions</h2>
            </div>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium">
                    {f.q}
                    <span aria-hidden className="text-xl leading-none text-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="container-x pb-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-ink px-6 py-10 text-white sm:flex-row sm:items-center sm:px-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">Start with 1 GB.</h2>
              <p className="mt-2 text-white/65">Create an account, fund your wallet, and buy what you need.</p>
            </div>
            <Link href="/signup" className="btn h-12 bg-lime px-6 text-ink hover:bg-white">
              Create an account
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
