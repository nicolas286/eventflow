// Real unchanged checkout across product/event/promo/org-FK locks. Local or CI
// disposable fixtures only; no payment provider/mail or plan limit mutations.
// Registrations open temporarily; the original setting is restored in finally.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from '../disposable-container.mjs';
const container=process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(statement){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});
 let output='';let errors='';child.stdout.on('data',c=>{output+=c;});child.stderr.on('data',c=>{errors+=c;});
 child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(new Error(errors||`psql exit ${code}`)));child.stdin.end(statement);
});}
const actor='b24c0000-0000-4000-8000-000000000001';const org='b24c0000-0000-4000-8000-000000000011';
const event='b24c0000-0000-4000-8000-000000000021';const promo='b24c0000-0000-4000-8000-000000000041';
const productA='b24c0000-0000-4000-8000-000000000031';const productB='b24c0000-0000-4000-8000-000000000032';
const cleanup=`DELETE FROM public.orders WHERE org_id='${org}';DELETE FROM public.organizations WHERE id='${org}';DELETE FROM private.rate_limit_hits WHERE key LIKE '%${event}%';`;
async function setup(maxUses){await sql(cleanup);await sql(`INSERT INTO public.organizations(id,type,name,plan) VALUES('${org}','association','B24 concurrent promos','free');
 INSERT INTO public.events(id,org_id,slug,title,is_published,starts_at,ends_at) VALUES('${event}','${org}','b24-concurrency','Promo locks',true,now()+interval '1 day',now()+interval '2 days');
 INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees) VALUES('${productA}','${event}','First product',100,10,true),('${productB}','${event}','Second product',100,10,true);
 INSERT INTO public.promo_codes(id,org_id,event_id,code,discount_cents,max_uses,updated_at) VALUES('${promo}','${org}','${event}','LAST',10,${maxUses},'2000-01-01');`);}
const checkout=product=>`SELECT public.create_order_intent('${event}','[{"event_product_id":"${product}","quantity":1}]',
 '[{"event_product_id":"${product}","email":"promo-concurrency-attendee@example.test"}]','{"email":"promo-concurrency-buyer@example.test"}',NULL,'last');`;
