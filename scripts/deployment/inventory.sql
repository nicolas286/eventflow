-- Metadata only. Run against the explicitly verified production link.
-- No customer rows, OAuth tokens, Vault values or cron command bodies.
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
  'database_version', version(),
  'extensions', (SELECT json_agg(json_build_object('name', extname, 'version', extversion)) FROM pg_extension),
  'buckets', (SELECT json_agg(json_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)) FROM storage.buckets),
  'publications', (SELECT json_agg(json_build_object('publication', pubname, 'schema', schemaname, 'table', tablename)) FROM pg_publication_tables),
  'cron_jobs', (SELECT json_agg(json_build_object('jobid', jobid, 'name', jobname, 'schedule', schedule, 'active', active)) FROM cron.job),
  'tables', (SELECT json_agg(json_build_object('schema', n.nspname, 'table', c.relname, 'rls', c.relrowsecurity)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'private') AND c.relkind = 'r'),
  'migration_versions', (SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
) AS inventory;
COMMIT;
