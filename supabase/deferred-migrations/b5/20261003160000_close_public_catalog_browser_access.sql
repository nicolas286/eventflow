-- Phase 3 only: publish Edge, frontend AND Netlify share first, then B0 transition.
begin;
DO $closure$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('get_public_org_by_slug','get_public_org_events_overview','get_public_event_detail','get_public_organization_sales_terms','is_event_sold_out','is_event_registration_open')
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature); END LOOP;
END $closure$;
-- Equivalent business tables close in B1/B2. Repeat reads/column ACL closure
-- here so this phase does not rely on RLS or a forgotten inherited grant.
DO $tables$ DECLARE t record;c record; BEGIN
 FOR t IN SELECT oid::regclass relation,oid FROM pg_class WHERE relnamespace='public'::regnamespace
 AND relkind IN ('r','p','v','m') AND relname IN ('organizations','organization_profile','events','event_products','event_form_fields','event_form_field_groups')
 LOOP EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated',t.relation);
   FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped
   LOOP EXECUTE format('REVOKE ALL (%I) ON %s FROM PUBLIC,anon,authenticated',c.attname,t.relation); END LOOP;
 END LOOP;
END $tables$;
-- Derived availability helpers have no direct frontend/server callers; SQL
-- registrations/payments still call them as owner, and service_role retains EXECUTE.
-- Keep RLS and all historical data; no table/policy drops.
commit;
