import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "@/lib/store";
import { errorCode, StoreError } from "@/lib/store";

pg.types.setTypeParser(20, (v) => Number(v)); // int8 -> number (kobo fits easily)

const ROOT = path.resolve(__dirname, "../..");
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DB_NAME = "sp_test";

/** Fresh database with the Supabase shim + the real migration + seed. */
export async function freshDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB_NAME}' and pid <> pg_backend_pid()`);
  await admin.query(`drop database if exists ${DB_NAME}`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = "/" + DB_NAME;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  for (const f of ["test/sql/supabase_shim.sql", "supabase/migrations/20261013000001_init.sql", "supabase/migrations/20261013000002_providers_no_manual.sql", "supabase/migrations/20261014000003_day_ports.sql", "supabase/seed.sql"]) {
    await pool.query(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  return pool;
}

export function pgStore(pool: pg.Pool): Store {
  const one = async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T | undefined;
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const keys = Object.keys(args);
      const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
      const vals = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      try {
        const r = await pool.query(sql, vals);
        const row = r.rows[0];
        if (!row) return null as T;
        const cols = Object.keys(row);
        return (cols.length === 1 && cols[0] === fn ? row[fn] : row) as T;
      } catch (e) {
        throw new StoreError(errorCode(e) === "unknown_error" ? (e as Error).message : errorCode(e));
      }
    },
    async getSetting<T>(key: string) {
      return ((await one<{ value: T }>("select value from settings where key = $1", [key]))?.value ?? null) as T | null;
    },
    async getProduct(id) {
      return (await one("select * from products where id = $1", [id])) ?? null;
    },
    async getProfile(id) {
      return (await one("select * from profiles where id = $1", [id])) ?? null;
    },
    async getOrder(id) {
      return (await one("select * from orders where id = $1", [id])) ?? null;
    },
    async findProxyAccount(userId, productId, provider) {
      return (
        (await one("select * from proxy_accounts where user_id = $1 and product_id = $2 and provider = $3 order by created_at limit 1", [userId, productId, provider])) ??
        null
      );
    },
    async setSetting(key, value) {
      await pool.query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [key, JSON.stringify(value)]);
    },
    async getPortPlan(id) {
      return (await one("select * from port_plans where id = $1", [id])) ?? null;
    },
    async getCountry(code) {
      return (await one("select * from countries where code = $1", [code])) ?? null;
    },
    async getDedicatedPort(id) {
      return (await one("select * from dedicated_ports where id = $1", [id])) ?? null;
    },
    async findDedicatedPort(by) {
      return "rotateToken" in by
        ? ((await one("select * from dedicated_ports where rotate_token = $1", [by.rotateToken])) ?? null)
        : ((await one("select * from dedicated_ports where provider = $1 and external_id = $2", [by.provider, by.externalId])) ?? null);
    },
    async getProviderCustomer(userId, provider) {
      return (await one<{ external_id: string }>("select external_id from provider_customers where user_id = $1 and provider = $2", [userId, provider]))?.external_id ?? null;
    },
  };
}

export async function createUser(pool: pg.Pool, email: string, tos = true): Promise<string> {
  const r = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
    email,
    JSON.stringify(tos ? { tos_accepted: "true" } : {}),
  ]);
  return r.rows[0].id;
}

export async function balance(pool: pg.Pool, userId: string): Promise<number> {
  return Number((await pool.query("select balance_kobo from profiles where id = $1", [userId])).rows[0].balance_kobo);
}
