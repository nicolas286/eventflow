-- Disposable webhook leases: a failed delivery remains retryable and completed
-- deliveries cannot be downgraded by a stale worker reporting an error.
begin;
set local role service_role;
do $$
declare
  v_result jsonb;
begin
  v_result := public.claim_payment_webhook_event('stripe','evt_fixture_retry','connect',
    'acct_fixture_retry','refund.updated','{}');
  if v_result is distinct from '{"should_process":true,"already_processed":false,"attempts":1}'::jsonb then
    raise exception 'Fresh webhook was not claimed: %', v_result;
  end if;
  v_result := public.claim_payment_webhook_event('stripe','evt_fixture_retry','connect',
    'acct_fixture_retry','refund.updated','{}');
  if v_result is distinct from '{"should_process":false,"already_processed":false,"attempts":1}'::jsonb then
    raise exception 'Busy webhook was acknowledged as completed: %', v_result;
  end if;
  perform public.complete_payment_webhook_event('stripe','evt_fixture_retry',false,'fixture failure');
end;
$$;
reset role;
do $$
begin
  if not exists (select 1 from private.payment_webhook_events
    where provider='stripe' and event_id='evt_fixture_retry'
      and processed_at is null and processing_started_at is not null
      and lease_expires_at <= now() and last_error='fixture failure') then
    raise exception 'Failure must persist its error and release its non-null lease';
  end if;
end;
$$;
set local role service_role;
do $$
declare
  v_result jsonb;
  v_invalid text;
begin
  v_result := public.claim_payment_webhook_event('stripe','evt_fixture_retry','connect',
    'acct_fixture_retry','refund.updated','{}');
  if v_result is distinct from '{"should_process":true,"already_processed":false,"attempts":2}'::jsonb then
    raise exception 'Failed webhook was not reclaimable: %', v_result;
  end if;
  perform public.complete_payment_webhook_event('stripe','evt_fixture_retry',true);
  perform public.complete_payment_webhook_event('stripe','evt_fixture_retry',false,'stale failure');
  v_result := public.claim_payment_webhook_event('stripe','evt_fixture_retry','connect',
    'acct_fixture_retry','refund.updated','{}');
  if v_result is distinct from '{"should_process":false,"already_processed":true,"attempts":2}'::jsonb then
    raise exception 'Completed webhook was downgraded or reclaimed: %', v_result;
  end if;
  -- Ordinary refunds need no late-receipt row but must accept both Stripe IDs.
  perform public.record_stripe_late_refund('acct_fixture_retry','pi_fixture_retry','pyr_fixture_refund',true);
  perform public.record_stripe_late_refund('acct_fixture_retry','pi_fixture_retry','re_fixture_refund',true);
  foreach v_invalid in array array[null::text,'','re_','pyr_','pi_invalid','pyr_invalid!'] loop
    begin
      perform public.record_stripe_late_refund('acct_fixture_retry','pi_fixture_retry',v_invalid,true);
      raise exception 'Invalid refund identifier was accepted: %', v_invalid;
    exception when raise_exception then
      if sqlerrm <> 'STRIPE_REFUND_ID_INVALID' then raise; end if;
    end;
  end loop;
end;
$$;
reset role;
do $$
declare
  v_function text;
begin
  if not exists (select 1 from private.payment_webhook_events
    where provider='stripe' and event_id='evt_fixture_retry'
      and processed_at is not null and processing_started_at is not null
      and last_error is null and attempts=2) then
    raise exception 'Completed webhook state was changed by stale failure';
  end if;
  foreach v_function in array array[
    'public.claim_payment_webhook_event(text,text,text,text,text,jsonb)',
    'public.complete_payment_webhook_event(text,text,boolean,text)',
    'public.record_stripe_late_refund(text,text,text,boolean)'
  ] loop
    if has_function_privilege('anon',v_function,'EXECUTE')
      or has_function_privilege('authenticated',v_function,'EXECUTE')
      or not has_function_privilege('service_role',v_function,'EXECUTE') then
      raise exception 'Webhook/refund function must remain service-only: %', v_function;
    end if;
  end loop;
end;
$$;
rollback;
