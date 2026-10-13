-- StrongProxy v1 schema
-- Money is stored in kobo (1 NGN = 100 kobo) as bigint. Traffic is whole GB.
-- All balance-changing logic lives in SECURITY DEFINER functions that only the
-- service role may execute; the Next.js server calls them after authenticating the user.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  is_banned boolean not null default false,
  banned_reason text,
  tos_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Create a profile row whenever Supabase Auth creates a user.
-- tos_accepted_at is read from the signup metadata (the signup form sends tos_accepted=true).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, tos_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    case when (new.raw_user_meta_data ->> 'tos_accepted') = 'true' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalogue: products + countries (admin-editable)
-- ---------------------------------------------------------------------------
create table public.products (
  id text primary key,                         -- 'residential', 'mobile', 'datacenter', ...
  name text not null,
  description text not null default '',
  price_per_gb_kobo bigint not null check (price_per_gb_kobo > 0),
  provider_pool text not null,                 -- pool name sent to the upstream (e.g. DataImpulse pool_type)
  min_gb integer not null default 1 check (min_gb >= 1),
  max_gb integer not null default 100 check (max_gb >= min_gb),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.countries (
  code text primary key check (code ~ '^[a-z]{2}$'),  -- ISO 3166-1 alpha-2, lower case (DataImpulse uses cr.<code>)
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Settings (non-secret). Provider keys are NEVER stored here; they live in env.
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Wallet ledger + payments
-- ---------------------------------------------------------------------------
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo <> 0),   -- + credit, - debit
  balance_after_kobo bigint not null,
  kind text not null check (kind in ('topup', 'purchase', 'refund', 'admin_credit', 'admin_debit')),
  reference text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('paystack', 'nowpayments')),
  reference text not null unique,
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  checkout_url text,
  meta jsonb,
  provider_payload jsonb,
  credited_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_user_idx on public.payments (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Proxy accounts (credentials handed to the customer) + orders
-- ---------------------------------------------------------------------------
create table public.proxy_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id),
  provider text not null,                       -- 'manual', 'dataimpulse', ...
  external_id text,                             -- upstream sub-user id (auto mode)
  host text not null,
  port integer not null,
  username text not null,
  password text not null,
  protocol text not null default 'http',
  sticky_port_start integer,
  sticky_port_end integer,
  traffic_gb_purchased integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proxy_accounts_user_idx on public.proxy_accounts (user_id);
create unique index proxy_accounts_provider_external_idx on public.proxy_accounts (provider, external_id)
  where external_id is not null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id),
  country_code text references public.countries (code),   -- null = any / random
  quantity_gb integer not null check (quantity_gb >= 1),
  unit_price_kobo bigint not null,
  total_kobo bigint not null,
  status text not null default 'pending_fulfilment'
    check (status in ('pending_fulfilment', 'processing', 'fulfilled', 'failed', 'refunded')),
  fulfilment_mode text not null default 'manual' check (fulfilment_mode in ('manual', 'auto')),
  provider text,
  proxy_account_id uuid references public.proxy_accounts (id),
  failure_reason text,
  admin_note text,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at);

-- ---------------------------------------------------------------------------
-- Audit log + rate limiting
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security: customers read their own rows; nobody writes directly.
-- The service role bypasses RLS and is the only writer (via functions below).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.countries enable row level security;
alter table public.settings enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.proxy_accounts enable row level security;
alter table public.orders enable row level security;
alter table public.audit_log enable row level security;
alter table public.rate_limits enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "public products" on public.products for select to anon, authenticated using (is_active);
create policy "public countries" on public.countries for select to anon, authenticated using (is_active);
create policy "own wallet tx" on public.wallet_transactions for select to authenticated using (user_id = auth.uid());
create policy "own payments" on public.payments for select to authenticated using (user_id = auth.uid());
create policy "own proxy accounts" on public.proxy_accounts for select to authenticated using (user_id = auth.uid());
create policy "own orders" on public.orders for select to authenticated using (user_id = auth.uid());
-- settings, audit_log, rate_limits: no policies => no access for anon/authenticated.

revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions (service role only)
-- ---------------------------------------------------------------------------

