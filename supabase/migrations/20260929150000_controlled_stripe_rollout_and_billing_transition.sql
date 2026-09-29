begin;

/*
 * Controlled Stripe rollout and complimentary billing transition.
 *
 * This migration preserves all Mollie/Stripe identifiers, orders, payments,
 * invoices and subscriptions. Stripe Connect is opt-in through the existing
 * service-role-only allowlist. Eligible paid Mollie subscriptions keep their
 * plan free of charge until 2026-11-01, then renew through manual invoicing.
 */

alter table public.user_profile
  alter column stripe_connect_allowed set default false;

update public.user_profile
set stripe_connect_allowed = false,
    updated_at = now()
where stripe_connect_allowed is distinct from false;

update public.organizations o
set stripe_migration_required = true,
    payments_live_ready = false,
    updated_at = now()
where o.stripe_connected_account_id is null
  and (
    exists (
      select 1
      from private.organization_mollie_connect mc
      where mc.org_id = o.id
    )
    or exists (
      select 1
      from public.payments p
      join public.orders ord on ord.id = p.order_id
      join public.events e on e.id = ord.event_id
      where e.org_id = o.id
        and p.provider = 'mollie'
    )
  );

alter table public.subscriptions
  add column if not exists billing_deferred_until timestamptz;

comment on column public.subscriptions.billing_deferred_until is
  'Prevents manual subscription invoices before the complimentary transition date.';

update public.subscriptions s
set mollie_legacy_snapshot = coalesce(
      s.mollie_legacy_snapshot,
      jsonb_build_object(
        'customer_id', s.mollie_customer_id,
        'subscription_id', s.mollie_subscription_id,
        'status', s.status,
        'plan', s.plan,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'promo_code', s.promo_code,
        'discount_percent', s.discount_percent,
        'captured_at', now(),
        'transition_reason', 'mollie_service_termination_2026_09'
      )
    ),
    provider = 'manual',
    current_period_end = timestamptz '2026-11-01 00:00:00 Europe/Brussels',
    billing_deferred_until = timestamptz '2026-11-01 00:00:00 Europe/Brussels',
    updated_at = now()
where s.provider = 'mollie'
  and s.status = 'active'
  and s.plan in ('starter', 'pro')
  and s.current_period_end > now()
  and trim(coalesce(s.billing_price_value, '')) ~ '^\d+(\.\d{1,2})?$';

update public.organizations o
set plan_expires_at = s.current_period_end,
    updated_at = now()
from public.subscriptions s
where s.org_id = o.id
  and s.provider = 'manual'
  and s.status = 'active'
  and s.billing_deferred_until = timestamptz '2026-11-01 00:00:00 Europe/Brussels'
  and o.plan = s.plan;

create or replace function private.prevent_deferred_subscription_invoice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.provider = 'manual'
     and exists (
       select 1
       from public.subscriptions s
       where s.org_id = new.org_id
         and s.provider = 'manual'
         and s.status = 'active'
         and s.billing_deferred_until is not null
         and s.billing_deferred_until > now()
     )
  then
    raise exception 'BILLING_DEFERRED';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_deferred_subscription_invoice()
  from public, anon, authenticated;

drop trigger if exists trg_prevent_deferred_subscription_invoice
  on public.invoices;
create trigger trg_prevent_deferred_subscription_invoice
before insert on public.invoices
for each row execute function private.prevent_deferred_subscription_invoice();

