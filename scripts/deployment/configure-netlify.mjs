import { readFileSync } from 'node:fs';
import { validateTarget } from './check-target.mjs';
const targets=JSON.parse(readFileSync(new URL('../../deploy/environments.json',import.meta.url)));
const target=validateTarget(process.argv[2],targets,process.env);
if(!process.env.NETLIFY_AUTH_TOKEN)throw new Error('Missing Netlify deployment credential');
const api=async(path,method='GET',body)=>{
  const response=await fetch(`https://api.netlify.com/api/v1${path}`,{
    method, headers:{Authorization:`Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw new Error(`Netlify configuration failed (${response.status})`);
  return response.status===204?null:response.json();
};
const site=await api(`/sites/${target.netlifySiteId}`);
if(site.id!==target.netlifySiteId || site.build_settings.repo_branch!==target.branch)throw new Error('Netlify site/branch mismatch');
const path=`/accounts/${encodeURIComponent(site.account_id)}/env`;
const query=`?site_id=${encodeURIComponent(site.id)}`;
const existing=await api(path+query);
for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_BASE_URL','PUBLIC_BASE_URL','VITE_TURNSTILE_SITEKEY']){
  const value=process.env[key];if(!value)throw new Error(`Missing ${key}`);
  const variable={key,is_secret:false,scopes:['builds','functions'],values:[{context:'all',value}]};
  if(existing.some(v=>v.key===key))await api(`${path}/${key}${query}`,'PUT',variable);
  else await api(path+query,'POST',[variable]);
  console.log(`Configured ${process.argv[2]} variable ${key}`);
}
