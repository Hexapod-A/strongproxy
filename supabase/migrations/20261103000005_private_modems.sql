-- StrongProxy migration 5: PRIVATE MODEMS (Proxies.sx "Private modems" product).
--
-- A private modem is one whole 4G/5G carrier modem rented to ONE customer for a day, a week or a month, with
-- unlimited traffic. It is paid from John's Proxies.sx balance (their retail catalog price), and the customer pays
-- John's own price from the StrongProxy wallet in naira (USD price x the admin's NGN-per-USD rate).
--
-- Flow (src/lib/services/modems.ts):
--   buy:   live catalog -> margin guard -> place_modem_order (wallet debit + order 'processing', one transaction)
--          -> POST /v1/private-modems/orders {tariffId, expectedPriceUsd} (Idempotency-Key = our order id)
--          -> poll GET /v1/private-modems/mine -> fulfil_modem_order stores host:port:user:pass
--          -> any failure -> fail_and_refund_order (existing) + admin alert.
--   renew: same with POST /v1/private-modems/:id/renew -> fulfil_modem_renewal.
--
-- Run once in the Supabase SQL editor (after migrations 1-4). Safe to re-run.

-- 1. Rented modems
create table if not exists public.private_modems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'proxies_sx',
  external_id text not null,                              -- Proxies.sx modem id (m_...)
  order_id uuid,                                          -- the order that created it
  country_code text not null,                             -- lower-case ISO code (gb, de, us ...)
  country_name text,
  carrier_name text,
  period text not null check (period in ('day', 'week', 'month')),
  http_host text,
  http_port integer,
  http_username text,
  http_password text,
  socks_host text,
  socks_port integer,
  socks_username text,
  socks_password text,
  rotate_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status text not null default 'active' check (status in ('active', 'expired', 'dead', 'replaced', 'cancelled')),
  online boolean,
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists private_modems_user_idx on public.private_modems (user_id, expires_at desc);

-- 2. Orders can carry a private modem (kind 'modem' / 'modem_renewal')
alter table public.orders add column if not exists modem_period text;
alter table public.orders add column if not exists modem_country text;          -- lower-case ISO code
alter table public.orders add column if not exists modem_country_name text;
alter table public.orders add column if not exists modem_carrier text;
alter table public.orders add column if not exists modem_tariff_id text;        -- Proxies.sx tariffId (buy only)
alter table public.orders add column if not exists modem_price_usd numeric(10, 2); -- John's sell price in USD
alter table public.orders add column if not exists modem_cost_usd numeric(10, 2);  -- Proxies.sx price (expectedPriceUsd)
alter table public.orders add column if not exists private_modem_id uuid references public.private_modems (id);
alter table public.orders add column if not exists upstream_order_id text;      -- Proxies.sx order id (o_...)

alter table public.orders drop constraint if exists orders_kind_check;
alter table public.orders add constraint orders_kind_check
  check (kind in ('gb', 'port', 'port_renewal', 'modem', 'modem_renewal'));
alter table public.orders drop constraint if exists orders_kind_shape;
alter table public.orders add constraint orders_kind_shape
  check ((kind = 'gb' and product_id is not null)
      or (kind in ('port', 'port_renewal') and port_plan_id is not null)
      or (kind in ('modem', 'modem_renewal') and modem_period is not null));
create index if not exists orders_open_modem_idx on public.orders (status, created_at) where kind in ('modem', 'modem_renewal');

-- 3. RLS: customers read their own modems; every write goes through the functions below.
alter table public.private_modems enable row level security;
drop policy if exists "own modems" on public.private_modems;
create policy "own modems" on public.private_modems for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.private_modems from anon, authenticated;

