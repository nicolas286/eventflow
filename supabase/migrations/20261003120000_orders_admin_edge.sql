-- B3: additive service-only operations. Browser closure is deferred.
begin;
create or replace function public.organizer_get_event_admin_orders_view(
  p_event_id uuid default null,
  p_org_id uuid default null,
  p_event_slug text default null,
  p_orders_limit integer default 200,
  p_orders_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;

  v_orders_total integer;
  v_orders jsonb;
  v_order_ids uuid[];

  v_order_items jsonb;
  v_payments jsonb;

  v_attendees jsonb;
  v_attendee_ids uuid[];
  v_attendee_answers jsonb;

  v_slug text := nullif(trim(p_event_slug), '');
begin
  perform set_config('search_path', 'pg_temp, public, extensions, private', true);

  /* ---------------- Auth ---------------- */



  if p_orders_limit < 1 or p_orders_limit > 1000 then
    raise exception 'VALIDATION_ERROR: orders_limit out of range';
  end if;

  if p_orders_offset is null or p_orders_offset < 0 then
    raise exception 'VALIDATION_ERROR: orders_offset out of range';
  end if;

  /* -------- Resolve event_id if needed -------- */

  if p_event_id is null then
    if p_org_id is null or v_slug is null then
      raise exception 'VALIDATION_ERROR: org_id + event_slug required';
    end if;

    select e.id
    into p_event_id
    from public.events e
    where e.org_id = p_org_id
      and e.slug = v_slug
    limit 1;

    if p_event_id is null then
      raise exception 'NOT_FOUND';
    end if;
  end if;

  /* ---------------- Membership ---------------- */


  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;


  /* ---------------- Orders total ---------------- */

  select count(*)
  into v_orders_total
  from public.orders o
  where o.event_id = p_event_id and o.org_id = p_org_id;

  /* ---------------- Orders page ---------------- */

  with o_page as (
    select o.*
    from public.orders o
    where o.event_id = p_event_id and o.org_id = p_org_id
    order by o.created_at desc, o.id desc
    limit p_orders_limit
    offset p_orders_offset
  ),
  redemptions as (
    select
      pcr.order_id,
      pcr.discount_cents,
      jsonb_build_object(
        'id', pcr.id,
        'promoCodeId', pcr.promo_code_id,
        'code', pc.code,
        'discountCents', pcr.discount_cents,
        'createdAt', pcr.created_at
      ) as promo_redemption
    from public.promo_code_redemptions pcr
    left join public.promo_codes pc on pc.id = pcr.promo_code_id
    where pcr.order_id in (select id from o_page)
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o_page.id,
          'orgId', o_page.org_id,
          'eventId', o_page.event_id,

          'currency', o_page.currency,

          'totalCents', coalesce(o_page.total_cents, 0),
          'paidCents', coalesce(o_page.paid_cents, 0),
          'discountCents', coalesce(redemptions.discount_cents, 0),
          'dueCents', greatest(
            coalesce(o_page.total_cents, 0)
            - coalesce(redemptions.discount_cents, 0)
            - coalesce(o_page.paid_cents, 0),
            0
          ),

          'promoRedemption', redemptions.promo_redemption,

          'status', o_page.status,

          'buyerEmail', o_page.buyer_email,
          'buyerName', o_page.buyer_name,
          'buyerPhone', o_page.buyer_phone,
          'buyerIsAttendee', coalesce(o_page.buyer_is_attendee, false),

          'depositDueCentsSnapshot', coalesce(o_page.deposit_due_cents_snapshot, 0),

          'createdAt', o_page.created_at,
          'updatedAt', o_page.updated_at,
          'expiresAt', o_page.expires_at,
          'confirmedAt', o_page.confirmed_at,
          'detailsCompletedAt', o_page.details_completed_at,
          'canceledAt', o_page.canceled_at
        )
        order by o_page.created_at desc, o_page.id desc
      ),
      '[]'::jsonb
    ),
    coalesce(array_agg(o_page.id), '{}'::uuid[])
  into v_orders, v_order_ids
  from o_page
  left join redemptions on redemptions.order_id = o_page.id;

  /* ---------------- Order items ---------------- */

  select coalesce(
    jsonb_agg(to_jsonb(oi) order by oi.created_at asc, oi.id asc),
    '[]'::jsonb
  )
  into v_order_items
  from public.order_items oi
  where oi.order_id = any(v_order_ids);

  /* ---------------- Payments ---------------- */

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'orderId', p.order_id,
        'provider', p.provider,
        'providerPaymentId', p.provider_payment_id,
        'amountCents', p.amount_cents,
        'currency', p.currency,
        'status', p.status,
        'type', p.type,
        'isRefund', p.is_refund,
        'parentPaymentId', p.parent_payment_id,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'processedAt', p.processed_at
      )
      order by p.created_at asc, p.id asc
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.order_id = any(v_order_ids);

  /* ---------------- Attendees ---------------- */

  with attendees_page_orders as (
    select oa.*
    from public.order_attendees oa
    where oa.order_id = any(v_order_ids)
    order by oa.created_at desc, oa.id desc
  )
  select
    coalesce(jsonb_agg(to_jsonb(attendees_page_orders)), '[]'::jsonb),
    coalesce(array_agg(attendees_page_orders.id), '{}'::uuid[])
  into v_attendees, v_attendee_ids
  from attendees_page_orders;

  /* ---------------- Attendee answers ---------------- */

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ans.id,
        'attendeeId', ans.attendee_id,
        'fieldKeySnapshot', ans.field_key_snapshot,
        'fieldTypeSnapshot', ans.field_type_snapshot,
        'fieldLabelSnapshot', ans.field_label_snapshot,
        'value',
          case ans.field_type_snapshot
            when 'checkbox' then
              case
                when ans.value ? 'value_bool' then (ans.value->>'value_bool')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'number' then
              case
                when ans.value ? 'value_int' then (ans.value->>'value_int')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'date' then
              coalesce(ans.value->>'value_date', ans.value->>'value_text', ans.value #>> '{}')
            else
              coalesce(ans.value->>'value_text', ans.value #>> '{}')
          end,
        'createdAt', ans.created_at,
        'updatedAt', ans.updated_at
      )
      order by ans.created_at asc, ans.id asc
    ),
    '[]'::jsonb
  )
  into v_attendee_answers
  from public.order_attendee_answers ans
  where ans.attendee_id = any(v_attendee_ids);

  /* ---------------- Final payload ---------------- */

  v_result := jsonb_build_object(
    'orders', jsonb_build_object(
      'limit', p_orders_limit,
      'offset', p_orders_offset,
      'total', v_orders_total,
      'rows', v_orders
    ),
    'orderItems', v_order_items,
    'payments', v_payments,
    'attendees', v_attendees,
    'attendeeAnswers', v_attendee_answers
  );

  return v_result;
