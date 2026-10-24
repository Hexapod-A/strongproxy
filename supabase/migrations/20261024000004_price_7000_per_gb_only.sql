-- Oct 24 2026: one price for every Proxies.sx per-GB product: N7,000 per GB (700000 kobo).
-- seed.sql uses "on conflict do nothing", so a database seeded earlier keeps its old prices until this runs.
-- Run it once in the Supabase SQL editor. You can still change prices later in Admin > Prices & countries.
update public.products set price_per_gb_kobo = 700000 where id in ('mobile', 'residential');

-- Per-GB only: switch daily ports off in the database too (the site code also hides them).
update public.settings set value = 'false'::jsonb where key = 'ports_enabled';
