import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../index.js';
import { hashPassword } from '../auth/passwords.js';

let app;
before(async () => { app = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false }); });
after(async () => { await app.close(); });

function client() {
  const c = { cookie: '', csrf: '' };
  c.req = async (method, path, body) => {
    const res = await fetch(app.url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf && method !== 'GET' ? { 'X-CSRF-Token': c.csrf } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const line of res.headers.getSetCookie?.() || []) { const [pair] = line.split(';'); if (pair.startsWith('oa_sid=')) c.cookie = pair; }
    const data = await res.json().catch(() => null); if (data?.csrfToken) c.csrf = data.csrfToken;
    return { status: res.status, data };
  };
  return c;
}
const pw = 'correct-horse-battery';
async function admin() {
  const email = `intern-admin-${Date.now()}@example.com`;
  app.repo.createUser({ email, passwordHash: await hashPassword(pw), displayName: 'Admin', role: 'admin', emailVerified: true });
  const c = client(); await c.req('POST', '/api/auth/login', { email, password: pw }); return c;
}
const application = (over = {}) => ({ fullName: 'Alex Rivera', email: 'alex@example.com', grade: 11, school: 'Central HS', location: 'Austin, TX', interests: ['STEM'], skills: 'Basic Python', availability: 'After school', statement: 'I want real experience at a local business.', ...over });

test('anyone can apply to intern; it validates and stores the record', async () => {
  const c = client();
  const ok = await c.req('POST', '/api/intern-applications', application());
  assert.equal(ok.status, 201);
  assert.ok(ok.data.id);
  const bad = await c.req('POST', '/api/intern-applications', { fullName: 'x', email: 'nope', statement: 'short' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.errors.fullName && bad.data.errors.email && bad.data.errors.statement);
});

test('applications reject bad grades, bad links, and unknown interests are dropped', async () => {
  const c = client();
  assert.equal((await c.req('POST', '/api/intern-applications', application({ grade: 5 })).then((r) => r.status)), 422);
  assert.equal((await c.req('POST', '/api/intern-applications', application({ link: 'javascript:alert(1)' })).then((r) => r.status)), 422);
  const r = await c.req('POST', '/api/intern-applications', application({ interests: ['STEM', 'NotAReal'] }));
  assert.equal(r.status, 201);
});

test('the roster is admin-only, sorts newest first, filters by status, and takes decisions', async () => {
  const pub = client();
  await pub.req('POST', '/api/intern-applications', application({ fullName: 'First Applicant' }));
  await pub.req('POST', '/api/intern-applications', application({ fullName: 'Second Applicant' }));

  assert.equal((await client().req('GET', '/api/admin/intern-applications')).status, 401);
  const student = client(); await student.req('POST', '/api/auth/register', { email: `s-${Date.now()}@example.com`, password: pw, displayName: 'S' });
  assert.equal((await student.req('GET', '/api/admin/intern-applications')).status, 403);

  const a = await admin();
  const list = await a.req('GET', '/api/admin/intern-applications');
  assert.equal(list.status, 200);
  assert.equal(list.data.items[0].fullName, 'Second Applicant', 'newest first');
  assert.ok(list.data.items.length >= 2);

  const id = list.data.items[0].id;
  const upd = await a.req('PATCH', `/api/admin/intern-applications/${id}`, { status: 'contacted', adminNote: 'emailed 9/23' });
  assert.equal(upd.data.application.status, 'contacted');
  assert.equal(upd.data.application.adminNote, 'emailed 9/23');
  assert.equal((await a.req('PATCH', `/api/admin/intern-applications/${id}`, { status: 'bogus' })).status, 400);

  const placed = await a.req('GET', '/api/admin/intern-applications?status=contacted');
  assert.ok(placed.data.items.every((x) => x.status === 'contacted'));
  assert.ok(placed.data.counts.contacted >= 1);
});

test('applying requires no account and no CSRF token (it is a public form)', async () => {
  const res = await fetch(app.url + '/api/intern-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(application()) });
  assert.equal(res.status, 201);
});
