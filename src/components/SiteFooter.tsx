import Link from "next/link";
import { Logo } from "./Logo";

export function SiteFooter() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <footer className="border-t border-line bg-paper">
      <div className="container-x flex flex-col gap-8 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-sm text-muted">Residential and mobile proxies for people who pay in naira.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <Link href="/terms" className="text-ink-2 hover:text-ink">Terms of Service</Link>
          <Link href="/#pricing" className="text-ink-2 hover:text-ink">Pricing</Link>
          <Link href="/acceptable-use" className="text-ink-2 hover:text-ink">Acceptable use</Link>
          <Link href="/#faq" className="text-ink-2 hover:text-ink">FAQ</Link>
          <Link href="/privacy" className="text-ink-2 hover:text-ink">Privacy</Link>
          <a href={`mailto:${email}`} className="text-ink-2 hover:text-ink">Support</a>
        </div>
      </div>
      <div className="container-x border-t border-line py-5 text-xs text-muted">
        © {new Date().getFullYear()} StrongProxy. Use of the service is subject to the Terms and Acceptable Use Policy.
      </div>
    </footer>
  );
}
