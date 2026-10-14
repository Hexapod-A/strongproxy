-- StrongProxy migration 3: per-day dedicated mobile ports (Proxies.sx reseller ports API) + low-balance auto-pause.
--
-- A "daily port" is one dedicated Proxies.sx mobile port rented for N days (plans: 1, 7, 30 days). The wallet is
-- charged, the port is created instantly through POST /reseller/ports, and the customer gets
-- server_ip:port:login:password plus a rotate button/link. Renewals extend the same port from the wallet before it
-- expires. Failures refund the wallet atomically with the existing fail_and_refund_order().
--
-- Pricing note (read 2026-10-14 from proxies.sx/pricing + /v1/reseller/docs/llm): Proxies.sx bills traffic at $4/GB
-- (volume-discounted) and says ports/endpoints are free. Each plan therefore carries a data allowance (traffic_gb,
-- 0 = no cap) that we push to Proxies.sx as the customer's traffic quota.

-- 1. Plans (admin-editable prices, allowance, on/off)
create table if not exists public.port_plans (
  id text primary key,                                   -- '1d', '7d', '30d'
  name text not null,
  days integer not null check (days between 1 and 365),
  price_kobo bigint not null check (price_kobo > 0),
  traffic_gb integer not null default 0 check (traffic_gb >= 0),   -- data allowance per purchase; 0 = no cap
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 2. Countries: per-country switch for daily ports + optional manual Proxies.sx countryId
alter table public.countries add column if not exists ports_enabled boolean not null default true;
alter table public.countries add column if not exists psx_country_id text;
comment on column public.countries.psx_country_id is
  'Proxies.sx countryId for POST /reseller/ports. Leave empty to resolve it from their live country list by ISO code.';

-- 3. Our user -> upstream customer (Proxies.sx sub-account) mapping
create table if not exists public.provider_customers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- 4. Rented ports
create table if not exists public.dedicated_ports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'proxies_sx',
  external_id text not null,                              -- Proxies.sx port _id
  country_code text references public.countries (code),
  plan_id text references public.port_plans (id),
  protocol text not null default 'http' check (protocol in ('http', 'socks5')),
  server_ip text not null,
  http_port integer,
  socks_port integer,
  username text not null,
  password text not null,
  display_name text,
  traffic_gb integer not null default 0,
  rotate_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted', 'expired')),
  expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists dedicated_ports_user_idx on public.dedicated_ports (user_id, expires_at desc);

-- 5. Orders carry either GB (kind 'gb') or a port plan (kind 'port' / 'port_renewal')
alter table public.orders alter column product_id drop not null;
alter table public.orders drop constraint if exists orders_quantity_gb_check;
alter table public.orders add constraint orders_quantity_gb_check check (quantity_gb >= 0);
alter table public.orders add column if not exists kind text not null default 'gb';
alter table public.orders drop constraint if exists orders_kind_check;
alter table public.orders add constraint orders_kind_check check (kind in ('gb', 'port', 'port_renewal'));
alter table public.orders add column if not exists port_plan_id text references public.port_plans (id);
alter table public.orders add column if not exists port_days integer;
alter table public.orders add column if not exists port_protocol text;
alter table public.orders add column if not exists dedicated_port_id uuid references public.dedicated_ports (id);
alter table public.orders drop constraint if exists orders_kind_shape;
alter table public.orders add constraint orders_kind_shape
  check ((kind = 'gb' and product_id is not null) or (kind <> 'gb' and port_plan_id is not null));

-- 6. RLS
alter table public.port_plans enable row level security;
alter table public.provider_customers enable row level security;
alter table public.dedicated_ports enable row level security;
drop policy if exists "public port plans" on public.port_plans;
create policy "public port plans" on public.port_plans for select to anon, authenticated using (is_active);
drop policy if exists "own ports" on public.dedicated_ports;
create policy "own ports" on public.dedicated_ports for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.port_plans, public.provider_customers, public.dedicated_ports from anon, authenticated;
revoke select on public.provider_customers from anon, authenticated;

-- 7. Buy or renew a port from the wallet: debit + order ('processing') in one transaction. The app then calls
--    Proxies.sx and either fulfil_port_order()/fulfil_port_renewal() or fail_and_refund_order().
create or replace function public.place_port_order(
  p_user_id uuid, p_plan_id text, p_country_code text, p_protocol text, p_port_id uuid default null
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_plan public.port_plans%rowtype;
  v_port public.dedicated_ports%rowtype;
  v_order public.orders%rowtype;
  v_country text;
  v_protocol text;
  v_kind text;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;
  if v_profile.is_banned then raise exception 'user_banned' using errcode = 'P0001'; end if;

  if coalesce((select value #>> '{}' from public.settings where key = 'ports_enabled'), 'true') <> 'true' then
    raise exception 'product_unavailable' using errcode = 'P0001';
  end if;

  select * into v_plan from public.port_plans where id = p_plan_id and is_active;
  if not found then raise exception 'plan_unavailable' using errcode = 'P0001'; end if;

  if p_port_id is null then
    v_kind := 'port';
    v_country := p_country_code;
    v_protocol := p_protocol;
    if v_country is null or not exists (
      select 1 from public.countries where code = v_country and is_active and ports_enabled
    ) then
      raise exception 'country_unavailable' using errcode = 'P0001';
    end if;
    if v_protocol is null or v_protocol not in ('http', 'socks5') then
      raise exception 'invalid_protocol' using errcode = 'P0001';
    end if;
  else
    v_kind := 'port_renewal';
    select * into v_port from public.dedicated_ports where id = p_port_id and user_id = p_user_id for update;
    if not found then raise exception 'port_not_found' using errcode = 'P0002'; end if;
    if v_port.status <> 'active' or v_port.expires_at <= now() then
      raise exception 'port_not_renewable' using errcode = 'P0001';
    end if;
    v_country := v_port.country_code;
    v_protocol := v_port.protocol;
  end if;

  insert into public.orders (user_id, product_id, country_code, quantity_gb, unit_price_kobo, total_kobo, status, provider,
                             kind, port_plan_id, port_days, port_protocol, dedicated_port_id)
  values (p_user_id, null, v_country, v_plan.traffic_gb, v_plan.price_kobo, v_plan.price_kobo, 'processing', 'proxies_sx',
          v_kind, v_plan.id, v_plan.days, v_protocol, p_port_id)
  returning * into v_order;

  perform public._wallet_apply(p_user_id, -v_plan.price_kobo, 'purchase', v_order.id::text,
                               case when v_kind = 'port' then 'Daily port ' else 'Port renewal ' end
                               || v_plan.name || ' ' || upper(coalesce(v_country, '')), null);
  return v_order;
end;
$$;

-- 8. Store the new port and mark the order delivered.
create or replace function public.fulfil_port_order(
  p_order_id uuid, p_external_id text, p_server_ip text, p_http_port integer, p_socks_port integer,
  p_username text, p_password text, p_display_name text, p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_port uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_order.status <> 'processing' or v_order.kind <> 'port' then
    raise exception 'order_not_fulfillable' using errcode = 'P0001';
  end if;
  insert into public.dedicated_ports (user_id, provider, external_id, country_code, plan_id, protocol, server_ip,
                                      http_port, socks_port, username, password, display_name, traffic_gb,
                                      expires_at, last_synced_at)
  values (v_order.user_id, 'proxies_sx', p_external_id, v_order.country_code, v_order.port_plan_id,
          coalesce(v_order.port_protocol, 'http'), p_server_ip, p_http_port, p_socks_port, p_username, p_password,
          p_display_name, v_order.quantity_gb, p_expires_at, now())
  returning id into v_port;
  update public.orders set status = 'fulfilled', dedicated_port_id = v_port, fulfilled_at = now(), failure_reason = null
   where id = p_order_id;
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'port.create', p_order_id::text, jsonb_build_object('port', v_port, 'external_id', p_external_id));
  return v_port;
end;
$$;

-- 9. Renewal delivered: push the expiry, add the plan's allowance.
create or replace function public.fulfil_port_renewal(p_order_id uuid, p_expires_at timestamptz)
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
  if v_order.status <> 'processing' or v_order.kind <> 'port_renewal' then
    raise exception 'order_not_fulfillable' using errcode = 'P0001';
  end if;
  update public.dedicated_ports
     set expires_at = p_expires_at, traffic_gb = traffic_gb + v_order.quantity_gb, plan_id = v_order.port_plan_id,
         status = 'active', last_synced_at = now(), updated_at = now()
   where id = v_order.dedicated_port_id;
  update public.orders set status = 'fulfilled', fulfilled_at = now(), failure_reason = null where id = p_order_id;
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'port.renew', p_order_id::text, jsonb_build_object('port', v_order.dedicated_port_id, 'expires_at', p_expires_at));
  return v_order.dedicated_port_id;
end;
$$;

-- 10. Small writers used by the sync/webhook code.
create or replace function public.set_provider_customer(p_user_id uuid, p_provider text, p_external_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.provider_customers (user_id, provider, external_id) values (p_user_id, p_provider, p_external_id)
  on conflict (user_id, provider) do update set external_id = excluded.external_id;
$$;

create or replace function public.sync_port(p_port_id uuid, p_status text, p_expires_at timestamptz, p_rotated boolean default false)
returns void
language sql
security definer
set search_path = public
as $$
  update public.dedicated_ports
     set status = coalesce(p_status, status),
         expires_at = coalesce(p_expires_at, expires_at),
         last_synced_at = now(),
         last_rotated_at = case when p_rotated then now() else last_rotated_at end,
         updated_at = now()
   where id = p_port_id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.place_port_order(uuid,text,text,text,uuid)',
    'public.fulfil_port_order(uuid,text,text,integer,integer,text,text,text,timestamptz)',
    'public.fulfil_port_renewal(uuid,timestamptz)',
    'public.set_provider_customer(uuid,text,text)',
    'public.sync_port(uuid,text,timestamptz,boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- 11. Seeds. Prices = ~2x the Proxies.sx traffic cost of the allowance ($4/GB x 2 x N1,330/$), admin-editable.
insert into public.port_plans (id, name, days, price_kobo, traffic_gb, is_active, sort_order) values
  ('1d', '1 day', 1, 2128000, 2, true, 1),
  ('7d', '7 days', 7, 10640000, 10, true, 2),
  ('30d', '30 days', 30, 31920000, 30, true, 3)
on conflict (id) do nothing;

insert into public.settings (key, value) values
  ('ports_enabled', 'true'),
  ('port_usd_ngn_rate', '1330'),             -- rate used for the suggested naira prices in Admin > Daily ports
  ('psx_cost_usd_per_gb', '4'),              -- Proxies.sx traffic price (their public pricing, 2026-10-14)
  ('psx_port_cost_usd_per_day', '0'),        -- set this if calculate-price shows a per-day port charge for your account
  ('psx_autopause_enabled', 'true'),         -- pause sales when the Proxies.sx balance is low
  ('psx_autopause_threshold_usd', '5')
on conflict (key) do nothing;
