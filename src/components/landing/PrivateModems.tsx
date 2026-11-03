import Link from "next/link";
import { formatNaira } from "@/lib/money";
import type { PublicModemOffer } from "@/lib/modem-public";
import { IconArrow, IconCheck, IconPhone } from "./Icons";

const TITLE = { day: "Day", week: "Week", month: "Month" } as const;
const FEATURES = [
  "A whole 4G/5G modem, used by you alone",
  "Unlimited data for the full period",
  "Your own HTTP and SOCKS5 port",
  "New IP whenever you want: one click or a link",
  "Renew from your wallet before it ends",
];

export function PrivateModems({ offer, cta = "/signup" }: { offer: PublicModemOffer; cta?: string }) {
  if (!offer.enabled) return null;
  const inStock = offer.countries.filter((c) => c.inStock);
  return (
    <div id="private-modems" className="mx-auto max-w-5xl scroll-mt-24">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p data-reveal className="eyebrow">Private modems</p>
        <h2 data-reveal className="h-section mt-4">A whole modem, just for you</h2>
        <p data-reveal className="mt-4 text-[17px] text-ink-2">
          Rent a dedicated mobile modem by the day, week or month. No per-GB billing, no one else on your IP.
        </p>
      </div>

      <div data-reveal-stagger className="grid gap-4 md:grid-cols-3">
        {offer.plans.map((p) => {
          const dark = p.period === "month";
          return (
            <div
              key={p.period}
              data-reveal
              className={`relative flex flex-col rounded-2xl border p-7 transition-[transform,translate,scale,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 ${
                dark ? "border-ink bg-ink text-white hover:shadow-[0_30px_60px_-30px_rgba(14,15,12,0.7)]" : "border-line bg-card hover:border-ink/30 hover:shadow-[0_24px_48px_-28px_rgba(14,15,12,0.35)]"
              }`}
            >
              {dark && <span className="absolute right-6 top-6 rounded-full bg-lime px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink">Lowest daily price</span>}
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${dark ? "bg-white/10 text-lime" : "bg-paper text-accent"}`}>
                <IconPhone />
              </span>
              <h3 className="mt-5 text-xl font-semibold">{TITLE[p.period]}</h3>
              <p className="mt-5 flex items-baseline gap-1.5">
                {p.from && <span className={`text-sm ${dark ? "text-white/60" : "text-muted"}`}>from</span>}
                <span className="text-[40px] font-semibold leading-none tracking-[-0.04em]">{formatNaira(p.priceKobo)}</span>
                <span className={dark ? "text-white/60" : "text-muted"}>/{p.period}</span>
              </p>
              <p className={`mt-2 text-sm ${dark ? "text-white/50" : "text-muted"}`}>
                {p.period === "day" ? "Unlimited data for 24 hours" : `About ${formatNaira(p.perDayKobo)} a day · unlimited data`}
              </p>
              <Link href={cta} className={`${dark ? "btn-lime" : "btn-primary"} group/btn mt-7 w-full`}>
                Rent for a {p.period}
                <IconArrow className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" />
              </Link>
            </div>
          );
        })}
      </div>

      <div data-reveal className="mt-4 grid gap-6 rounded-2xl border border-line bg-card p-6 sm:p-7 md:grid-cols-[1.1fr_1fr]">
        <ul className="space-y-3 text-[15px]">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok-bg text-accent">
                <IconCheck className="h-3 w-3" />
              </span>
              <span className="text-ink-2">{f}</span>
            </li>
          ))}
        </ul>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{offer.live ? "In stock now" : "Countries"}</p>
          {inStock.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {inStock.map((c) => (
                <li key={c.code} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-sm">
                  <span aria-hidden>{c.flag}</span>
                  {c.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Stock changes through the day. Sign up and check the live list in your dashboard.</p>
          )}
          <p className="mt-4 text-sm text-muted">Carrier and price depend on the country. You see the exact price before you pay, and a modem that can&apos;t be set up is refunded to your wallet.</p>
        </div>
      </div>
    </div>
  );
}
