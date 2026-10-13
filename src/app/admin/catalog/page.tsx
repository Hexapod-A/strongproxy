import { ActionForm } from "@/components/ActionForm";
import { PageTitle } from "@/components/PageTitle";
import { SubmitButton } from "@/components/SubmitButton";
import { createAdminClient } from "@/lib/supabase/server";
import type { Country, Product } from "@/lib/types";
import { updateProductAction, upsertCountryAction } from "../actions";

export const metadata = { title: "Prices & countries · Admin" };

export default async function Catalog() {
  const db = createAdminClient();
  const [{ data: products }, { data: countries }] = await Promise.all([
    db.from("products").select("*").order("sort_order"),
    db.from("countries").select("*").order("sort_order"),
  ]);

  return (
    <>
      <PageTitle title="Prices & countries" subtitle="Changes show on the site within a few minutes. Existing orders keep the price they were bought at." />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Products</h2>
        <div className="space-y-3">
          {((products ?? []) as Product[]).map((p) => (
            <ActionForm key={p.id} action={updateProductAction} className="card p-5">
              <input type="hidden" name="id" value={p.id} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_2fr_1fr_0.6fr_0.6fr_auto] md:items-end">
                <div>
                  <label className="label">Name</label>
                  <input name="name" defaultValue={p.name} className="input h-10" />
                </div>
                <div className="col-span-2 md:col-span-1">
                  <label className="label">Description</label>
                  <input name="description" defaultValue={p.description} className="input h-10" />
                </div>
                <div>
                  <label className="label">₦ per GB</label>
                  <input name="price" type="number" step="1" defaultValue={p.price_per_gb_kobo / 100} className="input h-10 font-mono" />
                </div>
                <div>
                  <label className="label">Min GB</label>
                  <input name="min_gb" type="number" defaultValue={p.min_gb} className="input h-10" />
                </div>
                <div>
                  <label className="label">Max GB</label>
                  <input name="max_gb" type="number" defaultValue={p.max_gb} className="input h-10" />
                </div>
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={p.is_active} className="h-4 w-4 accent-[#0e0f0c]" /> On sale
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-xs text-muted">id: {p.id} · upstream pool: {p.provider_pool}</span>
                <SubmitButton className="btn-primary btn-sm">Save</SubmitButton>
              </div>
            </ActionForm>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">To add a new product type (e.g. datacenter), insert a row into the products table; see the README.</p>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium text-muted">Countries</h2>
        <div className="card divide-y divide-line">
          {((countries ?? []) as Country[]).map((c) => (
            <ActionForm key={c.code} action={upsertCountryAction} className="px-4 py-3">
              <input type="hidden" name="code" value={c.code} />
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-8 font-mono text-sm uppercase text-muted">{c.code}</span>
                <input name="name" defaultValue={c.name} className="input h-9 min-w-0 flex-1 sm:max-w-xs" />
                <input name="sort_order" type="number" defaultValue={c.sort_order} className="input h-9 w-20" aria-label="Sort order" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={c.is_active} className="h-4 w-4 accent-[#0e0f0c]" /> Active
                </label>
                <SubmitButton className="btn-ghost btn-sm ml-auto">Save</SubmitButton>
              </div>
            </ActionForm>
          ))}
          <ActionForm action={upsertCountryAction} className="bg-paper/60 px-4 py-4">
            <p className="mb-2 text-sm font-medium">Add a country</p>
            <div className="flex flex-wrap items-center gap-3">
              <input name="code" placeholder="it" maxLength={2} className="input h-9 w-16 font-mono lowercase" required />
              <input name="name" placeholder="Italy" className="input h-9 min-w-0 flex-1 sm:max-w-xs" required />
              <input name="sort_order" type="number" defaultValue={100} className="input h-9 w-20" aria-label="Sort order" />
              <input type="hidden" name="is_active" value="on" />
              <SubmitButton className="btn-primary btn-sm ml-auto">Add</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </section>
    </>
  );
}