-- Internal: apply a wallet movement atomically. Raises on insufficient funds.
create or replace function public._wallet_apply(
  p_user_id uuid, p_amount_kobo bigint, p_kind text, p_reference text, p_note text, p_actor uuid
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  select balance_kobo into v_balance from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if v_balance + p_amount_kobo < 0 then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;
  v_balance := v_balance + p_amount_kobo;
  update public.profiles set balance_kobo = v_balance where id = p_user_id;
  insert into public.wallet_transactions (user_id, amount_kobo, balance_after_kobo, kind, reference, note, created_by)
  values (p_user_id, p_amount_kobo, v_balance, p_kind, p_reference, p_note, p_actor);
  return v_balance;
end;
$$;

-- Record a pending top-up before redirecting the customer to the gateway.
create or replace function public.create_payment(
  p_user_id uuid, p_provider text, p_reference text, p_amount_kobo bigint, p_meta jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_banned boolean;
begin
  select is_banned into v_banned from public.profiles where id = p_user_id;
  if v_banned then raise exception 'user_banned' using errcode = 'P0001'; end if;
  insert into public.payments (user_id, provider, reference, amount_kobo, meta)
  values (p_user_id, p_provider, p_reference, p_amount_kobo, p_meta)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_payment_checkout(p_reference text, p_checkout_url text, p_meta jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payments set checkout_url = p_checkout_url, meta = coalesce(meta, '{}'::jsonb) || coalesce(p_meta, '{}'::jsonb)
   where reference = p_reference;
$$;

create or replace function public.payment_meta(p_reference text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('amount_kobo', amount_kobo, 'meta', meta) from public.payments where reference = p_reference;
$$;

-- Called by a verified webhook. Idempotent: crediting the same reference twice is a no-op.
-- p_amount_kobo is the amount the gateway says was paid; it must cover the expected amount.
-- Returns 'credited', 'already_credited', 'amount_mismatch', 'unknown_reference', 'marked_failed'.
create or replace function public.confirm_payment(
  p_reference text, p_provider text, p_paid_amount_kobo bigint, p_success boolean, p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
begin
  select * into v_pay from public.payments where reference = p_reference and provider = p_provider for update;
  if not found then
    return 'unknown_reference';
  end if;
  if v_pay.status = 'success' then
    return 'already_credited';
  end if;
  if not p_success then
    update public.payments set status = 'failed', provider_payload = p_payload where id = v_pay.id;
    return 'marked_failed';
  end if;
  if p_paid_amount_kobo < v_pay.amount_kobo then
    update public.payments set provider_payload = p_payload where id = v_pay.id;
    return 'amount_mismatch';
  end if;
  update public.payments
     set status = 'success', credited_at = now(), provider_payload = p_payload
   where id = v_pay.id;
  perform public._wallet_apply(v_pay.user_id, v_pay.amount_kobo, 'topup', p_reference,
                               p_provider || ' top-up', null);
  return 'credited';
end;
$$;

-- Buy GB from the wallet. Price is always read from the products table (never trusted from the client).
-- Creates the order in 'pending_fulfilment'; the app then fulfils it (auto) or leaves it for the admin queue.
create or replace function public.place_order(
  p_user_id uuid, p_product_id text, p_country_code text, p_quantity_gb integer, p_mode text
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_product public.products%rowtype;
  v_total bigint;
  v_order public.orders%rowtype;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'profile_not_found' using errcode = 'P0002'; end if;
  if v_profile.is_banned then raise exception 'user_banned' using errcode = 'P0001'; end if;

  select * into v_product from public.products where id = p_product_id and is_active;
  if not found then raise exception 'product_unavailable' using errcode = 'P0001'; end if;

  if p_quantity_gb is null or p_quantity_gb < v_product.min_gb or p_quantity_gb > v_product.max_gb then
    raise exception 'invalid_quantity' using errcode = 'P0001';
  end if;

  if p_country_code is not null and not exists (
    select 1 from public.countries where code = p_country_code and is_active
  ) then
    raise exception 'country_unavailable' using errcode = 'P0001';
  end if;

  v_total := v_product.price_per_gb_kobo * p_quantity_gb;

  insert into public.orders (user_id, product_id, country_code, quantity_gb, unit_price_kobo, total_kobo, fulfilment_mode)
  values (p_user_id, p_product_id, p_country_code, p_quantity_gb, v_product.price_per_gb_kobo, v_total,
          case when p_mode = 'auto' then 'auto' else 'manual' end)
  returning * into v_order;

  perform public._wallet_apply(p_user_id, -v_total, 'purchase', v_order.id::text,
                               p_quantity_gb || ' GB ' || v_product.name, null);
  return v_order;
end;
$$;

-- Attach credentials to an order and mark it fulfilled (manual paste or provider result).
-- If p_proxy_account_id is given, the order is attached to that existing account (auto top-up).
create or replace function public.fulfil_order(
  p_order_id uuid,
  p_provider text,
  p_external_id text,
  p_host text, p_port integer, p_username text, p_password text, p_protocol text,
  p_sticky_start integer, p_sticky_end integer,
  p_notes text,
  p_actor uuid,
  p_proxy_account_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_acc uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_order.status not in ('pending_fulfilment', 'processing', 'failed') then
    raise exception 'order_not_fulfillable' using errcode = 'P0001';
  end if;

  if p_proxy_account_id is not null then
    update public.proxy_accounts
       set traffic_gb_purchased = traffic_gb_purchased + v_order.quantity_gb, updated_at = now()
     where id = p_proxy_account_id and user_id = v_order.user_id
     returning id into v_acc;
    if v_acc is null then raise exception 'proxy_account_not_found' using errcode = 'P0002'; end if;
  else
    insert into public.proxy_accounts (user_id, product_id, provider, external_id, host, port, username, password,
                                       protocol, sticky_port_start, sticky_port_end, traffic_gb_purchased, notes)
    values (v_order.user_id, v_order.product_id, p_provider, p_external_id, p_host, p_port, p_username, p_password,
            coalesce(p_protocol, 'http'), p_sticky_start, p_sticky_end, v_order.quantity_gb, p_notes)
    returning id into v_acc;
  end if;

  update public.orders
     set status = 'fulfilled', provider = p_provider, proxy_account_id = v_acc,
         fulfilled_at = now(), failure_reason = null
   where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, details)
  values (p_actor, 'order.fulfil', p_order_id::text, jsonb_build_object('provider', p_provider, 'proxy_account', v_acc));
  return v_acc;
end;
$$;

-- Mark an order failed (auto-fulfilment error). It stays in the admin queue; money is NOT refunded automatically.
create or replace function public.fail_order(p_order_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.orders set status = 'failed', failure_reason = left(p_reason, 500)
   where id = p_order_id and status in ('pending_fulfilment', 'processing');
$$;

-- Refund an unfulfilled (or failed) order back to the wallet.
create or replace function public.refund_order(p_order_id uuid, p_note text, p_actor uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_balance bigint;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found' using errcode = 'P0002'; end if;
  if v_order.status = 'refunded' then raise exception 'already_refunded' using errcode = 'P0001'; end if;
  update public.orders set status = 'refunded', admin_note = p_note where id = p_order_id;
  v_balance := public._wallet_apply(v_order.user_id, v_order.total_kobo, 'refund', p_order_id::text,
                                    coalesce(p_note, 'Order refund'), p_actor);
  insert into public.audit_log (actor_id, action, target, details)
  values (p_actor, 'order.refund', p_order_id::text, jsonb_build_object('amount_kobo', v_order.total_kobo, 'note', p_note));
  return v_balance;
end;
$$;

-- Manual credit (+) or debit (-) by an admin.
create or replace function public.admin_adjust_balance(p_user_id uuid, p_amount_kobo bigint, p_note text, p_actor uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if p_amount_kobo = 0 then raise exception 'zero_amount' using errcode = 'P0001'; end if;
  v_balance := public._wallet_apply(p_user_id, p_amount_kobo,
                 case when p_amount_kobo > 0 then 'admin_credit' else 'admin_debit' end,
                 null, p_note, p_actor);
  insert into public.audit_log (actor_id, action, target, details)
  values (p_actor, 'wallet.adjust', p_user_id::text, jsonb_build_object('amount_kobo', p_amount_kobo, 'note', p_note));
  return v_balance;
end;
$$;

-- Fixed-window rate limiter. Returns true when the call is allowed.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Lock all functions down to the service role.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._wallet_apply(uuid,bigint,text,text,text,uuid)',
    'public.create_payment(uuid,text,text,bigint,jsonb)',
    'public.confirm_payment(text,text,bigint,boolean,jsonb)',
    'public.place_order(uuid,text,text,integer,text)',
    'public.fulfil_order(uuid,text,text,text,integer,text,text,text,integer,integer,text,uuid,uuid)',
    'public.fail_order(uuid,text)',
    'public.set_payment_checkout(text,text,jsonb)',
    'public.payment_meta(text)',
    'public.refund_order(uuid,text,uuid)',
    'public.admin_adjust_balance(uuid,bigint,text,uuid)',
    'public.rate_limit_hit(text,integer,integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
