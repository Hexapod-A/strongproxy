import type { Store } from "@/lib/store";

/** Postgres-backed fixed-window limiter (works across restarts / multiple containers). Fails open on DB error. */
export async function rateLimit(store: Store, key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    return await store.rpc<boolean>("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  } catch (e) {
    console.error("rate limit check failed", e);
    return true;
  }
}
