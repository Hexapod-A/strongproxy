import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { SignupForm } from "./SignupForm";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Fund your wallet and buy proxies in a few minutes."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-ink underline underline-offset-2">Log in</Link></>}
    >
      <SignupForm />
    </AuthShell>
  );
}
