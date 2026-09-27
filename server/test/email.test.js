import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { start } from '../index.js';
import { createResendProvider, EmailError } from '../services/email/resend.js';
import { createMailer } from '../services/email/index.js';
import * as templates from '../services/email/templates.js';

let app;
before(async () => { app = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false, appUrl: 'http://localhost:4173' }); });
after(async () => { await app.close(); });

function client() {
  const c = { cookie: '', csrf: '' };
  c.req = async (method, path, body) => {
    const res = await fetch(app.url + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf && method !== 'GET' ? { 'X-CSRF-Token': c.csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie?.() || []) { const [pair] = line.split(';'); if (pair.startsWith('oa_sid=')) c.cookie = pair.endsWith('=') ? '' : pair; }
    const data = await res.json().catch(() => null);
    if (data?.csrfToken) c.csrf = data.csrfToken;
    return { status: res.status, data };
  };
  return c;
}

let n = 0;
const pw = 'correct-horse-battery';
const mails = (to) => app.mailer.outbox.filter((m) => m.to === to);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function tokenFor(to, kind, nth = 0) {
  for (let i = 0; i < 60; i++) {
    const found = mails(to).filter((m) => m.text.includes(`#/${kind}?token=`));
    if (found[nth]) return found[nth].text.match(/token=([A-Za-z0-9_-]+)/)[1];
    await wait(10);
  }
  throw new Error(`no ${kind} email`);
}
async function signup(verify = false) {
  const c = client();
  const email = `e${++n}-${Date.now()}@example.com`;
  const r = await c.req('POST', '/api/auth/register', { email, password: pw, displayName: 'Email Tester' });
  assert.equal(r.status, 201);
  c.email = email; c.user = r.data.user;
  if (verify) assert.equal((await client().req('POST', '/api/auth/verify', { token: await tokenFor(email, 'verify') })).status, 200);
  return c;
}
const submission = () => ({ title: 'Email Gate Test', org: 'Test Org (fictional)', type: 'Competition', summary: 'A test submission used only by automated tests, not real.', eligibility: 'Test only.', requirements: 'One', interests: [], grades: [10], cost: 'Free', costNote: '', format: 'Online', location: 'Anywhere', commitment: 'Flexible', commitmentNote: '', deadlineDate: null, deadlineNote: 'Rolling', url: null, relationship: 'other', contactEmail: 'c@example.com' });

// ------------------------------------------------------------------ verification
test('sign-up sends a verification email; unverified accounts can browse and save but cannot submit', async () => {
  const s = await signup(false);
  assert.equal(s.user.emailVerified, false);
  const token = await tokenFor(s.email, 'verify');
  assert.match(mails(s.email)[0].text, /http:\/\/localhost:4173\/#\/verify\?token=/);

  const blocked = await s.req('POST', '/api/submissions', submission());
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'email_unverified');
  assert.equal((await s.req('GET', '/api/me/library')).status, 200, 'core features stay available before verifying');

  assert.equal((await client().req('POST', '/api/auth/verify', { token })).status, 200);
  assert.equal((await s.req('GET', '/api/session')).data.user.emailVerified, true);
  assert.equal((await s.req('POST', '/api/submissions', submission())).status, 201);
});

test('verification tokens are single-use, well-formed, purpose-bound and stored hashed', async () => {
  const s = await signup(false);
  const token = await tokenFor(s.email, 'verify');
  assert.equal((await client().req('POST', '/api/auth/verify', { token })).status, 200);
  assert.equal((await client().req('POST', '/api/auth/verify', { token })).status, 400, 'second use fails');
  assert.equal((await client().req('POST', '/api/auth/verify', { token: 'nope' })).status, 400);
  assert.equal((await client().req('POST', '/api/auth/verify', {})).status, 400);
  // A reset token must not verify an email, and vice versa.
  const t = await signup(false);
  await client().req('POST', '/api/auth/forgot', { email: t.email });
  const resetToken = await tokenFor(t.email, 'reset');
  assert.equal((await client().req('POST', '/api/auth/verify', { token: resetToken })).status, 400);
  const hash = crypto.createHash('sha256').update(resetToken).digest('hex');
  assert.ok(app.repo.peekAuthToken(hash, 'reset_password'), 'stored under its hash');
  assert.equal(app.repo.peekAuthToken(resetToken, 'reset_password'), null, 'raw token is not what is stored');
});

test('expired verification links are refused', async () => {
  const s = await signup(false);
  const token = await tokenFor(s.email, 'verify');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  // Push the expiry into the past by re-issuing the same hash with an old date.
  app.repo.createAuthToken({ idHash: hash, userId: s.user.id, purpose: 'verify_email', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const r = await client().req('POST', '/api/auth/verify', { token });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /expired|already used/);
});

test('resend verification: needs sign-in, is a no-op once verified, and is rate limited', async () => {
  assert.equal((await client().req('POST', '/api/auth/verify/request')).status, 401);
  const done = await signup(true);
  assert.equal((await done.req('POST', '/api/auth/verify/request')).data.alreadyVerified, true);

  const s = await signup(false);
  const before = mails(s.email).length;
  const r = await s.req('POST', '/api/auth/verify/request');
  assert.equal(r.status, 200);
  assert.equal(mails(s.email).length, before + 1);
  // The newest link replaces the older one.
  const oldToken = await tokenFor(s.email, 'verify', 1);
  assert.equal((await client().req('POST', '/api/auth/verify', { token: oldToken })).status, 400, 'older link is invalidated');
  for (let i = 0; i < 3; i++) assert.equal((await s.req('POST', '/api/auth/verify/request')).status, 200); // 4 allowed per hour in total
  assert.equal((await s.req('POST', '/api/auth/verify/request')).status, 429);
});

// ------------------------------------------------------------------ password reset
test('forgot password answers identically for known and unknown emails, and only emails real accounts', async () => {
  const s = await signup(true);
  const known = await client().req('POST', '/api/auth/forgot', { email: s.email });
  const unknown = await client().req('POST', '/api/auth/forgot', { email: `nobody-${Date.now()}@example.com` });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(known.data, unknown.data);
  await tokenFor(s.email, 'reset');
  assert.equal(app.mailer.outbox.filter((m) => m.to.startsWith('nobody-')).length, 0);
  assert.equal((await client().req('POST', '/api/auth/forgot', { email: 'not-an-email' })).status, 422);
  const mail = mails(s.email).find((m) => m.subject.includes('Reset'));
  assert.ok(!mail.text.includes(pw) && !mail.html.includes(pw));
  assert.match(mail.text, /1 hour/);
});

test('reset: weak password does not burn the link; success signs out every session and works once', async () => {
  const s = await signup(true);
  const other = client(); assert.equal((await other.req('POST', '/api/auth/login', { email: s.email, password: pw })).status, 200);
  await client().req('POST', '/api/auth/forgot', { email: s.email });
  const token = await tokenFor(s.email, 'reset');

  assert.equal((await client().req('POST', '/api/auth/reset', { token, password: 'short' })).status, 422);
  assert.equal((await client().req('POST', '/api/auth/reset', { token: 'x'.repeat(30), password: 'a-brand-new-passphrase' })).status, 400);
  const ok = await client().req('POST', '/api/auth/reset', { token, password: 'a-brand-new-passphrase' });
  assert.equal(ok.status, 200);

  assert.equal((await s.req('GET', '/api/session')).data.user, null, 'old session ended');
  assert.equal((await other.req('GET', '/api/session')).data.user, null, 'other device ended');
  assert.equal((await client().req('POST', '/api/auth/login', { email: s.email, password: pw })).status, 401, 'old password dead');
  assert.equal((await client().req('POST', '/api/auth/login', { email: s.email, password: 'a-brand-new-passphrase' })).status, 200);
  assert.equal((await client().req('POST', '/api/auth/reset', { token, password: 'yet-another-passphrase-1' })).status, 400, 'single use');
});

test('reset also confirms the email address (they proved inbox access)', async () => {
  const s = await signup(false);
  await client().req('POST', '/api/auth/forgot', { email: s.email });
  const token = await tokenFor(s.email, 'reset');
  await client().req('POST', '/api/auth/reset', { token, password: 'a-brand-new-passphrase' });
  const c = client(); await c.req('POST', '/api/auth/login', { email: s.email, password: 'a-brand-new-passphrase' });
  assert.equal((await c.req('GET', '/api/session')).data.user.emailVerified, true);
});

test('reset emails are limited per address, without changing the response', async () => {
  const s = await signup(true);
  for (let i = 0; i < 5; i++) assert.equal((await client().req('POST', '/api/auth/forgot', { email: s.email })).status, 200);
  await wait(80);
  assert.equal(mails(s.email).filter((m) => m.subject.includes('Reset')).length, 3);
});

// ------------------------------------------------------------------ provider layer
test('Resend adapter sends the documented request and never leaks the key', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'em_123' }), { status: 200 }); };
  const p = createResendProvider({ apiKey: 're_secret_key', from: 'Open Ajar <hello@example.org>', fetchImpl: fake });
  const out = await p.send({ to: 'a@example.com', subject: 'Hi', html: '<p>x</p>', text: 'x', idempotencyKey: 'k1' });
  assert.equal(out.id, 'em_123');
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_secret_key');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'k1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: 'Open Ajar <hello@example.org>', to: ['a@example.com'], subject: 'Hi', html: '<p>x</p>', text: 'x' });

  const bad = createResendProvider({ apiKey: 're_secret_key', from: 'x', fetchImpl: async () => new Response(JSON.stringify({ name: 'validation_error', message: 'nope re_secret_key' }), { status: 422 }) });
  await assert.rejects(() => bad.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }), (e) => e instanceof EmailError && e.status === 422 && !e.message.includes('re_secret_key') && e.message.includes('nope [redacted]'));
  const down = createResendProvider({ apiKey: 'k', from: 'x', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => down.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' }), EmailError);
  assert.throws(() => createResendProvider({ apiKey: '', from: 'x' }), /RESEND_API_KEY/);
});

