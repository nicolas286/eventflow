begin;

create function private.assert_organization_accepts_new_orders(p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  -- Serializes admission with platform suspension. A suspended organization can
  -- still settle/refund existing orders: only insertion takes this guard.
  select status into v_status from public.organizations where id=p_org_id for share;
  if v_status = 'suspended' then
    raise exception 'ORGANIZATION_SUSPENDED' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.assert_organization_accepts_new_orders(uuid)
  from public, anon, authenticated, service_role;

create function private.guard_new_order_organization_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_organization_accepts_new_orders(new.org_id);
  return new;
end;
$$;
revoke all on function private.guard_new_order_organization_status()
  from public, anon, authenticated, service_role;
create trigger guard_new_order_organization_status before insert on public.orders
for each row execute function private.guard_new_order_organization_status();

-- Keep the implementation unchanged, but acquire the organization lock before
-- its product/event locks. Organizer mutations already use this lock order.
alter function public.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text) set schema private;
alter function private.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text)
  rename to create_order_intent_internal;
revoke all on function private.create_order_intent_internal(uuid,jsonb,jsonb,jsonb,text,text)
  from public, anon, authenticated, service_role;

create function public.create_order_intent(
  p_event_id uuid, p_items jsonb, p_attendees jsonb,
  p_buyer jsonb default '{}'::jsonb, p_rate_key text default null,
  p_promo_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org_id uuid;
begin
  select org_id into v_org_id from public.events where id=p_event_id;
  perform private.assert_organization_accepts_new_orders(v_org_id);
  return private.create_order_intent_internal(
    p_event_id,p_items,p_attendees,p_buyer,p_rate_key,p_promo_code
  );
end;
$$;
revoke all on function public.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.create_order_intent(uuid,jsonb,jsonb,jsonb,text,text) to service_role;

-- Event deletion already refuses busy checkout children. Its first lock must
-- now also refuse the admission lock, rather than waiting then cascading away
-- the order which has just been accepted.
CREATE OR REPLACE FUNCTION public.organizer_delete_event(p_actor_id uuid,p_org_id uuid,p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
BEGIN
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
 IF p_org_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR: org_id and event_id are required'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR NO KEY UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND org_id<>p_org_id)
  OR EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id=p_event_id AND org_id<>p_org_id) THEN
  RAISE EXCEPTION 'RELATIONSHIP_CONFLICT'; END IF;
 PERFORM 1 FROM public.orders WHERE event_id=p_event_id AND org_id=p_org_id ORDER BY id FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.event_products WHERE event_id=p_event_id ORDER BY id FOR UPDATE NOWAIT;
 PERFORM 1 FROM public.events WHERE id=p_event_id AND org_id=p_org_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND org_id<>p_org_id)
  OR EXISTS(SELECT 1 FROM public.promo_codes WHERE event_id=p_event_id AND org_id<>p_org_id) THEN
  RAISE EXCEPTION 'RELATIONSHIP_CONFLICT'; END IF;
 DELETE FROM public.events WHERE id=p_event_id AND org_id=p_org_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN jsonb_build_object('success',true);
EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'RESOURCE_BUSY';
END $$;
REVOKE ALL ON FUNCTION public.organizer_delete_event(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_delete_event(uuid,uuid,uuid) TO service_role;

commit;
