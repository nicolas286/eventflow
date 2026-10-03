import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';

const container = process.argv[2];
assertDisposableOrganizerContainer(container);
function sql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let output = '', errors = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { errors += value; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    child.stdin.end(input);
  });
}
async function sleeping(name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`) === 't') return;
    await delay(30);
  }
  throw new Error('Suspension race did not reach its transaction barrier');
}
const org = 'd7cc0000-0000-4000-8000-000000000001';
const event = 'd7cc0000-0000-4000-8000-000000000002';
const product = 'd7cc0000-0000-4000-8000-000000000003';
const create = `select public.create_order_intent('${event}', '[{"event_product_id":"${product}","quantity":1}]', '[{"event_product_id":"${product}","email":"race@example.test"}]', '{"email":"race@example.test"}');`;
const originalOpen = await sql('select registrations_open from private.platform_settings where singleton;');
try {
  await sql(`update private.platform_settings set registrations_open=true where singleton;
    insert into public.organizations(id,type,name,status,plan) values('${org}','association','Suspension race','active','pro');
    insert into public.events(id,org_id,slug,title,is_published,starts_at,ends_at) values('${event}','${org}','suspension-race','Suspension race',true,now()+interval '1 day',now()+interval '2 days');
    insert into public.event_products(id,event_id,name,price_cents,stock_qty,creates_attendees) values('${product}','${event}','Race ticket',1000,10,true);`);
  // A suspension already writing its status wins; the order must wait and fail.
  const suspension = sql(`begin; set local application_name='suspension_first'; set local statement_timeout='10s'; set local role service_role;
    update public.organizations set status='suspended' where id='${org}'; select pg_sleep(3); commit;`);
  await sleeping('suspension_first');
  const rejected = assert.rejects(sql(`set statement_timeout='10s'; set role service_role; ${create}`), /ORGANIZATION_SUSPENDED/);
  await Promise.all([suspension, rejected]);
  assert.equal(await sql(`select count(*) from public.orders where org_id='${org}';`), '0');
  assert.equal(await sql(`select reserved_qty from public.event_products where id='${product}';`), '0');
  // An admitted order finishes before the suspension commits, without deadlock.
  await sql(`update public.organizations set status='active' where id='${org}';`);
  const admitted = sql(`begin; set local application_name='order_first'; set local statement_timeout='10s'; set local role service_role;
    ${create} select pg_sleep(3); commit;`);
  await sleeping('order_first');
  const suspended = sql(`set statement_timeout='10s'; set role service_role; update public.organizations set status='suspended' where id='${org}';`);
  await Promise.all([admitted, suspended]);
  assert.equal(await sql(`select count(*) from public.orders where org_id='${org}';`), '1');
  assert.equal(await sql(`select status from public.organizations where id='${org}';`), 'suspended');
  await assert.rejects(sql(`set role service_role; ${create}`), /ORGANIZATION_SUSPENDED/);
  console.log('PASS: suspension/order races serialize in both directions; rejected orders leave no rows or stock');
} finally {
  await sql(`delete from public.orders where org_id='${org}'; delete from public.organizations where id='${org}';
    update private.platform_settings set registrations_open=${originalOpen === 't' ? 'true' : 'false'} where singleton;`);
}
