import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSbClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from "@/lib/env";

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/** Per-request client acting as the signed-in user (RLS applies). */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl()!, supabaseAnonKey()!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
/** Service-role client. Server only. Bypasses RLS; used for writes via the SQL functions. */
export function createAdminClient(): SupabaseClient {
  if (!admin) {
    const key = supabaseServiceKey();
    if (!supabaseUrl() || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing");
    admin = createSbClient(supabaseUrl()!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

/** Anonymous client without cookies, for public reads (prices, countries). */
export function createPublicClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  return createSbClient(supabaseUrl()!, supabaseAnonKey()!, { auth: { persistSession: false } });
}
