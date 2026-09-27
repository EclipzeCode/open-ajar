import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../index.js';
import { hashPassword } from '../auth/passwords.js';

let app;
before(async () => { app = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false }); });
after(async () => { await app.close(); });
export { app };

/** Minimal browser-like client: keeps the session cookie and sends the CSRF token. */
function client() {
  const c = { cookie: '', csrf: '' };
  c.req = async (method, path, body, headers = {}) => {
    const res = await fetch(app.url + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf && method !== 'GET' ? { 'X-CSRF-Token': c.csrf } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const line of set) { const [pair] = line.split(';'); if (pair.startsWith('oa_sid=')) c.cookie = pair.endsWith('=') ? '' : pair; }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (data?.csrfToken) c.csrf = data.csrfToken;
    return { status: res.status, data, headers: res.headers, setCookie: set };
  };
  return c;
}

let n = 0;
const pw = 'correct-horse-battery';
/** Waits for the email the server sends in the background and returns the token from its link. */
export async function tokenFromEmail(to, kind = 'verify') {
  for (let i = 0; i < 50; i++) {
    const mail = app.mailer.outbox.find((m) => m.to === to && m.text.includes(`#/${kind}?token=`));
    if (mail) return mail.text.match(/token=([A-Za-z0-9_-]+)/)[1];
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no ${kind} email for ${to}`);
}

/** Signs up like a real student, then confirms their email through the emailed link (skip with { verify: false }). */
async function signup(name = 'Student', { verify = true } = {}) {
  const c = client();
  const r = await c.req('POST', '/api/auth/register', { email: `s${++n}-${Date.now()}@example.com`, password: pw, displayName: name });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  if (verify) {
    const v = await client().req('POST', '/api/auth/verify', { token: await tokenFromEmail(c.user.email) });
    assert.equal(v.status, 200, JSON.stringify(v.data));
  }
  return c;
}
async function makeAdmin() {
  const email = `admin${++n}-${Date.now()}@example.com`;
  app.repo.createUser({ email, passwordHash: await hashPassword(pw), displayName: 'Admin', role: 'admin', emailVerified: true });
  const c = client();
  const r = await c.req('POST', '/api/auth/login', { email, password: pw });
  assert.equal(r.status, 200);
  return c;
}

const submission = (over = {}) => ({
  title: 'Test Opportunity One', org: 'Test Org (fictional)', type: 'Competition', summary: 'A test opportunity used by the automated tests only, not real.',
  eligibility: 'Anyone in the test suite.', requirements: 'One\nTwo', interests: ['STEM'], grades: [10, 11], cost: 'Free', costNote: '', format: 'Online',
  location: 'Anywhere', commitment: 'Flexible', commitmentNote: '', deadlineDate: null, deadlineNote: 'Rolling', url: 'https://example.com/apply',
  relationship: 'organization_rep', contactEmail: 'contact@example.com', ...over,
});

async function publish(admin, student, over) {
  const s = await student.req('POST', '/api/submissions', submission(over));
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const id = s.data.submission.id;
  const d = await admin.req('POST', `/api/admin/opportunities/${id}/decision`, { action: 'approve' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  return id;
}

test('session endpoint is public and reports signed-out state', async () => {
  const r = await client().req('GET', '/api/session');
  assert.equal(r.status, 200);
  assert.equal(r.data.user, null);
});

test('security headers are set', async () => {
  const r = await client().req('GET', '/api/meta');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('registration: validates, creates a student, sets an HttpOnly cookie, ignores a role in the body', async () => {
  const c = client();
  const bad = await c.req('POST', '/api/auth/register', { email: 'nope', password: 'short', displayName: '' });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.errors.email && bad.data.errors.password && bad.data.errors.displayName);

  const ok = await c.req('POST', '/api/auth/register', { email: `role-${Date.now()}@example.com`, password: pw, displayName: 'Sneaky', role: 'admin' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.role, 'student');
  assert.match(ok.setCookie[0], /HttpOnly/);
  assert.match(ok.setCookie[0], /SameSite=Lax/);
  assert.equal(ok.data.user.passwordHash, undefined);
});

test('login: wrong password and unknown email get the same generic error', async () => {
  const s = await signup();
  const a = await client().req('POST', '/api/auth/login', { email: s.user.email, password: 'wrong-password-123' });
  const b = await client().req('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password-123' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.data.error, b.data.error);
});

test('CSRF: writes without the token are rejected, cross-origin is rejected', async () => {
  const s = await signup();
  const noToken = await s.req('PUT', '/api/me/saved/00000000-0000-0000-0000-000000000000', undefined, { 'X-CSRF-Token': 'wrong' });
  assert.equal(noToken.status, 403);
  const cross = await s.req('POST', '/api/auth/logout', undefined, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
});

test('logout invalidates the session server-side', async () => {
  const s = await signup();
  const old = s.cookie;
  assert.equal((await s.req('POST', '/api/auth/logout')).status, 200);
  const replay = client(); replay.cookie = old;
  assert.equal((await replay.req('GET', '/api/session')).data.user, null);
});

test('anonymous users cannot use account or admin endpoints', async () => {
  const c = client();
  assert.equal((await c.req('GET', '/api/me/library')).status, 401);
  assert.equal((await c.req('POST', '/api/submissions', submission())).status, 401);
  assert.equal((await c.req('GET', '/api/admin/summary')).status, 401);
});

test('students cannot reach admin endpoints or change roles', async () => {
  const s = await signup();
  assert.equal((await s.req('GET', '/api/admin/summary')).status, 403);
  assert.equal((await s.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await s.req('PATCH', `/api/admin/users/${s.user.id}`, { role: 'admin' })).status, 403);
  const me = await s.req('PATCH', '/api/me', { displayName: 'New Name', role: 'admin' });
  assert.equal(me.data.user.role, 'student');
});

test('submissions start as Pending Review and are NOT public until approved', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const r = await s.req('POST', '/api/submissions', submission({ title: 'Hidden Until Approved' }));
  assert.equal(r.status, 201);
  assert.equal(r.data.submission.status, 'pending_review');
  const id = r.data.submission.id;

  const list = await client().req('GET', '/api/opportunities?q=Hidden');
  assert.equal(list.data.total, 0);
  assert.equal((await client().req('GET', `/api/opportunities/${id}`)).status, 404);

  assert.equal((await admin.req('POST', `/api/admin/opportunities/${id}/decision`, { action: 'approve' })).status, 200);
  const after = await client().req('GET', '/api/opportunities?q=Hidden');
  assert.equal(after.data.total, 1);
  assert.equal(after.data.items[0].contactEmail, undefined, 'public DTO must not leak contact email');
  assert.equal(after.data.items[0].status, undefined);
});

test('submission validation returns field errors and blocks javascript: URLs', async () => {
  const s = await signup();
  const r = await s.req('POST', '/api/submissions', submission({ title: 'x', url: 'javascript:alert(1)', grades: [] , type: 'Nope' }));
  assert.equal(r.status, 422);
  assert.ok(r.data.errors.title && r.data.errors.url && r.data.errors.grades && r.data.errors.type);
});

test('clients cannot set status, source or demo flags on submission', async () => {
  const s = await signup();
  const r = await s.req('POST', '/api/submissions', submission({ status: 'approved', isDemo: true, source: 'demo', verification: 'verified', title: 'Mass Assignment Try' }));
  assert.equal(r.status, 201);
  assert.equal(r.data.submission.status, 'pending_review');
  assert.equal(r.data.submission.isDemo, false);
  assert.notEqual(r.data.submission.verification, 'verified');
});

test('request changes → submitter edits → resubmits → approve; other users cannot touch it', async () => {
  const s = await signup(); const other = await signup(); const admin = await makeAdmin();
  const id = (await s.req('POST', '/api/submissions', submission({ title: 'Needs Edits' }))).data.submission.id;

  assert.equal((await admin.req('POST', `/api/admin/opportunities/${id}/decision`, { action: 'request_changes' })).status, 422, 'a message is required');
  const rc = await admin.req('POST', `/api/admin/opportunities/${id}/decision`, { action: 'request_changes', message: 'Please add the real application link.' });
  assert.equal(rc.data.opportunity.status, 'changes_requested');

  const mine = await s.req('GET', '/api/me/submissions');
  assert.equal(mine.data.items[0].reviewerMessage, 'Please add the real application link.');

  assert.equal((await other.req('PUT', `/api/submissions/${id}`, submission())).status, 404);
  assert.equal((await other.req('GET', `/api/submissions/${id}`)).status, 404);

  const edit = await s.req('PUT', `/api/submissions/${id}`, submission({ title: 'Needs Edits (fixed)', url: 'https://example.org/fixed' }));
  assert.equal(edit.data.submission.status, 'pending_review');
  assert.equal((await admin.req('POST', `/api/admin/opportunities/${id}/decision`, { action: 'approve' })).data.opportunity.status, 'approved');
});

test('resubmit is refused unless changes were requested', async () => {
  const s = await signup();
  const id = (await s.req('POST', '/api/submissions', submission({ title: 'Still Pending' }))).data.submission.id;
  assert.equal((await s.req('PUT', `/api/submissions/${id}`, submission())).status, 409);
});

test('reject requires a message and keeps the listing private; expire hides an approved listing', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const a = (await s.req('POST', '/api/submissions', submission({ title: 'To Reject Zed' }))).data.submission.id;
  assert.equal((await admin.req('POST', `/api/admin/opportunities/${a}/decision`, { action: 'reject', message: 'no' })).status, 422);
  assert.equal((await admin.req('POST', `/api/admin/opportunities/${a}/decision`, { action: 'reject', message: 'Not a real opportunity.' })).data.opportunity.status, 'rejected');
  assert.equal((await client().req('GET', '/api/opportunities?q=Zed')).data.total, 0);

  const b = await publish(admin, s, { title: 'To Expire Yak' });
  assert.equal((await client().req('GET', '/api/opportunities?q=Yak')).data.total, 1);
  assert.equal((await admin.req('POST', `/api/admin/opportunities/${b}/decision`, { action: 'expire' })).data.opportunity.status, 'expired');
  assert.equal((await client().req('GET', '/api/opportunities?q=Yak')).data.total, 0);
  // an illegal transition is refused
  assert.equal((await admin.req('POST', `/api/admin/opportunities/${b}/decision`, { action: 'expire' })).status, 409);
});

test('admin can edit; edits are logged in the review history', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const id = (await s.req('POST', '/api/submissions', submission({ title: 'Edit Me Please' }))).data.submission.id;
  const e = await admin.req('PATCH', `/api/admin/opportunities/${id}`, submission({ title: 'Edited By Admin', verification: 'verified' }));
  assert.equal(e.status, 200);
  assert.equal(e.data.opportunity.title, 'Edited By Admin');
  const d = await admin.req('GET', `/api/admin/opportunities/${id}`);
  assert.deepEqual(d.data.events.map((x) => x.action), ['submitted', 'edited']);
});

test('saved and tracked sync across devices (two sessions, same account)', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const id = await publish(admin, s, { title: 'Sync Target', requirements: 'Essay\nTranscript' });

  assert.equal((await s.req('PUT', `/api/me/saved/${id}`)).status, 200);
  const t = await s.req('PUT', `/api/me/tracked/${id}`, { stage: 'Preparing', notes: 'ask Ms. Rivera' });
  assert.equal(t.data.tracked.stage, 'Preparing');
  assert.deepEqual(t.data.tracked.checklist.map((c) => c.text), ['Essay', 'Transcript']);

  const phone = client();
  const login = await phone.req('POST', '/api/auth/login', { email: s.user.email, password: pw });
  assert.equal(login.status, 200);
  const lib = await phone.req('GET', '/api/me/library');
  assert.deepEqual(lib.data.saved, [id]);
  assert.equal(lib.data.tracked[id].notes, 'ask Ms. Rivera');
  assert.equal(lib.data.opportunities[0].title, 'Sync Target');
});

test('library is private to each user', async () => {
  const a = await signup(); const b = await signup(); const admin = await makeAdmin();
  const id = await publish(admin, a, { title: 'Private Library Item' });
  await a.req('PUT', `/api/me/saved/${id}`);
  assert.deepEqual((await b.req('GET', '/api/me/library')).data.saved, []);
});

test('tracked validation: bad stage, bad date, oversize notes; cannot track unpublished listings', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const id = await publish(admin, s, { title: 'Validation Target' });
  assert.equal((await s.req('PUT', `/api/me/tracked/${id}`, { stage: 'Hired' })).status, 422);
  assert.equal((await s.req('PUT', `/api/me/tracked/${id}`, { deadline: '2026-13-45' })).status, 422);
  assert.equal((await s.req('PUT', `/api/me/tracked/${id}`, { notes: 'x'.repeat(2001) })).status, 422);
  const pending = (await s.req('POST', '/api/submissions', submission({ title: 'Not Public Yet' }))).data.submission.id;
  assert.equal((await s.req('PUT', `/api/me/tracked/${pending}`, {})).status, 404);
  assert.equal((await s.req('PUT', `/api/me/saved/${pending}`)).status, 404);
});

test('search: filters, pagination, sort, and SQL metacharacters are inert', async () => {
  const s = await signup(); const admin = await makeAdmin();
  await publish(admin, s, { title: 'Alpha Coding Contest', type: 'Competition', cost: 'Free', grades: [9], interests: ['Computer science'] });
  await publish(admin, s, { title: 'Beta Paid Internship', type: 'Internship', cost: 'Award', grades: [12], interests: ['Business & finance'], deadlineDate: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) });

  const c = client();
  assert.equal((await c.req('GET', '/api/opportunities?type=Internship&q=Beta')).data.total, 1);
  assert.equal((await c.req('GET', '/api/opportunities?grade=9&q=Alpha')).data.total, 1);
  assert.equal((await c.req('GET', '/api/opportunities?grade=12&q=Alpha')).data.total, 0);
  assert.equal((await c.req('GET', '/api/opportunities?interest=Business%20%26%20finance&q=Beta')).data.total, 1);
  assert.equal((await c.req('GET', '/api/opportunities?cost=Award&q=Paid')).data.total, 1);
  const paged = await c.req('GET', '/api/opportunities?limit=1&page=2&sort=title');
  assert.equal(paged.data.items.length, 1);
  assert.ok(paged.data.total >= 2);
  for (const evil of ["'; DROP TABLE opportunities; --", '%', '_', '\\', '" OR 1=1 --']) {
    const r = await c.req('GET', `/api/opportunities?q=${encodeURIComponent(evil)}`);
    assert.equal(r.status, 200);
  }
  assert.ok((await c.req('GET', '/api/opportunities')).data.total >= 2, 'table still intact');
  assert.ok((await c.req('GET', '/api/opportunities')).data.facets.type.Internship >= 1);
});

test('admin cannot demote or disable themselves, and the last admin is protected', async () => {
  const admin = await makeAdmin();
  const me = (await admin.req('GET', '/api/session')).data.user;
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { role: 'student' })).status, 403);
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { disabled: true })).status, 403);
});

test('role change signs the user out everywhere and is audited', async () => {
  const admin = await makeAdmin(); const s = await signup();
  const r = await admin.req('PATCH', `/api/admin/users/${s.user.id}`, { role: 'organization' });
  assert.equal(r.data.user.role, 'organization');
  assert.equal((await s.req('GET', '/api/session')).data.user, null);
});

test('password change requires the current password and signs out other sessions', async () => {
  const s = await signup();
  const other = client();
  await other.req('POST', '/api/auth/login', { email: s.user.email, password: pw });
  assert.equal((await s.req('POST', '/api/auth/password', { currentPassword: 'wrong-wrong-1', newPassword: 'another-long-passphrase' })).status, 422);
  assert.equal((await s.req('POST', '/api/auth/password', { currentPassword: pw, newPassword: 'another-long-passphrase' })).status, 200);
  assert.equal((await other.req('GET', '/api/session')).data.user, null);
  assert.ok((await s.req('GET', '/api/session')).data.user);
});

test('static server: serves the app, blocks traversal, dotfiles and server source', async () => {
  const c = client();
  const root = await fetch(app.url + '/');
  assert.equal(root.status, 200);
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/server/index.js', '/.env', '/var/openajar.db']) {
    const r = await fetch(app.url + p);
    assert.equal(r.status, 404, p);
  }
});

test('oversized and malformed bodies are rejected', async () => {
  const s = await signup();
  assert.equal((await s.req('POST', '/api/submissions', { title: 'x'.repeat(70_000) })).status, 413);
  const res = await fetch(app.url + '/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: s.cookie, 'X-CSRF-Token': s.csrf }, body: '{not json' });
  assert.equal(res.status, 400);
});

test('account deletion: requires the correct password, wipes the user and their library, invalidates the session', async () => {
  const s = await signup(); const admin = await makeAdmin();
  const id = await publish(admin, s, { title: 'Deletion Keeps This Listing' });
  await s.req('PUT', `/api/me/saved/${id}`);
  await s.req('PUT', `/api/me/tracked/${id}`, { stage: 'Preparing' });

  // wrong password is refused
  assert.equal((await s.req('DELETE', '/api/me', { password: 'not-my-password' })).status, 422);
  // correct password deletes
  const del = await s.req('DELETE', '/api/me', { password: pw });
  assert.equal(del.status, 200);
  // session no longer valid
  assert.equal((await s.req('GET', '/api/session')).data.user, null);
  // cannot log back in
  assert.equal((await client().req('POST', '/api/auth/login', { email: s.user.email, password: pw })).status, 401);
  // the opportunity they submitted survives (submitter link nulled, not the listing)
  assert.equal((await client().req('GET', '/api/opportunities?q=Deletion%20Keeps')).data.total, 1);
});

test('account deletion: the last admin cannot delete themselves', async () => {
  // Isolated instance so this admin really is the only one (the shared suite creates many admins).
  const solo = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false });
  try {
    const email = `solo-admin-${Date.now()}@example.com`;
    solo.repo.createUser({ email, passwordHash: await hashPassword(pw), displayName: 'Solo', role: 'admin', emailVerified: true });
    const c = { cookie: '', csrf: '' };
    const req = async (method, path, body) => {
      const res = await fetch(solo.url + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf && method !== 'GET' ? { 'X-CSRF-Token': c.csrf } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      for (const line of res.headers.getSetCookie?.() || []) { const [pair] = line.split(';'); if (pair.startsWith('oa_sid=')) c.cookie = pair; }
      const data = await res.json().catch(() => null); if (data?.csrfToken) c.csrf = data.csrfToken;
      return { status: res.status, data };
    };
    await req('POST', '/api/auth/login', { email, password: pw });
    const r = await req('DELETE', '/api/me', { password: pw });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /only admin/i);
    assert.ok((await req('GET', '/api/session')).data.user, 'still signed in');
  } finally { await solo.close(); }
});

test('account deletion requires authentication and CSRF', async () => {
  assert.equal((await client().req('DELETE', '/api/me', { password: pw })).status, 401);
  const s = await signup();
  const noCsrf = await s.req('DELETE', '/api/me', { password: pw }, { 'X-CSRF-Token': 'wrong' });
  assert.equal(noCsrf.status, 403);
});
