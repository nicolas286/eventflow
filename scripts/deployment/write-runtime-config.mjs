import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { validateTarget } from './check-target.mjs';
const targets=JSON.parse(readFileSync(new URL('../../deploy/environments.json',import.meta.url)));
const target=validateTarget(process.argv[2], targets, process.env);
const base=`https://${target.supabaseProjectRef}.supabase.co/storage/v1/object/public/public-assets`;
mkdirSync('.local',{recursive:true});
writeFileSync('.local/runtime-config.sql',`UPDATE private.app_environment SET public_assets_base_url = '${base}' WHERE singleton = true;\n`);
