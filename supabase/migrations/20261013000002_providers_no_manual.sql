-- StrongProxy migration 2: per-product provider (Proxies.sx default, DataImpulse optional) and NO manual fulfilment.
-- Every paid order is delivered instantly through the product's provider. If the provider call fails, the order is
-- marked failed and the wallet is refunded in the same transaction (fail_and_refund_order).

-- 1. Which upstream each product uses. Keys still live only in env; this is just the choice.
alter table public.products
  add column if not exists provider text not null default 'proxies_sx'
  check (provider in ('proxies_sx', 'dataimpulse'));
comment on column public.products.provider is 'Upstream that delivers this product: proxies_sx (default) or dataimpulse.';
comment on column public.products.provider_pool is 'Our pool name (mobile/residential/datacenter); each adapter maps it to its own pool.';

-- 2. Fail an order and refund the wallet atomically. Only an order still being delivered can be auto-refunded,
--    so a retried call can never refund twice.
create or replace function public.fail_and_refund_order(p_order_id uuid, p_reason text)
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
  if v_order.status not in ('pending_fulfilment', 'processing') then
    raise exception 'order_not_refundable' using errcode = 'P0001';
  end if;
  update public.orders
     set status = 'refunded', failure_reason = left(p_reason, 500), admin_note = 'Auto-refunded: delivery failed'
   where id = p_order_id;
  v_balance := public._wallet_apply(v_order.user_id, v_order.total_kobo, 'refund', p_order_id::text,
                                    'Refund: order could not be delivered', null);
  insert into public.audit_log (actor_id, action, target, details)
  values (null, 'order.auto_refund', p_order_id::text,
          jsonb_build_object('amount_kobo', v_order.total_kobo, 'reason', left(p_reason, 500)));
  return v_balance;
end;
$$;

-- 3. Close out any order left waiting in the old manual queue: refund it so nobody is left charged.
do $$
declare r record;
begin
  for r in select id from public.orders where status = 'pending_fulfilment' loop
    perform public.fail_and_refund_order(r.id, 'Manual fulfilment was removed; refunded automatically');
  end loop;
end;
$$;

-- 4. Drop manual mode.
drop function if exists public.place_order(uuid, text, text, integer, text);
drop function if exists public.fail_order(uuid, text);
alter table public.orders drop column if exists fulfilment_mode;
alter table public.orders alter column status set default 'processing';
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('processing', 'fulfilled', 'failed', 'refunded'));
delete from public.settings where key = 'fulfilment_mode';

-- 5. Buy GB from the wallet: debit + order in 'processing', in one transaction. The app then calls the provider
--    and either fulfil_order() or fail_and_refund_order().
create or replace function public.place_order(
  p_user_id uuid, p_product_id text, p_country_code text, p_quantity_gb integer
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

  insert into public.orders (user_id, product_id, country_code, quantity_gb, unit_price_kobo, total_kobo, status, provider)
  values (p_user_id, p_product_id, p_country_code, p_quantity_gb, v_product.price_per_gb_kobo, v_total, 'processing',
          v_product.provider)
  returning * into v_order;

  perform public._wallet_apply(p_user_id, -v_total, 'purchase', v_order.id::text,
                               p_quantity_gb || ' GB ' || v_product.name, null);
  return v_order;
end;
$$;

-- 6. Attach provider credentials to an order being delivered. With p_proxy_account_id the customer's existing
--    account for this product is topped up instead of creating a new one.
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
  if v_order.status <> 'processing' then
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.place_order(uuid,text,text,integer)',
    'public.fulfil_order(uuid,text,text,text,integer,text,text,text,integer,integer,text,uuid,uuid)',
    'public.fail_and_refund_order(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
