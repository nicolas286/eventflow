-- Metadata only. Safe on a verified target; never calls a business RPC.
-- PUBLIC is the ACL grantee 0, not a SQL role for has_function_privilege().
BEGIN READ ONLY;

SELECT p.oid::regprocedure::text AS signature, r.rolname AS owner,
       p.prosecdef AS security_definer, p.proconfig, p.proacl,
       md5(pg_get_functiondef(p.oid)) AS definition_md5,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public' AND p.proname IN (
  'admin_grant_subscription', 'claim_order_confirmation_email', 'log_email_once',
  'mark_order_confirmation_email_error', 'mark_order_confirmation_email_sent')
ORDER BY signature;

-- Names only; never print function bodies or cron commands containing tokens.
SELECT p.oid::regprocedure::text AS sql_caller
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.proname NOT IN ('admin_grant_subscription', 'claim_order_confirmation_email',
    'log_email_once', 'mark_order_confirmation_email_error', 'mark_order_confirmation_email_sent')
  AND p.prosrc ~ '(admin_grant_subscription|claim_order_confirmation_email|log_email_once|mark_order_confirmation_email_(sent|error))';

SELECT r.rolname AS creator, n.nspname AS schema, d.defaclobjtype, d.defaclacl
FROM pg_default_acl d
JOIN pg_roles r ON r.oid = d.defaclrole
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY creator, schema, d.defaclobjtype;

SELECT parent.rolname AS granted_role, child.rolname AS member,
       m.inherit_option, m.set_option
FROM pg_auth_members m
JOIN pg_roles parent ON parent.oid = m.roleid
JOIN pg_roles child ON child.oid = m.member
WHERE child.rolname IN ('anon', 'authenticated', 'service_role');

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('event_products', 'event_form_fields', 'event_form_field_groups');

SELECT a.attname, a.attacl,
       has_column_privilege('anon', a.attrelid, a.attnum, 'UPDATE') AS anon_update,
       has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') AS authenticated_update,
       has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') AS authenticated_insert,
       has_column_privilege('service_role', a.attrelid, a.attnum, 'UPDATE') AS service_update
FROM pg_attribute a
WHERE a.attrelid = 'public.event_products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('event_products', 'event_form_fields', 'event_form_field_groups')
ORDER BY tablename, policyname;

-- Counts only: no form contents, customer IDs, tokens, or cron commands.
SELECT count(*) AS inconsistent_form_groups
FROM public.event_form_fields f
LEFT JOIN public.event_form_field_groups g ON g.id = f.group_id
WHERE f.group_id IS NOT NULL AND (g.id IS NULL OR g.event_id <> f.event_id);

SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
-- Eventflow migrations install pg_cron; only known route names are extracted.
SELECT jobname, schedule, active, username,
       CASE WHEN command LIKE '%/workers/reminders%' THEN '/functions/v1/workers/reminders'
            WHEN command LIKE '%/send-reminder-mail%' THEN '/functions/v1/send-reminder-mail'
            ELSE 'SQL/other' END AS endpoint_class,
       command ~ '(admin_grant_subscription|claim_order_confirmation_email|log_email_once|mark_order_confirmation_email_(sent|error))'
         AS sensitive_rpc_reference
FROM cron.job ORDER BY jobname;
COMMIT;