create or replace function public.get_public_organization_sales_terms(
  p_org_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_slug text := nullif(trim(coalesce(p_org_slug, '')), '');
  v_result jsonb;
begin
  if v_slug is null then
    raise exception 'VALIDATION_ERROR: org_slug is required';
  end if;

  perform public.assert_rate_limit(
    'anon:org_sales_terms:' || v_slug,
    240,
    60
  );

  select jsonb_build_object(
    'display_name', op.display_name,
    'public_email', op.public_email,
    'phone', op.phone,
    'website', op.website,
    'sales_terms', op.sales_terms,
    'sales_terms_version', op.sales_terms_version,
    'sales_terms_accepted',
      op.sales_terms_accepted_at is not null
      and op.sales_terms_accepted_version = op.sales_terms_version
      and nullif(trim(coalesce(op.public_email, '')), '') is not null
      and trim(op.public_email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$',
    'paid_sales_available',
      o.status = 'active'
      and o.payments_provider = 'stripe'
      and owner_profile.stripe_connect_allowed = true
      and o.stripe_connected_account_id is not null
      and o.stripe_compliance_verified = true
      and o.stripe_details_submitted = true
      and o.stripe_charges_enabled = true
      and o.stripe_payouts_enabled = true
      and o.stripe_requirements_disabled_reason is null
      and jsonb_array_length(o.stripe_requirements_currently_due) = 0
  )
  into v_result
  from public.organization_profile op
  join public.organizations o on o.id = op.org_id
  left join public.user_profile owner_profile on owner_profile.user_id = o.created_by
  where op.slug = v_slug
  limit 1;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_public_organization_sales_terms(text)
  from public, anon, authenticated;
grant execute on function public.get_public_organization_sales_terms(text)
  to anon, authenticated;

create or replace function public.cancel_internal_subscription(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), ''),
    current_user
  );
  v_subscription public.subscriptions%rowtype;
begin
  if v_role not in ('service_role', 'postgres') then
    raise exception 'FORBIDDEN';
  end if;

  perform 1 from public.organizations where id = p_org_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select * into v_subscription
  from public.subscriptions
  where org_id = p_org_id
  for update;

  update public.organizations
  set plan = 'free',
      plan_started_at = now(),
      plan_expires_at = null,
      updated_at = now()
  where id = p_org_id;

  if found then
    update public.subscriptions
    set status = 'canceled',
        updated_at = now()
    where org_id = p_org_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'org_id', p_org_id,
    'previous_status', v_subscription.status,
    'previous_plan', v_subscription.plan
  );
end;
$$;

revoke all on function public.cancel_internal_subscription(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_internal_subscription(uuid)
  to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid, jobname, schedule, command
    from cron.job
    where jobname = 'send-reminder-mail'
      and command like '%/send-reminder-mail%'
  loop
    perform cron.unschedule(v_job.jobid);
    perform cron.schedule(
      v_job.jobname,
      v_job.schedule,
      replace(v_job.command, '/send-reminder-mail', '/workers/reminders')
    );
  end loop;
end;
$$;

create or replace function public.get_deployment_cron_status()
returns jsonb
language sql
security definer
stable
set search_path = pg_catalog, public, cron
as $$
  select jsonb_build_object(
    'reminder_jobs', count(*) filter (where jobname = 'send-reminder-mail'),
    'reminder_workers_jobs', count(*) filter (
      where jobname = 'send-reminder-mail'
        and active = true
        and command like '%/workers/reminders%'
    ),
    'legacy_reminder_jobs', count(*) filter (
      where command like '%/send-reminder-mail%'
    ),
    'renewal_jobs', count(*) filter (
      where jobname = 'eventflow-manual-subscription-renewals'
        and active = true
    )
  )
  from cron.job;
$$;

revoke all on function public.get_deployment_cron_status()
  from public, anon, authenticated;
grant execute on function public.get_deployment_cron_status()
  to service_role;

do $$
declare
  v_target_count integer;
begin
  select count(*) into v_target_count
  from public.organizations
  where lower(trim(name)) = 'jeunesse de monceau-imbrechies';

  if v_target_count > 1 then
    raise exception 'AMBIGUOUS_ORGANIZATION_SUSPENSION_TARGET';
  end if;

  update public.organizations
  set status = 'suspended',
      plan = 'free',
      plan_expires_at = null,
      updated_at = now()
  where lower(trim(name)) = 'jeunesse de monceau-imbrechies';

  update public.subscriptions s
  set status = 'canceled',
      updated_at = now()
  from public.organizations o
  where s.org_id = o.id
    and lower(trim(o.name)) = 'jeunesse de monceau-imbrechies'
    and s.status not in ('canceled', 'cancelled', 'expired');
end;
$$;

commit;
