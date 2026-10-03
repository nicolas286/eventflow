begin;

-- Serialize the legacy snapshot with order writes while installing the bridge.
lock table public.orders in share row exclusive mode;

-- Delivery only: never apply a payment, change stock, or issue tickets here.
create table private.order_confirmation_deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'failed', 'sent', 'review_required', 'legacy_unknown')),
  claim_token uuid,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  first_dispatch_at timestamptz,
  payload jsonb,
  provider text check (provider in ('resend', 'capture')),
  provider_message_id text,
  error_code text,
  updated_at timestamptz not null default now()
);
alter table private.order_confirmation_deliveries enable row level security;
revoke all on private.order_confirmation_deliveries from public, anon, authenticated;
create index order_confirmation_deliveries_pending_idx
  on private.order_confirmation_deliveries(next_attempt_at, order_id)
  where status in ('pending', 'failed', 'sending');

-- An old claim does not prove whether the provider accepted the email. Do not
-- reset it or enqueue historical unclaimed orders as a migration side effect.
insert into private.order_confirmation_deliveries(order_id, status, error_code)
select id, 'legacy_unknown', 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN'
from public.orders where confirmation_email_claimed_at is not null
  and confirmation_email_sent_at is null;
update public.orders set confirmation_email_error = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN'
where id in (select order_id from private.order_confirmation_deliveries);

create function private.enqueue_order_confirmation() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  if new.confirmed_at is not null and new.status in ('paid', 'partially_paid')
    and new.confirmation_email_sent_at is null then
    insert into private.order_confirmation_deliveries(order_id, status, error_code)
    values (new.id,
      case when new.confirmation_email_claimed_at is null then 'pending' else 'legacy_unknown' end,
      case when new.confirmation_email_claimed_at is null then null else 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' end)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_order_confirmation() from public, anon, authenticated;
create trigger enqueue_order_confirmation after insert or update of confirmed_at, status
  on public.orders for each row execute function private.enqueue_order_confirmation();

create function private.order_confirmation_eligible(p_order_id uuid) returns boolean
language sql stable set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.orders o where o.id = p_order_id
      and o.confirmed_at is not null and o.status in ('paid', 'partially_paid')
      and o.confirmation_email_sent_at is null
      and nullif(btrim(o.buyer_email), '') is not null
      and not exists (
        select 1 from public.order_items i where i.order_id = o.id
          and (select count(*) from public.tickets t where t.order_item_id = i.id) < i.quantity
      )
  );
$$;
revoke all on function private.order_confirmation_eligible(uuid) from public, anon, authenticated;