async function waitFor(statement,message){for(let n=0;n<40;n++){if(await sql(statement)==='t')return;await delay(40);}throw new Error(message);}
const sleeps=name=>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND wait_event='PgSleep');`;
const blocked=(waiter,holder)=>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='${waiter}' AND h.application_name='${holder}');`;
async function organizerDuringCheckout(kind){
 await setup(10);
 const holderName=`b24_${kind}_holder`;const buyerName=`b24_${kind}_checkout`;const organizerName=`b24_${kind}_organizer`;
 // A third connection holds ONLY the promo. Real checkout acquires product and
 // event first, then waits here before its redemption/counter/org-FK effects.
 const holder=sql(`BEGIN;SET LOCAL application_name='${holderName}';SET LOCAL statement_timeout='12s';
  SELECT id FROM public.promo_codes WHERE id='${promo}' FOR UPDATE;SELECT pg_sleep(4);COMMIT;`).then(output=>({output}),error=>({error}));
 await waitFor(sleeps(holderName),'Promo holder never retained its fixture lock');
 const buyer=sql(`SET application_name='${buyerName}';SET statement_timeout='12s';SET ROLE service_role;${checkout(productA)}`).then(output=>({output}),error=>({error}));
 await waitFor(blocked(buyerName,holderName),'Real checkout never reached its existing promo lock');
 const mutation=kind==='update'?`SELECT public.organizer_update_event_promo_code('${actor}','{"org_id":"${org}","event_id":"${event}","promo_code_id":"${promo}","code":"AFTER","max_uses":2}');`
  :`SELECT public.organizer_delete_event_promo_code('${actor}','${org}','${event}','${promo}');`;
 const organizer=sql(`SET application_name='${organizerName}';SET statement_timeout='12s';SET ROLE service_role;${mutation}`).then(output=>({output}),error=>({error}));
 await waitFor(`SELECT (${blocked(organizerName,holderName).slice(7,-1)}) OR (${blocked(organizerName,buyerName).slice(7,-1)});`,'Organizer did not overlap the real checkout promo lock');
 const results=await Promise.all([holder,buyer,organizer]);assert.equal(results[0].error,undefined);assert.equal(results[1].error,undefined,'Checkout must finish through org FK without 40P01');
 const order=JSON.parse(results[1].output);assert.ok(order.order_id);assert.equal(order.discount_cents,10);
 assert.equal(await sql(`SELECT used_count FROM public.promo_codes WHERE id='${promo}';`),'1');
 assert.equal(await sql(`SELECT discount_cents FROM public.promo_code_redemptions WHERE order_id='${order.order_id}';`),'10');
 if(kind==='update'){
  assert.equal(results[2].error,undefined);const updated=JSON.parse(results[2].output);
  assert.equal(updated.used_count,1,'Waiter must preserve the newly committed counter');assert.equal(updated.code,'AFTER');
  assert.equal(await sql(`SELECT p.updated_at=r.created_at FROM public.promo_codes p JOIN public.promo_code_redemptions r ON r.promo_code_id=p.id WHERE p.id='${promo}';`),'t','Update preserves the checkout timestamp rather than touching it again');
 }else{
  assert.match(results[2].error?.message??'',/promo_code_redemptions_promo_code_id_fkey|23503/,'Issued redemption must restrict waiter deletion');
  assert.doesNotMatch(results[2].error?.message??'',/deadlock detected|40P01/);
  assert.equal(await sql(`SELECT code FROM public.promo_codes WHERE id='${promo}';`),'LAST');
 }
}
async function lastSlot(){
 await setup(1);
 const firstName='b24_last_first';const secondName='b24_last_second';
 const first=sql(`BEGIN;SET LOCAL application_name='${firstName}';SET LOCAL statement_timeout='12s';SET LOCAL ROLE service_role;${checkout(productA)}SELECT pg_sleep(4);COMMIT;`).then(output=>({output}),error=>({error}));
 await waitFor(sleeps(firstName),'First checkout never retained its actual last-slot reservation');
 const second=sql(`SET application_name='${secondName}';SET statement_timeout='12s';SET ROLE service_role;${checkout(productB)}`).then(output=>({output}),error=>({error}));
 await waitFor(blocked(secondName,firstName),'Second checkout did not overlap the first event/promo transaction');
 const results=await Promise.all([first,second]);assert.equal(results[0].error,undefined);
 assert.match(results[1].error?.message??'',/PROMO_CODE_USAGE_LIMIT_REACHED/,'Only one checkout can use the last slot');
 assert.equal(await sql(`SELECT count(*) FROM public.orders WHERE org_id='${org}';`),'1');
 assert.equal(await sql(`SELECT used_count FROM public.promo_codes WHERE id='${promo}';`),'1');
 assert.equal(await sql(`SELECT count(*) FROM public.promo_code_redemptions WHERE promo_code_id='${promo}';`),'1');
 assert.equal(await sql(`SELECT reserved_qty||':'||sold_qty FROM public.event_products WHERE id='${productB}';`),'0:0','Rejected checkout must leave its own product untouched');
}
let originalRegistrationsOpen;
try{
 originalRegistrationsOpen=await sql('SELECT registrations_open FROM private.platform_settings WHERE singleton;');
 assert.ok(['t','f'].includes(originalRegistrationsOpen),'A single boolean registration setting must exist');
 await sql('UPDATE private.platform_settings SET registrations_open=true WHERE singleton;');
 await organizerDuringCheckout('update');await organizerDuringCheckout('delete');await lastSlot();
 console.log('PASS: real checkout + promo update retains committed usage/timestamp, checkout + deletion preserves FK snapshots, and two overlapping checkouts consume only one last-use slot');
}finally{
 try{await sql(cleanup);}finally{
  if(['t','f'].includes(originalRegistrationsOpen)){
   const restored=await sql(`UPDATE private.platform_settings SET registrations_open=${originalRegistrationsOpen==='t'?'true':'false'} WHERE singleton;
    SELECT registrations_open FROM private.platform_settings WHERE singleton;`);
   assert.equal(restored,originalRegistrationsOpen,'Registration setting must be restored even when fixture cleanup fails');
  }
 }
}
