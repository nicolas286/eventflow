// Disposable real PostgreSQL connections. Never overwrite business plan limits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from '../disposable-container.mjs';
const container=process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(statement) {
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});
  let output='';let errors='';
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
  child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(new Error(errors||`psql exit ${code}`)));child.stdin.end(statement);
 });
}
const actor='b23c0000-0000-4000-8000-000000000001';
const org='b23c0000-0000-4000-8000-000000000011';
const capEvent='b23c0000-0000-4000-8000-000000000021';
const activationEvent='b23c0000-0000-4000-8000-000000000022';
const reorderEvent='b23c0000-0000-4000-8000-000000000023';
const fieldA='b23c0000-0000-4000-8000-000000000041';const fieldB='b23c0000-0000-4000-8000-000000000042';
const groupA='b23c0000-0000-4000-8000-000000000031';const groupB='b23c0000-0000-4000-8000-000000000032';
const cleanup=`DELETE FROM public.organizations WHERE id='${org}';DELETE FROM private.rate_limit_hits WHERE key LIKE '%${capEvent}%' OR key LIKE '%${activationEvent}%' OR key LIKE '%${reorderEvent}%';`;
async function waitFor(statement,message){for(let n=0;n<40;n++){if(await sql(statement)==='t')return;await delay(40);}throw new Error(message);}
async function overlap(kind,firstStatement,secondStatement,errorPattern){
 const firstName=`b23_${kind}_first`;const secondName=`b23_${kind}_second`;
 const first=sql(`BEGIN;SET LOCAL application_name='${firstName}';SET LOCAL ROLE service_role;${firstStatement}SELECT pg_sleep(3);COMMIT;`).then(output=>({output}),error=>({error}));
 await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${firstName}' AND wait_event='PgSleep');`,'First form operation never retained its organization lock');
 const second=sql(`SET application_name='${secondName}';SET ROLE service_role;${secondStatement}`).then(output=>({output}),error=>({error}));
 await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity waiter JOIN pg_stat_activity holder ON holder.pid=ANY(pg_blocking_pids(waiter.pid)) WHERE waiter.application_name='${secondName}' AND holder.application_name='${firstName}');`,'Second form operation did not wait on the first organization lock');
 const results=await Promise.all([first,second]);assert.equal(results[0].error,undefined);
 if(errorPattern)assert.match(results[1].error?.message??'',errorPattern);else assert.equal(results[1].error,undefined);
}
try{
 assert.equal(await sql("SELECT max_form_fields=100 FROM public.plan_limits WHERE plan='pro';"),'t','Requires the actual seeded 100-active-field quota; never overwrites settings');
 await sql(cleanup);
 await sql(`INSERT INTO public.organizations(id,type,name,plan,plan_expires_at) VALUES('${org}','association','B23 concurrent forms','pro',now()+interval '30 days');
  INSERT INTO public.events(id,org_id,slug,title) VALUES('${capEvent}','${org}','b23-cap','Cap'),('${activationEvent}','${org}','b23-activate','Activate'),('${reorderEvent}','${org}','b23-reorder','Reorder');
  INSERT INTO public.event_form_fields(event_id,label,field_key,field_type,is_active) SELECT '${capEvent}','Active '||n,'active_'||n,'text',true FROM generate_series(1,99)n;
  INSERT INTO public.event_form_fields(event_id,label,field_key,field_type,is_active) SELECT '${activationEvent}','Active '||n,'active_'||n,'text',true FROM generate_series(1,99)n;
  INSERT INTO public.event_form_fields(id,event_id,label,field_key,field_type,is_active) VALUES('${fieldA}','${activationEvent}','Activate first','first','text',false),('${fieldB}','${activationEvent}','Activate second','second','text',false);`);
 await overlap('cap',
  `SELECT public.organizer_create_event_form_field('${actor}','{"org_id":"${org}","event_id":"${capEvent}","label":"Last field","field_key":"last_field","field_type":"text","is_active":true}');`,
  `SELECT public.organizer_create_event_form_field('${actor}','{"org_id":"${org}","event_id":"${capEvent}","label":"Overflow field","field_key":"overflow_field","field_type":"text","is_active":true}');`,
  /PLAN_LIMIT: max_form_fields exceeded/);
 assert.equal(await sql(`SELECT count(*) FROM public.event_form_fields WHERE event_id='${capEvent}';`),'100');
 await overlap('activation',
  `SELECT public.organizer_update_event_form_field('${actor}','{"org_id":"${org}","event_id":"${activationEvent}","field_id":"${fieldA}","is_active":true}');`,
  `SELECT public.organizer_update_event_form_field('${actor}','{"org_id":"${org}","event_id":"${activationEvent}","field_id":"${fieldB}","is_active":true,"label":"Must rollback"}');`,
  /PLAN_LIMIT: max_form_fields exceeded/);
 assert.equal(await sql(`SELECT count(*) FROM public.event_form_fields WHERE event_id='${activationEvent}' AND is_active;`),'100');
 assert.equal(await sql(`SELECT label||':'||is_active FROM public.event_form_fields WHERE id='${fieldB}';`),'Activate second:false','Rejected activation must roll back its complete patch');
 await sql(`DELETE FROM public.event_form_fields WHERE event_id='${activationEvent}';
  INSERT INTO public.event_form_field_groups(id,event_id,label) VALUES('${groupA}','${reorderEvent}','First group'),('${groupB}','${reorderEvent}','Second group');
  INSERT INTO public.event_form_fields(id,event_id,group_id,label,field_key,field_type) VALUES('${fieldA}','${reorderEvent}','${groupA}','First field','first','text'),('${fieldB}','${reorderEvent}','${groupB}','Second field','second','text');`);
 const batch=(a,b)=>JSON.stringify({org_id:org,event_id:reorderEvent,fields:[{id:fieldA,sort_order:a},{id:fieldB,sort_order:b}],groups:[{id:groupA,sort_order:a},{id:groupB,sort_order:b}]});
 await overlap('reorder',`SELECT public.organizer_reorder_event_form('${actor}','${batch(1,2)}');`,`SELECT public.organizer_reorder_event_form('${actor}','${batch(9,8)}');`);
 assert.equal(await sql(`SELECT string_agg(sort_order::text,',' ORDER BY id) FROM public.event_form_fields WHERE event_id='${reorderEvent}';`),'9,8');
 assert.equal(await sql(`SELECT string_agg(sort_order::text,',' ORDER BY id) FROM public.event_form_field_groups WHERE event_id='${reorderEvent}';`),'9,8');
 console.log('PASS: actual 100-active-field creation/activation quotas and combined group/field reorders serialize on real organization locks; no obsolete total-field cap or plan settings overwritten');
}finally{await sql(cleanup);}
