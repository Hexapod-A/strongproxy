import Link from "next/link";
import { Logo } from "./Logo";

const POINTS = [
  "Residential and mobile proxies",
  "Pay in naira with Paystack, or in USDT",
  "Login details the moment you pay",
  "Undelivered orders refunded to your wallet",
];

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Logo />
          <Link href="/" className="group inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm text-ink-2 transition-colors hover:text-ink">
            <span aria-hidden className="transition-transform duration-200 group-hover:-translate-x-0.5">←</span>
            Back to site
          </Link>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 pb-16 pt-8 sm:items-center sm:pt-0">
          <div className="fade-in w-full max-w-[400px]">
            <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{title}</h1>
            <p className="mt-2 text-[15px] text-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <p className="mt-6 text-sm text-muted">{footer}</p>
          </div>
        </main>
        <footer className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-6 text-xs text-muted sm:px-8">
          <Link href="/terms" className="transition-colors hover:text-ink">Terms</Link>
          <Link href="/acceptable-use" className="transition-colors hover:text-ink">Acceptable use</Link>
          <Link href="/privacy" className="transition-colors hover:text-ink">Privacy</Link>
        </footer>
      </div>

      <aside className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div aria-hidden className="bg-grid-dark pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]" />
        <div aria-hidden className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-lime/15 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-lime" />
            StrongProxy
          </span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.035em] xl:text-[44px]">
            Proxies you can pay for <span className="text-lime">in naira.</span>
          </h2>
          <ul className="mt-8 space-y-3.5">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px] text-white/75">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime text-ink">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative rounded-xl border border-white/10 bg-white/[0.04] p-4 font-mono text-[12px] text-white/70">
          <p className="text-white/40">Your proxy</p>
          <p className="mt-1.5 break-all">host:port:username:password</p>
        </div>
      </aside>
    </div>
  );
}