-- 4. Buy or renew from the wallet: debit + order ('processing') in one transaction.
--    Prices are worked out by the server from the admin's settings and the live Proxies.sx catalog; this function
--    refuses anything that would sell at or below cost, so a bug upstream can never sell at a loss.
create or replace function public.place_modem_order(
  p_user_id uuid, p_country_code text, p_country_name text, p_carrier text, p_period text,
  p_price_kobo bigint, p_price_usd numeric, p_cost_usd numeric, p_tariff_id text default null, p_modem_id uuid default null
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_modem public.private_modems%rowtype;
  v_order public.orders%rowtype;
  v_kind text;
  v_cc text := lower(p_country_code);
  v_cn text := p_country_name;
  v_carrier text := p_carrier;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;
  if v_profile.is_banned then raise exception 'user_banned' using errcode = 'P0001'; end if;

  if coalesce((select value #>> '{}' from public.settings where key = 'modems_enabled'), 'true') <> 'true' then
    raise exception 'product_unavailable' using errcode = 'P0001';
  end if;
  if p_period is null or p_period not in ('day', 'week', 'month') then
    raise exception 'plan_unavailable' using errcode = 'P0001';
  end if;
  if p_price_kobo is null or p_price_kobo <= 0 or p_price_usd is null or p_cost_usd is null or p_cost_usd <= 0
     or p_cost_usd >= p_price_usd then
    raise exception 'plan_unavailable' using errcode = 'P0001';
  end if;

  if p_modem_id is null then
    v_kind := 'modem';
    if v_cc is null or v_cc !~ '^[a-z]{2}$' or p_tariff_id is null then
      raise exception 'plan_unavailable' using errcode = 'P0001';
    end if;
  else
    v_kind := 'modem_renewal';
    select * into v_modem from public.private_modems where id = p_modem_id and user_id = p_user_id for update;
    if not found then raise exception 'modem_not_found' using errcode = 'P0002'; end if;
    if v_modem.status <> 'active' or v_modem.expires_at <= now() then
      raise exception 'modem_not_renewable' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.orders where private_modem_id = p_modem_id and kind = 'modem_renewal' and status = 'processing') then
      raise exception 'renewal_in_progress' using errcode = 'P0001';
    end if;
    v_cc := v_modem.country_code;
    v_cn := v_modem.country_name;
    v_carrier := v_modem.carrier_name;
  end if;

  insert into public.orders (user_id, product_id, country_code, quantity_gb, unit_price_kobo, total_kobo, status, provider,
                             kind, modem_period, modem_country, modem_country_name, modem_carrier, modem_tariff_id,
                             modem_price_usd, modem_cost_usd, private_modem_id)
  values (p_user_id, null, null, 0, p_price_kobo, p_price_kobo, 'processing', 'proxies_sx',
          v_kind, p_period, v_cc, v_cn, v_carrier, p_tariff_id, p_price_usd, p_cost_usd, p_modem_id)
  returning * into v_order;

  perform public._wallet_apply(p_user_id, -p_price_kobo, 'purchase', v_order.id::text,
                               case when v_kind = 'modem' then 'Private modem ' else 'Private modem renewal ' end
                               || upper(v_cc) || coalesce(' ' || v_carrier, '') || ' · 1 ' || p_period, null);
  return v_order;
end;
$$;

-- 5. Remember the Proxies.sx order id as soon as it exists (lets a slow setup be finished later).
create or replace function public.set_modem_upstream_order(p_order_id uuid, p_upstream_order_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders set upstream_order_id = p_upstream_order_id
   where id = p_order_id and kind in ('modem', 'modem_renewal') and status = 'processing';
$$;

-- 6. Modem delivered: store it and mark the order fulfilled.
create or replace function public.fulfil_modem_order(
  p_order_id uuid, p_external_id text, p_expires_at timestamptz,
  p_http_host text, p_http_port integer, p_http_username text, p_http_password text,
  p_socks_host text, p_socks_port integer, p_socks_username text, p_socks_password text,
  p_country_name text default null, p_carrier text default null, p_online boolean default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_modem uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_order.status <> 'processing' or v_order.kind <> 'modem' then
    raise exception 'order_not_fulfillable' using errcode = 'P0001';
  end if;
  insert into public.private_modems (user_id, provider, external_id, order_id, country_code, country_name, carrier_name, period,
                                     http_host, http_port, http_username, http_password,
                                     socks_host, socks_port, socks_username, socks_password,
                                     online, expires_at, last_synced_at)
  values (v_order.user_id, 'proxies_sx', p_external_id, v_order.id, v_order.modem_country,
          coalesce(p_country_name, v_order.modem_country_name), coalesce(p_carrier, v_order.modem_carrier), v_order.modem_period,
          p_http_host, p_http_port, p_http_username, p_http_password,
          p_socks_host, p_socks_port, p_socks_username, p_socks_password,
          p_online, p_expires_at, now())
  returning id into v_modem;
  update public.orders set status = 'fulfilled', private_modem_id = v_modem, fulfilled_at = now(), failure_reason = null
   where id = p_order_id;
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'modem.create', p_order_id::text, jsonb_build_object('modem', v_modem, 'external_id', p_external_id));
  return v_modem;
end;
$$;

-- 7. Renewal delivered: push the expiry.
create or replace function public.fulfil_modem_renewal(p_order_id uuid, p_expires_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_order.status <> 'processing' or v_order.kind <> 'modem_renewal' then
    raise exception 'order_not_fulfillable' using errcode = 'P0001';
  end if;
  update public.private_modems
     set expires_at = greatest(expires_at, p_expires_at), status = 'active', last_synced_at = now(), updated_at = now()
   where id = v_order.private_modem_id;
  update public.orders set status = 'fulfilled', fulfilled_at = now(), failure_reason = null where id = p_order_id;
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'modem.renew', p_order_id::text, jsonb_build_object('modem', v_order.private_modem_id, 'expires_at', p_expires_at));
  return v_order.private_modem_id;
end;
$$;

-- 8. Keep our copy in step with Proxies.sx (expiry, status, online, replaced credentials, rotation time).
create or replace function public.sync_private_modem(
  p_id uuid, p_status text default null, p_expires_at timestamptz default null, p_online boolean default null,
  p_rotated boolean default false, p_creds jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.private_modems
     set status = coalesce(p_status, status),
         expires_at = coalesce(p_expires_at, expires_at),
         online = coalesce(p_online, online),
         last_rotated_at = case when p_rotated then now() else last_rotated_at end,
         http_host = coalesce(p_creds->>'http_host', http_host),
         http_port = coalesce((p_creds->>'http_port')::int, http_port),
         http_username = coalesce(p_creds->>'http_username', http_username),
         http_password = coalesce(p_creds->>'http_password', http_password),
         socks_host = coalesce(p_creds->>'socks_host', socks_host),
         socks_port = coalesce((p_creds->>'socks_port')::int, socks_port),
         socks_username = coalesce(p_creds->>'socks_username', socks_username),
         socks_password = coalesce(p_creds->>'socks_password', socks_password),
         last_synced_at = case when p_rotated then last_synced_at else now() end,
         updated_at = now()
   where id = p_id;
end;
$$;

-- 9. Public prices for the pricing pages (anon can't read settings directly). Only John's sell prices; never costs.
create or replace function public.public_modem_pricing()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', coalesce((select value from public.settings where key = 'modems_enabled'), 'true'::jsonb),
    'prices', coalesce((select value from public.settings where key = 'modem_prices_usd'), '{"day":10,"week":30,"month":115}'::jsonb),
    'rate', coalesce((select value from public.settings where key = 'usd_ngn_rate'), '1600'::jsonb),
    'minMargin', coalesce((select value from public.settings where key = 'modem_min_margin_usd'), '0'::jsonb),
    'overrides', coalesce((select value from public.settings where key = 'modem_line_overrides'), '{}'::jsonb)
  );
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.place_modem_order(uuid,text,text,text,text,bigint,numeric,numeric,text,uuid)',
    'public.set_modem_upstream_order(uuid,text)',
    'public.fulfil_modem_order(uuid,text,timestamptz,text,integer,text,text,text,integer,text,text,text,text,boolean)',
    'public.fulfil_modem_renewal(uuid,timestamptz)',
    'public.sync_private_modem(uuid,text,timestamptz,boolean,boolean,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
grant execute on function public.public_modem_pricing() to anon, authenticated;

-- 10. Default settings (John's prices, Nov 3 2026: $10/day, $30/week, $115/month). Edit them in Admin > Private modems.
insert into public.settings (key, value) values
  ('modems_enabled', 'true'),
  ('modem_prices_usd', '{"day": 10, "week": 30, "month": 115}'),
  ('modem_min_margin_usd', '0'),
  ('modem_line_overrides', '{}')
on conflict (key) do nothing;
