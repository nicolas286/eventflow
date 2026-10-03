BEGIN;
DO $$ DECLARE f record; n int:=0; BEGIN
 FOR f IN SELECT * FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'organizer_%'
 AND proname IN ('organizer_search_event_admin_orders_view','organizer_search_event_admin_tickets_view','organizer_get_event_admin_orders_view','organizer_get_event_admin_participants_export_data','organizer_admin_update_order_attendee','organizer_admin_delete_order','organizer_get_bank_transfer_admin_summaries','organizer_expire_bank_transfer_order') LOOP
  n:=n+1;
  IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee=0)
  OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Internal orders ACL'; END IF;
 END LOOP;
 IF n<>8 THEN RAISE EXCEPTION 'Unexpected B3 overloads: %',n; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_closed() RETURNS void LANGUAGE plpgsql AS $$ DECLARE f record; t text; BEGIN
 FOR f IN SELECT * FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('search_event_admin_orders_view','search_event_admin_tickets_view','get_event_admin_orders_view','get_event_admin_participants_export_data','admin_update_order_attendee','admin_delete_order','get_bank_transfer_admin_summaries','expire_bank_transfer_order',
 'organizer_search_event_admin_orders_view','organizer_search_event_admin_tickets_view','organizer_get_event_admin_orders_view','organizer_get_event_admin_participants_export_data','organizer_admin_update_order_attendee','organizer_admin_delete_order','organizer_get_bank_transfer_admin_summaries','organizer_expire_bank_transfer_order') LOOP
  IF has_function_privilege(current_user,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Old orders RPC still open'; END IF;
  BEGIN EXECUTE format('SELECT %s(%s)',f.oid::regproc,(SELECT string_agg('null',',') FROM generate_series(1,f.pronargs))); RAISE EXCEPTION 'RPC executed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['orders','order_items','order_attendees','order_attendee_answers','payments','tickets'] LOOP
  BEGIN EXECUTE format('SELECT * FROM public.%I LIMIT 1',t); RAISE EXCEPTION 'Old table still readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_any_column_privilege(current_user,format('public.%I',t),'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Table/column access survives'; END IF;
 END LOOP;
END $$;
-- Temporary test helper only; B6 closes implicit PUBLIC EXECUTE defaults.
GRANT EXECUTE ON FUNCTION pg_temp.assert_closed() TO anon,authenticated,service_role;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_closed();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_closed();
RESET ROLE;
ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attendees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attendee_answers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_closed();
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_closed();
RESET ROLE;
DO $$ BEGIN
 IF NOT has_function_privilege('authenticated','public.mark_ticket_checked_in(uuid,uuid)','EXECUTE') OR
 NOT has_function_privilege('authenticated','public.mark_ticket_checked_in_by_qr(text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'B4 accidentally closed'; END IF;
END $$;
ROLLBACK;
