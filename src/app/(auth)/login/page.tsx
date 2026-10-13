import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your StrongProxy account."
      footer={<>New here? <Link href="/signup" className="font-medium text-ink underline underline-offset-2">Create an account</Link></>}
    >
      <LoginForm next={next} />
    </AuthShell>
  );
}
