"use client";

import { useActionState, useState } from "react";
import { renewModemAction, rotateModemAction } from "@/app/dashboard/modem-actions";
import { formatNaira } from "@/lib/money";
import { CopyButton } from "./CopyButton";
import { Countdown } from "./Countdown";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

type Period = "day" | "week" | "month";
const LABEL: Record<Period, string> = { day: "1 day", week: "1 week", month: "1 month" };

export type ModemCardData = {
  id: string;
  title: string;
  flag: string;
  http: { host: string; port: number | null; username: string; password: string } | null;
  socks: { host: string; port: number | null; username: string; password: string } | null;
  online: boolean | null;
  expires_at: string;
  rotateUrl: string;
  /** Renewal prices for this modem's line (only the periods John sells at a profit). */
  renew: Partial<Record<Period, number>>;
};

export function ModemCard({ modem, balanceKobo, renewBlocked }: { modem: ModemCardData; balanceKobo: number; renewBlocked: boolean }) {
  const [protocol, setProtocol] = useState<"http" | "socks5">(modem.http ? "http" : "socks5");
  const [showPass, setShowPass] = useState(false);
  const periods = (Object.keys(LABEL) as Period[]).filter((p) => modem.renew[p] !== undefined);
  const [period, setPeriod] = useState<Period>(periods[0] ?? "day");
  const [rotState, rotAction] = useActionState(rotateModemAction, undefined);
  const [renState, renAction] = useActionState(renewModemAction, undefined);
  const c = protocol === "socks5" ? (modem.socks ?? modem.http) : (modem.http ?? modem.socks);
  const line = c ? `${c.host}:${c.port ?? ""}:${c.username}:${c.password}` : "";
  const shown = c ? (showPass ? line : `${c.host}:${c.port ?? ""}:${c.username}:••••••••`) : "Credentials not available yet";
  const url = c ? `${protocol === "socks5" ? "socks5h" : "http"}://${c.username}:${c.password}@${c.host}:${c.port ?? ""}` : "";
  const price = modem.renew[period];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${modem.online === false ? "bg-warn" : "bg-accent"}`} aria-hidden />
          <h3 className="font-semibold">
            <span aria-hidden className="mr-1.5">{modem.flag}</span>
            {modem.title}
          </h3>
        </div>
        <span className="text-sm text-muted">
          {modem.online === false ? "Reconnecting · " : ""}Time left: <Countdown until={modem.expires_at} />
        </span>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["http", "socks5"] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={p === "http" ? !modem.http : !modem.socks}
              onClick={() => setProtocol(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${protocol === p ? "bg-ink text-white" : "border border-line-2 text-ink-2 hover:border-ink"}`}
            >
              {p === "http" ? "HTTP" : "SOCKS5"}
            </button>
          ))}
          <span className="text-xs text-muted">host:port:user:pass</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm">{shown}</code>
          <button type="button" onClick={() => setShowPass((v) => !v)} className="h-8 rounded-md border border-line-2 px-2.5 text-xs text-ink-2 hover:border-ink">
            {showPass ? "Hide" : "Show"}
          </button>
          {line && <CopyButton value={line} />}
        </div>
        {url && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="shrink-0">As a URL</span>
            <code className="min-w-0 flex-1 truncate font-mono">{showPass ? url : url.replace(c!.password, "••••••••")}</code>
            <CopyButton value={url} />
          </div>
        )}
        <p className="text-xs text-muted">Unlimited data. The IP stays the same until you change it.</p>

        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <form action={rotAction} className="space-y-2">
            <input type="hidden" name="modem_id" value={modem.id} />
            <SubmitButton className="btn-ghost btn-sm" pendingText="Changing IP…">Change IP now</SubmitButton>
            <FormMessage state={rotState} />
          </form>
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Change-IP link (open it or call it from your script)</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-xs">{modem.rotateUrl}</code>
              <CopyButton value={modem.rotateUrl} />
            </div>
          </div>
        </div>

        <form action={renAction} className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
          <input type="hidden" name="modem_id" value={modem.id} />
          <label className="text-sm font-medium" htmlFor={`renew-${modem.id}`}>Renew</label>
          {periods.length === 0 ? (
            <span className="text-sm text-muted">Renewal isn&apos;t available for this modem right now.</span>
          ) : (
            <>
              <select id={`renew-${modem.id}`} name="period" className="input h-10 text-sm sm:max-w-[220px]" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {periods.map((p) => (
                  <option key={p} value={p}>
                    +{LABEL[p]} · {formatNaira(modem.renew[p]!)}
                  </option>
                ))}
              </select>
              {renewBlocked ? (
                <span className="text-sm text-warn">Renewals are temporarily unavailable.</span>
              ) : price !== undefined && price > balanceKobo ? (
                <a href="/dashboard/wallet" className="btn-ghost btn-sm">Top up {formatNaira(price - balanceKobo)}</a>
              ) : (
                <SubmitButton className="btn-primary btn-sm" pendingText="Renewing…">Pay {price !== undefined ? formatNaira(price) : ""} from wallet</SubmitButton>
              )}
            </>
          )}
        </form>
        <FormMessage state={renState} />
      </div>
    </div>
  );
}
