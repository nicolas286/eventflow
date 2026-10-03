import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { closureSql } from '../database/business-closure.mjs';

const workdir = process.argv[2], project = 'eventflow-security-b6-20261003';
if (!workdir || !readFileSync(`${workdir}/supabase/config.toml`, 'utf8').includes(`project_id = "${project}"`)) throw new Error('Pass only the isolated B6 workdir');
const container = `supabase_db_${project}`;
function sql(input) {
  const r = spawnSync('docker', ['exec', '-i', container, 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}
const status = spawnSync('supabase', ['status', '--workdir', workdir, '--output', 'json'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) throw new Error('Cannot read isolated runtime');
const runtime = JSON.parse(status.stdout);
if (!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.ANON_KEY || !runtime.SERVICE_ROLE_KEY || !runtime.JWT_SECRET) throw new Error('Missing loopback credentials');
const wasOpen = sql('select registrations_open from private.platform_settings where singleton;');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
try {
  sql(`BEGIN;${closureSql()}
${read('../../supabase/deferred-migrations/b6/20261003180000_retire_business_rls.sql').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, '')}
${read('../database/b5/catalog-fixture.sql').replace(/^BEGIN;$/mi, '')}
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
UPDATE private.app_environment SET public_assets_base_url='${runtime.API_URL}/storage/v1/object/public/public-assets' WHERE singleton;
DELETE FROM private.rate_limit_hits;
NOTIFY pgrst,'reload schema';COMMIT;`);
  const bundle = spawnSync('node', ['-e', "require('esbuild').buildSync({entryPoints:['netlify/functions/share-event.js'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'node_modules/.cache/b5-share.cjs'})"], { stdio: 'inherit', windowsHide: true });
  if (bundle.status !== 0) throw new Error('Netlify bundle failed');
  const result = spawnSync('deno', ['test', '--config', 'supabase/functions/deno.json', '--allow-net=127.0.0.1', '--allow-run=node', '--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,RATE_LIMIT_SALT,B0_LOCAL_JWT_SECRET,RATE_LIMIT_TRUST_CLOUDFLARE_IP,CORS_ALLOWED_ORIGINS,APP_ALLOWED_ORIGINS,APP_BASE_URL,LOCAL_ORGANIZER_STAGE',
    ...(process.argv.includes('--payments-only') ? ['tests/integration/payment-settings-b6.local.ts'] : ['tests/integration/invoice-history.local.ts', 'tests/integration/organizer.local.ts', 'tests/integration/events.local.ts', 'tests/integration/orders-management.local.ts', 'tests/integration/ticket-check-in.local.ts', 'tests/integration/public-catalog.local.ts', 'tests/integration/payment-settings-b6.local.ts'])], {
    stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SUPABASE_URL: runtime.API_URL, SUPABASE_ANON_KEY: runtime.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: runtime.SERVICE_ROLE_KEY, B0_LOCAL_JWT_SECRET: runtime.JWT_SECRET, RATE_LIMIT_SALT: 'synthetic-b6-local-salt', RATE_LIMIT_TRUST_CLOUDFLARE_IP: '0', LOCAL_ORGANIZER_STAGE: 'b2' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Real B6 HTTP boundary regression failed');
} finally {
  sql(`DELETE FROM public.organizations WHERE id IN ('b5000000-0000-4000-8000-000000000011','b5000000-0000-4000-8000-000000000012','b5000000-0000-4000-8000-000000000013'); UPDATE private.platform_settings SET registrations_open=${wasOpen === 't' ? 'true' : 'false'} WHERE singleton;`);
}
