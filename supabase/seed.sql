-- Seed: products, countries, default settings. Safe to re-run.
-- provider: proxies_sx (default) or dataimpulse; switch per product in Admin > Catalog.
insert into public.products (id, name, description, price_per_gb_kobo, provider_pool, provider, min_gb, max_gb, is_active, sort_order) values
  ('mobile', 'Mobile', 'Real 4G/5G carrier IPs. Highest trust for social and app traffic.', 700000, 'mobile', 'proxies_sx', 1, 100, true, 1),
  ('residential', 'Residential', 'Home ISP IPs in the country you pick. Rotating or sticky.', 700000, 'residential', 'proxies_sx', 1, 500, true, 2),
  ('datacenter', 'Datacenter', 'Fast, cheap IPs for bulk scraping. Coming soon.', 300000, 'datacenter', 'dataimpulse', 1, 1000, false, 3)
on conflict (id) do nothing;

insert into public.countries (code, name, sort_order) values
  ('us', 'United States', 1),
  ('gb', 'United Kingdom', 2),
  ('ca', 'Canada', 3),
  ('au', 'Australia', 4),
  ('de', 'Germany', 5),
  ('fr', 'France', 6),
  ('es', 'Spain', 7),
  ('nl', 'Netherlands', 8),
  ('no', 'Norway', 9)
on conflict (code) do nothing;

insert into public.settings (key, value) values
  ('min_topup_kobo', '100000'),
  ('usd_ngn_rate', '1600')
on conflict (key) do nothing;
