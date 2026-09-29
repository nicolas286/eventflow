import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Bootstrap: the token is required only when Vault has not been initialized.
const ref = 'cpcmcxerrsnnjncrhldr';
const workdir = process.env.STAGING_SUPABASE_WORKDIR ?? '.local/staging';
const linked = readFileSync(`${workdir}/supabase/.temp/project-ref`, 'utf8').trim();
if (linked !== ref) throw new Error('Refusing to configure reminders outside staging');
const token = process.env.STAGING_EDGE_SERVICE_TOKEN?.trim() || null;
if (token && token.length < 32) throw new Error('Invalid staging service token');
const literal = value => `'${value.replaceAll("'", "''")}'`;
const command = `SELECT net.http_post(
  url := 'https://${ref}.supabase.co/functions/v1/workers/reminders',
  headers := jsonb_build_object('Content-Type','application/json','Authorization',
    'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'eventflow_staging_edge_service_token')),
  body := '{"mode":"cron"}'::jsonb,
  timeout_milliseconds := 10000
);`;
const configureSecret = token
  ? `SELECT id INTO secret_id FROM vault.secrets WHERE name = 'eventflow_staging_edge_service_token';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(${literal(token)}, 'eventflow_staging_edge_service_token');
  ELSE
    PERFORM vault.update_secret(secret_id, ${literal(token)});
  END IF;`
  : `IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'eventflow_staging_edge_service_token'
  ) THEN
    RAISE EXCEPTION 'Missing staging service token in Vault';
  END IF;`;
const sql = `DO $bootstrap$
DECLARE secret_id uuid;
BEGIN
  IF (SELECT public_assets_base_url FROM private.app_environment WHERE singleton)
     <> 'https://${ref}.supabase.co/storage/v1/object/public/public-assets' THEN
    RAISE EXCEPTION 'Staging environment configuration mismatch';
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  ${configureSecret}
  PERFORM cron.schedule('send-reminder-mail', '30 seconds', ${literal(command)});
END $bootstrap$;`;
mkdirSync('.local', { recursive: true });
const file = resolve('.local/staging-reminder-bootstrap.sql');
writeFileSync(file, sql, { mode: 0o600 });
try {
  execFileSync(process.env.SUPABASE_CLI ?? 'supabase', ['db', 'query', '--linked', '--workdir', workdir, '--file', file], { stdio: 'pipe', windowsHide: true });
  console.log('Staging reminder cron configured with bearer auth; token kept in Vault');
} catch (error) {
  const detail = token
    ? String(error.stderr ?? error.message).replaceAll(token, '<redacted>')
    : String(error.stderr ?? error.message);
  console.error(detail);
  throw new Error('Staging reminder bootstrap failed; secret SQL was not printed');
} finally {
  // Keep the path for diagnostics without retaining the token in plain SQL.
  writeFileSync(file, '-- Secret bootstrap content removed after execution.\n');
}
