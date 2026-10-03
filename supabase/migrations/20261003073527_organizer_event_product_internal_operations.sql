-- B2.2 additive internal products. Authorization belongs to Edge.
-- Organization NO KEY UPDATE locks serialize organizer paid-event capacity
-- without blocking checkout FKs. Updates/deletes then lock the product only:
-- checkout takes product before event, so waiting here must not lock the event.
-- Stock zero is finite; only SQL NULL means unlimited. Legacy ACLs close later.
BEGIN;

create or replace function public.organizer_create_event_product(p_actor_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
  v_row public.event_products%rowtype;

  v_event_id uuid;
  v_name text;
  v_description text;
  v_price_cents int;
  v_currency text;
  v_stock_qty int;
  v_is_active boolean;
  v_sort_order int;
  v_creates_attendees boolean;
  v_attendees_per_unit int;

  v_is_gatekeeper boolean;
  v_close_event_when_sold_out boolean;

  v_org_id uuid;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input)<>'object' or exists (
    select 1 from jsonb_object_keys(p_input) k where k<>all(array['org_id','event_id','name','description','price_cents','currency','stock_qty','is_active','sort_order','creates_attendees','attendees_per_unit','is_gatekeeper','close_event_when_sold_out'])) then
    raise exception 'VALIDATION_ERROR: unsupported product input';
  end if;
  v_org_id := nullif(trim(p_input->>'org_id'),'')::uuid;
  if v_org_id is null then raise exception 'VALIDATION_ERROR: product org_id is required'; end if;

  /* ------------------------------
   * Parse input
   * ------------------------------ */
  v_event_id := nullif(trim(p_input->>'event_id'), '')::uuid;
  v_name := nullif(trim(p_input->>'name'), '');
  v_description := nullif(trim(p_input->>'description'), '');
  v_price_cents := nullif(trim(p_input->>'price_cents'), '')::int;
  v_currency := upper(coalesce(nullif(trim(p_input->>'currency'), ''), 'EUR'));

  v_stock_qty := nullif(trim(p_input->>'stock_qty'), '')::int;
  v_is_active := coalesce((p_input->>'is_active')::boolean, true);
  v_sort_order := coalesce(nullif(trim(p_input->>'sort_order'), '')::int, 0);
  v_creates_attendees := coalesce((p_input->>'creates_attendees')::boolean, true);
  v_attendees_per_unit := coalesce(nullif(trim(p_input->>'attendees_per_unit'), '')::int, 1);
  v_is_gatekeeper := coalesce((p_input->>'is_gatekeeper')::boolean, false);
  v_close_event_when_sold_out := coalesce((p_input->>'close_event_when_sold_out')::boolean, false);

  /* ------------------------------
   * Validations
   * ------------------------------ */
  if v_event_id is null then
    raise exception 'VALIDATION_ERROR: product event_id is required';
  end if;

  if v_name is null then
    raise exception 'VALIDATION_ERROR: product name is required';
  end if;

  if char_length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: product name too short';
  end if;

  if char_length(v_name) > 80 then
    raise exception 'VALIDATION_ERROR: product name too long';
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'VALIDATION_ERROR: product description too long';
  end if;

  if v_price_cents is null or v_price_cents < 0 or v_price_cents > 10000000 then
    raise exception 'VALIDATION_ERROR: product price_cents must be between 0 and 10000000';
  end if;

  if v_currency <> 'EUR' then
    raise exception 'VALIDATION_ERROR: product unsupported currency';
  end if;

  if v_stock_qty is not null and v_stock_qty < 0 then
    raise exception 'VALIDATION_ERROR: product stock_qty must be >= 0';
  end if;

  if v_sort_order < 0 or v_sort_order > 1000 then
    raise exception 'VALIDATION_ERROR: product sort_order must be between 0 and 1000';
  end if;

  if v_creates_attendees and (
    v_attendees_per_unit is null
    or v_attendees_per_unit < 1
    or v_attendees_per_unit > 20
  ) then
    raise exception 'VALIDATION_ERROR: product attendees_per_unit must be between 1 and 20';
  end if;

  if v_close_event_when_sold_out and not v_is_gatekeeper then
    raise exception 'VALIDATION_ERROR: product close_event_when_sold_out requires is_gatekeeper=true';
  end if;

  perform 1 from public.organizations where id=v_org_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.events where id=v_event_id and org_id=v_org_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  /* ------------------------------
   * Rate limit
   * ------------------------------ */
  perform public.assert_rate_limit(
    'create_product:org:' || v_org_id::text || ':user:' || v_user_id::text,
    100,
    3600
  );

  /* ------------------------------
   * Plan limits
   * ------------------------------ */
  perform public.assert_can_add_product(v_org_id, v_event_id);

  if v_price_cents > 0 and not public.is_event_paid(v_event_id) then
    perform private.organizer_assert_paid_event_capacity(v_org_id);
  end if;

  /* ------------------------------
   * Insert
   * ------------------------------ */
  insert into public.event_products (
    id,
    event_id,
    name,
    description,
    price_cents,
    currency,
    stock_qty,
    is_active,
    sort_order,
    creates_attendees,
    attendees_per_unit,
    is_gatekeeper,
    close_event_when_sold_out,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_event_id,
    v_name,
    v_description,
    v_price_cents,
    v_currency,
    v_stock_qty,
    v_is_active,
    v_sort_order,
    v_creates_attendees,
    v_attendees_per_unit,
    v_is_gatekeeper,
    v_close_event_when_sold_out,
    now(),
    now()
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

REVOKE ALL ON FUNCTION public.organizer_create_event_product(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_create_event_product(uuid,jsonb) TO service_role;

create or replace function public.organizer_update_event_product(p_actor_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user_id uuid := p_actor_id;
  v_row public.event_products%rowtype;

  v_product_id uuid;
  v_cur record;

  v_event_id uuid;
  v_org_id uuid;

  v_name text;
  v_description text;
  v_price_cents int;
  v_currency text;
  v_stock_qty int;
  v_is_active boolean;
  v_sort_order int;
  v_creates_attendees boolean;
  v_attendees_per_unit int;

  v_is_gatekeeper boolean;
  v_close_event_when_sold_out boolean;

  v_description_provided boolean := false;
  v_stock_qty_provided boolean := false;

  v_new_price_cents int;
  v_new_currency text;
  v_new_creates_attendees boolean;
  v_new_attendees_per_unit int;
  v_new_is_gatekeeper boolean;
  v_new_close_event_when_sold_out boolean;

  v_event_paid_before boolean;
  v_event_paid_after boolean;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_input is null or jsonb_typeof(p_input)<>'object' or exists (
    select 1 from jsonb_object_keys(p_input) k where k<>all(array['org_id','event_id','product_id','name','description','price_cents','currency','stock_qty','is_active','sort_order','creates_attendees','attendees_per_unit','is_gatekeeper','close_event_when_sold_out'])) then
    raise exception 'VALIDATION_ERROR: unsupported product input';
  end if;
  v_org_id := nullif(trim(p_input->>'org_id'),'')::uuid;
  if v_org_id is null then raise exception 'VALIDATION_ERROR: product org_id is required'; end if;
  v_event_id := nullif(trim(p_input->>'event_id'),'')::uuid;
  if v_event_id is null then raise exception 'VALIDATION_ERROR: product event_id is required'; end if;

  /* ------------------------------
   * Parse
   * ------------------------------ */
  v_product_id := nullif(trim(p_input->>'product_id'), '')::uuid;

  if v_product_id is null then
    raise exception 'VALIDATION_ERROR: product product_id is required';
  end if;

  if p_input ? 'name' then
    v_name := nullif(trim(p_input->>'name'), '');
  end if;

  if p_input ? 'description' then
    v_description_provided := true;
    v_description := nullif(trim(p_input->>'description'), '');
  end if;

  if p_input ? 'price_cents' then
    v_price_cents := nullif(trim(p_input->>'price_cents'), '')::int;
  end if;

  if p_input ? 'currency' then
    v_currency := upper(coalesce(nullif(trim(p_input->>'currency'), ''), 'EUR'));
  end if;

  if p_input ? 'stock_qty' then
    v_stock_qty_provided := true;
    v_stock_qty := nullif(trim(p_input->>'stock_qty'), '')::int;
  end if;

  if p_input ? 'is_active' then
    v_is_active := (p_input->>'is_active')::boolean;
  end if;

  if p_input ? 'sort_order' then
    v_sort_order := nullif(trim(p_input->>'sort_order'), '')::int;
  end if;

  if p_input ? 'creates_attendees' then
    v_creates_attendees := (p_input->>'creates_attendees')::boolean;
  end if;

  if p_input ? 'attendees_per_unit' then
    v_attendees_per_unit := nullif(trim(p_input->>'attendees_per_unit'), '')::int;
  end if;

  if p_input ? 'is_gatekeeper' then
    v_is_gatekeeper := (p_input->>'is_gatekeeper')::boolean;
  end if;

  if p_input ? 'close_event_when_sold_out' then
    v_close_event_when_sold_out := (p_input->>'close_event_when_sold_out')::boolean;
  end if;

  perform 1 from public.organizations where id=v_org_id for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.events where id=v_event_id and org_id=v_org_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_cur from public.event_products
    where id=v_product_id and event_id=v_event_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  /* ------------------------------
   * Rate limit
   * ------------------------------ */
  perform public.assert_rate_limit(
    'update_product:org:' || v_org_id::text || ':user:' || v_user_id::text,
    200,
    3600
  );

  /* ------------------------------
   * Compute final values
   * ------------------------------ */
  v_new_price_cents := coalesce(v_price_cents, v_cur.price_cents, 0);
  v_new_currency := coalesce(v_currency, v_cur.currency, 'EUR');
  v_new_creates_attendees := coalesce(v_creates_attendees, v_cur.creates_attendees, true);
  v_new_attendees_per_unit := coalesce(v_attendees_per_unit, v_cur.attendees_per_unit, 1);
  v_new_is_gatekeeper := coalesce(v_is_gatekeeper, v_cur.is_gatekeeper, false);
  v_new_close_event_when_sold_out :=
    coalesce(v_close_event_when_sold_out, v_cur.close_event_when_sold_out, false);

  /* ------------------------------
   * Validations
   * ------------------------------ */
  if p_input ? 'name' and v_name is null then
    raise exception 'VALIDATION_ERROR: product name is required';
  end if;

  if v_name is not null and char_length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: product name too short';
  end if;

  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'VALIDATION_ERROR: product name too long';
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'VALIDATION_ERROR: product description too long';
  end if;

  if v_new_price_cents < 0 or v_new_price_cents > 10000000 then
    raise exception 'VALIDATION_ERROR: product price_cents must be between 0 and 10000000';
  end if;

  if v_new_currency <> 'EUR' then
    raise exception 'VALIDATION_ERROR: product unsupported currency';
  end if;

  if v_stock_qty is not null and v_stock_qty < 0 then
    raise exception 'VALIDATION_ERROR: product stock_qty must be >= 0';
  end if;

  if v_sort_order is not null and (v_sort_order < 0 or v_sort_order > 1000) then
    raise exception 'VALIDATION_ERROR: product sort_order must be between 0 and 1000';
  end if;

  if v_new_creates_attendees and (
    v_new_attendees_per_unit is null
    or v_new_attendees_per_unit < 1
    or v_new_attendees_per_unit > 20
  ) then
    raise exception 'VALIDATION_ERROR: product attendees_per_unit must be between 1 and 20';
  end if;

  if v_new_close_event_when_sold_out and not v_new_is_gatekeeper then
    raise exception 'VALIDATION_ERROR: product close_event_when_sold_out requires is_gatekeeper=true';
  end if;

  if v_stock_qty_provided and v_stock_qty is not null
     and v_stock_qty < v_cur.reserved_qty + v_cur.sold_qty then
    raise exception 'STOCK_BELOW_ALLOCATED';
  end if;

  /* ------------------------------
   * Plan limits
   * ------------------------------ */
  v_event_paid_before := public.is_event_paid(v_event_id);
  if v_new_price_cents > 0 then
    v_event_paid_after := true;
  else
    v_event_paid_after :=
      exists (
        select 1
        from public.events e
        where e.id = v_event_id
          and coalesce(e.deposit_cents, 0) > 0
      )
      or exists (
        select 1
        from public.event_products ep
        where ep.event_id = v_event_id
          and ep.id <> v_product_id
          and coalesce(ep.price_cents, 0) > 0
      );
  end if;

  if coalesce(v_event_paid_before, false) = false
     and coalesce(v_event_paid_after, false) = true
  then
    perform private.organizer_assert_paid_event_capacity(v_org_id);
  end if;

  /* ------------------------------
   * Update
   * ------------------------------ */
  update public.event_products ep
  set
    name = coalesce(v_name, ep.name),
    description = case
      when v_description_provided then v_description
      else ep.description
    end,
    price_cents = coalesce(v_price_cents, ep.price_cents),
    currency = coalesce(v_currency, ep.currency),
    stock_qty = case
      when v_stock_qty_provided then v_stock_qty
      else ep.stock_qty
    end,
    is_active = coalesce(v_is_active, ep.is_active),
    sort_order = coalesce(v_sort_order, ep.sort_order),
    creates_attendees = coalesce(v_creates_attendees, ep.creates_attendees),
    attendees_per_unit = coalesce(v_attendees_per_unit, ep.attendees_per_unit),
    is_gatekeeper = coalesce(v_is_gatekeeper, ep.is_gatekeeper),
    close_event_when_sold_out = coalesce(
      v_close_event_when_sold_out,
      ep.close_event_when_sold_out
    ),
    updated_at = now()
  where ep.id = v_product_id and ep.event_id = v_event_id
  returning ep.* into v_row;

  return to_jsonb(v_row);

exception
  when unique_violation then
    raise exception 'CONFLICT';
end;
$$;

REVOKE ALL ON FUNCTION public.organizer_update_event_product(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_update_event_product(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.organizer_delete_event_product(
 p_actor_id uuid,p_org_id uuid,p_event_id uuid,p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private AS $$
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 IF p_org_id IS NULL OR p_event_id IS NULL OR p_product_id IS NULL THEN
  RAISE EXCEPTION 'VALIDATION_ERROR: product resource identifiers are required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.event_products WHERE id=p_product_id AND event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 -- Snapshot FKs retain their existing SET NULL behavior; issued tickets RESTRICT.
 DELETE FROM public.event_products WHERE id=p_product_id AND event_id=p_event_id;
 RETURN jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.organizer_delete_event_product(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event_product(uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
