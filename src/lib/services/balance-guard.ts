import type { Notifier } from "@/lib/notify";
import { StoreError, type Store } from "@/lib/store";
import type { PortPlan } from "@/lib/types";

/**
 * Low-balance auto-pause. Every Proxies.sx sale (per-GB keys and daily ports) is paid from John's Proxies.sx
 * balance. When that balance is below the admin threshold (default $5), or below what one order would cost,
 * the product shows "temporarily unavailable" and the buy is refused BEFORE the wallet is charged.
 * Sales resume on their own when the balance is back above the threshold. Auto-refund stays as the fallback.
 *
 * Balance source: GET /v1/account/summary (documented in their LLM reference). Read at most once a minute.
 * If the balance can't be read, sales stay OPEN (fail-open) and the auto-refund covers a failed delivery.
 */
export type BalanceReader = { isConfigured(): boolean; getBalanceUsd(): Promise<number> };

export type GuardSettings = { enabled: boolean; thresholdUsd: number; costPerGbUsd: number; portCostPerDayUsd: number };

export type SalesStatus = {
  enabled: boolean;
  paused: boolean;
  reason: "below_threshold" | "below_order_cost" | null;
  balanceUsd: number | null;
  thresholdUsd: number;
  error?: string;
};

export type GuardDeps = { store: Store; notify: Notifier; reader: BalanceReader; now?: () => number };

export const BALANCE_TTL_MS = 60_000;
let cache: { at: number; usd: number } | null = null;
export function resetBalanceCache() {
  cache = null;
}

const n = (v: unknown, d: number) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

export async function guardSettings(store: Store): Promise<GuardSettings> {
  const [enabled, threshold, perGb, perDay] = await Promise.all([
    store.getSetting<unknown>("psx_autopause_enabled"),
    store.getSetting<unknown>("psx_autopause_threshold_usd"),
    store.getSetting<unknown>("psx_cost_usd_per_gb"),
    store.getSetting<unknown>("psx_port_cost_usd_per_day"),
  ]);
  return {
    enabled: !(enabled === false || enabled === "false"),
    thresholdUsd: n(threshold, 5),
    costPerGbUsd: n(perGb, 4),
    portCostPerDayUsd: n(perDay, 0),
  };
}

/** What one order costs John upstream (estimate used for the "below what the order would cost" check). */
export const gbOrderCostUsd = (s: GuardSettings, gb: number) => gb * s.costPerGbUsd;
export const portOrderCostUsd = (s: GuardSettings, plan: Pick<PortPlan, "days" | "traffic_gb">) => plan.days * s.portCostPerDayUsd + plan.traffic_gb * s.costPerGbUsd;

async function readBalance(reader: BalanceReader, now: number): Promise<{ usd: number | null; error?: string }> {
  if (cache && now - cache.at < BALANCE_TTL_MS) return { usd: cache.usd };
  try {
    const usd = await reader.getBalanceUsd();
    cache = { at: now, usd };
    return { usd };
  } catch (e) {
    return { usd: null, error: e instanceof Error ? e.message : String(e) };
  }
}

type PauseState = { paused: boolean; since: string; balanceUsd: number | null };

async function recordTransition(deps: GuardDeps, below: boolean, usd: number, threshold: number) {
  const prev = await deps.store.getSetting<PauseState>("psx_pause_state");
  if (Boolean(prev?.paused) === below) return;
  await deps.store.setSetting("psx_pause_state", { paused: below, since: new Date(deps.now?.() ?? Date.now()).toISOString(), balanceUsd: usd });
  await deps.notify(
    below ? `Sales PAUSED: Proxies.sx balance $${usd.toFixed(2)}` : `Sales resumed: Proxies.sx balance $${usd.toFixed(2)}`,
    below
      ? `Your Proxies.sx balance is $${usd.toFixed(2)}, below your $${threshold.toFixed(2)} threshold.\nMobile, residential (Proxies.sx), private modems and daily ports now show "temporarily unavailable" and nobody can be charged.\nTop up Proxies.sx and sales resume on their own within a minute. Change the threshold in Admin > Private modems.`
      : `Your Proxies.sx balance is back to $${usd.toFixed(2)} (threshold $${threshold.toFixed(2)}). Sales are open again.`,
  );
}

export async function salesStatus(deps: GuardDeps, orderCostUsd = 0): Promise<SalesStatus> {
  const s = await guardSettings(deps.store);
  const base = { enabled: s.enabled, thresholdUsd: s.thresholdUsd };
  if (!s.enabled || !deps.reader.isConfigured()) return { ...base, paused: false, reason: null, balanceUsd: null };
  const { usd, error } = await readBalance(deps.reader, deps.now?.() ?? Date.now());
  if (usd === null) return { ...base, paused: false, reason: null, balanceUsd: null, error };
  const below = usd < s.thresholdUsd;
  await recordTransition(deps, below, usd, s.thresholdUsd);
  if (below) return { ...base, paused: true, reason: "below_threshold", balanceUsd: usd };
  if (orderCostUsd > 0 && usd < orderCostUsd) return { ...base, paused: true, reason: "below_order_cost", balanceUsd: usd };
  return { ...base, paused: false, reason: null, balanceUsd: usd };
}

/** Re-check right before charging the wallet. Throws StoreError("sales_paused"); nothing is charged. */
export async function refuseIfPaused(deps: GuardDeps, orderCostUsd: number, what: string): Promise<void> {
  const st = await salesStatus(deps, orderCostUsd);
  if (!st.paused) return;
  if (st.reason === "below_order_cost") {
    await deps.notify(
      `Sale refused: Proxies.sx balance too low for one order`,
      `A customer tried to buy ${what} (about $${orderCostUsd.toFixed(2)} upstream) but your Proxies.sx balance is $${(st.balanceUsd ?? 0).toFixed(2)}.\nNothing was charged. Top up Proxies.sx.`,
    );
  }
  throw new StoreError("sales_paused");
}
