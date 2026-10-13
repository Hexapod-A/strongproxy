import { AuthShell } from "@/components/AuthShell";
import { logOut } from "../(auth)/actions";

export const metadata = { title: "Account suspended" };

export default function Banned() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <AuthShell
      title="Your account is suspended"
      subtitle="This account broke our Terms or Acceptable Use Policy, or was reported for abuse."
      footer={<>If you think this is a mistake, email <a className="underline" href={`mailto:${email}`}>{email}</a>.</>}
    >
      <form action={logOut}>
        <button className="btn-ghost w-full">Log out</button>
      </form>
    </AuthShell>
  );
}
