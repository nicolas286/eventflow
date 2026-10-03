import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workdir = process.argv[2];
const project = 'eventflow-security-b1b2-20261003';
const stage = process.argv[3];
if (stage !== undefined && !['events','products','forms','b2'].includes(stage)) throw new Error('Unknown organizer integration stage');
if (!workdir || !readFileSync(`${workdir}/supabase/config.toml`, 'utf8').includes(`project_id = "${project}"`)) {
  throw new Error('Pass the isolated B1/B2 workdir rebuilt from migrations');
}
const container = `supabase_db_${project}`;
const status = spawnSync('supabase', ['status','--workdir',workdir,'--output','json'], {encoding:'utf8'});
if (status.status !== 0) throw new Error('Cannot read isolated local runtime');
const runtime = JSON.parse(status.stdout);
if (!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.ANON_KEY || !runtime.SERVICE_ROLE_KEY) throw new Error('Missing isolated loopback configuration');
function sql(input) {
  const result = spawnSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], {input,encoding:'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Disposable SQL failed');
}
const directory = new URL('../../supabase/deferred-migrations/b1/',import.meta.url);
const closure = readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => readFileSync(new URL(name,directory),'utf8')).join('\n');
const tables = ['organizations','organization_members','organization_profile','user_profile','organization_billing'];
let b2Closure = '';
if (stage) {
  const b2 = new URL('../../supabase/deferred-migrations/b2/',import.meta.url);
  const families = stage === 'events' ? ['events'] : stage === 'products' ? ['events','products'] : ['events','products','form'];
  b2Closure = readdirSync(b2).filter(name => name.endsWith('.sql') && (stage === 'b2' || families.some(f => name.includes(f)))).sort().map(name => readFileSync(new URL(name,b2),'utf8')).join('\n');
  const stageTables = ['events'];
  if (stage !== 'events') stageTables.push('event_products');
  if (stage === 'forms' || stage === 'b2') stageTables.push('event_form_fields','event_form_field_groups');
  if (stage === 'b2') stageTables.push('promo_codes');
  tables.push(...stageTables);
}
try {
  sql(`BEGIN; ${closure} ${b2Closure}
${tables.map(t => `ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY;`).join('\n')}
UPDATE private.platform_settings SET registrations_open=true WHERE singleton;
UPDATE private.app_environment SET public_assets_base_url='http://127.0.0.1:55321/storage/v1/object/public/public-assets' WHERE singleton;
NOTIFY pgrst,'reload schema'; COMMIT;`);
  const result = spawnSync('deno',['test','--config','supabase/functions/deno.json','--allow-net=127.0.0.1','--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,RATE_LIMIT_SALT,CORS_ALLOWED_ORIGINS,APP_ALLOWED_ORIGINS,APP_BASE_URL,LOCAL_ORGANIZER_STAGE','tests/integration/organizer.local.ts',...(stage ? ['tests/integration/events.local.ts'] : [])], {
    stdio:'inherit', env:{...process.env,SUPABASE_URL:runtime.API_URL,SUPABASE_ANON_KEY:runtime.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:runtime.SERVICE_ROLE_KEY,RATE_LIMIT_SALT:'synthetic-b1b2-local-salt',LOCAL_ORGANIZER_STAGE:stage ?? ''},
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('B1/B2 local HTTP recipe failed');
} finally {
  sql(tables.map(t => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`).join('\n'));
}