test('mailer selection: production refuses the console provider; unknown providers fail loudly', () => {
  assert.throws(() => createMailer({ production: true, emailProvider: 'console' }), /Production requires/);
  assert.throws(() => createMailer({ production: false, emailProvider: 'carrier-pigeon' }), /Unknown EMAIL_PROVIDER/);
  assert.equal(createMailer({ production: true, emailProvider: 'resend', resendApiKey: 'k', emailFrom: 'x' }).name, 'resend');
  assert.equal(createMailer({ production: false, emailProvider: 'console' }).name, 'console');
});

test('a failing provider never breaks sign-up or leaks a 500', async () => {
  const flaky = { name: 'flaky', async send() { throw new EmailError('boom'); } };
  const a = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false, emailProvider: 'resend', resendApiKey: 'k', mailer: flaky });
  try {
    const res = await fetch(a.url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'flaky@example.com', password: pw, displayName: 'Flaky' }) });
    assert.equal(res.status, 201);
    const cookie = res.headers.getSetCookie()[0].split(';')[0];
    const csrf = (await res.json()).csrfToken;
    const retry = await fetch(a.url + '/api/auth/verify/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: '{}' });
    assert.equal(retry.status, 502);
    assert.match((await retry.json()).error, /couldn’t send/);
    const dev = await fetch(a.url + '/api/dev/outbox');
    assert.equal(dev.status, 404, 'dev inbox is off when a real provider is configured');
  } finally { await a.close(); }
});

test('dev inbox is available only with the console provider', async () => {
  const r = await client().req('GET', '/api/dev/outbox');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.items));
  assert.equal((await client().req('GET', '/api/session')).data.devInbox, true);
});

test('email templates escape user-controlled text', () => {
  const m = templates.verifyEmail({ to: 'a@example.com', name: '<script>alert(1)</script> Al', link: 'http://localhost/#/verify?token=abc' });
  assert.ok(!m.html.includes('<script>'));
  assert.match(m.html, /&lt;script&gt;/);
  assert.ok(m.text.includes('http://localhost/#/verify?token=abc'));
});

test('admin activity feed is restricted to reviewers', async () => {
  const s = await signup(true);
  assert.equal((await s.req('GET', '/api/admin/activity')).status, 403);
});
