-- Accept Stripe payment refunds (Bancontact pyr_ IDs) as well as card refunds.
-- Preserve non-null processing timestamps on failures and distinguish busy leases
-- from completed deliveries. Existing rows and accounting entries are unchanged.
begin;

create or replace function public.record_stripe_late_refund(
  p_account_id text, p_payment_intent_id text, p_refund_id text, p_succeeded boolean default false
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_refund_id is null or p_refund_id !~ '^(re|pyr)_[A-Za-z0-9_]+$' then
    raise exception 'STRIPE_REFUND_ID_INVALID';
  end if;
  update private.stripe_late_payment_refunds r set refund_id = coalesce(r.refund_id, p_refund_id),
    completed_at = case when p_succeeded then coalesce(r.completed_at, now()) else r.completed_at end
  from public.payments p where p.id = r.payment_id
    and p.provider = 'stripe' and p.provider_payment_id = p_payment_intent_id
    and p.provider_account_id = p_account_id
    and (r.refund_id is null or r.refund_id = p_refund_id)
    -- A partial or unrelated refund webhook cannot finish the late receipt.
    and (not p_succeeded or exists (select 1 from public.payments refunded
      where refunded.parent_payment_id = p.id and refunded.provider = 'stripe'
        and refunded.provider_payment_id = p_refund_id and refunded.type = 'refund'
        and refunded.status = 'paid' and refunded.amount_cents = p.amount_cents
        and upper(refunded.currency) = upper(p.currency)));
end;
$$;
revoke all on function public.record_stripe_late_refund(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.record_stripe_late_refund(text,text,text,boolean) to service_role;

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_scope text,
  p_account_id text,
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.payment_webhook_events%rowtype;
begin
  if lower(trim(coalesce(p_provider, ''))) <> 'stripe' then
    raise exception 'VALIDATION_ERROR: unsupported webhook provider';
  end if;

  if lower(trim(coalesce(p_scope, ''))) <> 'connect' then
    raise exception 'VALIDATION_ERROR: unsupported webhook scope';
  end if;

  if nullif(trim(coalesce(p_event_id, '')), '') is null
     or nullif(trim(coalesce(p_event_type, '')), '') is null then
    raise exception 'VALIDATION_ERROR: webhook identity required';
  end if;

  insert into private.payment_webhook_events (
    provider,
    event_id,
    scope,
    account_id,
    event_type,
    payload
  )
  values (
    lower(trim(p_provider)),
    trim(p_event_id),
    lower(trim(p_scope)),
    nullif(trim(coalesce(p_account_id, '')), ''),
    trim(p_event_type),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, event_id) do update
  set
    attempts = private.payment_webhook_events.attempts + 1,
    processing_started_at = now(),
    lease_expires_at = now() + interval '5 minutes',
    last_error = null,
    updated_at = now()
  where private.payment_webhook_events.processed_at is null
    and private.payment_webhook_events.lease_expires_at <= now()
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'should_process', true, 'already_processed', false, 'attempts', v_row.attempts
    );
  end if;

  -- A live lease is not a completed event: callers must request a retry.
  select * into v_row from private.payment_webhook_events
  where provider = lower(trim(p_provider)) and event_id = trim(p_event_id);
  return jsonb_build_object(
    'should_process', false,
    'already_processed', v_row.processed_at is not null,
    'attempts', v_row.attempts
  );
end;
$$;

revoke all on function public.claim_payment_webhook_event(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text, text, text, text, jsonb)
  to service_role;

create or replace function public.complete_payment_webhook_event(
  p_provider text,
  p_event_id text,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.payment_webhook_events
  set
    processed_at = case when p_success then now() else null end,
    lease_expires_at = case when p_success then lease_expires_at else now() end,
    last_error = case when p_success then null else left(coalesce(p_error, 'WEBHOOK_PROCESSING_FAILED'), 1000) end,
    updated_at = now()
  where provider = lower(trim(p_provider))
    and event_id = trim(p_event_id)
    and processed_at is null;
end;
$$;

revoke all on function public.complete_payment_webhook_event(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_payment_webhook_event(text, text, boolean, text)
  to service_role;

commit;