end;
$$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_get_event_admin_orders_view' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

CREATE OR REPLACE FUNCTION public.organizer_search_event_admin_orders_view(p_org_id uuid DEFAULT NULL::uuid, p_event_slug text DEFAULT NULL::text, p_event_id uuid DEFAULT NULL::uuid, p_query text DEFAULT ''::text, p_filter_mode text DEFAULT 'all'::text, p_orders_limit integer DEFAULT 50, p_orders_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, private
AS $function$
declare
  v_result jsonb;

  v_orders_total integer;
  v_orders jsonb;
  v_order_ids uuid[];

  v_order_items jsonb;
  v_payments jsonb;

  v_attendees jsonb;
  v_attendee_ids uuid[];
  v_attendee_answers jsonb;

  v_slug text := nullif(trim(p_event_slug), '');
  v_query text := nullif(trim(p_query), '');
  v_filter_mode text := coalesce(nullif(trim(p_filter_mode), ''), 'all');
begin
  /* ---------------- Auth ---------------- */



  if p_orders_limit < 1 or p_orders_limit > 1000 then
    raise exception 'VALIDATION_ERROR: orders_limit out of range';
  end if;

  if p_orders_offset is null or p_orders_offset < 0 then
    raise exception 'VALIDATION_ERROR: orders_offset out of range';
  end if;

  /* -------- Resolve event_id if needed -------- */

  if p_event_id is null then
    if p_org_id is null or v_slug is null then
      raise exception 'VALIDATION_ERROR: org_id + event_slug required';
    end if;

    select e.id
    into p_event_id
    from public.events e
    where e.org_id = p_org_id
      and e.slug = v_slug
    limit 1;

    if p_event_id is null then
      raise exception 'NOT_FOUND';
    end if;
  end if;

  /* ---------------- Membership ---------------- */


  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;


  /* ---------------- Orders total ---------------- */

  with matched_orders as (
    select distinct o.id
    from public.orders o
    left join public.order_attendees oa
      on oa.order_id = o.id
    left join public.order_attendee_answers ans
      on ans.attendee_id = oa.id
    where o.event_id = p_event_id and o.org_id = p_org_id
      and (
        v_query is null
        or
        case
          when v_filter_mode = 'order' then
            (
              coalesce(o.buyer_email, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_name, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_phone, '') ilike '%' || v_query || '%'
              or o.id::text ilike '%' || v_query || '%'
              or coalesce(o.status, '') ilike '%' || v_query || '%'
            )

          when v_filter_mode like 'field:%' then
            (
              ans.field_key_snapshot = replace(v_filter_mode, 'field:', '')
              and (
                coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
                or ans.value::text ilike '%' || v_query || '%'
              )
            )

          else
            (
              coalesce(o.buyer_email, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_name, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_phone, '') ilike '%' || v_query || '%'
              or o.id::text ilike '%' || v_query || '%'
              or coalesce(o.status, '') ilike '%' || v_query || '%'

              or oa.id::text ilike '%' || v_query || '%'
              or coalesce(oa.product_name_snapshot, '') ilike '%' || v_query || '%'
              or oa.attendee_index::text ilike '%' || v_query || '%'
              or coalesce(oa.status, '') ilike '%' || v_query || '%'

              or coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
              or coalesce(ans.field_key_snapshot, '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
              or ans.value::text ilike '%' || v_query || '%'
            )
        end
      )
  )
  select count(*)
  into v_orders_total
  from matched_orders;

  /* ---------------- Orders page ---------------- */

  with matched_orders as (
    select distinct o.id, o.created_at
    from public.orders o
    left join public.order_attendees oa
      on oa.order_id = o.id
    left join public.order_attendee_answers ans
      on ans.attendee_id = oa.id
    where o.event_id = p_event_id and o.org_id = p_org_id
      and (
        v_query is null
        or
        case
          when v_filter_mode = 'order' then
            (
              coalesce(o.buyer_email, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_name, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_phone, '') ilike '%' || v_query || '%'
              or o.id::text ilike '%' || v_query || '%'
              or coalesce(o.status, '') ilike '%' || v_query || '%'
            )

          when v_filter_mode like 'field:%' then
            (
              ans.field_key_snapshot = replace(v_filter_mode, 'field:', '')
              and (
                coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
                or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
                or ans.value::text ilike '%' || v_query || '%'
              )
            )

          else
            (
              coalesce(o.buyer_email, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_name, '') ilike '%' || v_query || '%'
              or coalesce(o.buyer_phone, '') ilike '%' || v_query || '%'
              or o.id::text ilike '%' || v_query || '%'
              or coalesce(o.status, '') ilike '%' || v_query || '%'

              or oa.id::text ilike '%' || v_query || '%'
              or coalesce(oa.product_name_snapshot, '') ilike '%' || v_query || '%'
              or oa.attendee_index::text ilike '%' || v_query || '%'
              or coalesce(oa.status, '') ilike '%' || v_query || '%'

              or coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
              or coalesce(ans.field_key_snapshot, '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
              or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
              or ans.value::text ilike '%' || v_query || '%'
            )
        end
      )
  ),
  o_page as (
    select o.*
    from public.orders o
    join matched_orders mo on mo.id = o.id
    order by o.created_at desc, o.id desc
    limit p_orders_limit
    offset p_orders_offset
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o_page.id,
          'orgId', o_page.org_id,
          'eventId', o_page.event_id,
          'currency', o_page.currency,
          'totalCents', o_page.total_cents,
          'paidCents', coalesce(o_page.paid_cents, 0),
          'status', o_page.status,
          'buyerEmail', o_page.buyer_email,
          'buyerName', o_page.buyer_name,
          'buyerPhone', o_page.buyer_phone,
          'buyerIsAttendee', coalesce(o_page.buyer_is_attendee, false),
          'depositDueCentsSnapshot', coalesce(o_page.deposit_due_cents_snapshot, 0),
          'createdAt', o_page.created_at,
          'updatedAt', o_page.updated_at,
          'expiresAt', o_page.expires_at,
          'confirmedAt', o_page.confirmed_at,
          'detailsCompletedAt', o_page.details_completed_at,
          'canceledAt', o_page.canceled_at
        )
        order by o_page.created_at desc, o_page.id desc
      ),
      '[]'::jsonb
    ),
    coalesce(array_agg(o_page.id), '{}'::uuid[])
  into v_orders, v_order_ids
  from o_page;

  /* ---------------- Order items ---------------- */

  select coalesce(
    jsonb_agg(to_jsonb(oi) order by oi.created_at asc, oi.id asc),
    '[]'::jsonb
  )
  into v_order_items
  from public.order_items oi
  where oi.order_id = any(coalesce(v_order_ids, '{}'::uuid[]));

  /* ---------------- Payments ---------------- */

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'orderId', p.order_id,
        'provider', p.provider,
        'providerPaymentId', p.provider_payment_id,
        'amountCents', p.amount_cents,
        'currency', p.currency,
        'status', p.status,
        'type', p.type,
        'isRefund', p.is_refund,
        'parentPaymentId', p.parent_payment_id,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'processedAt', p.processed_at
      )
      order by p.created_at asc, p.id asc
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.order_id = any(coalesce(v_order_ids, '{}'::uuid[]));

  /* ---------------- Attendees ---------------- */

  with attendees_page_orders as (
    select oa.*
    from public.order_attendees oa
    where oa.order_id = any(coalesce(v_order_ids, '{}'::uuid[]))
    order by oa.created_at desc, oa.id desc
  )
  select
    coalesce(jsonb_agg(to_jsonb(attendees_page_orders)), '[]'::jsonb),
    coalesce(array_agg(attendees_page_orders.id), '{}'::uuid[])
  into v_attendees, v_attendee_ids
  from attendees_page_orders;

  /* ---------------- Attendee answers ---------------- */

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ans.id,
        'attendeeId', ans.attendee_id,
        'fieldKeySnapshot', ans.field_key_snapshot,
        'fieldTypeSnapshot', ans.field_type_snapshot,
        'fieldLabelSnapshot', ans.field_label_snapshot,
        'value',
          case ans.field_type_snapshot
            when 'checkbox' then
              case
                when ans.value ? 'value_bool' then (ans.value->>'value_bool')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'number' then
              case
                when ans.value ? 'value_int' then (ans.value->>'value_int')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'date' then
              coalesce(ans.value->>'value_date', ans.value->>'value_text', ans.value #>> '{}')
            else
              coalesce(ans.value->>'value_text', ans.value #>> '{}')
          end,
        'createdAt', ans.created_at,
        'updatedAt', ans.updated_at
      )
      order by ans.created_at asc, ans.id asc
    ),
    '[]'::jsonb
  )
  into v_attendee_answers
  from public.order_attendee_answers ans
  where ans.attendee_id = any(coalesce(v_attendee_ids, '{}'::uuid[]));

  /* ---------------- Final payload ---------------- */

  v_result := jsonb_build_object(
    'orders', jsonb_build_object(
      'limit', p_orders_limit,
      'offset', p_orders_offset,
      'total', v_orders_total,
      'rows', v_orders
    ),
    'orderItems', v_order_items,
    'payments', v_payments,
    'attendees', v_attendees,
    'attendeeAnswers', v_attendee_answers
  );

  return v_result;
