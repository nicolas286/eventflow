const base=process.env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Backend check configuration missing');
const health=await fetch(`${base}/auth/v1/health`,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
if(!health.ok)throw new Error(`Auth health failed: ${health.status}`);
// This public endpoint must reject a missing order token, rather than crash.
const response=await fetch(`${base}/functions/v1/orders/11111111-1111-4111-8111-111111111111`,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
if(response.status!==401)throw new Error(`orders contract check failed: ${response.status}`);
if (!serviceKey) throw new Error('Cron check configuration missing');
const cronResponse=await fetch(`${base}/rest/v1/rpc/get_deployment_cron_status`,{
  method:'POST',
  headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},
  body:'{}',
  signal:AbortSignal.timeout(30000),
});
if(!cronResponse.ok)throw new Error(`Cron status check failed: ${cronResponse.status}`);
const cron=await cronResponse.json();
if(cron.reminder_jobs!==1 || cron.reminder_workers_jobs!==1 || cron.legacy_reminder_jobs!==0 || cron.renewal_jobs!==1){
  throw new Error(`Cron configuration invalid: ${JSON.stringify(cron)}`);
}
console.log('Auth, public order endpoint and cron jobs are ready');
