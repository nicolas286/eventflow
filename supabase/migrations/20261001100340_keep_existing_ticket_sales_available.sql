begin;
-- Contract reacceptance is collected separately: it must not suspend existing
-- ticket sales. Buyer acceptance and Stripe readiness remain enforced.
create or replace function public.create_order_intent_with_terms(p_event_id uuid,p_items jsonb,p_attendees jsonb,p_buyer jsonb,p_rate_key text,p_promo_code text,
 p_platform_terms_version text,p_platform_terms_snapshot text,p_organizer_sales_terms_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_org uuid; p public.organization_profile%rowtype; v_order jsonb; v_paid boolean;
begin
 if p_platform_terms_version is distinct from '2026-10-01' or char_length(coalesce(p_platform_terms_snapshot,''))<100 then raise exception 'TERMS_CHANGED_RELOAD'; end if;
 select org_id into v_org from public.events where id=p_event_id;
 select * into p from public.organization_profile where org_id=v_org for share;
 if p_organizer_sales_terms_version is not null and p_organizer_sales_terms_version is distinct from p.sales_terms_version then raise exception 'TERMS_CHANGED_RELOAD'; end if;
 v_order:=public.create_order_intent(p_event_id,p_items,p_attendees,p_buyer,p_rate_key,p_promo_code);
 v_paid:=coalesce((v_order->>'payment_required')::boolean,false) and coalesce((v_order->>'amount_due_now_cents')::integer,0)>0;
 if v_paid then
  if p_organizer_sales_terms_version is distinct from p.sales_terms_version then raise exception 'TERMS_CHANGED_RELOAD'; end if;
  if not exists (
   select 1 from public.organizations o
   join public.user_profile u on u.user_id=o.created_by
   where o.id=v_org and o.status='active' and o.payments_provider='stripe'
    and u.stripe_connect_allowed=true and o.stripe_connected_account_id is not null
    and o.stripe_compliance_verified=true and o.stripe_details_submitted=true
    and o.stripe_charges_enabled=true and o.stripe_payouts_enabled=true
    and o.stripe_requirements_disabled_reason is null
    and jsonb_array_length(o.stripe_requirements_currently_due)=0
  ) then raise exception 'ORG_STRIPE_ONBOARDING_INCOMPLETE'; end if;
 end if;
 update public.orders set platform_terms_version=p_platform_terms_version,platform_terms_snapshot=p_platform_terms_snapshot,
 organizer_sales_terms_version=case when p_organizer_sales_terms_version is not null then p.sales_terms_version end,
 organizer_sales_terms_snapshot=case when p_organizer_sales_terms_version is not null then p.sales_terms end,
 organizer_display_name_snapshot=p.display_name,
 organizer_identity_snapshot=jsonb_build_object('display_name',p.display_name,'legal_name',p.seller_legal_name,'address',p.seller_address,'business_number',p.seller_business_number,'seller_type',p.seller_type,'email',p.public_email,'phone',p.phone,'website',p.website),
 terms_accepted_at=now() where id=(v_order->>'order_id')::uuid;
 return v_order;
end; $$;
revoke all on function public.create_order_intent_with_terms(uuid,jsonb,jsonb,jsonb,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_order_intent_with_terms(uuid,jsonb,jsonb,jsonb,text,text,text,text,text) to service_role;


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
    'seller_legal_name', op.seller_legal_name,
    'seller_address', op.seller_address,
    'seller_business_number', op.seller_business_number,
    'seller_type', op.seller_type,
    'connect_terms_accepted_version', op.connect_terms_accepted_version,
    'dpa_accepted_version', op.dpa_accepted_version,
    'display_name', op.display_name,
    'public_email', op.public_email,
    'phone', op.phone,
    'website', op.website,
    'sales_terms', op.sales_terms,
    'sales_terms_version', op.sales_terms_version,
    'sales_terms_accepted', coalesce(op.sales_terms_accepted_at is not null and op.sales_terms_accepted_version=op.sales_terms_version, false),
    'sales_terms_available', coalesce(char_length(trim(op.sales_terms)) >= 200 and trim(coalesce(op.public_email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$', false),
    'paid_sales_available', coalesce(
      o.status = 'active'
      and o.payments_provider = 'stripe'
      and owner_profile.stripe_connect_allowed = true
      and o.stripe_connected_account_id is not null
      and o.stripe_compliance_verified = true
      and o.stripe_details_submitted = true
      and o.stripe_charges_enabled = true
      and o.stripe_payouts_enabled = true
      and o.stripe_requirements_disabled_reason is null
      and jsonb_array_length(o.stripe_requirements_currently_due) = 0, false)
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



commit;
