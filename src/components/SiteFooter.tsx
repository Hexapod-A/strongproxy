import Link from "next/link";
import { Logo } from "./Logo";

const COLS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/#pricing", label: "Mobile proxies" },
      { href: "/#pricing", label: "Residential proxies" },
      { href: "/pricing#private-modems", label: "Private modems" },
      { href: "/pricing", label: "Pricing" },
      { href: "/signup", label: "Sign up" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how", label: "How it works" },
      { href: "/#locations", label: "Locations" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/acceptable-use", label: "Acceptable Use" },
    ],
  },
];

export function SiteFooter() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <footer className="border-t border-line bg-card">
      <div className="container-x grid gap-12 py-14 sm:py-16 lg:grid-cols-[1.3fr_2fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-[15px] leading-relaxed text-muted">Residential and mobile proxies for people who pay in naira.</p>
          <a
            href={`mailto:${email}`}
            className="group mt-6 inline-flex items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 transition-[border-color,transform,translate,scale] duration-200 hover:-translate-y-0.5 hover:border-ink"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-lime">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" /></svg>
            </span>
            <span className="text-left">
              <span className="block text-xs text-muted">Need help? Email us</span>
              <span className="block text-sm font-medium text-ink">{email}</span>
            </span>
          </a>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLS.map((c) => (
            <div key={c.title}>
              <p className="eyebrow">{c.title}</p>
              <ul className="mt-4 space-y-2.5 text-[15px]">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="inline-block text-ink-2 transition-[color,transform,translate,scale] duration-200 hover:translate-x-0.5 hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="container-x flex flex-col gap-2 border-t border-line py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} StrongProxy. All rights reserved.</p>
        <p>Use of the service is subject to the Terms and Acceptable Use Policy.</p>
      </div>
    </footer>
  );
}
