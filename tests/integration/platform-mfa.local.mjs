import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const workdir=process.argv[2], project='eventflow-security-b6-20261003';
if (!workdir || !readFileSync(`${workdir}/supabase/config.toml`,'utf8').includes(`project_id = "${project}"`)) throw new Error('Dedicated local B6 stack required');
const status=spawnSync('supabase',['status','--workdir',workdir,'--output','json'],{encoding:'utf8',windowsHide:true});
if (status.status!==0) throw new Error('Local stack unavailable');
const runtime=JSON.parse(status.stdout);
if (!runtime.API_URL?.startsWith('http://127.0.0.1:') || !runtime.INBUCKET_URL?.startsWith('http://127.0.0.1:')) throw new Error('Loopback Auth and SMTP capture required');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(runtime.API_URL,runtime.SERVICE_ROLE_KEY,options), browser=createClient(runtime.API_URL,runtime.ANON_KEY,options);
function sql(statement) {
  const result=spawnSync('docker',['exec','-i',`supabase_db_${project}`,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',windowsHide:true});
  if (result.status!==0) throw new Error(result.stderr); return result.stdout.trim();
}
function totp(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits='';
  for (const char of secret.toUpperCase().replace(/=+$/,'')) bits+=alphabet.indexOf(char).toString(2).padStart(5,'0');
  const key=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(); const offset=digest[19]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
const mailbox=`d4-${randomUUID()}`, email=`${mailbox}@example.test`, password=`Synthetic-${randomUUID()}`;
let userId; const capturedIds=[];
try {
  // Unlike MAIL_MODE=capture, the actual Auth invite travels through local SMTP/Inbucket.
  const invite=await admin.auth.admin.inviteUserByEmail(email); assert.equal(invite.error,null); userId=invite.data.user.id;
  let messages=[];
  for (let n=0;n<20;n++) {
    const response=await fetch(`${runtime.INBUCKET_URL}/api/v1/messages`);
    if (response.ok) messages=(await response.json()).messages.filter(message=>message.To?.some(to=>to.Address===email)); if (messages.length) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(messages.length,'Auth invitation was not captured by the local SMTP transport');
  capturedIds.push(...messages.map(message=>message.ID));
  assert.equal((await admin.auth.admin.updateUserById(userId,{password,email_confirm:true})).error,null);
  const signed=await browser.auth.signInWithPassword({email,password}); assert.equal(signed.error,null);
  sql(`insert into private.platform_admins(user_id,note) values ('${userId}','D4 recovery fixture');`);
  const enrolled=await browser.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic lost factor'}); assert.equal(enrolled.error,null);
  const verified=await browser.auth.mfa.challengeAndVerify({factorId:enrolled.data.id,code:totp(enrolled.data.totp.secret)}); assert.equal(verified.error,null);
  const oldSession=(await browser.auth.getSession()).data.session;
  assert.equal((await browser.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,'aal2');
  sql(`update private.platform_admins set revoked_at=now() where user_id='${userId}';`);
  // A role regrant is not factor recovery: the original verified factor persists.
  sql(`update private.platform_admins set revoked_at=null where user_id='${userId}';`);
  assert.ok((await admin.auth.admin.mfa.listFactors({userId})).data.factors.some(f=>f.id===enrolled.data.id));
  sql(`update private.platform_admins set revoked_at=now() where user_id='${userId}';`);
  assert.equal((await admin.auth.admin.signOut(oldSession.access_token,'global')).error,null);
  assert.equal((await admin.auth.admin.mfa.deleteFactor({userId,id:enrolled.data.id})).error,null);
  assert.equal((await admin.auth.admin.mfa.listFactors({userId})).data.factors.length,0);
  const revokedSessionId=JSON.parse(Buffer.from(oldSession.access_token.split('.')[1],'base64url')).session_id;
  assert.equal(sql(`select exists(select 1 from auth.sessions where id='${revokedSessionId}' and user_id='${userId}');`),'f');
  const refresh=await browser.auth.refreshSession({refresh_token:oldSession.refresh_token}); assert.ok(refresh.error);
  assert.equal((await browser.auth.signInWithPassword({email,password})).error,null);
  const replacement=await browser.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic replacement'}); assert.equal(replacement.error,null);
  assert.equal((await browser.auth.mfa.challengeAndVerify({factorId:replacement.data.id,code:totp(replacement.data.totp.secret)})).error,null);
  assert.equal((await browser.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,'aal2');
  sql(`update private.platform_admins set revoked_at=null where user_id='${userId}';`);
  console.log('D4: real local Auth SMTP invite, TOTP enrollment, role-only non-recovery, global logout, factor deletion and replacement AAL2 passed.');
} finally {
  if (userId) { sql(`delete from private.platform_admins where user_id='${userId}';`); await admin.auth.admin.deleteUser(userId); }
  if (capturedIds.length) await fetch(`${runtime.INBUCKET_URL}/api/v1/messages`,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({IDs:capturedIds})});
}
