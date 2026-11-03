import Link from "next/link";
import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";
import { HeaderShadow } from "./HeaderShadow";

export const NAV_ITEMS = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#private-modems", label: "Private modems" },
  { href: "/#how", label: "How it works" },
  { href: "/#locations", label: "Locations" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header id="site-header" className="sticky top-0 z-50 border-b border-transparent bg-paper/85 backdrop-blur-md transition-[border-color,box-shadow] duration-300 data-[scrolled=true]:border-line data-[scrolled=true]:shadow-[0_8px_24px_-20px_rgba(14,15,12,0.4)]">
      <HeaderShadow />
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {NAV_ITEMS.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link href="/dashboard" className="btn-primary btn-sm">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="nav-link">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary btn-sm group">
                Get started
                <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
              </Link>
            </>
          )}
        </div>
        <MobileMenu items={NAV_ITEMS} signedIn={signedIn} />
      </div>
    </header>
  );
}
