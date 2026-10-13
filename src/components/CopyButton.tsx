"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = value;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex h-8 shrink-0 items-center rounded-md border border-line-2 bg-card px-2.5 text-xs font-medium text-ink-2 hover:border-ink hover:text-ink"
      aria-label={`${label} ${value.length > 40 ? "" : value}`.trim()}
    >
      {done ? "Copied" : label}
    </button>
  );
}