create function public.claim_order_confirmation_delivery(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  d private.order_confirmation_deliveries%rowtype;
  v_token uuid := gen_random_uuid();
  v_error text;
begin
  -- Same lock order as ticket issuance/payment. Concurrent claims serialize.
  perform 1 from public.orders where id = p_order_id for update;
  if not private.order_confirmation_eligible(p_order_id) then
    return jsonb_build_object('claimed', false, 'reason', 'not_eligible');
  end if;
  insert into private.order_confirmation_deliveries(order_id, status, error_code)
  select id,
    case when confirmation_email_claimed_at is null then 'pending' else 'legacy_unknown' end,
    case when confirmation_email_claimed_at is null then null else 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' end
  from public.orders where id = p_order_id on conflict do nothing;
  select * into d from private.order_confirmation_deliveries where order_id = p_order_id for update;
  -- An old function already entered before the migration may resume its UPDATE
  -- afterwards. A legacy column claim on a pending row is still ambiguous.
  if d.status = 'pending' and exists(select 1 from public.orders
    where id = p_order_id and confirmation_email_claimed_at is not null) then
    update private.order_confirmation_deliveries set status = 'legacy_unknown',
      error_code = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN', updated_at = now() where order_id = p_order_id;
    update public.orders set confirmation_email_error = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' where id = p_order_id;
    return jsonb_build_object('claimed', false, 'reason', 'legacy_unknown');
  end if;
  if d.status in ('sent', 'review_required', 'legacy_unknown') then
    return jsonb_build_object('claimed', false, 'reason', d.status);
  end if;
  if d.status = 'sending' and d.claimed_at > now() - interval '5 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'in_progress');
  end if;
  -- Resend retains idempotency for 24h. Leave a 1h margin; never blindly
  -- retransmit an ambiguous delivery after this conservative deadline.
  if d.first_dispatch_at <= now() - interval '23 hours' then
    v_error := 'CONFIRMATION_IDEMPOTENCY_WINDOW_EXPIRED';
  elsif d.attempt_count >= 8 then
    v_error := 'CONFIRMATION_ATTEMPTS_EXHAUSTED';
  end if;
  if v_error is not null then
    update private.order_confirmation_deliveries set status = 'review_required',
      claim_token = null, error_code = v_error, updated_at = now() where order_id = p_order_id;
    update public.orders set confirmation_email_error = v_error where id = p_order_id;
    return jsonb_build_object('claimed', false, 'reason', 'review_required');
  end if;
  if d.next_attempt_at > now() then
    return jsonb_build_object('claimed', false, 'reason', 'backoff');
  end if;
  update private.order_confirmation_deliveries set status = 'sending', claim_token = v_token,
    claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
  where order_id = p_order_id;
  update public.orders set confirmation_email_claimed_at = now(),
    confirmation_email_error = 'CONFIRMATION_DELIVERY_IN_PROGRESS' where id = p_order_id;
  return jsonb_build_object('claimed', true, 'claimToken', v_token, 'payload', d.payload, 'provider', d.provider);
end;
$$;

-- Persist the exact envelope (including PDF bytes and sender) BEFORE the first
-- provider request; a regenerated PDF or changed event would invalidate the key.
create function public.prepare_order_confirmation_dispatch(
  p_order_id uuid, p_claim_token uuid, p_payload jsonb, p_provider text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare d private.order_confirmation_deliveries%rowtype;
begin
  perform 1 from public.orders where id = p_order_id for update;
  select * into d from private.order_confirmation_deliveries where order_id = p_order_id for update;
  if not found or d.status <> 'sending' or d.claim_token is distinct from p_claim_token
    or d.claimed_at <= now() - interval '5 minutes'
    or not private.order_confirmation_eligible(p_order_id) then return null; end if;
  if d.first_dispatch_at <= now() - interval '23 hours' then return null; end if;
  if p_provider not in ('resend', 'capture') or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_CONFIRMATION_PAYLOAD';
  end if;
  if d.provider is not null and d.provider <> p_provider then return null; end if;
  update private.order_confirmation_deliveries
  set payload = coalesce(payload, p_payload), provider = coalesce(provider, p_provider),
    first_dispatch_at = coalesce(first_dispatch_at, now()), updated_at = now()
  where order_id = p_order_id returning * into d;
  return jsonb_build_object('payload', d.payload, 'provider', d.provider,
    'dispatchBefore', d.first_dispatch_at + interval '23 hours');
end;
$$;

create function public.complete_order_confirmation_delivery(
  p_order_id uuid, p_claim_token uuid, p_success boolean,
  p_provider_message_id text default null, p_error_code text default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare d private.order_confirmation_deliveries%rowtype;
begin
  perform 1 from public.orders where id = p_order_id for update;
  select * into d from private.order_confirmation_deliveries where order_id = p_order_id for update;
  if not found or d.status <> 'sending' or d.claim_token is distinct from p_claim_token
    or d.claimed_at <= now() - interval '5 minutes' then return false; end if;
  if p_success and (d.first_dispatch_at is null or nullif(p_provider_message_id, '') is null) then
    raise exception 'CONFIRMATION_ACCEPTANCE_REQUIRED';
  end if;
  update private.order_confirmation_deliveries set
    status = case when p_success then 'sent' when attempt_count >= 8 then 'review_required' else 'failed' end,
    claim_token = null,
    next_attempt_at = now() + make_interval(secs => least(3600, 300 * (2 ^ (attempt_count - 1))::integer)),
    provider_message_id = case when p_success then p_provider_message_id else provider_message_id end,
    error_code = case when p_success then null when attempt_count >= 8 then 'CONFIRMATION_ATTEMPTS_EXHAUSTED'
      else left(coalesce(p_error_code, 'CONFIRMATION_DELIVERY_FAILED'), 100) end,
    updated_at = now() where order_id = p_order_id returning * into d;
  update public.orders set confirmation_email_sent_at = case when p_success then now() else confirmation_email_sent_at end,
    confirmation_email_error = d.error_code where id = p_order_id;
  return true;
end;
$$;

create function public.list_pending_order_confirmations(p_limit integer default 25)
returns table(order_id uuid) language sql security definer
set search_path = pg_catalog, public, private as $$
  select d.order_id from private.order_confirmation_deliveries d
  where d.status in ('pending', 'failed', 'sending') and d.next_attempt_at <= now()
    and (d.status <> 'sending' or d.claimed_at <= now() - interval '5 minutes')
    and private.order_confirmation_eligible(d.order_id)
  order by d.next_attempt_at, d.order_id limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

-- Compatibility bridge: old code cannot fence a retry. Its claims are isolated
-- as legacy_unknown; old mark RPCs can never complete or release a new claim.
create or replace function public.claim_order_confirmation_email(p_order_id uuid)
returns table(ok boolean, order_id uuid, buyer_email text, booking_token text)
language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  perform 1 from public.orders where id = p_order_id for update;
  if exists(select 1 from private.order_confirmation_deliveries d where d.order_id = p_order_id and d.status <> 'pending') then
    return query select false, p_order_id, null::text, null::text; return;
  end if;
  update public.orders o set confirmation_email_claimed_at = now(), confirmation_email_error = null
  where o.id = p_order_id and o.confirmation_email_sent_at is null and o.confirmation_email_claimed_at is null;
  if not found then return query select false, p_order_id, null::text, null::text; return; end if;
  insert into private.order_confirmation_deliveries(order_id, status, error_code)
  values (p_order_id, 'legacy_unknown', 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN')
  on conflict on constraint order_confirmation_deliveries_pkey do update
    set status = 'legacy_unknown', error_code = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN';
  return query select true, o.id, o.buyer_email, o.booking_token from public.orders o where o.id = p_order_id;
end;
$$;
create or replace function public.mark_order_confirmation_email_sent(p_order_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  perform 1 from public.orders where id = p_order_id for update;
  insert into private.order_confirmation_deliveries(order_id, status, error_code)
    select id, 'legacy_unknown', 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' from public.orders
    where id = p_order_id and confirmation_email_claimed_at is not null
      and confirmation_email_sent_at is null
    on conflict do nothing;
  update private.order_confirmation_deliveries set status = 'sent', error_code = null, updated_at = now()
    where order_id = p_order_id and (status = 'legacy_unknown'
      or (status = 'pending' and claim_token is null and first_dispatch_at is null
        and exists(select 1 from public.orders where id = p_order_id and confirmation_email_claimed_at is not null)));
  if found then update public.orders set confirmation_email_sent_at = now(), confirmation_email_error = null where id = p_order_id; end if;
end;
$$;
create or replace function public.mark_order_confirmation_email_error(p_order_id uuid, p_error text)
returns void language plpgsql security definer set search_path = pg_catalog, public, private as $$
begin
  perform 1 from public.orders where id = p_order_id for update;
  insert into private.order_confirmation_deliveries(order_id, status, error_code)
    select id, 'legacy_unknown', 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN' from public.orders
    where id = p_order_id and confirmation_email_claimed_at is not null
      and confirmation_email_sent_at is null
    on conflict do nothing;
  update private.order_confirmation_deliveries set status = 'legacy_unknown',
    error_code = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN', updated_at = now()
    where order_id = p_order_id and status = 'pending' and claim_token is null and first_dispatch_at is null
      and exists(select 1 from public.orders where id = p_order_id and confirmation_email_claimed_at is not null);
  update public.orders set confirmation_email_error = 'LEGACY_CONFIRMATION_OUTCOME_UNKNOWN'
    where id = p_order_id and exists(select 1 from private.order_confirmation_deliveries
      where order_id = p_order_id and status = 'legacy_unknown');
end;
$$;

revoke all on function public.claim_order_confirmation_delivery(uuid) from public, anon, authenticated;
revoke all on function public.prepare_order_confirmation_dispatch(uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.complete_order_confirmation_delivery(uuid,uuid,boolean,text,text) from public, anon, authenticated;
revoke all on function public.list_pending_order_confirmations(integer) from public, anon, authenticated;
grant execute on function public.claim_order_confirmation_delivery(uuid) to service_role;
grant execute on function public.prepare_order_confirmation_dispatch(uuid,uuid,jsonb,text) to service_role;
grant execute on function public.complete_order_confirmation_delivery(uuid,uuid,boolean,text,text) to service_role;
grant execute on function public.list_pending_order_confirmations(integer) to service_role;
revoke all on function public.claim_order_confirmation_email(uuid) from public, anon, authenticated;
revoke all on function public.mark_order_confirmation_email_sent(uuid) from public, anon, authenticated;
revoke all on function public.mark_order_confirmation_email_error(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_order_confirmation_email(uuid) to service_role;
grant execute on function public.mark_order_confirmation_email_sent(uuid) to service_role;
grant execute on function public.mark_order_confirmation_email_error(uuid,text) to service_role;

commit;
