"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { adminStore, clientIp } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { rateLimit } from "@/lib/services/ratelimit";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string } | undefined;

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  full_name: z.string().trim().max(80).optional(),
  tos: z.literal("on", { message: "You need to accept the Terms and Acceptable Use Policy." }),
});

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    full_name: form.get("full_name") || undefined,
    tos: form.get("tos") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const ip = await clientIp();
  if (!(await rateLimit(adminStore(), `signup:${ip}`, 3600, 5))) {
    return { error: "Too many sign-ups from your network. Try again in an hour." };
  }

  const sb = await createClient();
  const { data, error } = await sb.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback`,
      data: { full_name: parsed.data.full_name ?? null, tos_accepted: "true" },
    },
  });
  if (error) return { error: error.message };
  if (!data.session) return { message: "Check your email to confirm your account, then log in." };
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const ip = await clientIp();
  if (!(await rateLimit(adminStore(), `login:${ip}`, 900, 20))) {
    return { error: "Too many attempts. Wait 15 minutes and try again." };
  }
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password." };
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logOut() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/");
}
