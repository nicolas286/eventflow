-- Metadata only, no row values or function bodies. Run only on an attested target.
BEGIN READ ONLY;
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_table,
 has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') anon_column,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated_table,
 has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') authenticated_column
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 AND c.relkind IN ('r','p','v','m') ORDER BY 1,2;
SELECT n.nspname,p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' ORDER BY 1,2;
SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) owner,
 has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE') anon_access,
 has_sequence_privilege('authenticated',c.oid,'USAGE,SELECT,UPDATE') authenticated_access
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' ORDER BY 1,2;
SELECT pg_get_userbyid(defaclrole) creator,coalesce(n.nspname,'GLOBAL') scope,defaclobjtype,defaclacl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3;
SELECT pubname,schemaname,tablename FROM pg_publication_tables ORDER BY 1,2,3;
SELECT r.rolname,s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
WHERE r.rolname IN ('authenticator','anon','authenticated','service_role');
-- PostgREST env/dashboard configuration remains to attest, not derivable solely
-- from SQL role settings. Local config exposes public and graphql_public only.
ROLLBACK;
