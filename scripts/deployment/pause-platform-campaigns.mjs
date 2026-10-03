import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { validateTarget } from './check-target.mjs';

// Hosted Edge workers live at most 400s. Drain with a margin before changing
// the delivery writer. https://supabase.com/docs/guides/functions/limits
export const DRAIN_SECONDS = 420;

export function pausedEntrypoint(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected deployment commit SHA');
  return `import { handlePlatformAdminRequest } from "./deployment-active.ts";
import { json } from "../_shared/app/http.ts";
Deno.serve((req: Request) => {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const base = segments.lastIndexOf("platform-admin");
  const path = base < 0 ? [] : segments.slice(base + 1);
  if (req.method === "POST" && path.length === 2 && path[0] === "communications" && path[1] === "email") {
    return json(req, { error: "PLATFORM_CAMPAIGNS_DEPLOYING", revision: "${revision}" }, 503);
  }
  return handlePlatformAdminRequest(req);
});
`;
}

export async function deployPaused({ entry, active, revision, deploy }) {
  const source = await readFile(entry, 'utf8');
  // Exclusive create: never overwrite a file from another operation.
  await writeFile(active, source, { flag: 'wx' });
  try {
    await writeFile(entry, pausedEntrypoint(revision));
    await deploy();
  } finally {
    await writeFile(entry, source);
    await unlink(active);
  }
}

async function main() {
  const targets = JSON.parse(await readFile(new URL('../../deploy/environments.json', import.meta.url), 'utf8'));
  const target = validateTarget(process.env.APP_ENV, targets, process.env);
  const revision = process.env.GITHUB_SHA;
  pausedEntrypoint(revision);
  await deployPaused({
    entry: new URL('../../supabase/functions/platform-admin/index.ts', import.meta.url),
    active: new URL('../../supabase/functions/platform-admin/deployment-active.ts', import.meta.url),
    revision,
    deploy: () => execFileSync('supabase', ['functions', 'deploy', 'platform-admin', '--project-ref', target.supabaseProjectRef, '--use-api'], { stdio: 'inherit' }),
  });
  const verifyPause = async () => {
    const response = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/platform-admin/communications/email`, {
      method: 'POST', headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (response.status !== 503 || body.error !== 'PLATFORM_CAMPAIGNS_DEPLOYING' || body.revision !== revision) {
      throw new Error('Campaign pause not confirmed; refuse to migrate');
    }
  };
  await verifyPause();
  console.log('Campaign sends paused; draining existing workers for 420 seconds');
  const deadline = Date.now() + DRAIN_SECONDS * 1000;
  while (Date.now() < deadline) {
    await delay(Math.min(30000, deadline - Date.now()));
    await verifyPause();
    console.log('Campaign pause verified; waiting for old workers to finish');
  }
  // If anything subsequently fails, leave the remote pause in place. A later
  // successful deployment publishes the normal entrypoint only after SQL.
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
