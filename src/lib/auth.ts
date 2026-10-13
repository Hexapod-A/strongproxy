import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { adminEmails } from "@/lib/env";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { supabaseStore, type Store } from "@/lib/store";
import type { Profile } from "@/lib/types";

export type Session = { userId: string; email: string; profile: Profile; isAdmin: boolean };

export async function getSession(): Promise<Session | null> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return null;
  const email = (user.email ?? "").toLowerCase();
  const isAdmin = profile.role === "admin" || adminEmails().includes(email);
  return { userId: user.id, email, profile: profile as Profile, isAdmin };
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.profile.is_banned) redirect("/banned");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireUser();
  if (!s.isAdmin) redirect("/dashboard");
  return s;
}

export function adminStore(): Store {
  return supabaseStore(createAdminClient());
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}
