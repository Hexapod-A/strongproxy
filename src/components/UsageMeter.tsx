"use client";

import { useEffect, useState } from "react";

type Usage = { remainingBytes: number; usedBytes: number | null; totalBytes: number | null };
const GB = 1024 ** 3;
const fmtGb = (b: number) => `${(b / GB).toFixed(b / GB >= 10 ? 1 : 2)} GB`;

export function UsageMeter({ accountId, trackable, purchasedGb }: { accountId: string; trackable: boolean; purchasedGb: number }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!trackable) return;
    let alive = true;
    fetch(`/api/proxies/${accountId}/usage`)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) setErr(j.error ?? "unavailable");
        else setUsage(j);
      })
      .catch(() => alive && setErr("unavailable"));
    return () => {
      alive = false;
    };
  }, [accountId, trackable]);

  if (!trackable) {
    return (
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted">Data purchased</span>
          <span className="font-medium">{purchasedGb} GB</span>
        </div>
        <p className="mt-2 text-xs text-muted">Live usage isn&rsquo;t available for this proxy. Ask support for a usage report.</p>
      </div>
    );
  }
  if (err) return <p className="text-sm text-muted">Usage is temporarily unavailable.</p>;
  if (!usage) return <div className="h-12 animate-pulse rounded-lg bg-paper" aria-label="Loading usage" />;

  const total = usage.totalBytes ?? purchasedGb * GB;
  const used = usage.usedBytes ?? Math.max(total - usage.remainingBytes, 0);
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Used {fmtGb(used)} of {fmtGb(total)}</span>
        <span className="font-medium">{fmtGb(usage.remainingBytes)} left</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${pct > 85 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
