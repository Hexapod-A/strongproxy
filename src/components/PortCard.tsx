"use client";

import { useActionState, useState } from "react";
import { renewPortAction, rotatePortAction } from "@/app/dashboard/port-actions";
import { formatNaira } from "@/lib/money";
import type { PortPlan } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { Countdown } from "./Countdown";
import { FormMessage } from "./FormMessage";
import { SubmitButton } from "./SubmitButton";

export type PortCardData = {
  id: string;
  countryName: string;
  protocol: "http" | "socks5";
  server_ip: string;
  http_port: number | null;
  socks_port: number | null;
  username: string;
  password: string;
  traffic_gb: number;
  status: string;
  expires_at: string;
  rotateUrl: string;
};

export function PortCard({ port, plans, balanceKobo, renewBlocked }: { port: PortCardData; plans: PortPlan[]; balanceKobo: number; renewBlocked: boolean }) {
  const [protocol, setProtocol] = useState<"http" | "socks5">(port.protocol);
  const [showPass, setShowPass] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [rotState, rotAction] = useActionState(rotatePortAction, undefined);
  const [renState, renAction] = useActionState(renewPortAction, undefined);
  const portNo = protocol === "socks5" ? (port.socks_port ?? port.http_port) : (port.http_port ?? port.socks_port);
  const line = `${port.server_ip}:${portNo ?? ""}:${port.username}:${port.password}`;
  const shown = showPass ? line : `${port.server_ip}:${portNo ?? ""}:${port.username}:••••••••`;
  const plan = plans.find((p) => p.id === planId);
  const suspended = port.status === "suspended";

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${suspended ? "bg-warn" : "bg-accent"}`} aria-hidden />
          <h3 className="font-semibold">Dedicated mobile port · {port.countryName}</h3>
        </div>
        <span className="text-sm text-muted">
          {suspended ? "Suspended · " : ""}Time left: <Countdown until={port.expires_at} />
        </span>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["http", "socks5"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProtocol(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${protocol === p ? "bg-ink text-white" : "border border-line-2 text-ink-2 hover:border-ink"}`}
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
          <CopyButton value={line} />
        </div>
        <p className="text-xs text-muted">
          {port.traffic_gb > 0 ? `Includes ${port.traffic_gb} GB of data. ` : ""}Same IP until you rotate it.
        </p>

        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
          <form action={rotAction} className="space-y-2">
            <input type="hidden" name="port_id" value={port.id} />
            <SubmitButton className="btn-ghost btn-sm" pendingText="Rotating…">Rotate IP now</SubmitButton>
            <FormMessage state={rotState} />
          </form>
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-medium text-ink-2">Rotate link (open it or call it from your script)</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-xs">{port.rotateUrl}</code>
              <CopyButton value={port.rotateUrl} />
            </div>
          </div>
        </div>

        <form action={renAction} className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
          <input type="hidden" name="port_id" value={port.id} />
          <label className="text-sm font-medium" htmlFor={`renew-${port.id}`}>Renew</label>
          <select id={`renew-${port.id}`} name="plan_id" className="input h-10 text-sm sm:max-w-[220px]" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                +{p.name} · {formatNaira(p.price_kobo)}
              </option>
            ))}
          </select>
          {renewBlocked ? (
            <span className="text-sm text-warn">Renewals are temporarily unavailable.</span>
          ) : plan && plan.price_kobo > balanceKobo ? (
            <a href="/dashboard/wallet" className="btn-ghost btn-sm">Top up {formatNaira(plan.price_kobo - balanceKobo)}</a>
          ) : (
            <SubmitButton className="btn-primary btn-sm" pendingText="Renewing…">Pay {plan ? formatNaira(plan.price_kobo) : ""} from wallet</SubmitButton>
          )}
        </form>
        <FormMessage state={renState} />
      </div>
    </div>
  );
}
