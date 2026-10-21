"use client";

import { useEffect } from "react";

/** Adds a hairline + soft shadow to the sticky header once the page has scrolled. */
export function HeaderShadow() {
  useEffect(() => {
    const h = document.getElementById("site-header");
    if (!h) return;
    const on = () => h.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return null;
}
