import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateTarget(name, targets, env) {
  const target = targets[name];
  if (!target || !['staging', 'production'].includes(name)) throw new Error('Unknown deployment environment');
  if (target.deploymentEnabled !== true) throw new Error(`Deployment to ${name} is disabled pending bootstrap validation`);
  if (!/^[a-z]{20}$/.test(target.supabaseProjectRef ?? '')) throw new Error('Missing or invalid project reference');
  if (!target.netlifySiteId) throw new Error('Missing Netlify site ID');
  if (targets.staging.supabaseProjectRef === targets.production.supabaseProjectRef) throw new Error('Staging and production must use different Supabase projects');
  if (targets.staging.netlifySiteId === targets.production.netlifySiteId) throw new Error('Staging and production must use different Netlify sites');
  if (env.GITHUB_EVENT_NAME !== 'push') throw new Error('Only branch push deployments are allowed');
  if (env.GITHUB_REF !== `refs/heads/${target.branch}`) throw new Error('Branch does not match deployment environment');
  const expected = {
    SUPABASE_PROJECT_REF: target.supabaseProjectRef,
    NETLIFY_SITE_ID: target.netlifySiteId,
    VITE_SUPABASE_URL: `https://${target.supabaseProjectRef}.supabase.co`,
    VITE_PUBLIC_BASE_URL: target.publicOrigin,
    PUBLIC_BASE_URL: target.publicOrigin,
    APP_ENV: name,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) throw new Error(`${key} does not match the committed ${name} target`);
  }
  if (!env.VITE_SUPABASE_ANON_KEY?.trim()) throw new Error('Missing public Supabase API key');
  // Legacy JWT keys must be anon keys from the selected project.
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (key.split('.').length === 3) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Invalid public Supabase JWT'); }
    if (payload.role !== 'anon' || payload.ref !== target.supabaseProjectRef) throw new Error('Public API key role or project does not match target');
  } else if (!key.startsWith('sb_publishable_')) {
    throw new Error('Expected an anon or publishable key, never a server secret');
  }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const targets = JSON.parse(readFileSync(new URL('../../deploy/environments.json', import.meta.url)));
    const target = validateTarget(process.argv[2], targets, process.env);
    console.log(`Verified ${process.argv[2]}: ${target.branch} -> ${target.publicOrigin}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
