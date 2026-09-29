begin;

-- No existing invoices, periods, prices or Mollie references are rewritten.
-- Automatic renewal runs every five minutes after the period expires. An
-- active, consistent manual subscription keeps its rights for at most one hour
-- while the job catches up. Within that hour the next period starts at the old
-- boundary; after a longer outage it starts at now, without retroactive bills.

create or replace function public.create_manual_subscription_invoice(
  p_org_id uuid,
  p_plan text,
  p_total_cents integer,
  p_currency text default 'EUR',
  p_promo_code text default null,
  p_discount_percent integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), ''),
    current_user
  );
  v_now timestamptz := now();
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_currency text := upper(trim(coalesce(p_currency, 'EUR')));
  v_period_start timestamptz := v_now;
  v_period_end timestamptz := v_now + interval '1 month';
  v_due_at timestamptz := now() + interval '14 days';
  v_subtotal_cents integer;
  v_vat_cents integer;
  v_vat_rate numeric(6, 4) := 21.0000;
  v_number text;
  v_reference text;
  v_snapshot jsonb;
  v_existing_sub public.subscriptions%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if v_role not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN';
  end if;

  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  if v_plan not in ('starter', 'pro') then
    raise exception 'VALIDATION_ERROR: unknown plan';
  end if;

  if p_total_cents is null or p_total_cents < 0 then
    raise exception 'VALIDATION_ERROR: total_cents must be positive';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'VALIDATION_ERROR: currency invalid';
  end if;

  if p_discount_percent is not null and (p_discount_percent < 0 or p_discount_percent > 100) then
    raise exception 'VALIDATION_ERROR: discount_percent invalid';
  end if;

  perform 1
  from public.organizations
  where id = p_org_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select *
  into v_existing_sub
  from public.subscriptions
  where org_id = p_org_id
  for update;

  if found
     and v_existing_sub.provider = 'manual'
     and v_existing_sub.status = 'active'
     and v_existing_sub.plan = v_plan
     and v_existing_sub.current_period_end > v_now
  then
    select *
    into v_invoice
    from public.invoices
    where org_id = p_org_id
      and provider = 'manual'
      and status in ('issued', 'paid')
      and period_start = v_existing_sub.current_period_start
    order by issued_at desc, id desc
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'org_id', p_org_id,
        'plan', v_plan,
        'provider', 'manual',
        'status', 'active',
        'invoice_id', v_invoice.id,
        'invoice_number', v_invoice.number,
        'due_at', v_invoice.due_at,
        'current_period_end', v_existing_sub.current_period_end,
        'reused', true
      );
    end if;
  end if;

  -- Preserve the billing boundary during the bounded scheduler grace period.
  -- After a longer outage, start at now: never generate retroactive arrears.
  if v_existing_sub.provider = 'manual'
     and v_existing_sub.status = 'active'
     and v_existing_sub.plan = v_plan
     and v_existing_sub.current_period_end <= v_now
     and v_existing_sub.current_period_end >= v_now - interval '1 hour'
  then
    v_period_start := v_existing_sub.current_period_end;
    v_period_end := v_period_start + interval '1 month';
  end if;

  select jsonb_build_object(
    'legalName', ob.legal_name,
    'vatCountryCode', ob.vat_country_code,
    'vatNumber', ob.vat_number,
    'addressLine1', ob.address_line1,
    'addressLine2', ob.address_line2,
    'postalCode', ob.postal_code,
    'city', ob.city,
    'countryCode', ob.country_code,
    'billingEmail', ob.billing_email,
    'invoiceReference', ob.invoice_reference
  )
  into v_snapshot
  from public.organization_billing ob
  where ob.org_id = p_org_id;

  if v_snapshot is null then
    raise exception 'VALIDATION_ERROR: billing profile missing for org';
  end if;

  v_subtotal_cents := round(
    p_total_cents::numeric * 100 / (100 + v_vat_rate)
  )::integer;
  v_vat_cents := p_total_cents - v_subtotal_cents;
  v_number := to_char(v_now, 'YYYY') || '-' ||
    lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  v_reference := 'E-' || v_number;

  insert into public.invoices (
    org_id,
    number,
    status,
    issued_at,
    paid_at,
    due_at,
    payment_reference,
    period_start,
    period_end,
    currency,
    subtotal_cents,
    vat_cents,
    total_cents,
    vat_rate,
    billing_snapshot,
    provider,
    provider_invoice_id,
    pdf_path
  ) values (
    p_org_id,
    v_number,
    'issued',
    v_now,
    null,
    v_due_at,
    v_reference,
    v_period_start,
    v_period_end,
    v_currency,
    v_subtotal_cents,
    v_vat_cents,
    p_total_cents,
    v_vat_rate,
    jsonb_build_object(
      'billing', v_snapshot,
      'payment', jsonb_build_object(
        'beneficiary', 'Eventflow - Nicolas Manns',
        'iban', 'BE51732081025262',
        'termsDays', 14,
        'communication', v_reference
      ),
      'subscription', jsonb_build_object(
        'plan', v_plan,
        'promoCode', nullif(trim(coalesce(p_promo_code, '')), ''),
        'discountPercent', p_discount_percent
      )
    ),
    'manual',
    'manual-subscription-' || gen_random_uuid()::text,
    null
  )
  returning * into v_invoice;

  insert into public.subscriptions (
    org_id,
    provider,
    plan,
    status,
    current_period_start,
    current_period_end,
    promo_code,
    discount_percent,
    billing_price_value,
    billing_currency,
    created_at,
    updated_at
  ) values (
    p_org_id,
    'manual',
    v_plan,
    'active',
    v_period_start,
    v_period_end,
    nullif(trim(coalesce(p_promo_code, '')), ''),
    p_discount_percent,
    to_char(p_total_cents::numeric / 100, 'FM999999990.00'),
    v_currency,
    v_now,
    v_now
  )
  on conflict (org_id) do update
  set
    mollie_legacy_snapshot = case
      when subscriptions.provider = 'mollie'
       and subscriptions.mollie_subscription_id is not null
       and subscriptions.mollie_legacy_snapshot is null
      then jsonb_build_object(
        'customer_id', subscriptions.mollie_customer_id,
        'subscription_id', subscriptions.mollie_subscription_id,
        'status', subscriptions.status,
        'plan', subscriptions.plan,
        'current_period_end', subscriptions.current_period_end,
        'promo_code', subscriptions.promo_code,
        'discount_percent', subscriptions.discount_percent,
        'captured_at', v_now
      )
      else subscriptions.mollie_legacy_snapshot
    end,
    provider = 'manual',
    plan = excluded.plan,
    status = 'active',
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    promo_code = excluded.promo_code,
    discount_percent = excluded.discount_percent,
    billing_price_value = excluded.billing_price_value,
    billing_currency = excluded.billing_currency,
    updated_at = v_now;

  update public.organizations
  set
    plan_started_at = case when plan is distinct from v_plan then v_now else plan_started_at end,
    plan = v_plan,
    plan_expires_at = v_period_end,
    updated_at = v_now
  where id = p_org_id;

  -- Same initial state as rpc_create_invoice_peppol, within this transaction.
  -- The public legacy helper remains service-JWT-only; cron has no JWT.
  insert into public.invoice_peppol (invoice_id, provider, status, attempt_count)
  values (v_invoice.id, 'billit', 'not_sent', 0)
  on conflict (invoice_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'org_id', p_org_id,
    'plan', v_plan,
    'provider', 'manual',
    'status', 'active',
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.number,
    'due_at', v_invoice.due_at,
    'current_period_end', v_period_end,
    'reused', false
  );
