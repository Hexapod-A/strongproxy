"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { buyAction } from "../actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNaira } from "@/lib/money";
import type { ProductStock } from "@/lib/stock";
import type { Country, Product } from "@/lib/types";

export function BuyForm({
  products,
  countries,
  stock,
  balanceKobo,
}: {
  products: Product[];
  countries: Country[];
  stock: Record<string, ProductStock>;
  balanceKobo: number;
}) {
  const [state, action] = useActionState(buyAction, undefined);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [country, setCountry] = useState("");
  const product = products.find((p) => p.id === productId);
  const avail = stock[productId]?.countries ?? {};
  const isOut = (code: string) => avail[code] === "out_of_stock";
  const countryOut = isOut(country);
  const inStockCount = countries.filter((c) => !isOut(c.code)).length;
  const total = (product?.price_per_gb_kobo ?? 0) * (Number.isFinite(qty) ? qty : 0);
  const short = total > balanceKobo;

  return (
    <form action={action} className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      <div className="space-y-6">
        <fieldset>
          <legend className="label">Proxy type</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map((p) => (
              <label
                key={p.id}
                className={`card cursor-pointer p-4 transition-colors ${productId === p.id ? "border-ink ring-1 ring-ink" : "hover:border-line-2"}`}
              >
                <input type="radio" name="product_id" value={p.id} checked={productId === p.id} onChange={() => setProductId(p.id)} className="sr-only" />
                <span className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-sm font-medium">{formatNaira(p.price_per_gb_kobo)}/GB</span>
                </span>
                <span className="mt-1.5 block text-sm text-muted">{p.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="country">Country</label>
            <select id="country" name="country" className="input" value={countryOut ? "" : country} onChange={(e) => setCountry(e.target.value)}>
              <option value="" disabled={isOut("")}>Any country (random){isOut("") ? " · out of stock" : ""}</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code} disabled={isOut(c.code)}>
                  {c.name}
                  {isOut(c.code) ? " · out of stock" : ""}
                </option>
              ))}
            </select>
            {stock[productId]?.live && inStockCount < countries.length ? (
              <p className="mt-1.5 text-xs text-muted">Live stock. Greyed-out countries are sold out right now for {product?.name ?? "this type"}.</p>
            ) : null}
          </div>
          <div>
            <label className="label" htmlFor="quantity">Quantity (GB)</label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={product?.min_gb ?? 1}
              max={product?.max_gb ?? 100}
              value={Number.isFinite(qty) ? qty : ""}
              onChange={(e) => setQty(parseInt(e.target.value, 10))}
              className="input"
            />
          </div>
        </div>
        <p className="text-xs text-muted">You can switch country any time later with the string generator on your dashboard.</p>
      </div>

      <aside className="card h-fit p-5">
        <h2 className="font-semibold">Summary</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{product?.name ?? "—"} × {Number.isFinite(qty) ? qty : 0} GB</dt><dd>{formatNaira(total)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Wallet balance</dt><dd>{formatNaira(balanceKobo)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2.5 font-medium"><dt>After purchase</dt><dd className={short ? "text-danger" : ""}>{short ? "Not enough" : formatNaira(balanceKobo - total)}</dd></div>
        </dl>
        <div className="mt-5 space-y-3">
          <FormMessage state={state} />
          {isOut(countryOut ? "" : country) ? (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">{product?.name ?? "This type"} is out of stock right now. Check back soon.</p>
          ) : short ? (
            <Link href="/dashboard/wallet" className="btn-primary w-full">Top up {formatNaira(total - balanceKobo)}</Link>
          ) : (
            <SubmitButton pendingText="Placing order…">Pay {formatNaira(total)} from wallet</SubmitButton>
          )}
        </div>
      </aside>
    </form>
  );
}
