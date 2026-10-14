import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const s = await requireUser();
  const nav = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/buy", label: "Buy GB" },
    { href: "/dashboard/ports", label: "Daily ports" },
    { href: "/dashboard/wallet", label: "Wallet" },
    { href: "/dashboard/orders", label: "Orders" },
    ...(s.isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <AppShell nav={nav} email={s.email}>
      {children}
    </AppShell>
  );
}
