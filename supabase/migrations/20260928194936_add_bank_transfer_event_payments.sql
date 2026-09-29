begin;

alter table public.organizations
  add column if not exists bank_transfer_beneficiary text,
  add column if not exists bank_transfer_iban text;

alter table public.organizations
  drop constraint if exists organizations_payments_provider_check;

alter table public.organizations
  add constraint organizations_payments_provider_check
  check (payments_provider in ('mollie', 'stripe', 'bank_transfer')) not valid;

alter table public.organizations
  validate constraint organizations_payments_provider_check;

alter table public.organizations
  add constraint organizations_bank_transfer_beneficiary_check
  check (
    bank_transfer_beneficiary is null
    or char_length(bank_transfer_beneficiary) between 2 and 160
  ) not valid;

alter table public.organizations
  validate constraint organizations_bank_transfer_beneficiary_check;

alter table public.organizations
  add constraint organizations_bank_transfer_iban_check
  check (
    bank_transfer_iban is null
    or (
      char_length(bank_transfer_iban) between 15 and 34
      and bank_transfer_iban ~ '^[A-Z]{2}[0-9A-Z]+$'
    )
  ) not valid;

alter table public.organizations
  validate constraint organizations_bank_transfer_iban_check;

alter table public.order_email_logs
  drop constraint if exists order_email_logs_kind_check;

alter table public.order_email_logs
  add constraint order_email_logs_kind_check
  check (
    kind in (
      'reminder_v1',
      'confirmation_v1',
      'bank_transfer_instructions_v1'
    )
  ) not valid;

alter table public.order_email_logs
  validate constraint order_email_logs_kind_check;

create or replace function public.update_organization_payment_settings(
  p_org_id uuid,
  p_provider text,
  p_bank_transfer_beneficiary text default null,
  p_bank_transfer_iban text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_provider text := lower(nullif(trim(coalesce(p_provider, '')), ''));
  v_beneficiary text := nullif(
    trim(regexp_replace(coalesce(p_bank_transfer_beneficiary, ''), '\s+', ' ', 'g')),
    ''
  );
  v_iban text := nullif(
    upper(regexp_replace(coalesce(p_bank_transfer_iban, ''), '\s+', '', 'g')),
    ''
  );
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_org_id is null then
    raise exception 'VALIDATION_ERROR: org_id is required';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  perform private.assert_rate_limit(
    'update_org_payment:user:' || v_user_id::text || ':org:' || p_org_id::text,
    30,
    60
  );

  if v_provider is null or v_provider not in ('stripe', 'bank_transfer') then
    raise exception 'VALIDATION_ERROR: invalid payment provider';
  end if;

  if v_beneficiary is not null
     and char_length(v_beneficiary) not between 2 and 160 then
    raise exception 'VALIDATION_ERROR: invalid bank transfer beneficiary';
  end if;

  if v_iban is not null
     and (
       char_length(v_iban) not between 15 and 34
       or v_iban !~ '^[A-Z]{2}[0-9A-Z]+$'
     ) then
    raise exception 'VALIDATION_ERROR: invalid IBAN';
  end if;

  if v_provider = 'bank_transfer'
     and (v_beneficiary is null or v_iban is null) then
    raise exception 'VALIDATION_ERROR: bank transfer details are required';
  end if;

  update public.organizations o
  set
    payments_provider = v_provider,
    bank_transfer_beneficiary = v_beneficiary,
    bank_transfer_iban = v_iban,
    stripe_migration_required = case
      when v_provider = 'bank_transfer' then false
      else o.stripe_migration_required
    end,
    updated_at = now()
  where o.id = p_org_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'orgId', o.id,
    'paymentsProvider', o.payments_provider,
    'bankTransferBeneficiary', o.bank_transfer_beneficiary,
    'bankTransferIban', o.bank_transfer_iban
  )
  into v_result
  from public.organizations o
  where o.id = p_org_id;

  return v_result;
end;
$$;

revoke all on function public.update_organization_payment_settings(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_payment_settings(uuid, text, text, text)
  to authenticated;

commit;
