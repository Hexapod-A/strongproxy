import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { SubmitButton } from "@/components/SubmitButton";
import { formatNaira } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { adjustBalanceAction, setBanAction } from "../actions";

export const metadata = { title: "Users · Admin" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const db = createAdminClient();
  let query = db.from("profiles").select("*").order("created_at", { ascending: false }).limit(50);
  const term = q.trim().replace(/[%,()]/g, "");
  if (term) query = query.ilike("email", `%${term}%`);
  const { data } = await query;
  const users = (data ?? []) as Profile[];

  return (
    <>
      <PageTitle title="Users" subtitle="Credit, debit or ban. Every change is written to the audit log." />
      <form className="mb-6 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by email" className="input h-10 max-w-sm" />
        <button className="btn-ghost btn-sm h-10">Search</button>
      </form>
      <div className="space-y-3">
        {users.map((u) => (
          <details key={u.id} className="card group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{u.email}</p>
                <p className="text-xs text-muted">
                  Joined {new Date(u.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}
                  {u.tos_accepted_at ? " · ToS accepted" : " · ToS not recorded"}
                  {u.role === "admin" ? " · admin" : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {u.is_banned && <span className="pill bg-danger-bg text-danger">Banned</span>}
                <span className="font-mono text-sm">{formatNaira(u.balance_kobo)}</span>
                <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
              </div>
            </summary>
            <div className="grid gap-6 border-t border-line p-5 md:grid-cols-2">
              <ActionForm action={adjustBalanceAction}>
                <input type="hidden" name="user_id" value={u.id} />
                <p className="mb-2 text-sm font-medium">Credit or debit wallet</p>
                <div className="flex gap-2">
                  <input name="amount" type="number" step="0.01" placeholder="₦ (negative to debit)" required className="input h-10 w-40" />
                  <input name="note" placeholder="Reason" required className="input h-10" />
                </div>
                <SubmitButton className="btn-primary btn-sm mt-2">Apply</SubmitButton>
              </ActionForm>
              <ActionForm action={setBanAction}>
                <input type="hidden" name="user_id" value={u.id} />
                <input type="hidden" name="ban" value={u.is_banned ? "false" : "true"} />
                <p className="mb-2 text-sm font-medium">{u.is_banned ? "Lift ban" : "Ban user"}</p>
                {u.is_banned ? (
                  <p className="mb-2 text-sm text-muted">Reason: {u.banned_reason ?? "—"}</p>
                ) : (
                  <input name="reason" placeholder="Reason (e.g. abuse report from provider)" className="input h-10" />
                )}
                <SubmitButton className={`${u.is_banned ? "btn-ghost" : "btn bg-danger text-white hover:opacity-90"} btn-sm mt-2`}>
                  {u.is_banned ? "Unban" : "Ban and block proxies"}
                </SubmitButton>
              </ActionForm>
            </div>
          </details>
        ))}
        {users.length === 0 && <div className="card p-8 text-sm text-muted">No users found.</div>}
      </div>
    </>
  );
}
