import type { SupabaseClient } from "@supabase/supabase-js";
import type { Country, DedicatedPort, Order, PortPlan, Product, Profile, ProxyAccount } from "./types";

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
  setSetting(key: string, value: unknown): Promise<void>;
  getPortPlan(id: string): Promise<PortPlan | null>;
  getCountry(code: string): Promise<Country | null>;
  getDedicatedPort(id: string): Promise<DedicatedPort | null>;
  findDedicatedPort(by: { provider: string; externalId: string } | { rotateToken: string }): Promise<DedicatedPort | null>;
  getProviderCustomer(userId: string, provider: string): Promise<string | null>;
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
    "plan_unavailable",
    "invalid_protocol",
    "port_not_found",
    "port_not_renewable",
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
    async setSetting(key, value) {
      const { error } = await db.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
      if (error) throw new StoreError(error.message);
    },
    async getPortPlan(id) {
      const { data } = await db.from("port_plans").select("*").eq("id", id).maybeSingle();
      return (data as PortPlan) ?? null;
    },
    async getCountry(code) {
      const { data } = await db.from("countries").select("*").eq("code", code).maybeSingle();
      return (data as Country) ?? null;
    },
    async getDedicatedPort(id) {
      const { data } = await db.from("dedicated_ports").select("*").eq("id", id).maybeSingle();
      return (data as DedicatedPort) ?? null;
    },
    async findDedicatedPort(by) {
      let q = db.from("dedicated_ports").select("*");
      q = "rotateToken" in by ? q.eq("rotate_token", by.rotateToken) : q.eq("provider", by.provider).eq("external_id", by.externalId);
      const { data } = await q.maybeSingle();
      return (data as DedicatedPort) ?? null;
    },
    async getProviderCustomer(userId, provider) {
      const { data } = await db.from("provider_customers").select("external_id").eq("user_id", userId).eq("provider", provider).maybeSingle();
      return (data?.external_id as string | undefined) ?? null;
    },
  };
}
