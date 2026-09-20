import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function assertPublishedDeployment(site, target, sha) {
  if (site.id !== target.netlifySiteId || site.ssl_url !== target.publicOrigin) throw new Error('Unexpected protected site');
  const deployment = site.published_deploy;
  if (!sha || deployment?.state !== 'ready' || deployment.title !== `GitHub ${sha} (staging)`) throw new Error('Expected commit is not published');
}

export function assertAssetHash(asset, contents) {
  if (asset.sha !== createHash('sha1').update(contents).digest('hex')) throw new Error('Published asset differs from the verified build');
}

// Site protection remains enabled. Authenticated metadata proves which exact
// build is published; this does not claim an authenticated browser smoke test.
export async function verifyProtectedFrontend(target, other, env = process.env) {
  if (env.APP_ENV !== 'staging' || !env.NETLIFY_AUTH_TOKEN) throw new Error('Protected verification is restricted to staging');
  const api = async (path) => {
    const r = await fetch(`https://api.netlify.com/api/v1/sites/${target.netlifySiteId}${path}`, {
      headers: { Authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}` }, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Netlify verification HTTP ${r.status}`);
    return r.json();
  };
  assertPublishedDeployment(await api(''), target, env.GITHUB_SHA);
  const html = readFileSync('dist/index.html');
  const script = html.toString().match(/<script\b[^>]*\bsrc="([^"]+\.js)"/i)?.[1];
  if (!script || !/^\/assets\/[\w.-]+\.js$/.test(script)) throw new Error('Unexpected built frontend module');
  const bundle = readFileSync(`dist${script}`);
  const code = bundle.toString();
  if (!code.includes(`https://${target.supabaseProjectRef}.supabase.co`) || code.includes(`https://${other.supabaseProjectRef}.supabase.co`)) throw new Error('Wrong backend in the build');
  assertAssetHash(await api('/files/index.html'), html);
  assertAssetHash(await api(`/files${script}`), bundle);
  console.log('Protected staging: published commit and asset hashes match the verified build');
}
