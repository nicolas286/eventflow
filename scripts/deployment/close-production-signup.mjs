import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateTarget } from './check-target.mjs';

export async function closeProductionSignup(targets, env, request = fetch) {
  const target = validateTarget('production', targets, env);
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('Supabase management token is missing');

  const url = `https://api.supabase.com/v1/projects/${target.supabaseProjectRef}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const update = await request(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ disable_signup: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (!update.ok) throw new Error(`Could not close production signup: HTTP ${update.status}`);

  const verification = await request(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!verification.ok) throw new Error(`Could not verify production signup: HTTP ${verification.status}`);
  const config = await verification.json();
  if (config.disable_signup !== true) throw new Error('Production signup is still enabled');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = JSON.parse(readFileSync(new URL('../../deploy/environments.json', import.meta.url)));
  await closeProductionSignup(targets, process.env);
  console.log('Production Supabase Auth signup is disabled');
}
