import type { Country } from "@/lib/types";
import { IconBolt, IconChart, IconGlobe, IconPlug, IconRotate, IconWallet } from "./Icons";

function Card({ icon, title, text, children, className = "" }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode; className?: string }) {
  return (
    <div
      data-reveal
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-6 transition-[transform,translate,scale,border-color,background-color] duration-300 ease-out hover:-translate-y-1 hover:border-lime/40 hover:bg-white/[0.06] ${className}`}
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-lime/15 text-lime transition-transform duration-300 group-hover:scale-110">{icon}</span>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-white">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-white/60">{text}</p>
      {children && <div className="mt-6 flex-1">{children}</div>}
    </div>
  );
}

export function Features({ countries, flags }: { countries: Country[]; flags: Record<string, string> }) {
  return (
    <section id="features" className="relative overflow-hidden bg-ink text-white">
      <div aria-hidden className="bg-grid-dark pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      <div className="container-x section-y relative">
        <div className="mx-auto max-w-2xl text-center">
          <p data-reveal className="font-mono text-[12px] uppercase tracking-[0.14em] text-lime">Features</p>
          <h2 data-reveal className="h-section mt-4">Everything you need, nothing you don&rsquo;t</h2>
          <p data-reveal className="mt-4 text-[17px] text-white/60">One wallet, two proxy types, and login details you can paste straight into your tools.</p>
        </div>

        <div data-reveal-stagger className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card icon={<IconPlug />} title="Works with your tools" text="HTTP, HTTPS and SOCKS5. Copy one string and paste it into your browser, bot or script.">
            <div className="space-y-2">
              {[
                ["HTTP / HTTPS", true],
                ["SOCKS5", true],
                ["Sticky session", true],
              ].map(([l]) => (
                <div key={String(l)} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white/80">
                  {l}
                  <span aria-hidden className="relative h-5 w-9 rounded-full bg-lime"><span className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-ink" /></span>
                </div>
              ))}
            </div>
          </Card>

          <Card icon={<IconGlobe />} title="Pick the country" text={`Choose from ${countries.length} countries, or leave it on any country for a random location.`}>
            <div className="flex flex-wrap gap-1.5">
              {countries.map((c) => (
                <span key={c.code} className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-white/75 transition-colors hover:border-lime/50 hover:text-white">
                  <span aria-hidden>{flags[c.code]}</span>
                  {c.name}
                </span>
              ))}
            </div>
          </Card>

          <Card icon={<IconRotate />} title="Rotating or sticky" text="Get a new IP on every request, or keep the same IP for a while when a site needs you to stay put.">
            <div className="space-y-2 font-mono text-[12px]">
              {[
                ["session-a1", "Sticky"],
                ["session-b2", "Rotating"],
                ["session-c3", "Sticky"],
              ].map(([id, mode]) => (
                <div key={id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white/70">
                  <span>user-{id}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${mode === "Sticky" ? "bg-lime/15 text-lime" : "bg-white/10 text-white/70"}`}>{mode}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card icon={<IconWallet />} title="Pay in naira" text="Top up your wallet with Paystack (card, bank transfer or USSD), or with USDT. No subscription.">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {["Card", "Bank transfer", "USSD", "USDT"].map((m) => (
                <span key={m} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-center text-white/75 transition-colors hover:border-lime/50 hover:text-white">{m}</span>
              ))}
            </div>
          </Card>

          <Card icon={<IconBolt />} title="Instant delivery" text="Your host, port, username and password show up the moment you pay. If an order can’t be delivered, the money goes back to your wallet by itself.">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-[12px] leading-6 text-white/70">
              <p><span className="text-lime">✓</span> Payment received</p>
              <p><span className="text-lime">✓</span> Proxy created</p>
              <p><span className="text-lime">✓</span> Details on your dashboard</p>
            </div>
          </Card>

          <Card icon={<IconChart />} title="Track your usage" text="See how much data each proxy has used and how much is left, right on your dashboard.">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex justify-between text-xs text-white/50"><span>Used</span><span>Left</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[38%] rounded-full bg-lime transition-[width] duration-700 group-hover:w-[62%]" /></div>
            </div>
          </Card>
        </div>

      </div>
    </section>
  );
}
