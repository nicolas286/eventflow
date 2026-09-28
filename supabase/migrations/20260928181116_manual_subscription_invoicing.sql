begin;

alter table public.invoices
  add column if not exists due_at timestamptz,
  add column if not exists payment_reference text;

alter table public.invoices
  add constraint invoices_due_after_issue_check
  check (due_at is null or issued_at is null or due_at >= issued_at) not valid;

alter table public.invoices
  validate constraint invoices_due_after_issue_check;

alter table public.invoices
  add constraint invoices_payment_reference_len_check
  check (payment_reference is null or char_length(trim(payment_reference)) between 3 and 80) not valid;

alter table public.invoices
  validate constraint invoices_payment_reference_len_check;

create index if not exists invoices_open_due_idx
  on public.invoices (org_id, due_at, issued_at desc)
  where status = 'issued';

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
    current_user
  );
  v_now timestamptz := now();
  v_plan text := lower(trim(coalesce(p_plan, '')));
  v_currency text := upper(trim(coalesce(p_currency, 'EUR')));
  v_period_end timestamptz := now() + interval '1 month';
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
    v_now,
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
    v_now,
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

  perform public.rpc_create_invoice_peppol(
    jsonb_build_object('invoice_id', v_invoice.id)
  );

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
    current_user
  );
  v_subscription record;
  v_result jsonb;
  v_renewed integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if v_role not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN';
  end if;

  for v_subscription in
    select
      s.org_id,
      s.plan,
      s.billing_price_value,
      coalesce(nullif(trim(s.billing_currency), ''), 'EUR') as billing_currency,
      s.promo_code,
      s.discount_percent
    from public.subscriptions s
    where s.provider = 'manual'
      and s.status = 'active'
      and s.plan in ('starter', 'pro')
      and s.current_period_end <= now()
      and trim(coalesce(s.billing_price_value, '')) ~ '^\d+(\.\d{1,2})?$'
    order by s.current_period_end, s.org_id
  loop
    begin
      v_result := public.create_manual_subscription_invoice(
        v_subscription.org_id,
        v_subscription.plan,
        round(v_subscription.billing_price_value::numeric * 100)::integer,
        v_subscription.billing_currency,
        v_subscription.promo_code,
        v_subscription.discount_percent
      );

      if coalesce((v_result->>'reused')::boolean, false) = false then
        v_renewed := v_renewed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'org_id', v_subscription.org_id,
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
grant execute on function public.renew_manual_subscriptions()
  to service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'eventflow-manual-subscription-renewals'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'eventflow-manual-subscription-renewals',
    '15 2 * * *',
    'select public.renew_manual_subscriptions();'
  );
end;
$$;

create or replace function public.get_dashboard_bootstrap()
returns jsonb
language plpgsql
set search_path = pg_catalog, public
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
      select to_jsonb(o) from public.organizations o where o.id = v_org_id
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
        and i.status = 'issued'
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

create or replace function public.rpc_list_invoices(
  p_org_id uuid,
  p_limit integer default 25,
  p_cursor_issued_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  if not exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  with rows as (
    select
      i.id,
      i.org_id,
      i.number,
      i.status::text as status,
      i.issued_at,
      i.paid_at,
      i.due_at,
      i.payment_reference,
      i.period_start,
      i.period_end,
      i.currency,
      i.subtotal_cents,
      i.vat_cents,
      i.total_cents,
      i.vat_rate,
      i.provider,
      i.mollie_payment_id,
      i.mollie_subscription_id,
      i.pdf_path,
      i.created_at,
      i.updated_at
    from public.invoices i
    where i.org_id = p_org_id
      and (
        p_cursor_issued_at is null
        or (i.issued_at, i.id) < (p_cursor_issued_at, p_cursor_id)
      )
    order by i.issued_at desc nulls last, i.id desc
    limit v_limit
  )
  select jsonb_build_object(
    'orgId', p_org_id,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'orgId', r.org_id,
      'number', r.number,
      'status', r.status,
      'issuedAt', r.issued_at,
      'paidAt', r.paid_at,
      'dueAt', r.due_at,
      'paymentReference', r.payment_reference,
      'periodStart', r.period_start,
      'periodEnd', r.period_end,
      'currency', r.currency,
      'subtotalCents', r.subtotal_cents,
      'vatCents', r.vat_cents,
      'totalCents', r.total_cents,
      'vatRate', r.vat_rate,
      'provider', r.provider,
      'molliePaymentId', r.mollie_payment_id,
      'mollieSubscriptionId', r.mollie_subscription_id,
      'pdfPath', r.pdf_path,
      'createdAt', r.created_at,
      'updatedAt', r.updated_at
    ) order by r.issued_at desc nulls last, r.id desc), '[]'::jsonb),
    'nextCursor', case
      when count(*) = v_limit then (
        select jsonb_build_object('issuedAt', x.issued_at, 'id', x.id)
        from rows x
        order by x.issued_at asc nulls first, x.id asc
        limit 1
      )
      else null
    end
  ) into v_result
  from rows r;

  return v_result;
end;
$$;

revoke all on function public.rpc_list_invoices(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.rpc_list_invoices(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

commit;
