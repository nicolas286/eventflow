import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Deliberately fixed to the isolated B0 project. Never fall back to the linked
// workspace project or read .local, .env, hosted keys or production credentials.
const workdir = process.argv[2];
if (!workdir || !readFileSync(`${workdir}/supabase/config.toml`, 'utf8').includes('project_id = "eventflow-security-b0-20261002"')) {
  throw new Error('Pass the isolated B0 workdir rebuilt from migrations');
}
const container = 'supabase_db_eventflow-security-b0-20261002';
const status = spawnSync('supabase', ['status', '--workdir', workdir, '--output', 'json'], { encoding: 'utf8' });
if (status.status !== 0) throw new Error('Cannot read isolated local runtime');
const runtime = JSON.parse(status.stdout);
if (!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.ANON_KEY || !runtime.SERVICE_ROLE_KEY || !runtime.JWT_SECRET) {
  throw new Error('Missing isolated loopback credentials');
}
function sql(input) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Local SQL failed');
}
const closure = readFileSync(new URL('../../supabase/deferred-migrations/b0/20261002213326_close_invoice_history_browser_access.sql', import.meta.url), 'utf8');
// SQL ACL proof uses a rollback-only transaction (separate runner). ALTER RLS
// holds AccessExclusiveLock until transaction end; an HTTP connection cannot
// read through that lock. On this disposable DB ONLY, commit the no-RLS state
// for HTTP, restore it afterwards, then delete the project with supabase stop.
try {
  sql(`BEGIN; ${closure}
ALTER TABLE public.invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members DISABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema'; COMMIT;`);
  const result = spawnSync('deno', ['test', '--config', 'supabase/functions/deno.json', '--allow-net=127.0.0.1', '--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,RATE_LIMIT_SALT,B0_LOCAL_JWT_SECRET,CORS_ALLOWED_ORIGINS,APP_ALLOWED_ORIGINS,APP_BASE_URL', 'tests/integration/invoice-history.local.ts'], {
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_URL: runtime.API_URL, SUPABASE_ANON_KEY: runtime.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: runtime.SERVICE_ROLE_KEY, B0_LOCAL_JWT_SECRET: runtime.JWT_SECRET, RATE_LIMIT_SALT: 'synthetic-b0-local-salt' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('B0 local HTTP recipe failed');
} finally {
  sql('ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY; ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;');
}
