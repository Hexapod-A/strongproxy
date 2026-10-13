"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ nav, vertical = false }: { nav: { href: string; label: string }[]; vertical?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/dashboard" || href === "/admin" ? path === href : path.startsWith(href));
  if (vertical) {
    return (
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`rounded-md px-3 py-2 text-sm ${isActive(n.href) ? "bg-paper font-medium text-ink" : "text-ink-2 hover:bg-paper hover:text-ink"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${isActive(n.href) ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
