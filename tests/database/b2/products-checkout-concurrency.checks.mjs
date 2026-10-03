// Exercise the unchanged REAL checkout function across its product -> event ->
// organization FK locks, not a simulated stock UPDATE. Disposable Docker only.
// Temporarily open registrations locally and restore the captured setting.
// No payment provider or email effects; no plan limits are changed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from '../disposable-container.mjs';
const container = process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { windowsHide:true });
    let output=''; let errors='';
    child.stdout.on('data',chunk=>{output+=chunk;});
    child.stderr.on('data',chunk=>{errors+=chunk;});
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve(output.trim()):reject(new Error(errors||`psql exit ${code}`)));
    child.stdin.end(statement);
  });
}
const actor='b22d0000-0000-4000-8000-000000000001';
const org='b22d0000-0000-4000-8000-000000000011';
const event='b22d0000-0000-4000-8000-000000000021';
const product='b22d0000-0000-4000-8000-000000000031';
const cleanup=`DELETE FROM public.organizations WHERE id='${org}';
 DELETE FROM private.rate_limit_hits WHERE key LIKE '%${org}%' OR key LIKE '%${event}%';`;
async function waitFor(statement,description) {
  for(let n=0;n<40;n++) {
    if(await sql(statement)==='t') return;
    await delay(40);
  }
  throw new Error(description);
}
const blocking=(waiter,holder)=>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity waiter JOIN pg_stat_activity holder
 ON holder.pid=ANY(pg_blocking_pids(waiter.pid)) WHERE waiter.application_name='${waiter}' AND holder.application_name='${holder}');`;
async function setup() {
  await sql(cleanup);
  await sql(`INSERT INTO public.organizations(id,type,name,plan,plan_expires_at)
   VALUES('${org}','association','B22 real checkout locks','pro',now()+interval '30 days');
   INSERT INTO public.events(id,org_id,slug,title,is_published,starts_at,ends_at)
   VALUES('${event}','${org}','b22-checkout-locks','Checkout locks',true,now()+interval '1 day',now()+interval '2 days');
   INSERT INTO public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees)
   VALUES('${product}','${event}','Checkout product',100,10,true);`);
}
const checkoutSql=`SELECT public.create_order_intent('${event}','[{"event_product_id":"${product}","quantity":1}]',
 '[{"event_product_id":"${product}","email":"checkout-attendee@example.test"}]',
 '{"email":"checkout-locks@example.test"}',NULL,NULL);`;
async function scenario(kind) {
  await setup();
  const holder=`b22_checkout_${kind}_holder`;
  const checkoutName=`b22_checkout_${kind}_buyer`;
  const organizerName=`b22_checkout_${kind}_organizer`;
  // This holder pauses REAL checkout after it has acquired the product lock,
  // at its existing event FOR UPDATE, before its orders.org_id FK KEY SHARE.
  const held=sql(`BEGIN; SET LOCAL application_name='${holder}'; SET LOCAL statement_timeout='12s';
   SELECT id FROM public.events WHERE id='${event}' FOR UPDATE; SELECT pg_sleep(4); COMMIT;`)
   .then(output=>({output}),error=>({error}));
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holder}' AND wait_event='PgSleep');`,'Event holder never acquired its fixture lock');
  const checkout=sql(`SET application_name='${checkoutName}'; SET statement_timeout='12s'; SET ROLE service_role;
   ${checkoutSql}`)
   .then(output=>({output}),error=>({error}));
  await waitFor(blocking(checkoutName,holder),'Real checkout never waited on its event after locking the product');
  let mutation;
  if(kind==='update') mutation=`SELECT public.organizer_update_event_product('${actor}',
   '{"org_id":"${org}","event_id":"${event}","product_id":"${product}","name":"After checkout","stock_qty":1}');`;
  else if(kind==='delete') mutation=`SELECT public.organizer_delete_event_product('${actor}','${org}','${event}','${product}');`;
  else mutation=`SELECT public.organizer_delete_event('${actor}','${org}','${event}');`;
  const organizer=sql(`SET application_name='${organizerName}'; SET statement_timeout='12s'; SET ROLE service_role; ${mutation}`)
   .then(output=>({output}),error=>({error}));
  if(kind==='event_delete') {
    const busy=await organizer;
    assert.match(busy.error?.message??'',/RESOURCE_BUSY/,'Event deletion must refuse the busy product without waiting on its event');
    assert.doesNotMatch(busy.error?.message??'',/deadlock detected|40P01/);
    assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holder}' AND wait_event='PgSleep');`),'t','Busy deletion must finish before the event holder releases');
    assert.equal(await sql(`SELECT count(*) FROM public.events WHERE id='${event}';`),'1','Busy delete must leave the event');
    assert.equal(await sql(`SELECT count(*) FROM public.event_products WHERE id='${product}';`),'1','Busy delete must leave the product');
  } else {
    // Verifies the waiter reached the product lock rather than the event lock.
    await waitFor(blocking(organizerName,checkoutName),'Organizer did not wait on the product held by real checkout');
  }
  const results=await Promise.all([held,checkout,organizer]);
  assert.equal(results[0].error,undefined,'Fixture holder must release');
  assert.equal(results[1].error,undefined,'Real checkout must finish product/event/org-FK sequence without deadlock');
  const order=JSON.parse(results[1].output);
  assert.ok(order.order_id,'Real checkout must return its persisted order');
  assert.equal(await sql(`SELECT count(*) FROM public.orders WHERE id='${order.order_id}' AND org_id='${org}' AND event_id='${event}' AND total_cents=100;`),'1');
  if(kind==='update') {
    assert.equal(results[2].error,undefined,'Product update must finish after checkout');
    assert.equal(await sql(`SELECT name||':'||stock_qty||':'||reserved_qty||':'||sold_qty FROM public.event_products WHERE id='${product}';`),'After checkout:1:1:0');
  } else if(kind==='delete') {
    assert.equal(results[2].error,undefined,'Product deletion must finish after checkout');
    assert.equal(await sql(`SELECT count(*) FROM public.event_products WHERE id='${product}';`),'0');
    assert.equal(await sql(`SELECT count(*) FROM public.order_items WHERE order_id='${order.order_id}' AND product_id IS NULL AND product_name_snapshot='Checkout product';`),'1','Historical order snapshot must survive deletion');
  } else {
    assert.equal(await sql(`SET ROLE service_role; SELECT public.organizer_delete_event('${actor}','${org}','${event}');`),'{"success": true}','Retry must retain the ordinary delete operation');
    assert.equal(await sql(`SELECT count(*) FROM public.orders WHERE id='${order.order_id}';`),'0','Retry must preserve historical event/order cascades');
    assert.equal(await sql(`SELECT count(*) FROM public.event_products WHERE event_id='${event}';`),'0');
  }
}
async function expiryScenario() {
  await setup();
  const order=JSON.parse(await sql(`SET ROLE service_role; ${checkoutSql}`));
  await sql(`UPDATE public.orders SET expires_at=now()-interval '1 minute' WHERE id='${order.order_id}';`);
  const workerName='b22_checkout_expiry_worker';
  // Real expiry takes this order lock itself, then releases reserved stock. The
  // delay merely exposes its established order-before-product lock boundary.
  const worker=sql(`BEGIN; SET LOCAL application_name='${workerName}'; SET LOCAL statement_timeout='12s'; SET LOCAL ROLE service_role;
   SELECT id FROM public.orders WHERE id='${order.order_id}' FOR UPDATE;
   SELECT pg_sleep(4); SELECT public.expire_unstarted_checkout('${order.order_id}'); COMMIT;`)
   .then(output=>({output}),error=>({error}));
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${workerName}' AND wait_event='PgSleep');`,'Expiry worker never retained its real order lock');
  const refusal=await sql(`SET ROLE service_role; SELECT public.organizer_delete_event('${actor}','${org}','${event}');`)
   .then(output=>({output}),error=>({error}));
  assert.match(refusal.error?.message??'',/RESOURCE_BUSY/,'Event deletion must refuse the busy order before locking products');
  assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${workerName}' AND wait_event='PgSleep');`),'t','Order-busy rejection must finish while worker retains its order lock');
  assert.equal(await sql(`SELECT count(*) FROM public.event_products WHERE id='${product}' AND reserved_qty=1;`),'1','Busy delete must have no product effect');
  const expired=await worker;
  assert.equal(expired.error,undefined,'Real expiry must complete without a delete/product deadlock');
  assert.equal(await sql(`SELECT status FROM public.orders WHERE id='${order.order_id}';`),'expired');
  assert.equal(await sql(`SELECT reserved_qty FROM public.event_products WHERE id='${product}';`),'0');
  assert.equal(await sql(`SET ROLE service_role; SELECT public.organizer_delete_event('${actor}','${org}','${event}');`),'{"success": true}');
  assert.equal(await sql(`SELECT count(*) FROM public.orders WHERE id='${order.order_id}';`),'0','Retry preserves original order cascade');
}
async function eventLockScenario() {
  await setup();
  const holderName='b22_checkout_event_only_holder';
  const holder=sql(`BEGIN; SET LOCAL application_name='${holderName}';
   SELECT id FROM public.events WHERE id='${event}' FOR UPDATE; SELECT pg_sleep(3); COMMIT;`)
   .then(output=>({output}),error=>({error}));
  await waitFor(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND wait_event='PgSleep');`,'Event-only holder never retained its lock');
  const refusal=await sql(`SET ROLE service_role; SELECT public.organizer_delete_event('${actor}','${org}','${event}');`)
   .then(output=>({output}),error=>({error}));
  assert.match(refusal.error?.message??'',/RESOURCE_BUSY/,'Deletion must not wait on an event while retaining children');
  assert.equal(await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${holderName}' AND wait_event='PgSleep');`),'t');
  assert.equal(await sql(`SELECT count(*) FROM public.event_products WHERE id='${product}';`),'1','Event-busy rejection must roll back product prelocks without deleting');
  assert.equal((await holder).error,undefined);
  assert.equal(await sql(`SET ROLE service_role; SELECT public.organizer_delete_event('${actor}','${org}','${event}');`),'{"success": true}');
}
let originalRegistrationsOpen;
try {
  originalRegistrationsOpen=await sql('SELECT registrations_open FROM private.platform_settings WHERE singleton;');
  assert.ok(['t','f'].includes(originalRegistrationsOpen),'A single boolean registration setting must exist');
  await sql('UPDATE private.platform_settings SET registrations_open=true WHERE singleton;');
  await scenario('update');
  await scenario('delete');
  await scenario('event_delete');
  await expiryScenario();
  await eventLockScenario();
  console.log('PASS: real checkout product/event/FK and real expiry order/product locks remain compatible; product mutations wait safely; event deletion refuses busy orders/products atomically and retry preserves cascades');
} finally {
  try {
    await sql(cleanup);
  } finally {
    if(['t','f'].includes(originalRegistrationsOpen)) {
      const restored=await sql(`UPDATE private.platform_settings SET registrations_open=${originalRegistrationsOpen==='t'?'true':'false'} WHERE singleton;
        SELECT registrations_open FROM private.platform_settings WHERE singleton;`);
      assert.equal(restored,originalRegistrationsOpen,'Registration setting must be restored even when fixture cleanup fails');
    }
  }
}
