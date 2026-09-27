import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from '../index.js';
import { parseCsv } from '../services/csv.js';
import { runProvider } from '../services/importer.js';
import * as sheet from '../providers/sheet.js';
import { hashPassword } from '../auth/passwords.js';

let app;
before(async () => { app = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false }); });
after(async () => { await app.close(); });

const HEADER = 'id,title,organization,type,summary,eligibility,requirements,grades,interests,cost,cost_note,format,location,commitment,commitment_note,deadline_date,deadline_note,official_url,checked_on,apply_url,group,batch';
const row = (o = {}) => {
  const r = { id: 'r1', title: 'Test Program One', organization: 'Test Org (fictional)', type: 'Competition', summary: 'A fictional program used only by the automated tests, not a real opportunity.', eligibility: 'Test only, grades 9 to 12.', requirements: 'Form;Essay', grades: '9;10', interests: 'Science;Coding', cost: 'Free', cost_note: '', format: 'Online', location: 'Anywhere', commitment: 'Flexible', commitment_note: 'Self-paced', deadline_date: '', deadline_note: 'Rolling', official_url: 'https://example.com/info', checked_on: '2026-09-21', apply_url: '', group: 'import', batch: '', ...o };
  return HEADER.split(',').map((k) => { const v = String(r[k] ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',');
};
const tmpCsv = (...rows) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oa-')), 'in.csv'); fs.writeFileSync(f, [HEADER, ...rows].join('\r\n')); return f; };

test('CSV parser handles quotes, commas, escaped quotes, newlines inside fields, CRLF and BOM', () => {
  const out = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n"multi\nline",2,3\r\n\r\n');
  assert.deepEqual(out, [{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: 'multi\nline', b: '2', c: '3' }]);
  assert.deepEqual(parseCsv(''), []);
});

test('sheet import: maps tags, defaults blank cost, prefers apply_url, records where each row came from', async () => {
  const file = tmpCsv(row({ id: 'a', apply_url: 'https://example.com/apply', interests: 'Science;Made-up Tag' }), row({ id: 'b', title: 'Blank Cost Program', cost: '', group: 'recheck' }));
  const res = await runProvider(app.repo, { ...sheet, demo: false }, { file });
  assert.equal(res.created, 2); assert.equal(res.skipped.length, 0);

  const [a] = app.repo.listByStatus({ source: 'import:sheet:import' });
  assert.equal(a.url, 'https://example.com/apply');
  assert.deepEqual(a.interests, ['STEM']);
  assert.deepEqual(a.requirements, ['Form', 'Essay']);
  const evA = app.repo.listReviewEvents(a.id)[0];
  assert.match(evA.message, /unmapped interest tags dropped: Made-up Tag/);
  assert.match(evA.message, /Official page: https:\/\/example.com\/info/);

  const [b] = app.repo.listByStatus({ source: 'import:sheet:recheck' });
  assert.equal(b.cost, 'Varies');
  assert.match(app.repo.listReviewEvents(b.id)[0].message, /cost was blank/);
});

test('imports NEVER publish: everything lands as pending_review and stays out of the public API', async () => {
  const before = app.repo.listPublic({}).total;
  await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'c', title: 'Should Stay Private' })) });
  assert.equal(app.repo.listPublic({}).total, before);
  assert.equal(app.repo.listByStatus({ status: 'pending_review', q: 'Should Stay Private' })[0].status, 'pending_review');
});

test('re-importing never touches a LIVE listing and is idempotent for pending ones', async () => {
  const f1 = tmpCsv(row({ id: 'idem', title: 'Idempotent Program' }), row({ id: 'idem2', title: 'Still Pending Program' }));
  await runProvider(app.repo, { ...sheet, demo: false }, { file: f1 });
  const [live] = app.repo.listByStatus({ q: 'Idempotent Program' });
  app.repo.setOpportunityStatus(live.id, 'approved', { publishedAt: new Date().toISOString() });

  const f2 = tmpCsv(
    row({ id: 'idem', title: 'Idempotent Program', summary: 'An UPDATED fictional summary used only by tests, still not real.' }),
    row({ id: 'idem2', title: 'Still Pending Program', summary: 'An UPDATED fictional summary used only by tests, still not real.' }));
  const r2 = await runProvider(app.repo, { ...sheet, demo: false }, { file: f2 });
  assert.equal(r2.created, 0);
  assert.equal(r2.unchangedLive, 1, 'the approved listing is reported as left alone');
  assert.equal(r2.updated, 1, 'only the not-yet-approved listing is refreshed');
  assert.doesNotMatch(app.repo.getOpportunity(live.id).summary, /UPDATED/, 'live content is never changed by an import');
  assert.equal(app.repo.getOpportunity(live.id).status, 'approved');
  assert.match(app.repo.listByStatus({ q: 'Still Pending Program' })[0].summary, /UPDATED/);
});

test('renumbered ids are refused: an id that now names a different program must not overwrite the old one', async () => {
  await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'shift-1', title: 'Poetry Recitation Contest', organization: 'Arts Org' })) });
  const [orig] = app.repo.listByStatus({ q: 'Poetry Recitation Contest' });
  app.repo.setOpportunityStatus(orig.id, 'approved', { publishedAt: new Date().toISOString() });

  const res = await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'shift-1', title: 'Online Pre-College Summer Program', organization: 'A University', official_url: 'https://example.com/other' })) });
  assert.equal(res.created, 0); assert.equal(res.updated, 0);
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].existing, 'Poetry Recitation Contest');
  assert.equal(app.repo.getOpportunity(orig.id).title, 'Poetry Recitation Contest', 'the live listing is untouched');
});

