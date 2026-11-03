"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { rentModemAction } from "../../modem-actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNaira } from "@/lib/money";
import type { CountryOffer } from "@/lib/services/modems";

type Period = "day" | "week" | "month";
const PERIODS: { id: Period; label: string; unit: string }[] = [
  { id: "day", label: "1 day", unit: "day" },
  { id: "week", label: "1 week", unit: "week" },
  { id: "month", label: "1 month", unit: "month" },
];

export function ModemRentForm({
  offers,
  flags,
  balanceKobo,
  canBuy,
  blockedReason,
}: {
  offers: CountryOffer[];
  flags: Record<string, string>;
  balanceKobo: number;
  canBuy: boolean;
  blockedReason: string | null;
}) {
  const [state, action] = useActionState(rentModemAction, undefined);
  // Start on a country that has a 1-day modem in stock (the cheapest way in), else the first one in stock.
  const firstIn = offers.find((c) => c.inStock && c.carriers.some((x) => x.periods.day?.inStock)) ?? offers.find((c) => c.inStock) ?? offers[0];
  const [code, setCode] = useState(firstIn?.code ?? "");
  const country = offers.find((c) => c.code === code);
  const firstCarrier = (c?: CountryOffer) => c?.carriers.find((x) => x.inStock) ?? c?.carriers[0];
  const [carrierName, setCarrierName] = useState(firstCarrier(firstIn)?.name ?? "");
  const carrier = country?.carriers.find((x) => x.name === carrierName) ?? firstCarrier(country);
  const firstPeriod = (car?: CountryOffer["carriers"][number]) => PERIODS.find((p) => car?.periods[p.id]?.inStock)?.id ?? "day";
  const [period, setPeriod] = useState<Period>(firstPeriod(carrier));
  const line = carrier?.periods[period];
  const sellable = Boolean(line?.inStock);
  const total = sellable ? line!.priceKobo : 0;
  const short = total > balanceKobo;

  const pickCountry = (c: CountryOffer) => {
    setCode(c.code);
    const car = firstCarrier(c);
    setCarrierName(car?.name ?? "");
    setPeriod(firstPeriod(car));
  };
  const pickCarrier = (name: string) => {
    setCarrierName(name);
    const car = country?.carriers.find((x) => x.name === name);
    if (!car?.periods[period]?.inStock) setPeriod(firstPeriod(car));
  };
  const soldOutCount = useMemo(() => offers.filter((c) => !c.inStock).length, [offers]);

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <input type="hidden" name="country" value={country?.code ?? ""} />
      <input type="hidden" name="carrier" value={carrier?.name ?? ""} />
      <input type="hidden" name="period" value={period} />

      <div className="space-y-7">
        <fieldset>
          <legend className="label">Country</legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {offers.map((c) => {
              const active = c.code === country?.code;
              return (
                <button
                  key={c.code}
                  type="button"
                  disabled={!c.inStock}
                  onClick={() => pickCountry(c)}
                  aria-pressed={active}
                  className={`card flex flex-col items-start gap-1 p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    active ? "border-ink ring-1 ring-ink" : "hover:border-line-2"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span aria-hidden className="text-base leading-none">{flags[c.code] ?? "🌐"}</span>
                    {c.name}
                  </span>
                  <span className="text-xs text-muted">{c.inStock && c.fromKobo !== null ? `From ${formatNaira(c.fromKobo)} / ${c.fromPeriod ?? "day"}` : "Sold out"}</span>
                </button>
              );
            })}
          </div>
          {soldOutCount > 0 && <p className="mt-2 text-xs text-muted">Live stock. Greyed-out countries are sold out right now.</p>}
        </fieldset>

        {country && (
          <fieldset>
            <legend className="label">Carrier</legend>
            <div className="flex flex-wrap gap-2">
              {country.carriers.map((car) => {
                const active = car.name === carrier?.name;
                return (
                  <button
                    key={car.name}
                    type="button"
                    disabled={!car.inStock}
                    onClick={() => pickCarrier(car.name)}
                    aria-pressed={active}
                    className={`rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      active ? "bg-ink text-white" : "border border-line-2 bg-card text-ink-2 hover:border-ink"
                    }`}
                  >
                    {car.name}
                    {!car.inStock && <span className="ml-1.5 text-xs font-normal">· sold out</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {carrier && (
          <fieldset>
            <legend className="label">How long</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {PERIODS.map((p) => {
                const l = carrier.periods[p.id];
                const ok = Boolean(l?.inStock);
                const active = p.id === period && ok;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!ok}
                    onClick={() => setPeriod(p.id)}
                    aria-pressed={active}
                    className={`card flex items-center justify-between gap-3 p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:flex-col sm:items-start ${
                      active ? "border-ink ring-1 ring-ink" : "hover:border-line-2"
                    }`}
                  >
                    <span className="text-sm font-medium text-ink-2">{p.label}</span>
                    <span className="text-lg font-semibold tracking-tight tabular-nums">
                      {l ? (ok ? formatNaira(l.priceKobo) : "Sold out") : "Not available"}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <ul className="grid gap-2 text-sm text-ink-2 sm:grid-cols-2">
          {["The whole modem is yours alone", "Unlimited data for the full period", "HTTP and SOCKS5, your own port", "New IP whenever you want"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <aside className="card h-fit p-5">
        <h2 className="font-semibold">Summary</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">
              {country && carrier ? `${country.name} · ${carrier.name} · ${PERIODS.find((p) => p.id === period)?.label}` : "Pick a modem"}
            </dt>
            <dd className="shrink-0">{sellable ? formatNaira(total) : "—"}</dd>
          </div>
          <div className="flex justify-between"><dt className="text-muted">Wallet balance</dt><dd>{formatNaira(balanceKobo)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2.5 font-medium">
            <dt>After payment</dt>
            <dd className={short ? "text-danger" : ""}>{!sellable ? "—" : short ? "Not enough" : formatNaira(balanceKobo - total)}</dd>
          </div>
        </dl>
        <div className="mt-5 space-y-3">
          <FormMessage state={state} />
          {blockedReason ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">{blockedReason}</p>
          ) : !sellable ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">Pick a country, carrier and period that are in stock.</p>
          ) : short ? (
            <Link href="/dashboard/wallet" className="btn-primary w-full">Top up {formatNaira(total - balanceKobo)}</Link>
          ) : (
            <SubmitButton pendingText="Setting up your modem…">Pay {formatNaira(total)} from wallet</SubmitButton>
          )}
          {canBuy && !blockedReason && <p className="text-xs text-muted">Ready in under a minute. If it can&apos;t be set up, the full amount goes back to your wallet.</p>}
        </div>
      </aside>
    </form>
  );
}
