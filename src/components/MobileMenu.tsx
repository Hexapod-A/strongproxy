"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

export function MobileMenu({ items, signedIn }: { items: Item[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-drawer"
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-11 w-11 place-items-center rounded-lg border border-line-2 bg-card transition-[border-color,transform,translate,scale] duration-200 hover:border-ink active:scale-95"
      >
        <span className="sr-only">Menu</span>
        <span aria-hidden className="relative block h-3 w-[18px]">
          <span className={`absolute left-0 top-0 h-[2px] w-full rounded bg-ink transition-transform duration-300 ${open ? "translate-y-[5px] rotate-45" : ""}`} />
          <span className={`absolute bottom-0 left-0 h-[2px] w-full rounded bg-ink transition-transform duration-300 ${open ? "-translate-y-[5px] -rotate-45" : ""}`} />
        </span>
      </button>

      {mounted &&
        createPortal(
          <div className="md:hidden">
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 top-16 z-40 bg-ink/30 backdrop-blur-[2px] transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <nav
        id="mobile-drawer"
        aria-label="Mobile"
        className={`fixed inset-x-0 top-16 z-50 origin-top border-b border-line bg-paper px-5 pb-6 pt-3 shadow-[0_24px_48px_-24px_rgba(14,15,12,0.35)] transition-[transform,translate,scale,opacity] duration-300 ease-out ${open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"}`}
      >
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.href}>
              <Link
                href={it.href}
                onClick={() => setOpen(false)}
                tabIndex={open ? 0 : -1}
                className="flex items-center justify-between border-b border-line py-4 text-[17px] font-medium text-ink transition-colors active:text-accent"
              >
                {it.label}
                <span aria-hidden className="text-muted">→</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {signedIn ? (
            <Link href="/dashboard" tabIndex={open ? 0 : -1} className="btn-primary col-span-2">Go to dashboard</Link>
          ) : (
            <>
              <Link href="/login" tabIndex={open ? 0 : -1} className="btn-ghost">Log in</Link>
              <Link href="/signup" tabIndex={open ? 0 : -1} className="btn-primary">Get started</Link>
            </>
          )}
        </div>
      </nav>
          </div>,
          document.body,
        )}
    </div>
  );
}
