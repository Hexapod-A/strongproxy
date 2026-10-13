"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "../actions";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function SignupForm() {
  const [state, action] = useActionState(signUp, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="full_name">Name <span className="font-normal text-muted">(optional)</span></label>
        <input id="full_name" name="full_name" className="input" autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required minLength={8} className="input" autoComplete="new-password" />
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-line bg-card p-3 text-sm text-ink-2">
        <input type="checkbox" name="tos" required className="mt-0.5 h-4 w-4 accent-[#0e0f0c]" />
        <span>
          I agree to the <Link href="/terms" className="underline underline-offset-2" target="_blank">Terms of Service</Link> and the{" "}
          <Link href="/acceptable-use" className="underline underline-offset-2" target="_blank">Acceptable Use Policy</Link>. No fraud,
          carding, spam or account-creation abuse.
        </span>
      </label>
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
    </form>
  );
}