end;
$function$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_search_event_admin_orders_view' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

CREATE OR REPLACE FUNCTION public.organizer_search_event_admin_tickets_view(p_org_id uuid, p_event_id uuid, p_query text DEFAULT ''::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, private
AS $function$
declare

  v_total integer;
  v_rows jsonb;
  v_result jsonb;

  v_query text := nullif(trim(p_query), '');
begin
  /* ---------------- Auth ---------------- */



  if p_limit < 1 or p_limit > 1000 then
    raise exception 'VALIDATION_ERROR: limit out of range';
  end if;

  if p_offset is null or p_offset < 0 then
    raise exception 'VALIDATION_ERROR: offset out of range';
  end if;

  /* ---------------- Membership ---------------- */


  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;


  /* ---------------- Total ---------------- */

  with matched_tickets as (
    select distinct t.id
    from public.tickets t
    join public.orders o
      on o.id = t.order_id
    join public.order_items oi
      on oi.id = t.order_item_id
    join public.event_products ep
      on ep.id = t.product_id
    left join public.order_attendees oa
      on oa.order_id = t.order_id
     and oa.product_id = t.product_id
    left join public.order_attendee_answers ans
      on ans.attendee_id = oa.id
    where t.event_id = p_event_id and o.event_id=p_event_id and o.org_id=p_org_id and ep.event_id=p_event_id and oi.order_id=o.id
      and (
        v_query is null
        or (
          t.id::text ilike '%' || v_query || '%'
          or t.order_id::text ilike '%' || v_query || '%'
          or t.order_item_id::text ilike '%' || v_query || '%'
          or t.product_id::text ilike '%' || v_query || '%'
          or t.qr_token ilike '%' || v_query || '%'
          or right(t.qr_token, 8) ilike '%' || v_query || '%'
          or t.ticket_index::text ilike '%' || v_query || '%'
          or coalesce(t.status, '') ilike '%' || v_query || '%'

          or coalesce(oi.product_name_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(o.buyer_email, '') ilike '%' || v_query || '%'

          or coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(ans.field_key_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
          or ans.value::text ilike '%' || v_query || '%'
        )
      )
  )
  select count(*)
  into v_total
  from matched_tickets;

  /* ---------------- Tickets ---------------- */

  with matched_tickets as (
    select distinct
      t.id,
      t.created_at
    from public.tickets t
    join public.orders o
      on o.id = t.order_id
    join public.order_items oi
      on oi.id = t.order_item_id
    join public.event_products ep
      on ep.id = t.product_id
    left join public.order_attendees oa
      on oa.order_id = t.order_id
     and oa.product_id = t.product_id
    left join public.order_attendee_answers ans
      on ans.attendee_id = oa.id
    where t.event_id = p_event_id and o.event_id=p_event_id and o.org_id=p_org_id and ep.event_id=p_event_id and oi.order_id=o.id
      and (
        v_query is null
        or (
          t.id::text ilike '%' || v_query || '%'
          or t.order_id::text ilike '%' || v_query || '%'
          or t.order_item_id::text ilike '%' || v_query || '%'
          or t.product_id::text ilike '%' || v_query || '%'
          or t.qr_token ilike '%' || v_query || '%'
          or right(t.qr_token, 8) ilike '%' || v_query || '%'
          or t.ticket_index::text ilike '%' || v_query || '%'
          or coalesce(t.status, '') ilike '%' || v_query || '%'

          or coalesce(oi.product_name_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(o.buyer_email, '') ilike '%' || v_query || '%'

          or coalesce(ans.field_label_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(ans.field_key_snapshot, '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_text', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_date', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_bool', '') ilike '%' || v_query || '%'
          or coalesce(ans.value->>'value_int', '') ilike '%' || v_query || '%'
          or ans.value::text ilike '%' || v_query || '%'
        )
      )
  ),
  t_page as (
    select
      t.id,
      t.order_id,
      t.order_item_id,
      t.product_id,
      t.ticket_index,
      t.qr_token,
      t.status,
      t.checked_in_at,
      t.created_at,

      oi.product_name_snapshot,
      oi.unit_price_cents_snapshot,

      ep.creates_attendees,
      t.admits_count,

      o.created_at as order_created_at,
      o.buyer_email

    from public.tickets t
    join matched_tickets mt
      on mt.id = t.id
    join public.orders o
      on o.id = t.order_id
    join public.order_items oi
      on oi.id = t.order_item_id
    join public.event_products ep
      on ep.id = t.product_id
    order by t.created_at desc, t.id desc
    limit p_limit
    offset p_offset
  ),

  attendees_ranked as (
    select
      oa.id,
      oa.order_id,
      oa.product_id,
      oa.attendee_index,
      row_number() over (
        partition by oa.order_id, oa.product_id
        order by oa.attendee_index asc, oa.created_at asc, oa.id asc
      ) as rn
    from public.order_attendees oa
    where oa.order_id in (select distinct order_id from t_page)
  ),

  answers_ranked as (
    select
      ans.attendee_id,
      coalesce(nullif(trim(ans.field_key_snapshot), ''), '') as field_key_snapshot,
      coalesce(
        nullif(trim(ans.field_label_snapshot), ''),
        nullif(trim(ans.field_key_snapshot), ''),
        'Champ'
      ) as field_label_snapshot,
      case
        when jsonb_typeof(ans.value) = 'string' then trim(both '"' from ans.value::text)
        when jsonb_typeof(ans.value) = 'number' then ans.value::text
        when jsonb_typeof(ans.value) = 'boolean' then
          case when ans.value::text = 'true' then 'Oui' else 'Non' end
        when jsonb_typeof(ans.value) = 'object' then
          coalesce(
            nullif(ans.value->>'value_text', ''),
            nullif(ans.value->>'value_date', ''),
            nullif(ans.value->>'value_int', ''),
            case
              when ans.value ? 'value_bool' then
                case when ans.value->>'value_bool' = 'true' then 'Oui' else 'Non' end
              else null
            end
          )
        else null
      end as rendered_value
    from public.order_attendee_answers ans
    where ans.attendee_id in (select id from attendees_ranked)
  )

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'orderId', t.order_id,
        'orderItemId', t.order_item_id,

        'productId', t.product_id,
        'productNameSnapshot', t.product_name_snapshot,
        'unitPriceCentsSnapshot', t.unit_price_cents_snapshot,

        'ticketIndex', t.ticket_index,
        'reference', right(t.qr_token, 8),
        'qrToken', t.qr_token,

        'status', t.status,
        'checkedInAt', t.checked_in_at,
        'createdAt', t.created_at,

        'createsAttendees', t.creates_attendees,
        'admitsCount', t.admits_count,

        'orderCreatedAt', t.order_created_at,
        'buyerEmail', t.buyer_email,

        'attendeeSummaryLines',
          case
            when not t.creates_attendees then '[]'::jsonb
            else coalesce((
              select jsonb_agg(s.line order by s.priority, s.attendee_rn, s.answer_ord)
              from (
                select *
                from (
                  select
                    ar.rn as attendee_rn,
                    case
                      when lower(coalesce(a.field_key_snapshot, '')) in ('first_name', 'firstname', 'prenom', 'prÃ©nom') then 1
                      when lower(coalesce(a.field_key_snapshot, '')) in ('last_name', 'lastname', 'nom') then 2
                      when lower(coalesce(a.field_key_snapshot, '')) in ('email', 'e-mail', 'mail') then 3
                      else 10
                    end as priority,
                    row_number() over (
                      partition by ar.id
                      order by
                        case
                          when lower(coalesce(a.field_key_snapshot, '')) in ('first_name', 'firstname', 'prenom', 'prÃ©nom') then 1
                          when lower(coalesce(a.field_key_snapshot, '')) in ('last_name', 'lastname', 'nom') then 2
                          when lower(coalesce(a.field_key_snapshot, '')) in ('email', 'e-mail', 'mail') then 3
                          else 10
                        end,
                        a.field_label_snapshot
                    ) as answer_ord,
                    (a.field_label_snapshot || ' : ' || a.rendered_value) as line
                  from attendees_ranked ar
                  join answers_ranked a
                    on a.attendee_id = ar.id
                  where ar.order_id = t.order_id
                    and ar.product_id = t.product_id
                    and ar.rn between
                      (((t.ticket_index - 1) * greatest(t.admits_count, 1)) + 1)
                      and
                      (t.ticket_index * greatest(t.admits_count, 1))
                    and a.rendered_value is not null
                    and nullif(trim(a.rendered_value), '') is not null
                ) ranked_answers
                where ranked_answers.answer_ord <= 2
                order by ranked_answers.priority, ranked_answers.attendee_rn, ranked_answers.answer_ord
                limit 2
              ) s
            ), '[]'::jsonb)
          end
      )
      order by t.created_at desc, t.id desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from t_page t;

  /* ---------------- Payload ---------------- */

  v_result := jsonb_build_object(
    'tickets', jsonb_build_object(
      'limit', p_limit,
      'offset', p_offset,
      'total', v_total,
      'rows', v_rows
    )
  );

  return v_result;
end;
$function$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_search_event_admin_tickets_view' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

CREATE OR REPLACE FUNCTION public.organizer_get_event_admin_participants_export_data(p_event_id uuid DEFAULT NULL::uuid, p_org_id uuid DEFAULT NULL::uuid, p_event_slug text DEFAULT NULL::text, p_confirmed_only boolean DEFAULT true, p_limit integer default 100, p_after uuid default null, p_through uuid default null, p_snapshot timestamptz default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, private
AS $function$
declare
  v_result jsonb;
  v_snapshot timestamptz := coalesce(p_snapshot, statement_timestamp());
  v_through uuid;
  v_next uuid;

  v_orders jsonb;
  v_order_ids uuid[];

  v_order_items jsonb;

  v_attendees jsonb;
  v_attendee_ids uuid[];
  v_attendee_answers jsonb;

  v_slug text := nullif(trim(p_event_slug), '');
begin
  /* ---------------- Auth ---------------- */



  /* -------- Resolve event_id if needed -------- */

  if p_event_id is null then
    if p_org_id is null or v_slug is null then
      raise exception 'VALIDATION_ERROR: org_id + event_slug required';
    end if;

    select e.id
    into p_event_id
    from public.events e
    where e.org_id = p_org_id
      and e.slug = v_slug
    limit 1;

    if p_event_id is null then
      raise exception 'NOT_FOUND';
    end if;
  end if;

  /* ---------------- Membership ---------------- */


  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;



  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'VALIDATION_ERROR'; end if;
  if p_after is not null and (p_through is null or p_snapshot is null) then raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(p_through,(select id from public.orders where event_id=p_event_id and org_id=p_org_id order by id desc limit 1)) into v_through;
  if p_after is not null and not exists(select 1 from public.orders where id=p_after and org_id=p_org_id and event_id=p_event_id and id<=p_through and created_at<=v_snapshot) then raise exception 'FORBIDDEN'; end if;
  -- Immutable UUID keyset and fixed upper key; not an MVCC snapshot.


  with o_all as (
    select o.*
    from public.orders o
    where o.event_id = p_event_id and o.org_id = p_org_id
    and (p_after is null or o.id>p_after) and o.id<=v_through and o.created_at<=v_snapshot
    order by o.id asc limit p_limit
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', o_all.id,
          'orgId', o_all.org_id,
          'eventId', o_all.event_id,
          'currency', o_all.currency,
          'totalCents', o_all.total_cents,
          'paidCents', coalesce(o_all.paid_cents, 0),
          'status', o_all.status,
          'buyerEmail', o_all.buyer_email,
          'buyerName', o_all.buyer_name,
          'buyerPhone', o_all.buyer_phone,
          'buyerIsAttendee', coalesce(o_all.buyer_is_attendee, false),
          'depositDueCentsSnapshot', coalesce(o_all.deposit_due_cents_snapshot, 0),
          'createdAt', o_all.created_at,
          'updatedAt', o_all.updated_at,
          'expiresAt', o_all.expires_at,
          'confirmedAt', o_all.confirmed_at,
          'detailsCompletedAt', o_all.details_completed_at,
          'canceledAt', o_all.canceled_at
        )
        order by o_all.created_at desc, o_all.id desc
      ),
      '[]'::jsonb
    ),
    coalesce(array_agg(o_all.id), '{}'::uuid[])
  into v_orders, v_order_ids
  from o_all;

  /* ---------------- Order items ---------------- */

  select coalesce(
    jsonb_agg(to_jsonb(oi) order by oi.created_at asc, oi.id asc),
    '[]'::jsonb
  )
  into v_order_items
  from public.order_items oi
  where oi.order_id = any(v_order_ids);

  /* ---------------- Attendees ---------------- */

  with attendees_all as (
    select oa.*
    from public.order_attendees oa
    where oa.order_id = any(v_order_ids)
      and (
        not p_confirmed_only
        or oa.status = 'confirmed'
      )
    order by oa.created_at desc, oa.id desc
  )
  select
    coalesce(jsonb_agg(to_jsonb(attendees_all)), '[]'::jsonb),
    coalesce(array_agg(attendees_all.id), '{}'::uuid[])
  into v_attendees, v_attendee_ids
  from attendees_all;

  /* ---------------- Attendee answers ---------------- */

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ans.id,
        'attendeeId', ans.attendee_id,
        'fieldKeySnapshot', ans.field_key_snapshot,
        'fieldTypeSnapshot', ans.field_type_snapshot,
        'fieldLabelSnapshot', ans.field_label_snapshot,
        'value',
          case ans.field_type_snapshot
            when 'checkbox' then
              case
                when ans.value ? 'value_bool' then (ans.value->>'value_bool')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'number' then
              case
                when ans.value ? 'value_int' then (ans.value->>'value_int')
                else coalesce(ans.value->>'value_text', ans.value #>> '{}')
              end
            when 'date' then
              coalesce(ans.value->>'value_date', ans.value->>'value_text', ans.value #>> '{}')
            else
              coalesce(ans.value->>'value_text', ans.value #>> '{}')
          end,
        'createdAt', ans.created_at,
        'updatedAt', ans.updated_at
      )
      order by ans.created_at asc, ans.id asc
    ),
    '[]'::jsonb
  )
  into v_attendee_answers
  from public.order_attendee_answers ans
  where ans.attendee_id = any(v_attendee_ids);

  /* ---------------- Final payload ---------------- */

  v_result := jsonb_build_object(
    'orders', jsonb_build_object(
      'rows', v_orders
    ),
    'orderItems', v_order_items,
    'attendees', v_attendees,
    'attendeeAnswers', v_attendee_answers
  );


  select id into v_next from public.orders where id=any(v_order_ids) order by id desc limit 1;
  if not exists(select 1 from public.orders where event_id=p_event_id and org_id=p_org_id and id>v_next and id<=v_through and created_at<=v_snapshot) then v_next:=null; end if;
  return v_result || jsonb_build_object('nextCursor',case when v_next is null then null else jsonb_build_object('after',v_next,'through',v_through,'snapshot',v_snapshot) end);

end;
$function$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_get_event_admin_participants_export_data' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

create or replace function public.organizer_get_bank_transfer_admin_summaries(p_org_id uuid, p_event_id uuid, p_limit integer default 100, p_after uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare

  v_result jsonb;
begin



  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'amountCents', p.amount_cents,
    'currency', p.currency,
    'internalReference', coalesce(i.internal_reference, o.id::text),
    'communication', coalesce(i.communication, p.raw->>'communication'),
    'createdAt', o.created_at,
    'paymentDueAt', null,
    'confirmedAt', coalesce(i.confirmed_at, p.manual_confirmed_at),
    'confirmedBy', coalesce(i.confirmed_by, p.manual_confirmed_by)
  ) order by o.id asc), '[]'::jsonb)
  into v_result
  from (select * from public.orders where event_id=p_event_id and org_id=p_org_id and (p_after is null or id>p_after) and exists(select 1 from public.payments bp where bp.order_id=orders.id and bp.provider='offline' and bp.provider_payment_id='bank_transfer:'||orders.id::text and bp.type='payment') order by id asc limit p_limit) o
  join public.payments p
    on p.order_id = o.id
   and p.provider = 'offline'
   and p.provider_payment_id = 'bank_transfer:' || o.id::text
   and p.type = 'payment'
  left join private.bank_transfer_payment_instructions i
    on i.order_id = o.id
  where o.event_id = p_event_id and o.org_id = p_org_id;

  return v_result;
end;
$$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_get_bank_transfer_admin_summaries' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

CREATE OR REPLACE FUNCTION public.organizer_admin_update_order_attendee(p_actor_id uuid, p_org_id uuid, p_event_id uuid, p_attendee_id uuid, p_attendee jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, private
AS $function$declare
  v_user_id uuid := p_actor_id;

  v_attendee record;
  v_order record;
  v_event record;

  v_ans jsonb;
  v_field_key text;
  v_field_id uuid;
  v_eff record;

  v_updated_count int := 0;

  v_has_answers boolean := false;
  v_is_empty boolean;
begin

  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;

  if not exists(select 1 from public.organization_members m where m.org_id=p_org_id and m.user_id=v_user_id and m.role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
  /* ---------------- Hardening ---------------- */
  perform set_config('search_path', 'pg_temp, public, extensions, private', true);

  /* ---------------- Auth ---------------- */
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_attendee_id is null then
    raise exception 'VALIDATION_ERROR: attendee_id is required';
  end if;

  if p_attendee is null or jsonb_typeof(p_attendee) <> 'object' then
    raise exception 'VALIDATION_ERROR: attendee payload is required';
  end if;

  perform public.assert_rate_limit(
    'svc:admin_update_attendee:' || p_attendee_id::text,
    300,
    60
  );

  /* ---------------- Lock attendee ---------------- */
  select *
  into v_attendee
  from public.order_attendees oa
  where oa.id = p_attendee_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  /* ---------------- Load order ---------------- */
  select *
  into v_order
  from public.orders o
  where o.id = v_attendee.order_id and o.org_id=p_org_id and o.event_id=p_event_id for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  -- Match payment/delete lock order: order first, then its participant.
  select * into v_attendee from public.order_attendees where id=p_attendee_id and order_id=v_order.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  /* ---------------- Rights ---------------- */
  if not exists (
    select 1
    from public.organization_members om
    where om.org_id = v_order.org_id
      and om.user_id = v_user_id
      and om.role in ('owner','admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  /* ---------------- Load event ---------------- */
  select *
  into v_event
  from public.events e
  where e.id = v_order.event_id;

  /* =========================================================
     âœï¸ Update answers (upsert + delete if empty)
     ========================================================= */

  if (p_attendee ? 'answers')
     and jsonb_typeof(p_attendee->'answers') = 'array'
  then
    v_has_answers := true;

    for v_ans in select * from jsonb_array_elements(p_attendee->'answers')
    loop
      v_field_key := nullif(trim(coalesce(v_ans->>'field_key','')), '');
      v_field_id := null;

      if (v_ans ? 'event_form_field_id') then
        begin
          v_field_id := nullif(trim(v_ans->>'event_form_field_id'), '')::uuid;
        exception when others then
          raise exception 'VALIDATION_ERROR: invalid field id';
        end;
      end if;

      if v_field_key is null and v_field_id is null then
        raise exception 'VALIDATION_ERROR: field_key or event_form_field_id required';
      end if;

      /* Resolve form field (must belong to same event) */
      select eff.*
      into v_eff
      from public.event_form_fields eff
      where eff.event_id = v_event.id
        and eff.is_active = true
        and (
          (v_field_id is null or eff.id = v_field_id)
          and
          (v_field_key is null or eff.field_key = v_field_key)
        )
      limit 1;

      if not found then
        raise exception 'VALIDATION_ERROR: invalid form field';
      end if;

      /*
        Detect empty value => delete answer so UI can "clear" a field.
        Rules:
        - if v_ans contains "value" object: empty if it's {} OR all known subfields empty/null
        - else use value_text/value_int/value_bool/value_date
      */
      v_is_empty :=
        (
          /* explicit value object */
          (v_ans ? 'value') and (
            v_ans->'value' = 'null'::jsonb
            or v_ans->'value' = '{}'::jsonb
            or (
              jsonb_typeof(v_ans->'value') = 'object'
              and ((v_ans->'value') - array['value_text','value_int','value_bool','value_date']) = '{}'::jsonb
              and nullif(trim(coalesce(v_ans->'value'->>'value_text','')), '') is null
              and (v_ans->'value'->>'value_int') is null
              and (v_ans->'value'->>'value_bool') is null
              and nullif(trim(coalesce(v_ans->'value'->>'value_date','')), '') is null
            )
          )
        )
        or
        (
          /* fallback fields */
          (not (v_ans ? 'value')) and
          nullif(trim(coalesce(v_ans->>'value_text','')), '') is null
          and nullif(trim(coalesce(v_ans->>'value_date','')), '') is null
          and (v_ans->>'value_int') is null
          and (v_ans->>'value_bool') is null
        );

      if v_is_empty then
        delete from public.order_attendee_answers oaa
        where oaa.attendee_id = p_attendee_id
          and oaa.field_key_snapshot = v_eff.field_key;

        v_updated_count := v_updated_count + 1;
      else
        insert into public.order_attendee_answers (
          id,
          attendee_id,
          field_key_snapshot,
          field_label_snapshot,
          field_type_snapshot,
          value,
          created_at,
          updated_at
        )
        values (
          gen_random_uuid(),
          p_attendee_id,
          v_eff.field_key,
          v_eff.label,
          v_eff.field_type,
          coalesce(
            v_ans->'value',
            jsonb_build_object(
              'value_text', nullif(trim(coalesce(v_ans->>'value_text','')), ''),
              'value_int',  case
                when (v_ans ? 'value_int')
                  and nullif(trim(coalesce(v_ans->>'value_int','')), '') is not null
                then (v_ans->>'value_int')::int else null end,
              'value_bool', case
                when (v_ans ? 'value_bool')
                  and nullif(trim(coalesce(v_ans->>'value_bool','')), '') is not null
                then (v_ans->>'value_bool')::boolean else null end,
              'value_date', nullif(trim(coalesce(v_ans->>'value_date','')), '')
            )
          ),
          now(),
          now()
        )
        on conflict (attendee_id, field_key_snapshot)
        do update set
          value = excluded.value,
          field_label_snapshot = excluded.field_label_snapshot,
          field_type_snapshot = excluded.field_type_snapshot,
          updated_at = now();

        v_updated_count := v_updated_count + 1;
      end if;
    end loop;
  end if;

  if not v_has_answers then
    raise exception 'VALIDATION_ERROR: answers array is required';
  end if;

  return jsonb_build_object(
    'attendee_id', p_attendee_id,
    'updated_answers_count', v_updated_count
  );
end;$function$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_admin_update_order_attendee' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

CREATE OR REPLACE FUNCTION public.organizer_admin_delete_order(p_actor_id uuid, p_org_id uuid, p_event_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public, private
AS $function$
declare
  v_uid uuid := p_actor_id;
  v_order record;

  v_is_sold boolean := false;
  v_dec_reserved int := 0;
  v_dec_sold int := 0;
begin

  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;

  if not exists(select 1 from public.organization_members m where m.org_id=p_org_id and m.user_id=v_uid and m.role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
  perform set_config('search_path', 'pg_temp, public, extensions, private', true);

  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_order_id is null then
    raise exception 'VALIDATION_ERROR: order_id is required';
  end if;

  /* lock order */
  select id, org_id, event_id, status
  into v_order
  from public.orders
  where id = p_order_id and org_id=p_org_id and event_id=p_event_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: order';
  end if;

  if not exists(select 1 from public.organization_members m where m.org_id=v_order.org_id and m.user_id=v_uid and m.role in ('owner','admin')) then
    raise exception 'FORBIDDEN';
  end if;


  if exists(select 1 from public.order_items oi left join public.event_products ep on ep.id=oi.product_id where oi.order_id=p_order_id and oi.product_id is not null and ep.event_id is distinct from p_event_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;
  /*
    DÃ©termine si on libÃ¨re du sold ou du reserved.
    âœ… adapte la liste selon tes statuts rÃ©els.
  */
  v_is_sold := (v_order.status in ('paid', 'confirmed'));

  /*
    LibÃ©ration stock basÃ©e sur les order_items (unitÃ©s de tickets),
    pas sur les attendees (sinon impossible avec attendees_per_unit).
  */
  if v_is_sold then
    update public.event_products ep
    set sold_qty = greatest(0, ep.sold_qty - x.qty)
    from (
      select product_id, sum(quantity)::int as qty
      from public.order_items
      where order_id = p_order_id
      group by product_id
    ) x
    where ep.id = x.product_id;

    v_dec_sold := coalesce((
      select sum(quantity)::int from public.order_items where order_id = p_order_id
    ), 0);

  else
    update public.event_products ep
    set reserved_qty = greatest(0, ep.reserved_qty - x.qty)
    from (
      select product_id, sum(quantity)::int as qty
      from public.order_items
      where order_id = p_order_id
      group by product_id
    ) x
    where ep.id = x.product_id;

    v_dec_reserved := coalesce((
      select sum(quantity)::int from public.order_items where order_id = p_order_id
    ), 0);
  end if;

  /* delete order (cascades attendees/answers/items etc.) */
  delete from public.orders
  where id = p_order_id;

  return jsonb_build_object(
    'deleted_order_id', p_order_id,
    'released', jsonb_build_object(
      'reserved_units', v_dec_reserved,
      'sold_units', v_dec_sold
    )
  );
end;
$function$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_admin_delete_order' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

create or replace function public.organizer_expire_bank_transfer_order(p_actor_id uuid, p_org_id uuid, p_event_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
  v_order public.orders%rowtype;
  v_released integer := 0;
begin

  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.orders o where o.event_id=p_event_id and o.org_id is distinct from p_org_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;

  if not exists(select 1 from public.organization_members m where m.org_id=p_org_id and m.user_id=v_user_id and m.role in ('owner','admin')) then raise exception 'FORBIDDEN'; end if;
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and org_id=p_org_id and event_id=p_event_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.org_id = v_order.org_id
      and m.user_id = v_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'FORBIDDEN';
  end if;


  if exists(select 1 from public.order_items oi left join public.event_products ep on ep.id=oi.product_id where oi.order_id=p_order_id and oi.product_id is not null and ep.event_id is distinct from p_event_id) then raise exception 'RELATIONSHIP_CONFLICT'; end if;
  if not exists (
    select 1
    from public.payments p
    where p.order_id = p_order_id
      and p.provider = 'offline'
      and p.provider_payment_id = 'bank_transfer:' || p_order_id::text
      and p.type = 'payment'
  ) then
    raise exception 'ORDER_IS_NOT_A_BANK_TRANSFER';
  end if;

  if v_order.status = 'expired' then
    return jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'status', 'expired',
      'releasedUnits', 0,
      'idempotent', true
    );
  end if;

  if v_order.status not in ('open', 'pending', 'awaiting_payment')
     or coalesce(v_order.paid_cents, 0) > 0 then
    raise exception 'ORDER_NOT_EXPIRABLE';
  end if;

  select coalesce(sum(oi.quantity), 0)::integer
  into v_released
  from public.order_items oi
  where oi.order_id = p_order_id;

  update public.event_products ep
  set reserved_qty = greatest(0, coalesce(ep.reserved_qty, 0) - quantities.qty)
  from (
    select oi.product_id, sum(oi.quantity)::integer as qty
    from public.order_items oi
    where oi.order_id = p_order_id
    group by oi.product_id
  ) quantities
  where ep.id = quantities.product_id;

  update public.order_attendees
  set status = 'expired'
  where order_id = p_order_id
    and status = 'reserved';

  update public.payments
  set status = 'expired', updated_at = now()
  where order_id = p_order_id
    and provider = 'offline'
    and provider_payment_id = 'bank_transfer:' || p_order_id::text
    and type = 'payment'
    and status <> 'paid';

  update public.orders
  set
    status = 'expired',
    expires_at = null,
    expired_at = now(),
    expired_by = v_user_id,
    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', 'expired',
    'releasedUnits', v_released,
    'idempotent', false
  );
end;
$$;

DO $acl$ declare f record; begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='organizer_expire_bank_transfer_order' loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature); execute format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); end loop; end $acl$;

commit;
