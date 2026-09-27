import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../index.js';
import { hashPassword } from '../auth/passwords.js';

let app;
const sent = [];
// Inject a mailer that records instead of sending.
const mailer = { name: 'test', async send(msg) { sent.push(msg); return { id: `t${sent.length}` }; } };
before(async () => { app = await start({ port: 0, dbPath: ':memory:', seedDemo: false, authRateMax: 10_000, rateMax: 100_000, writeRateMax: 100_000, secureCookies: false, mailer }); });
after(async () => { await app.close(); });

const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }; // local calendar date
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

let n = 0;
async function verifiedUser({ reminders = true } = {}) {
  const email = `rem${++n}-${Date.now()}@example.com`;
  const id = app.repo.createUser({ email, passwordHash: await hashPassword('x'.repeat(12)), displayName: `User ${n}`, role: 'student', emailVerified: true });
  if (!reminders) app.repo.updateUser(id, { emailReminders: false });
  return { id, email };
}
function liveOpp(deadlineDate, over = {}) {
  const id = app.repo.createOpportunity(
    { title: `Opp ${Math.random().toString(36).slice(2, 8)}`, org: 'Org', type: 'Competition', summary: 'A fictional opportunity for reminder tests, not real at all here.', eligibility: 'Test only.', requirements: [], interests: [], grades: [11], cost: 'Free', format: 'Online', location: 'Anywhere', commitment: 'Flexible', deadlineDate, deadlineNote: '', ...over },
    { status: 'approved', publishedAt: new Date().toISOString() }
  );
  return id;
}
const track = (userId, oppId, entry = {}) => app.repo.upsertTracked(userId, oppId, { stage: 'Interested', notes: '', deadline: '', checklist: [], addedAt: new Date().toISOString(), ...entry });
const reset = () => { sent.length = 0; app.repo.setMeta('reminderRunDate', ''); };

test('sends one digest for a user with a deadline inside the window', async () => {
  reset();
  const u = await verifiedUser();
  track(u.id, liveOpp(inDays(3)));
  track(u.id, liveOpp(inDays(6)));
  const r = await app.reminders.runOnce({ force: true });
  assert.equal(r.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, u.email);
  assert.match(sent[0].subject, /2 deadlines/);
});

test('does not remind twice for the same deadline, but re-arms when the deadline changes', async () => {
  reset();
  const u = await verifiedUser();
  const opp = liveOpp(inDays(4));
  track(u.id, opp);
  assert.equal((await app.reminders.runOnce({ force: true })).sent, 1);
  reset();
  assert.equal((await app.reminders.runOnce({ force: true })).sent, 0, 'no repeat for the same deadline');
  // student sets their own, closer deadline -> should remind again
  track(u.id, opp, { deadline: inDays(2) });
  reset();
  assert.equal((await app.reminders.runOnce({ force: true })).sent, 1, 're-armed by a new deadline');
});

test('respects the window, stage, verification and opt-out', async () => {
  reset();
  const far = await verifiedUser(); track(far.id, liveOpp(inDays(30)));           // outside 7-day window
  const past = await verifiedUser(); track(past.id, liveOpp(inDays(-1)));          // already passed
  const applied = await verifiedUser(); track(applied.id, liveOpp(inDays(2)), { stage: 'Applied' }); // acted already
  const optOut = await verifiedUser({ reminders: false }); track(optOut.id, liveOpp(inDays(2)));     // opted out
  // unverified user
  const email = `unv-${Date.now()}@example.com`;
  const uid = app.repo.createUser({ email, passwordHash: await hashPassword('x'.repeat(12)), displayName: 'Unv', role: 'student', emailVerified: false });
  track(uid, liveOpp(inDays(2)));
  const r = await app.reminders.runOnce({ force: true });
  assert.equal(r.sent, 0);
  assert.equal(sent.length, 0);
});

test('the daily guard prevents a second run the same day', async () => {
  reset();
  const u = await verifiedUser(); track(u.id, liveOpp(inDays(1)));
  const first = await app.reminders.runOnce();  // not forced
  assert.equal(first.sent, 1);
  const again = await app.reminders.runOnce();  // same day, not forced
  assert.equal(again.skipped, 'already-ran-today');
  assert.equal(sent.length, 1);
});

test('the reminder email names the opportunity, the timing and a tracker link', async () => {
  reset();
  const u = await verifiedUser();
  track(u.id, liveOpp(inDays(0)));  // due today
  await app.reminders.runOnce({ force: true });
  const mail = sent[0];
  assert.match(mail.text, /due today/i);
  assert.ok(mail.html.includes('/#/tracker'));
  assert.ok(!mail.html.includes('<script>'));
});
