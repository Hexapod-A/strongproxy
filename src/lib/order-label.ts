import type { Order } from "./types";

export const isPortOrder = (o: Pick<Order, "kind">) => o.kind === "port" || o.kind === "port_renewal";

/** One-line title for any order: "5 GB Mobile" or "Daily port · 7 days · HTTP" / "Port renewal · 7 days". */
export function orderTitle(o: Order, productName: (id: string) => string): string {
  if (isPortOrder(o)) {
    const days = o.port_days ?? 0;
    const d = `${days} day${days === 1 ? "" : "s"}`;
    return o.kind === "port_renewal" ? `Port renewal · ${d}` : `Daily port · ${d}${o.port_protocol ? ` · ${o.port_protocol.toUpperCase()}` : ""}`;
  }
  return `${o.quantity_gb} GB ${o.product_id ? productName(o.product_id) : ""}`.trim();
}

/** GB column: GB bought, or the plan's data allowance for daily ports ("No cap" for 0). */
export function orderGb(o: Order): string {
  if (isPortOrder(o)) return o.quantity_gb > 0 ? `${o.quantity_gb} incl.` : "No cap";
  return String(o.quantity_gb);
}