test('batch-labelled ids keep a second export separate, and programs already listed are skipped as duplicates', async () => {
  await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'row-900', title: 'Regional Robotics Challenge', official_url: 'https://example.com/robotics' })) });
  const b2 = tmpCsv(
    row({ id: 'row-900', batch: 'b2', title: 'Regional Robotics Challenge', official_url: 'https://example.com/robotics' }),          // same program, new numbering
    row({ id: 'row-901', batch: 'b2', title: 'Regional Robotics Challenge (Summer 2027)', official_url: 'https://example.com/robotics' }), // near-identical title, same link
    row({ id: 'row-902', batch: 'b2', title: 'Brand New Program Nobody Has', official_url: 'https://example.com/new' }));
  const res = await runProvider(app.repo, { ...sheet, demo: false }, { file: b2 });
  assert.equal(res.created, 1);
  assert.equal(res.duplicates.length, 2);
  assert.equal(app.repo.listByStatus({ q: 'Regional Robotics Challenge' }).length, 1, 'no duplicate listing was created');
  assert.ok(app.repo.findByExternal('import:sheet', 'b2:row-902'), 'new row stored under its batch-namespaced id');
});

test('a pending row that moves between tabs is updated in place, not duplicated', async () => {
  await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'mv1', title: 'Movable Program', group: 'recheck' })) });
  const res = await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'mv1', title: 'Movable Program', group: 'import', deadline_date: '2027-01-15' })) });
  assert.equal(res.created, 0); assert.equal(res.updated, 1);
  const all = app.repo.listByStatus({ q: 'Movable Program' });
  assert.equal(all.length, 1);
  assert.equal(all[0].source, 'import:sheet:import');
  assert.equal(all[0].deadlineDate, '2027-01-15');
});

test('invalid rows are skipped and reported, valid rows still import', async () => {
  const file = tmpCsv(row({ id: 'ok1', title: 'Valid One Program' }), row({ id: 'bad1', type: 'Not A Type' }), row({ id: 'bad2', official_url: 'javascript:alert(1)' }), row({ id: 'bad3', grades: '' }));
  const res = await runProvider(app.repo, { ...sheet, demo: false }, { file });
  assert.equal(res.created, 1);
  assert.deepEqual(res.skipped.map((s) => s.externalId).sort(), ['bad1', 'bad2', 'bad3']);
});

// ------------------------------------------------------------------ bulk approve
function client() {
  const c = { cookie: '', csrf: '' };
  c.req = async (method, p, body) => {
    const res = await fetch(app.url + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf && method !== 'GET' ? { 'X-CSRF-Token': c.csrf } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const line of res.headers.getSetCookie?.() || []) { const [pair] = line.split(';'); if (pair.startsWith('oa_sid=')) c.cookie = pair.endsWith('=') ? '' : pair; }
    const data = await res.json().catch(() => null); if (data?.csrfToken) c.csrf = data.csrfToken;
    return { status: res.status, data };
  };
  return c;
}
const pw = 'correct-horse-battery';
async function admin() {
  const email = `bulk-admin-${Date.now()}@example.com`;
  app.repo.createUser({ email, passwordHash: await hashPassword(pw), displayName: 'Bulk Admin', role: 'admin', emailVerified: true });
  const c = client(); assert.equal((await c.req('POST', '/api/auth/login', { email, password: pw })).status, 200); return c;
}

test('bulk approve: admin-only, publishes the selection, reports failures, and is audited', async () => {
  await runProvider(app.repo, { ...sheet, demo: false }, { file: tmpCsv(row({ id: 'p1', title: 'Bulk Item Alpha' }), row({ id: 'p2', title: 'Bulk Item Beta' }), row({ id: 'p3', title: 'Bulk Item Gamma' })) });
  const ids = app.repo.listByStatus({ status: 'pending_review', q: 'Bulk Item' }).map((o) => o.id);
  assert.equal(ids.length, 3);

  const student = client(); await student.req('POST', '/api/auth/register', { email: `bulk-s-${Date.now()}@example.com`, password: pw, displayName: 'S' });
  assert.equal((await student.req('POST', '/api/admin/opportunities/bulk-approve', { ids })).status, 403);
  assert.equal((await client().req('POST', '/api/admin/opportunities/bulk-approve', { ids })).status, 401);

  const a = await admin();
  assert.equal((await a.req('POST', '/api/admin/opportunities/bulk-approve', { ids: [] })).status, 400);
  assert.equal((await a.req('POST', '/api/admin/opportunities/bulk-approve', { ids: ['not-a-uuid'] })).status, 400);
  const r = await a.req('POST', '/api/admin/opportunities/bulk-approve', { ids: [ids[0], ids[1], '00000000-0000-0000-0000-000000000000'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.approved.length, 2);
  assert.equal(r.data.failed.length, 1);
  assert.equal((await client().req('GET', '/api/opportunities?q=Bulk%20Item')).data.total, 2, 'only the selected two are public');
  // approving an already-approved listing is refused by the state machine, not silently accepted
  const again = await a.req('POST', '/api/admin/opportunities/bulk-approve', { ids: [ids[0]] });
  assert.equal(again.data.failed.length, 1);
  assert.ok(app.repo.recentActivity(20).some((e) => e.action === 'bulk_approve'));
});

test('admin list can filter by origin and reports origin counts', async () => {
  const a = await admin();
  const res = await a.req('GET', '/api/admin/opportunities?status=pending_review&source=import%3Asheet%3Arecheck');
  assert.equal(res.status, 200);
  assert.ok(res.data.items.every((o) => o.source === 'import:sheet:recheck'));
  assert.ok(res.data.sources.some((s) => s.source === 'import:sheet:import'));
  assert.equal((await a.req('GET', '/api/admin/opportunities?status=pending_review&source=%27%3B%20DROP%20TABLE')).status, 200, 'malformed source is ignored, not executed');
});
