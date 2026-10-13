const MAP: Record<string, [string, string]> = {
  processing: ["Processing", "bg-warn-bg text-warn"],
  fulfilled: ["Delivered", "bg-ok-bg text-accent-ink"],
  failed: ["Failed", "bg-danger-bg text-danger"],
  refunded: ["Refunded", "bg-paper text-ink-2 border border-line"],
  pending: ["Pending", "bg-warn-bg text-warn"],
  success: ["Paid", "bg-ok-bg text-accent-ink"],
};

/** `failed` marks an order whose delivery failed and was auto-refunded (status "refunded" + a failure reason). */
export function StatusPill({ status, failed = false, adminView = false }: { status: string; failed?: boolean; adminView?: boolean }) {
  const [label, cls] = MAP[status] ?? [status, "bg-paper text-ink-2"];
  const text = status === "refunded" && failed ? (adminView ? "Failed · refunded" : "Not delivered · refunded") : label;
  return <span className={`pill whitespace-nowrap ${cls}`}>{text}</span>;
}
