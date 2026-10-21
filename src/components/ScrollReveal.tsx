"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Fades up every [data-reveal] element the first time it scrolls into view.
 * Elements already on screen are shown at once, so nothing flashes on load.
 * Children of a [data-reveal-stagger] parent get a small delay each.
 */
export function ScrollReveal() {
  const path = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    document.querySelectorAll<HTMLElement>("[data-reveal-stagger]").forEach((group) => {
      Array.from(group.querySelectorAll<HTMLElement>(":scope > [data-reveal]")).forEach((el, i) => {
        el.style.setProperty("--reveal-delay", `${Math.min(i, 8) * 70}ms`);
      });
    });
    // Once an element has faded in, drop the hook so its own hover transitions take over again.
    const settle = (el: HTMLElement, wait: number) => {
      window.setTimeout(() => el.removeAttribute("data-reveal"), wait);
    };
    const vh = window.innerHeight;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.95 && r.bottom > 0) {
        el.classList.add("is-in");
        settle(el, 0);
      }
    });
    root.classList.add("reveal-on");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => {
        el.classList.add("is-in");
        settle(el, 0);
      });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            el.classList.add("is-in");
            io.unobserve(el);
            settle(el, 900 + (parseInt(el.style.getPropertyValue("--reveal-delay"), 10) || 0));
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    els.forEach((el) => {
      if (!el.classList.contains("is-in")) io.observe(el);
    });
    return () => io.disconnect();
  }, [path]);
  return null;
}
