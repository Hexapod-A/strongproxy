"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/acceptable-use", label: "Acceptable Use" },
];

export function LegalTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Legal pages" className="-mx-5 mt-8 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-xl border border-line bg-paper p-1">
        {TABS.map((t) => {
          const on = path === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition-[background-color,color,box-shadow] duration-200 ${on ? "bg-card font-medium text-ink shadow-[0_1px_3px_rgba(14,15,12,0.12)]" : "text-ink-2 hover:bg-card/70 hover:text-ink"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
