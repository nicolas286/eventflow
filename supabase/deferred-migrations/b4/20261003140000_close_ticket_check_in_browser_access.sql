-- Apply only after the migrated scanner is published and B0 transition completes.
begin;
DO $closure$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('get_event_tickets_admin','mark_ticket_checked_in','mark_ticket_checked_in_by_qr','check_in_ticket_internal')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $closure$;
-- Equivalent direct table/column writes close with B3; RLS is retained.
revoke all on public.tickets from PUBLIC, anon, authenticated;
DO $columns$ DECLARE c record; BEGIN
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.tickets'::regclass AND attnum>0 AND NOT attisdropped
  LOOP EXECUTE format('REVOKE ALL (%I) ON public.tickets FROM PUBLIC, anon, authenticated',c.attname); END LOOP;
END $columns$;
commit;
