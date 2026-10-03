-- B4 additive service-only routines; historical status rules preserved.
begin;
CREATE OR REPLACE FUNCTION public.organizer_get_event_tickets_admin(p_org_id uuid, p_event_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
declare
  v_total integer;
  v_rows jsonb;
  v_result jsonb;
begin
  /* ---------------- Validation ---------------- */

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'VALIDATION_ERROR: limit out of range';
  end if;

  if p_offset is null or p_offset < 0 or p_offset > 10000000 then
    raise exception 'VALIDATION_ERROR: offset out of range';
  end if;

  /* ---------------- Resource scope (Edge authorizes the actor) ---------------- */

  if not exists(select 1 from public.events e where e.id=p_event_id and e.org_id=p_org_id) then
    raise exception 'FORBIDDEN';
  end if;

  /* ---------------- Total ---------------- */

  select count(*)
  into v_total
  from public.tickets t
  where t.event_id = p_event_id
      and exists(select 1 from public.orders scoped where scoped.id=t.order_id and scoped.event_id=p_event_id and scoped.org_id=p_org_id)
      and exists(select 1 from public.order_items scoped where scoped.id=t.order_item_id and scoped.order_id=t.order_id and scoped.product_id=t.product_id)
      and exists(select 1 from public.event_products scoped where scoped.id=t.product_id and scoped.event_id=p_event_id);

  /* ---------------- Tickets ---------------- */

  with t_page as (
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
    join public.orders o
      on o.id = t.order_id
    join public.order_items oi
      on oi.id = t.order_item_id
    join public.event_products ep
      on ep.id = t.product_id
    where t.event_id = p_event_id
      and exists(select 1 from public.orders scoped where scoped.id=t.order_id and scoped.event_id=p_event_id and scoped.org_id=p_org_id)
      and exists(select 1 from public.order_items scoped where scoped.id=t.order_item_id and scoped.order_id=t.order_id and scoped.product_id=t.product_id)
      and exists(select 1 from public.event_products scoped where scoped.id=t.product_id and scoped.event_id=p_event_id)
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
                      when lower(coalesce(a.field_key_snapshot, '')) in ('first_name', 'firstname', 'prenom', 'prénom') then 1
                      when lower(coalesce(a.field_key_snapshot, '')) in ('last_name', 'lastname', 'nom') then 2
                      when lower(coalesce(a.field_key_snapshot, '')) in ('email', 'e-mail', 'mail') then 3
                      else 10
                    end as priority,
                    row_number() over (
                      partition by ar.id
                      order by
                        case
                          when lower(coalesce(a.field_key_snapshot, '')) in ('first_name', 'firstname', 'prenom', 'prénom') then 1
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

end;$function$
;
CREATE OR REPLACE FUNCTION public.organizer_check_in_ticket(p_actor_id uuid, p_org_id uuid, p_ticket_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
declare
  v_user_id uuid := p_actor_id;
  v_ticket record;
  v_checked_in_at timestamptz := now();
begin
  /* ---------------- Validation ---------------- */

  if p_ticket_id is null then
    raise exception 'VALIDATION_ERROR: ticket_id required';
  end if;

  if p_event_id is null then
    raise exception 'VALIDATION_ERROR: event_id required';
  end if;

  /* ---------------- Auth ---------------- */

  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  /* ---------------- Lock + load ticket ---------------- */

  select
    t.id,
    t.event_id,
    t.order_id,
    t.order_item_id,
    t.product_id,
    t.ticket_index,
    t.qr_token,
    t.status,
    t.checked_in_at,
    t.checked_in_by,
    t.created_at
  into v_ticket
  from public.tickets t
  where t.id = p_ticket_id
  for update;

  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  /* ---------------- Event scope guard ---------------- */

  if v_ticket.event_id is distinct from p_event_id then
    raise exception 'EVENT_MISMATCH';
  end if;

  /* ---------------- Membership ---------------- */

  if not exists(select 1 from public.events e join public.organization_members m on m.org_id=e.org_id
     where e.id=p_event_id and e.org_id=p_org_id and m.user_id=p_actor_id and m.role in ('owner','admin'))
    or not exists(select 1 from public.tickets t join public.orders o on o.id=t.order_id
      join public.order_items oi on oi.id=t.order_item_id join public.event_products ep on ep.id=t.product_id
      where t.id=p_ticket_id and o.org_id=p_org_id and o.event_id=p_event_id
        and oi.order_id=o.id and oi.product_id=t.product_id and ep.event_id=p_event_id) then
    raise exception 'FORBIDDEN';
  end if;

  /* ---------------- Guards ---------------- */

  if coalesce(v_ticket.status, '') = 'invalid' then
    raise exception 'TICKET_INVALID';
  end if;

  if coalesce(v_ticket.status, '') = 'cancelled' then
    raise exception 'TICKET_CANCELLED';
  end if;

  if v_ticket.checked_in_at is not null then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'already_checked',
      'ticketId', v_ticket.id,
      'eventId', v_ticket.event_id,
      'orderId', v_ticket.order_id,
      'ticketIndex', v_ticket.ticket_index,
      'qrToken', v_ticket.qr_token,
      'status', v_ticket.status,
      'checkedInAt', v_ticket.checked_in_at,
      'checkedInBy', v_ticket.checked_in_by
    );
  end if;

  /* ---------------- Update ---------------- */

  update public.tickets
  set
    status = 'checked_in',
    checked_in_at = v_checked_in_at,
    checked_in_by = v_user_id
  where id = p_ticket_id;

  /* ---------------- Return ---------------- */

  return jsonb_build_object(
    'ok', true,
    'outcome', 'validated',
    'ticketId', v_ticket.id,
    'eventId', v_ticket.event_id,
    'orderId', v_ticket.order_id,
    'ticketIndex', v_ticket.ticket_index,
    'qrToken', v_ticket.qr_token,
    'status', 'checked_in',
    'checkedInAt', v_checked_in_at,
    'checkedInBy', v_user_id
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.organizer_check_in_ticket_by_qr(p_actor_id uuid, p_org_id uuid, p_qr_token text, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO public, pg_temp
AS $function$
declare
  v_ticket_id uuid;
  v_ticket_event_id uuid;
  v_token text := nullif(regexp_replace(trim(p_qr_token), '\s+', '', 'g'), '');
begin
  if v_token is null then
    raise exception 'VALIDATION_ERROR: qr_token required';
  end if;

  if p_event_id is null then
    raise exception 'VALIDATION_ERROR: event_id required';
  end if;

  select
    t.id,
    t.event_id
  into
    v_ticket_id,
    v_ticket_event_id
  from public.tickets t
  where t.event_id=p_event_id and regexp_replace(trim(t.qr_token), '\s+', '', 'g') = v_token
  limit 1;

  if v_ticket_id is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  if v_ticket_event_id is distinct from p_event_id then
    raise exception 'EVENT_MISMATCH';
  end if;

  return public.organizer_check_in_ticket(p_actor_id, p_org_id, v_ticket_id, p_event_id);
end;
$function$
;
REVOKE ALL ON FUNCTION public.organizer_get_event_tickets_admin(uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_get_event_tickets_admin(uuid,uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.organizer_check_in_ticket(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_check_in_ticket(uuid,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.organizer_check_in_ticket_by_qr(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_check_in_ticket_by_qr(uuid,uuid,text,uuid) TO service_role;
commit;