end;
$$;

revoke all on function public.create_manual_subscription_invoice(
  uuid, text, integer, text, text, integer
) from public, anon, authenticated;
grant execute on function public.create_manual_subscription_invoice(
  uuid, text, integer, text, text, integer
) to service_role;

create or replace function public.renew_manual_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), ''),
    current_user
  );
  v_org_id uuid;
  v_org public.organizations%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_result jsonb;
  v_renewed integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if v_role not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN';
  end if;

  for v_org_id in
    select s.org_id
    from public.subscriptions s
    where s.provider = 'manual'
      and s.status = 'active'
      and s.plan in ('starter', 'pro')
      and s.current_period_end <= now()
    order by s.current_period_end, s.org_id
  loop
    begin
      -- Same lock order as invoice creation. Re-read after locking so a stale
      -- cursor cannot revive a canceled subscription or restore an old plan.
      select * into v_org
      from public.organizations
      where id = v_org_id
      for update;

      if not found then
        continue;
      end if;

      select * into v_subscription
      from public.subscriptions
      where org_id = v_org_id
      for update;

      if not found
         or v_subscription.provider <> 'manual'
         or v_subscription.status <> 'active'
         or v_subscription.plan not in ('starter', 'pro')
         or v_subscription.current_period_end is null
         or v_subscription.current_period_end > now()
         or v_org.plan is distinct from v_subscription.plan
         or v_org.plan_expires_at is distinct from v_subscription.current_period_end
      then
        continue;
      end if;

      if trim(coalesce(v_subscription.billing_price_value, '')) !~ '^\d+(\.\d{1,2})?$' then
        raise exception 'INVALID_SUBSCRIPTION_PRICE';
      end if;

      v_result := public.create_manual_subscription_invoice(
        v_org_id,
        v_subscription.plan,
        round(v_subscription.billing_price_value::numeric * 100)::integer,
        coalesce(nullif(trim(v_subscription.billing_currency), ''), 'EUR'),
        v_subscription.promo_code,
        v_subscription.discount_percent
      );

      if coalesce((v_result->>'reused')::boolean, false) = false then
        v_renewed := v_renewed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'org_id', v_org_id,
        'error', left(sqlerrm, 500)
      ));
    end;
  end loop;

  return jsonb_build_object(
    'ok', v_failed = 0,
    'renewed', v_renewed,
    'failed', v_failed,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.renew_manual_subscriptions()
  from public, anon, authenticated;
grant execute on function public.renew_manual_subscriptions() to service_role;

create or replace function public.get_org_plan(p_org_id uuid)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when lower(coalesce(nullif(trim(o.plan), ''), 'free')) in ('starter', 'pro')
      and o.plan_expires_at is not null
      and (
        o.plan_expires_at > now()
        or (
          o.plan_expires_at >= now() - interval '1 hour'
          and exists (
            select 1 from public.subscriptions s
            where s.org_id = o.id
              and s.provider = 'manual'
              and s.status = 'active'
              and s.plan = o.plan
              and s.current_period_end = o.plan_expires_at
          )
        )
      )
    then lower(trim(o.plan))
    else 'free'
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

revoke all on function public.get_org_plan(uuid) from public, anon, authenticated;
grant execute on function public.get_org_plan(uuid) to service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job
    where jobname = 'eventflow-manual-subscription-renewals'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'eventflow-manual-subscription-renewals',
    '*/5 * * * *',
    'select public.renew_manual_subscriptions();'
  );
