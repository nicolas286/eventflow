-- Promote only AFTER the orders Edge routes and frontend, plus the B0 transition window.
-- B4 check-in/QR RPCs and shared RLS stay intact.
DO $closure$
DECLARE f record; t text; c record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[
  'search_event_admin_orders_view','search_event_admin_tickets_view','get_event_admin_orders_view',
  'get_event_admin_participants_export_data','admin_update_order_attendee','admin_delete_order',
  'get_bank_transfer_admin_summaries','expire_bank_transfer_order']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['orders','order_items','order_attendees','order_attendee_answers','payments','tickets'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM PUBLIC, anon, authenticated',c.attname,c.attname,c.attname,c.attname,t);
  END LOOP;
 END LOOP;
END $closure$;
