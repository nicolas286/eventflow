import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workdir=process.argv[2], project='eventflow-security-b5-20261003';
if(!workdir || !readFileSync(`${workdir}/supabase/config.toml`,'utf8').includes(`project_id = "${project}"`)) throw new Error('Pass only the isolated B5 workdir');
const container=`supabase_db_${project}`;
function sql(input){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();}
const status=spawnSync('supabase',['status','--workdir',workdir,'--output','json'],{encoding:'utf8',windowsHide:true});
if(status.status!==0)throw new Error('Cannot read isolated local runtime');
const runtime=JSON.parse(status.stdout);
if(!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.ANON_KEY || !runtime.SERVICE_ROLE_KEY)throw new Error('Missing synthetic loopback configuration');
const tables=['organizations','organization_profile','events','event_products','event_form_fields','event_form_field_groups'];
const wasOpen=sql('select registrations_open from private.platform_settings where singleton;');
try{
 const closure=readFileSync(new URL('../../supabase/deferred-migrations/b5/20261003160000_close_public_catalog_browser_access.sql',import.meta.url),'utf8').replace(/^begin;$/mi,'').replace(/^commit;$/mi,'');
 const fixture=readFileSync(new URL('../database/b5/catalog-fixture.sql',import.meta.url),'utf8').replace(/^BEGIN;$/mi,'');
 sql(`BEGIN;${fixture}${closure}${tables.map(t=>`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY;`).join('\n')}NOTIFY pgrst,'reload schema';COMMIT;`);
 const bundle=spawnSync('node',['-e',"require('esbuild').buildSync({entryPoints:['netlify/functions/share-event.js'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'node_modules/.cache/b5-share.cjs'})"],{stdio:'inherit',windowsHide:true});
 if(bundle.status!==0)throw new Error('Cannot bundle shared Netlify contract');
 const r=spawnSync('deno',['test','--config','supabase/functions/deno.json','--allow-net=127.0.0.1','--allow-run=node','--allow-env=SUPABASE_URL,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,RATE_LIMIT_SALT,RATE_LIMIT_TRUST_CLOUDFLARE_IP,CORS_ALLOWED_ORIGINS,APP_ALLOWED_ORIGINS,APP_BASE_URL','tests/integration/public-catalog.local.ts'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,SUPABASE_URL:runtime.API_URL,SUPABASE_ANON_KEY:runtime.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:runtime.SERVICE_ROLE_KEY,RATE_LIMIT_SALT:'synthetic-b4-salt'},
 });
 if(r.error)throw r.error;if(r.status!==0)throw new Error('B5 real HTTP recipe failed');
}finally{sql(`DELETE FROM public.organizations WHERE id IN ('b5000000-0000-4000-8000-000000000011','b5000000-0000-4000-8000-000000000012','b5000000-0000-4000-8000-000000000013');${tables.map(t=>`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`).join('\n')}UPDATE private.platform_settings SET registrations_open=${wasOpen==='t'?'true':'false'} WHERE singleton;`);}
