import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";
import { DAILY_PORTS_ENABLED } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireAdmin();
  const nav = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/catalog", label: "Prices & countries" },
    ...(DAILY_PORTS_ENABLED ? [{ href: "/admin/ports", label: "Daily ports" }] : []),
    { href: "/dashboard", label: "← Customer view" },
  ];
  return (
    <AppShell nav={nav} email={s.email} badge={<span className="pill bg-lime text-ink">Admin</span>}>
      {children}
    </AppShell>
  );
}