end;
$$;

create or replace function public.get_dashboard_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_result jsonb;
  v_plan_limits jsonb;
  v_profile jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select to_jsonb(pl) into v_plan_limits
  from public.plan_limits pl
  where pl.plan = 'free'
  limit 1;

  if v_plan_limits is null then
    raise exception 'CONFIG_ERROR: missing plan_limits for plan=free';
  end if;

  select to_jsonb(up) into v_profile
  from public.user_profile up
  where up.user_id = v_user_id
  limit 1;

  select om.org_id into v_org_id
  from public.organization_members om
  where om.user_id = v_user_id
  order by om.created_at asc
  limit 1;

  if v_org_id is null then
    return jsonb_build_object(
      'profile', v_profile,
      'membership', null,
      'organization', null,
      'organizationProfile', null,
      'subscription', null,
      'latestOpenInvoice', null,
      'planLimits', v_plan_limits
    );
  end if;

  select jsonb_build_object(
    'profile', v_profile,
    'membership', (
      select to_jsonb(om)
      from public.organization_members om
      where om.user_id = v_user_id and om.org_id = v_org_id
      limit 1
    ),
    'organization', (
      select to_jsonb(o) || jsonb_build_object(
        'bank_transfer_iban', case
          when o.bank_transfer_iban is null then null
          else private.mask_iban(o.bank_transfer_iban)
        end
      )
      from public.organizations o where o.id = v_org_id
    ),
    'organizationProfile', (
      select to_jsonb(op) from public.organization_profile op where op.org_id = v_org_id
    ),
    'subscription', (
      select jsonb_build_object(
        'org_id', s.org_id,
        'provider', s.provider,
        'plan', s.plan,
        'status', s.status,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'promo_code', s.promo_code,
        'discount_percent', s.discount_percent,
        'billing_price_value', s.billing_price_value,
        'billing_currency', s.billing_currency
      )
      from public.subscriptions s
      where s.org_id = v_org_id
      limit 1
    ),
    'latestOpenInvoice', (
      select jsonb_build_object(
        'id', i.id,
        'number', i.number,
        'status', i.status,
        'issued_at', i.issued_at,
        'due_at', i.due_at,
        'total_cents', i.total_cents,
        'currency', i.currency,
        'payment_reference', i.payment_reference
      )
      from public.invoices i
      where i.org_id = v_org_id
        and i.provider = 'manual'
        and i.status = 'issued'
        and i.due_at is not null
        and i.payment_reference is not null
      order by i.issued_at desc, i.id desc
      limit 1
    ),
    'planLimits', (
      select to_jsonb(pl)
      from public.plan_limits pl
      join public.organizations o on o.plan = pl.plan
      where o.id = v_org_id
      limit 1
    )
  ) into v_result;

  if (v_result->'planLimits') is null then
    v_result := jsonb_set(v_result, '{planLimits}', v_plan_limits, true);
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_bootstrap() from public, anon, authenticated;
grant execute on function public.get_dashboard_bootstrap() to authenticated;

commit;
