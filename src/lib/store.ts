import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, Product, Profile, ProxyAccount } from "./types";

/**
 * The narrow data interface the business services need. Production uses Supabase (service role);
 * tests use a real Postgres through `pg` (see test/helpers/pgStore.ts). Balance changes only happen
 * through the SQL functions called via rpc().
 */
export interface Store {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  getSetting<T = unknown>(key: string): Promise<T | null>;
  getProduct(id: string): Promise<Product | null>;
  getProfile(id: string): Promise<Profile | null>;
  getOrder(id: string): Promise<Order | null>;
  findProxyAccount(userId: string, productId: string, provider: string): Promise<ProxyAccount | null>;
}

export class StoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StoreError";
  }
}

/** Map Postgres "raise exception 'code'" messages to a stable code. */
export function errorCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const known = [
    "insufficient_balance",
    "user_banned",
    "product_unavailable",
    "invalid_quantity",
    "country_unavailable",
    "order_not_found",
    "order_not_fulfillable",
    "order_not_refundable",
    "already_refunded",
    "profile_not_found",
    "proxy_account_not_found",
    "zero_amount",
  ];
  return known.find((k) => msg.includes(k)) ?? "unknown_error";
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new StoreError(errorCode(new Error(error.message)) === "unknown_error" ? error.message : errorCode(new Error(error.message)));
      return data as T;
    },
    async getSetting<T>(key: string) {
      const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
      return (data?.value ?? null) as T | null;
    },
    async getProduct(id) {
      const { data } = await db.from("products").select("*").eq("id", id).maybeSingle();
      return (data as Product) ?? null;
    },
    async getProfile(id) {
      const { data } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
      return (data as Profile) ?? null;
    },
    async getOrder(id) {
      const { data } = await db.from("orders").select("*").eq("id", id).maybeSingle();
      return (data as Order) ?? null;
    },
    async findProxyAccount(userId, productId, provider) {
      const { data } = await db
        .from("proxy_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .eq("provider", provider)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      return (data as ProxyAccount) ?? null;
    },
  };
}
