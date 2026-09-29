import { readFileSync } from 'node:fs';
import { verifyProtectedFrontend } from './verify-protected-frontend.mjs';
const targets = JSON.parse(readFileSync(new URL('../../deploy/environments.json', import.meta.url)));
const target = targets[process.argv[2]];
if (!target) throw new Error('Unknown frontend environment');
const other = targets[process.argv[2] === 'staging' ? 'production' : 'staging'];

async function verify() {
  const response = await fetch(target.publicOrigin, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (response.status === 401 && process.argv[2] === 'staging') {
    const protectionPage = await response.text();
    if (!protectionPage.includes('<title>Password Protection</title>')) throw new Error('Unexpected frontend authorization error');
    return verifyProtectedFrontend(target, other);
  }
  if (!response.ok) throw new Error(`Frontend HTTP ${response.status}`);
  const html = await response.text();
  const script = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/i)?.[1];
  if (!script) throw new Error('Frontend module was not found');
  const url = new URL(script, target.publicOrigin);
  if (url.origin !== target.publicOrigin) throw new Error('Unexpected frontend module origin');
  const bundle = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!bundle.ok) throw new Error(`Frontend module HTTP ${bundle.status}`);
  const code = await bundle.text();
  if (!code.includes(`https://${target.supabaseProjectRef}.supabase.co`)) throw new Error('Published frontend does not contain its expected backend URL');
  if (code.includes(`https://${other.supabaseProjectRef}.supabase.co`)) throw new Error('Published frontend contains the other environment backend URL');
}

for (let attempt = 0; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    if (attempt === 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
console.log(`Published ${process.argv[2]} frontend targets its own Supabase backend`);
