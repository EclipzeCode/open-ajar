/**
 * Checks that every link in an import CSV still responds. Reads status codes only (HEAD, falling back to a GET whose
 * body is discarded unread). It can't tell you a page's CONTENT is still accurate; a person still has to check that.
 *   npm run check:links [-- data/opportunities.csv]     check a CSV before importing
 *   npm run check:links -- --pending                     check everything currently waiting in the review queue
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { parseCsv } from '../services/csv.js';

const pending = process.argv.includes('--pending');
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
let rows;
if (pending) {
  // Check the links of listings still waiting for review (what you're about to approve).
  const { createRepo } = await import('../repo/index.js');
  const repo = createRepo(config);
  rows = repo.listByStatus({ status: 'pending_review', limit: 500 }).map((o) => ({ id: o.id, title: o.title, official_url: o.url || '', apply_url: '' }));
  repo.close();
} else rows = parseCsv(fs.readFileSync(path.resolve(fileArg || path.join(config.root, 'data', 'opportunities.csv')), 'utf8'));
const jobs = [];
for (const r of rows) for (const [kind, url] of [['apply_url', r.apply_url], ['official_url', r.official_url]]) if (url) jobs.push({ id: r.id, title: r.title, kind, url });
const unique = [...new Map(jobs.map((j) => [j.url, j])).values()];

async function probe(url) {
  const opts = { redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'OpenAjarLinkCheck/1.0 (+status check only)', Accept: 'text/html,*/*' } };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status >= 400 || res.status === 405) { res = await fetch(url, { ...opts, method: 'GET' }); await res.body?.cancel(); }
    return { status: res.status, final: res.url };
  } catch (e) { return { status: 0, error: e.name === 'TimeoutError' ? 'timed out' : (e.cause?.code || e.message) }; }
}

console.log(`Checking ${unique.length} unique links from ${rows.length} ${pending ? 'listings waiting for review' : 'rows'}…`);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < unique.length) { const j = unique[next++]; results.push({ ...j, ...(await probe(j.url)) }); }
}));

const ok = results.filter((r) => r.status >= 200 && r.status < 400);
// 401/403/429 usually mean "bot protection", not a dead page: a person should open these in a browser.
const blocked = results.filter((r) => [401, 403, 429, 999].includes(r.status));
const bad = results.filter((r) => !ok.includes(r) && !blocked.includes(r));
console.log(`\nOK: ${ok.length}   Blocked to bots (open manually): ${blocked.length}   Broken: ${bad.length}`);
for (const r of bad) console.log(`  BROKEN  ${r.id} ${r.title}\n          ${r.kind}: ${r.url}  →  ${r.status || r.error}`);
for (const r of blocked) console.log(`  MANUAL  ${r.id} ${r.title}  [${r.status}]  ${r.url}`);
process.exitCode = bad.length ? 2 : 0;
