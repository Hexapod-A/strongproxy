"use client";

import { useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";
import { UsageMeter } from "./UsageMeter";
import { formatProxy, stickyNote, supportsTargeting } from "@/lib/proxy-format";
import type { Country } from "@/lib/types";

export type ProxyCardAccount = {
  id: string;
  provider: string;
  productName: string;
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: string;
  sticky_port_start: number | null;
  sticky_port_end: number | null;
  traffic_gb_purchased: number;
  notes: string | null;
  defaultCountry: string | null;
};

export function ProxyCard({ account, countries }: { account: ProxyCardAccount; countries: Pick<Country, "code" | "name">[] }) {
  const targeting = supportsTargeting(account.provider);
  const [country, setCountry] = useState<string>(account.defaultCountry ?? "");
  const [mode, setMode] = useState<"rotating" | "sticky">("rotating");
  const [protocol, setProtocol] = useState<"http" | "socks5">(account.protocol === "socks5" ? "socks5" : "http");
  const [format, setFormat] = useState<"hostport" | "url">("hostport");
  const [session, setSession] = useState(() => Math.random().toString(36).slice(2, 8));
  const [showPass, setShowPass] = useState(false);

  const str = useMemo(
    () =>
      formatProxy(account.provider, account, {
        country: targeting ? country || null : null,
        mode: targeting ? mode : "rotating",
        protocol,
        sessionId: mode === "sticky" ? session : undefined,
        format,
      }),
    [account, targeting, country, mode, protocol, session, format],
  );

  const fields: [string, string, boolean?][] = [
    ["Host", account.host],
    ["Port", String(account.port)],
    ["Username", account.username],
    ["Password", account.password, true],
  ];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
          <h3 className="font-semibold">{account.productName}</h3>
        </div>
        <span className="font-mono text-xs text-muted">{account.traffic_gb_purchased} GB bought</span>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2 [&>*]:min-w-0">
        <dl className="space-y-2">
          {fields.map(([k, v, secret]) => (
            <div key={k} className="flex items-center gap-3 rounded-lg bg-paper px-3 py-2">
              <dt className="w-20 shrink-0 text-xs text-muted">{k}</dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-[13px]">
                {secret && !showPass ? "•".repeat(Math.min(v.length, 14)) : v}
              </dd>
              {secret && (
                <button type="button" onClick={() => setShowPass((s) => !s)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                  {showPass ? "Hide" : "Show"}
                </button>
              )}
              <CopyButton value={v} />
            </div>
          ))}
          {account.notes && <p className="pt-1 text-xs text-muted">{account.notes}</p>}
        </dl>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {targeting && (
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor={`c-${account.id}`}>Country</label>
                <select id={`c-${account.id}`} className="input h-10" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">Any country</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {targeting && (
              <div className="col-span-2 sm:col-span-1">
                <span className="label">Rotation</span>
                <Segmented value={mode} onChange={setMode} options={[["rotating", "Rotating"], ["sticky", "Sticky"]]} />
              </div>
            )}
            <div>
              <span className="label">Protocol</span>
              <Segmented value={protocol} onChange={setProtocol} options={[["http", "HTTP"], ["socks5", "SOCKS5"]]} />
            </div>
            <div>
              <span className="label">Format</span>
              <Segmented value={format} onChange={setFormat} options={[["hostport", "host:port"], ["url", "URL"]]} />
            </div>
          </div>
          {targeting && mode === "sticky" && (
            <div className="flex items-center gap-2 text-xs text-muted">
              Session <span className="font-mono text-ink">{session}</span> {stickyNote(account.provider)}.
              <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => setSession(Math.random().toString(36).slice(2, 8))}>
                New IP
              </button>
            </div>
          )}
          <div className="rounded-lg bg-ink p-3">
            <div className="flex items-start gap-3">
              <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed text-lime">{str}</code>
              <CopyButton value={str} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-line px-5 py-4">
        <UsageMeter accountId={account.id} trackable={targeting} purchasedGb={account.traffic_gb_purchased} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="grid h-10 grid-cols-2 rounded-lg border border-line-2 bg-card p-0.5 text-[13px]">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-md transition-colors ${value === v ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
