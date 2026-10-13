import Link from "next/link";
import { Logo } from "./Logo";

export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/#pricing" className="hidden rounded-md px-3 py-2 text-sm text-ink-2 hover:text-ink sm:inline-block">
            Pricing
          </Link>
          <Link href="/#faq" className="hidden rounded-md px-3 py-2 text-sm text-ink-2 hover:text-ink sm:inline-block">
            FAQ
          </Link>
          {signedIn ? (
            <Link href="/dashboard" className="btn-primary btn-sm">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-2 text-sm text-ink-2 hover:text-ink">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
