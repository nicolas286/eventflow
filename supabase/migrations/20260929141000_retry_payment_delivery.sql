begin;

-- Delivery claims are distinct from successful sends. No bank details are copied
-- here; the existing private instruction snapshot remains the source of truth.
create table private.bank_transfer_email_deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null check (status in ('sending', 'sent', 'failed', 'legacy_unknown')),
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error_code text,
  updated_at timestamptz not null default now()
);
alter table private.bank_transfer_email_deliveries enable row level security;
revoke all on private.bank_transfer_email_deliveries from public, anon, authenticated;

-- Historical log entries recorded an attempt, not its result. Preserve them as
-- unknown rather than silently declaring them delivered or resending them all.
insert into private.bank_transfer_email_deliveries(order_id, status)
select order_id, 'legacy_unknown' from public.order_email_logs
where kind = 'bank_transfer_instructions_v1'
on conflict do nothing;

create function public.claim_bank_transfer_email(p_order_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_delivery private.bank_transfer_email_deliveries%rowtype;
  v_token uuid := gen_random_uuid();
begin
  perform 1 from public.orders o
  join private.bank_transfer_payment_instructions i on i.order_id = o.id
  where o.id = p_order_id and o.status = 'awaiting_payment'
  for update of o;
  if not found then return jsonb_build_object('claimed', false, 'reason', 'not_payable'); end if;

  insert into private.bank_transfer_email_deliveries(order_id, status)
  values (p_order_id, 'failed') on conflict do nothing;
  select * into v_delivery from private.bank_transfer_email_deliveries
  where order_id = p_order_id for update;
  if v_delivery.status in ('sent', 'legacy_unknown') then
    return jsonb_build_object('claimed', false, 'reason', v_delivery.status);
  end if;
  if v_delivery.status = 'sending' and v_delivery.claimed_at > now() - interval '5 minutes' then
    return jsonb_build_object('claimed', false, 'reason', 'in_progress');
  end if;
  update private.bank_transfer_email_deliveries
  set status = 'sending', claim_token = v_token, claimed_at = now(),
      attempt_count = attempt_count + 1, error_code = null, updated_at = now()
  where order_id = p_order_id;
  return jsonb_build_object('claimed', true, 'claimToken', v_token);
end;
$$;

create function public.complete_bank_transfer_email(p_order_id uuid, p_claim_token uuid, p_success boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.bank_transfer_email_deliveries
  set status = case when p_success then 'sent' else 'failed' end,
      sent_at = case when p_success then now() else null end,
      error_code = case when p_success then null else 'DELIVERY_FAILED' end,
      next_attempt_at = now() + interval '5 minutes', claim_token = null, updated_at = now()
  where order_id = p_order_id and claim_token = p_claim_token and status = 'sending';
  return found;
end;
$$;

create function public.list_pending_bank_transfer_emails(p_limit integer default 25)
returns setof jsonb language sql security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'orderId', i.order_id, 'beneficiary', i.beneficiary, 'iban', i.iban,
    'amountCents', i.amount_cents, 'currency', i.currency,
    'communication', i.communication, 'internalReference', i.internal_reference,
    'paymentDueAt', null
  )
  from private.bank_transfer_payment_instructions i
  join public.orders o on o.id = i.order_id
  left join private.bank_transfer_email_deliveries d on d.order_id = i.order_id
  where o.status = 'awaiting_payment'
    and (d.order_id is null
      or (d.status = 'failed' and d.next_attempt_at <= now())
      or (d.status = 'sending' and d.claimed_at <= now() - interval '5 minutes'))
  order by coalesce(d.updated_at, o.created_at), i.order_id
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

-- Serialize Billit delivery, including concurrent POST /subscriptions retries.
-- An abandoned send is ambiguous: never automatically retransmit an invoice
-- that the provider may already have accepted.
alter table public.invoice_peppol
  add column delivery_claim_token uuid,
  add column delivery_claimed_at timestamptz;

create function public.claim_invoice_billit_delivery(p_invoice_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_delivery public.invoice_peppol%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_delivery from public.invoice_peppol
  where invoice_id = p_invoice_id and provider = 'billit' for update;
  if not found then raise exception 'INVOICE_DELIVERY_NOT_FOUND'; end if;
  if v_delivery.status in ('sent', 'accepted', 'rejected') then
    return jsonb_build_object('claimed', false, 'reason', 'already_sent');
  end if;
  if v_delivery.error_code = 'BILLIT_DELIVERY_UNKNOWN' then
    return jsonb_build_object('claimed', false, 'reason', 'review_required');
  end if;
  if v_delivery.status = 'sending' then
    if coalesce(v_delivery.delivery_claimed_at, v_delivery.last_status_at) > now() - interval '5 minutes' then
      return jsonb_build_object('claimed', false, 'reason', 'in_progress');
    end if;
    update public.invoice_peppol set status = 'failed', error_code = 'BILLIT_DELIVERY_UNKNOWN',
      error_message = 'Previous delivery outcome requires reconciliation',
      delivery_claim_token = null, last_status_at = now()
    where invoice_id = p_invoice_id;
    return jsonb_build_object('claimed', false, 'reason', 'review_required');
  end if;
  if v_delivery.attempt_count >= 50 then
    return jsonb_build_object('claimed', false, 'reason', 'review_required');
  end if;
  update public.invoice_peppol set status = 'sending', delivery_claim_token = v_token,
    delivery_claimed_at = now(), last_status_at = now(),
    attempt_count = attempt_count + 1, error_code = null, error_message = null
  where invoice_id = p_invoice_id;
  return jsonb_build_object('claimed', true, 'claimToken', v_token);
end;
$$;

create function public.complete_invoice_billit_delivery(
  p_invoice_id uuid, p_claim_token uuid, p_status text,
  p_provider_message_id text default null, p_error_code text default null
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'INVALID_DELIVERY_STATUS'; end if;
  update public.invoice_peppol
  set status = p_status::public.invoice_peppol_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
      last_status_at = now(), delivery_claim_token = null,
      error_code = left(p_error_code, 60), error_message = left(p_error_code, 500)
  where invoice_id = p_invoice_id and delivery_claim_token = p_claim_token and status = 'sending';
  return found;
end;
$$;

revoke all on function public.claim_bank_transfer_email(uuid) from public, anon, authenticated;
revoke all on function public.complete_bank_transfer_email(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.list_pending_bank_transfer_emails(integer) from public, anon, authenticated;
revoke all on function public.claim_invoice_billit_delivery(uuid) from public, anon, authenticated;
revoke all on function public.complete_invoice_billit_delivery(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_bank_transfer_email(uuid) to service_role;
grant execute on function public.complete_bank_transfer_email(uuid,uuid,boolean) to service_role;
grant execute on function public.list_pending_bank_transfer_emails(integer) to service_role;
grant execute on function public.claim_invoice_billit_delivery(uuid) to service_role;
grant execute on function public.complete_invoice_billit_delivery(uuid,uuid,text,text,text) to service_role;

commit;
