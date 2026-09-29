begin;

insert into public.organizations(id, type, name)
values ('a6100000-0000-4000-8000-000000000001', 'association', 'Delivery regression');
insert into public.organization_billing(org_id, legal_name, address_line1, postal_code, city, country_code, billing_email)
values ('a6100000-0000-4000-8000-000000000001', 'Delivery regression ASBL', 'Test street 1', '1000', 'Brussels', 'BE', 'fixture@example.test');
insert into public.events(id, org_id, slug, title, is_published)
values ('a6100000-0000-4000-8000-000000000002', 'a6100000-0000-4000-8000-000000000001', 'delivery-regression', 'Delivery regression', true);
insert into public.orders(id, org_id, event_id, currency, total_cents, paid_cents, buyer_email, booking_token, status)
values ('a6100000-0000-4000-8000-000000000003', 'a6100000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000002',
  'EUR', 2500, 0, 'fixture@example.test', 'delivery-regression-booking-token', 'awaiting_payment');

set local role service_role;
set local "request.jwt.claim.role" = 'service_role';
select public.create_bank_transfer_payment('a6100000-0000-4000-8000-000000000003', 2500, 'EUR',
  'Synthetic beneficiary', 'BE68539007547034', 'Synthetic communication', 'EF-REGRESSION');

do $$
declare
  v_claim jsonb;
  v_retry jsonb;
begin
  v_claim := public.claim_bank_transfer_email('a6100000-0000-4000-8000-000000000003');
  if not (v_claim->>'claimed')::boolean then raise exception 'Initial email claim denied'; end if;
  if (public.claim_bank_transfer_email('a6100000-0000-4000-8000-000000000003')->>'reason') <> 'in_progress' then
    raise exception 'Concurrent email sender was not excluded';
  end if;
  if public.complete_bank_transfer_email('a6100000-0000-4000-8000-000000000003', gen_random_uuid(), true) then
    raise exception 'Unrelated email claim completed delivery';
  end if;
  perform public.complete_bank_transfer_email('a6100000-0000-4000-8000-000000000003', (v_claim->>'claimToken')::uuid, false);
  v_retry := public.claim_bank_transfer_email('a6100000-0000-4000-8000-000000000003');
  if not (v_retry->>'claimed')::boolean then raise exception 'Failed email cannot be retried'; end if;
  if public.complete_bank_transfer_email('a6100000-0000-4000-8000-000000000003', (v_claim->>'claimToken')::uuid, true) then
    raise exception 'Obsolete sender overwrote a newer email claim';
  end if;
  perform public.complete_bank_transfer_email('a6100000-0000-4000-8000-000000000003', (v_retry->>'claimToken')::uuid, true);
  if (public.claim_bank_transfer_email('a6100000-0000-4000-8000-000000000003')->>'reason') <> 'sent' then
    raise exception 'Delivered email was claimed again';
  end if;
  if exists(select 1 from public.list_pending_bank_transfer_emails(100) x where x->>'orderId' = 'a6100000-0000-4000-8000-000000000003') then
    raise exception 'Sent instructions remain in retry batch';
  end if;
end;
$$;

do $$
declare
  v_invoice_id uuid;
  v_claim jsonb;
  v_retry jsonb;
begin
  v_invoice_id := (public.create_manual_subscription_invoice('a6100000-0000-4000-8000-000000000001', 'starter', 1599, 'EUR', null, null)->>'invoice_id')::uuid;
  v_claim := public.claim_invoice_billit_delivery(v_invoice_id);
  if not (v_claim->>'claimed')::boolean then raise exception 'Initial Billit claim denied'; end if;
  if public.claim_invoice_billit_delivery(v_invoice_id)->>'reason' <> 'in_progress' then
    raise exception 'Concurrent Billit sender was not excluded';
  end if;
  if public.complete_invoice_billit_delivery(v_invoice_id, gen_random_uuid(), 'sent') then
    raise exception 'Unrelated Billit claim completed delivery';
  end if;
  perform public.complete_invoice_billit_delivery(v_invoice_id, (v_claim->>'claimToken')::uuid, 'failed', null, 'BILLIT_SEND_FAILED');
  v_retry := public.claim_invoice_billit_delivery(v_invoice_id);
  if not (v_retry->>'claimed')::boolean then raise exception 'Known Billit failure cannot be retried'; end if;
  if public.complete_invoice_billit_delivery(v_invoice_id, (v_claim->>'claimToken')::uuid, 'sent') then
    raise exception 'Obsolete Billit sender overwrote a newer claim';
  end if;
  perform public.complete_invoice_billit_delivery(v_invoice_id, (v_retry->>'claimToken')::uuid, 'sent', 'synthetic-billit-message');
  if public.claim_invoice_billit_delivery(v_invoice_id)->>'reason' <> 'already_sent' then
    raise exception 'Sent invoice was transmitted again';
  end if;
  update public.invoice_peppol set status = 'accepted' where invoice_id = v_invoice_id;
  if public.claim_invoice_billit_delivery(v_invoice_id)->>'reason' <> 'already_sent' then
    raise exception 'Accepted invoice was transmitted again';
  end if;
  update public.invoice_peppol set status = 'failed', error_code = 'BILLIT_DELIVERY_UNKNOWN' where invoice_id = v_invoice_id;
  if public.claim_invoice_billit_delivery(v_invoice_id)->>'reason' <> 'review_required' then
    raise exception 'Unknown provider outcome must not be retransmitted automatically';
  end if;
  update public.invoice_peppol set status = 'sending', error_code = null,
    delivery_claimed_at = now() - interval '6 minutes' where invoice_id = v_invoice_id;
  if public.claim_invoice_billit_delivery(v_invoice_id)->>'reason' <> 'review_required' then
    raise exception 'Abandoned send must be reconciled before retransmission';
  end if;
end;
$$;

reset role;
do $$
begin
  if exists(select 1 from private.bank_transfer_email_deliveries where order_id = 'a6100000-0000-4000-8000-000000000003' and sent_at is null) then
    raise exception 'Successful delivery missing its sent timestamp';
  end if;
end;
$$;

set local role anon;
do $$
begin
  begin
    perform public.claim_bank_transfer_email('a6100000-0000-4000-8000-000000000003');
    raise exception 'Anonymous email claim allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.list_pending_bank_transfer_emails(25);
    raise exception 'Anonymous caller read bank instructions';
  exception when insufficient_privilege then null; end;
end;
$$;
set local role authenticated;
do $$
begin
  begin
    perform public.claim_invoice_billit_delivery('a6100000-0000-4000-8000-000000000003');
    raise exception 'Ordinary user claimed an invoice delivery';
  exception when insufficient_privilege then null; end;
  begin
    perform public.complete_bank_transfer_email('a6100000-0000-4000-8000-000000000003', gen_random_uuid(), true);
    raise exception 'Ordinary user completed an email delivery';
  exception when insufficient_privilege then null; end;
  begin
    perform public.complete_invoice_billit_delivery('a6100000-0000-4000-8000-000000000003', gen_random_uuid(), 'sent');
    raise exception 'Ordinary user completed an invoice delivery';
  exception when insufficient_privilege then null; end;
end;
$$;
rollback;
