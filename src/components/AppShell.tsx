import Link from "next/link";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { logOut } from "@/app/(auth)/actions";

export function AppShell({
  nav,
  email,
  children,
  badge,
}: {
  nav: { href: string; label: string }[];
  email: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line bg-card lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2 px-6">
          <Logo href="/dashboard" />
          {badge}
        </div>
        <NavLinks nav={nav} vertical />
        <div className="mt-auto border-t border-line p-4">
          <p className="truncate px-2 text-xs text-muted">{email}</p>
          <form action={logOut}>
            <button className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-paper hover:text-ink">Log out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between px-5">
            <div className="flex items-center gap-2">
              <Logo href="/dashboard" />
              {badge}
            </div>
            <form action={logOut}>
              <button className="text-sm text-muted hover:text-ink">Log out</button>
            </form>
          </div>
          <NavLinks nav={nav} />
        </header>
        <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:py-10">{children}</main>
        <footer className="mx-auto flex max-w-5xl gap-5 px-5 pb-8 text-xs text-muted sm:px-8">
          <Link href="/terms">Terms</Link>
          <Link href="/acceptable-use">Acceptable use</Link>
        </footer>
      </div>
    </div>
  );
}
