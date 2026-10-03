-- PHASE 4 ONLY, after B1.1 ACL closure and real-role denial have been verified.
-- user_profile has only Auth/system and service readers after B1.1.
DO $$ DECLARE policy record; BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) browser(role)
    WHERE has_table_privilege(browser.role,'public.user_profile','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(browser.role,'public.user_profile','SELECT,INSERT,UPDATE,REFERENCES'))
  THEN RAISE EXCEPTION 'Close user_profile browser ACLs before retiring RLS'; END IF;
  FOR policy IN SELECT polname FROM pg_policy WHERE polrelid='public.user_profile'::regclass LOOP
    EXECUTE format('DROP POLICY %I ON public.user_profile', policy.polname);
  END LOOP;
END $$;
ALTER TABLE public.user_profile DISABLE ROW LEVEL SECURITY;
