import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { assertDisposableOrganizerContainer } from './disposable-container.mjs';
const container = process.argv[2]; assertDisposableOrganizerContainer(container);
function sql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let out = '', err = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(err))); child.stdin.end(input);
  });
}
const actor='d3000000-0000-4000-8000-000000000001', owner='d3000000-0000-4000-8000-000000000002';
const session='d3000000-0000-4000-8000-000000000003', session2='d3000000-0000-4000-8000-000000000004';
const operation='d3000000-0000-4000-8000-000000000005';
const originalSettings = JSON.parse(await sql('select to_jsonb(s) from private.platform_settings s where singleton;'));
const payload=JSON.stringify({ownerUserId:owner, ownerEmail:'d3-owner@example.test',organizationName:'D3 concurrent fixture',organizationType:'association',plan:'free',status:'active',idempotencyKey:operation,payloadHash:'a'.repeat(64),reason:'Fixture D3'});
const mutate=`select public.platform_admin_mutate('${actor}','${session}','aal2','organizations.onboard','${payload}'::jsonb,null);`;
async function waitSleeping(name) {
  for (let n=0;n<100;n++) {
    if (await sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event='PgSleep');`) === 't') return;
    await delay(30);
  }
  throw new Error('Concurrent session did not reach its lock-holding barrier');
}
try {
  for (const name of ['20261003190000_platform_onboarding_atomic_replay.sql','20261003191000_platform_campaign_retry.sql']) {
    // Runner operates on a freshly replayed disposable database. DDL is checked separately by replay.
    assert.ok(readFileSync(`supabase/migrations/${name}`, 'utf8').includes('commit;'));
  }
  await sql(`insert into auth.users(id,email,aud,role,email_confirmed_at) values
    ('${actor}','d3-admin@example.test','authenticated','authenticated',now()),('${owner}','d3-owner@example.test','authenticated','authenticated',now());
    insert into auth.sessions(id,user_id) values ('${session}','${actor}'),('${session2}','${actor}');
    insert into private.platform_admins(user_id,note) values ('${actor}','Synthetic fixture');`);
  for (const hash of ['c'.repeat(64), 'd'.repeat(64)]) await sql(`set role service_role;
    select public.platform_admin_issue_step_up('${actor}','${session}','aal2','${hash}','organizations.onboard','d3-owner@example.test',now()+interval '4 minutes');`);
  const authorize = hash => `select public.platform_admin_authorize_onboarding('${actor}','${session}','aal2','${operation}','d3-owner@example.test',repeat('a',64),'${hash}');`;
  const authorizedFirst = sql(`begin; set local application_name='d3_authorize_first'; set local role service_role; ${authorize('c'.repeat(64))} select pg_sleep(2); commit;`);
  await waitSleeping('d3_authorize_first');
  const authorizedSecond = sql(`set role service_role; ${authorize('d'.repeat(64))}`);
  const authorizationResults = await Promise.all([authorizedFirst, authorizedSecond]);
  for (const result of authorizationResults) assert.equal(JSON.parse(result.split('\n')[0]).authorized, true);
  const first=sql(`begin; set local application_name='d3_onboarding_first'; set local role service_role; ${mutate} select pg_sleep(2); commit;`);
  await waitSleeping('d3_onboarding_first');
  const second=sql(`set role service_role; ${mutate}`);
  const results=await Promise.all([first,second]);
  assert.equal(JSON.parse(results[0].split('\n')[0]).replayed,false); assert.equal(JSON.parse(results[1]).replayed,true);
  assert.equal(await sql(`select count(*) from public.organizations where created_by='${owner}';`),'1');
  assert.equal(await sql(`select count(*) from private.platform_audit_log where actor_user_id='${actor}' and action='organizations.onboard';`),'1');
  const org=JSON.parse(results[1]).organizationId;
  console.log('D3: concurrent service_role onboarding succeeds twice, one organization and one audit.');
  for (const role of ['anon','authenticated']) await assert.rejects(sql(`set role ${role}; ${mutate}`),/permission denied/);
  await assert.rejects(sql(`set role service_role; ${mutate.replace("'aal2'","'aal1'")}`),/PLATFORM_MFA_REQUIRED/);
  await assert.rejects(sql(`set role service_role; ${mutate.replace(`"payloadHash":"${'a'.repeat(64)}"`,`"payloadHash":"${'b'.repeat(64)}"`)}`),/PLATFORM_IDEMPOTENCY_CONFLICT/);
  const target='global', action='settings.registrations.set', hash='b'.repeat(64);
  const settings={registrationsOpen:true,registrationPublicMessage:'Synthetic fixture',reason:'D4 fixture'};
  const consume=(sid=session,act=action,tgt=target)=>`set role service_role; select public.platform_admin_mutate('${actor}','${sid}','aal2','${act}','${JSON.stringify(act===action?settings:{orgId:tgt,status:'active',reason:'D4 fixture'})}'::jsonb,'${hash}');`;
  const issue=()=>sql(`set role service_role; select public.platform_admin_issue_step_up('${actor}','${session}','aal2','${hash}','${action}','${target}',now()+interval '4 minutes');`);
  await issue();
  await assert.rejects(sql(consume(session2)),/PLATFORM_STEP_UP_REQUIRED/);
  await assert.rejects(sql(consume(session,'organizations.status',org)),/PLATFORM_STEP_UP_REQUIRED/);
  const otherHash='e'.repeat(64);
  await sql(`set role service_role; select public.platform_admin_issue_step_up('${actor}','${session}','aal2','${otherHash}','organizations.status','${org}',now()+interval '4 minutes');`);
  await assert.rejects(sql(consume(session,'organizations.status','d4000000-0000-4000-8000-000000000001').replace(hash,otherHash)),/PLATFORM_STEP_UP_REQUIRED/);
  await sql(`update private.platform_step_up_grants set created_at=now()-interval '2 minutes', expires_at=now()-interval '1 second' where token_hash='${hash}';`);
  await assert.rejects(sql(consume()),/PLATFORM_STEP_UP_REQUIRED/);
  await sql(`update private.platform_step_up_grants set expires_at=now()+interval '4 minutes' where token_hash='${hash}'; update private.platform_admins set revoked_at=now() where user_id='${actor}';`);
  await assert.rejects(sql(consume()),/PLATFORM_FORBIDDEN/);
  await sql(`update private.platform_admins set revoked_at=null where user_id='${actor}';`);
  const once=sql(`begin; set local application_name='d4_stepup_first'; ${consume().replace('set role','set local role')} select pg_sleep(2); commit;`);
  await waitSleeping('d4_stepup_first');
  await assert.rejects(sql(consume()),/PLATFORM_STEP_UP_REQUIRED/); await once;
  await assert.rejects(sql(consume()),/PLATFORM_STEP_UP_REQUIRED/);
  console.log('D4: real SQL expiry, wrong action/session, revoked admin, concurrent consumption and replay refused.');

  const campaign='d5000000-0000-4000-8000-000000000001', delivery='d5000000-0000-4000-8000-000000000002';
  const campaignPayload=JSON.stringify({target:'organization',organizationId:org,subject:'Fixture',body:'Fixture body',reason:'D5 concurrency',idempotencyKey:'d5000000-0000-4000-8000-000000000009'});
  for (const proof of ['1'.repeat(64),'2'.repeat(64)]) await sql(`set role service_role;
    select public.platform_admin_issue_step_up('${actor}','${session}','aal2','${proof}','communications.email.send','${org}',now()+interval '4 minutes');`);
  const create=proof=>`select public.platform_admin_create_email_campaign('${actor}','${session}','aal2','${campaignPayload}'::jsonb,'${proof}');`;
  const createFirst=sql(`begin; set local application_name='d5_create_first'; set local role service_role; ${create('1'.repeat(64))} select pg_sleep(2); commit;`);
  await waitSleeping('d5_create_first');
  const createSecond=sql(`set role service_role; ${create('2'.repeat(64))}`);
  const creation=await Promise.all([createFirst,createSecond]);
  assert.equal(JSON.parse(creation[0].split('\n')[0]).id,JSON.parse(creation[1]).id);
  assert.equal(await sql("select count(*) from private.platform_email_campaigns where idempotency_key='d5000000-0000-4000-8000-000000000009';"),'1');
  await sql(`insert into private.platform_email_campaigns(id,idempotency_key,actor_user_id,actor_session_id,target_type,organization_id,subject,body,reason,recipient_count)
    values ('${campaign}',gen_random_uuid(),'${actor}','${session}','organization','${org}','Fixture subject','Fixture body','D5 fixture',1);
    insert into private.platform_email_deliveries(id,campaign_id,organization_id,recipient_user_id,recipient_email)
    values ('${delivery}','${campaign}','${org}','${owner}','d3-owner@example.test');`);
  const claim=`select public.platform_admin_email_campaign_deliveries('${campaign}');`;
  const held=sql(`begin; set local application_name='d5_claim_first'; set local role service_role; ${claim} select pg_sleep(2); commit;`);
  await waitSleeping('d5_claim_first'); const competing=sql(`set role service_role; ${claim}`);
  const [claimed,excluded]=await Promise.all([held,competing]); const lease=JSON.parse(claimed.split('\n')[0]).deliveries[0];
  assert.deepEqual(JSON.parse(excluded).deliveries,[]);
  const complete=(token,success)=>`set role service_role; select public.platform_admin_complete_email_delivery('${campaign}','${delivery}','${token}',${success},'capture','synthetic-message','MAIL_SERVICE_FAILED');`;
  assert.equal(await sql(complete(lease.claimToken,false)),'t');
  assert.deepEqual(JSON.parse(await sql(`set role service_role; ${claim}`)).deliveries,[]);
  await sql(`update private.platform_email_deliveries set retry_after=now()-interval '1 second' where id='${delivery}';`);
  const retry=JSON.parse(await sql(`set role service_role; ${claim}`)).deliveries[0];
  assert.notEqual(retry.claimToken,lease.claimToken); assert.equal(await sql(complete(lease.claimToken,true)),'f');
  assert.equal(await sql(complete(retry.claimToken,true)),'t');
  assert.deepEqual(JSON.parse(await sql(`set role service_role; ${claim}`)).deliveries,[]);
  assert.equal(await sql(`select attempts||':'||status from private.platform_email_deliveries where id='${delivery}';`),'2:sent');
  await sql(`update private.platform_email_deliveries set status='failed',attempts=3,retry_after=null where id='${delivery}';`);
  assert.deepEqual(JSON.parse(await sql(`set role service_role; ${claim}`)).deliveries,[]);
  await sql(`update private.platform_email_deliveries set attempts=1,first_attempt_at=now()-interval '24 hours' where id='${delivery}';`);
  assert.deepEqual(JSON.parse(await sql(`set role service_role; ${claim}`)).deliveries,[]);
  for (const role of ['anon','authenticated']) {
    await assert.rejects(sql(`set role ${role}; ${claim}`),/permission denied/);
    await assert.rejects(sql(complete(retry.claimToken,true).replace('set role service_role',`set role ${role}`)),/permission denied/);
  }
  await assert.rejects(sql(`set role service_role; select public.platform_admin_record_email_delivery('${campaign}','${delivery}',true);`),/permission denied/);
  await assert.rejects(sql(`begin; grant execute on function public.platform_admin_record_email_delivery(uuid,uuid,boolean,text,text,text) to service_role;
    set local role service_role; select public.platform_admin_record_email_delivery('${campaign}','${delivery}',true);`),/PLATFORM_EMAIL_DELIVERY_CLAIM_REQUIRED/);
  assert.equal(await sql(`select count(*) from private.platform_audit_log where actor_user_id='${actor}' and action='communications.email.delivery';`),'2');
  console.log('D5: concurrent claim, provider failure, cooldown, retry, fencing, sent exclusion, attempt/window bounds, real ACL and audit passed.');
} finally {
  const saved=JSON.stringify(originalSettings).replaceAll("'","''");
  await sql(`update private.platform_settings set registrations_open=('${saved}'::jsonb->>'registrations_open')::boolean,
    registration_public_message='${saved}'::jsonb->>'registration_public_message',
    updated_at=('${saved}'::jsonb->>'updated_at')::timestamptz,
    updated_by=nullif('${saved}'::jsonb->>'updated_by','')::uuid where singleton;`);
  await sql(`delete from private.platform_email_campaigns where actor_user_id='${actor}';
    delete from private.platform_onboarding_operations where actor_user_id='${actor}';
    delete from private.platform_step_up_grants where admin_user_id='${actor}';
    delete from private.platform_audit_log where actor_user_id='${actor}';
    delete from public.organizations where created_by='${owner}';
    delete from auth.users where id in ('${actor}','${owner}');`);
}
