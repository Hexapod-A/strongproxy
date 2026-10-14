"use client";

import { useEffect, useState } from "react";

function left(ms: number) {
  if (ms <= 0) return "Expired";
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** Live "time left" until an ISO timestamp. */
export function Countdown({ until }: { until: string }) {
  const target = new Date(until).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="tabular-nums">…</span>;
  const ms = target - now;
  return <span className={`tabular-nums ${ms < 6 * 3600_000 ? "text-danger" : ""}`}>{left(ms)}</span>;
}
