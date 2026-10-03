import { readFileSync, readdirSync } from 'node:fs';
export function closureSql() {
  const directory = new URL('../../supabase/deferred-migrations/', import.meta.url);
  return readdirSync(directory).sort().flatMap(lot => readdirSync(new URL(`${lot}/`, directory)).sort()
    .filter(file => /^\d+.*\.sql$/.test(file) && !file.includes('retire_'))
    .map(file => readFileSync(new URL(`${lot}/${file}`, directory), 'utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, ''))).join('\n');
}
