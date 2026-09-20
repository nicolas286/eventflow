const base=process.env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Backend check configuration missing');
const health=await fetch(`${base}/auth/v1/health`,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
if(!health.ok)throw new Error(`Auth health failed: ${health.status}`);
// This public endpoint must reject a missing order token, rather than crash.
const response=await fetch(`${base}/functions/v1/orders/11111111-1111-4111-8111-111111111111`,{headers:{apikey:key},signal:AbortSignal.timeout(30000)});
if(response.status!==401)throw new Error(`orders contract check failed: ${response.status}`);
console.log('Auth and public order endpoint are reachable');
