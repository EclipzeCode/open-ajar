import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { createRepo } from '../repo/index.js';
import { runProvider } from '../services/importer.js';

const name = process.argv[2];
if (!name || !/^[a-z0-9_-]+$/i.test(name) || name === 'demo') {
  console.error('Usage: node server/scripts/import.js <provider> [file]\nProviders live in server/providers/<provider>.js (see the README there).');
  process.exit(1);
}
const provider = await import(pathToFileURL(path.join(config.root, 'server', 'providers', `${name}.js`)).href);
const repo = createRepo(config);
const r = await runProvider(repo, { ...provider, demo: false }, { file: process.argv[3] });
console.log(`Import "${provider.name}": ${r.created} new (pending review), ${r.updated} refreshed, ${r.unchangedLive} live listings left untouched.`);
if (r.duplicates.length) console.log(`Skipped ${r.duplicates.length} rows that are already listed (matched by title/link):`);
for (const d of r.duplicates.slice(0, 200)) console.log(`  duplicate  ${d.externalId}  "${d.title}"  ~  "${d.matches}" [${d.status}]`);
if (r.conflicts.length) console.log(`REFUSED ${r.conflicts.length} rows whose id now points at a different program than before (ids were probably renumbered):`);
for (const c of r.conflicts) console.log(`  conflict   ${c.externalId}  now "${c.incoming}", was "${c.existing}"`);
if (r.skipped.length) console.log(`Skipped ${r.skipped.length} invalid rows:`);
for (const s of r.skipped) console.log('  invalid   ', s.externalId, s.reason);
repo.close();
