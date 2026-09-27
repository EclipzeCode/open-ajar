import http from 'node:http';
import { config } from './config.js';
import { createRepo } from './repo/index.js';
import { createApp } from './http/app.js';
import { runProvider } from './services/importer.js';
import { createMailer } from './services/email/index.js';
import { createAccountEmails } from './services/accountEmails.js';
import { createReminderService } from './services/reminders.js';
import * as demo from './providers/demo.js';

export async function start(overrides = {}) {
  const cfg = { ...config, ...overrides };
  if (cfg.production && !/^https:\/\//.test(cfg.appUrl)) throw new Error('Production requires APP_URL to be your public https:// address (it is used in email links).');
  const repo = createRepo(cfg);
  const mailer = overrides.mailer || createMailer(cfg);
  const accountEmails = createAccountEmails({ repo, mailer, config: cfg });
  const reminders = createReminderService({ repo, mailer, config: cfg });

  if (cfg.seedDemo && repo.countOpportunities() === 0) {
    const r = await runProvider(repo, demo);
    console.log(`Seeded ${r.created} DEMO listings (fictional; development only). Remove with: node server/scripts/seed-demo.js --purge`);
  }

  // Housekeeping: expire listings past their expiry and drop dead sessions.
  const tick = () => {
    repo.expireDue(); repo.purgeExpiredSessions(); repo.purgeExpiredTokens();
    reminders.runOnce().catch((e) => console.error('[reminders]', e.message));
  };
  tick();
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref();

  const server = http.createServer(createApp({ repo, config: cfg, mailer, accountEmails }));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve) => server.listen(cfg.port, cfg.host, resolve));
  return { server, repo, mailer, reminders, url: `http://${cfg.host}:${server.address().port}`, close: () => new Promise((r) => { clearInterval(timer); server.close(() => { repo.close(); r(); }); }) };
}

const isMain = import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('server/index.js');
if (isMain) {
  const { url } = await start();
  console.log(`Open Ajar running at ${url}${config.production ? '' : '  (development mode)'}`);
  console.log(config.emailProvider === 'resend'
    ? `Email: Resend is ON (sending from ${config.emailFrom}). Test it with: npm run email:test -- you@example.com`
    : 'Email: NOT sending. No RESEND_API_KEY found, so emails only appear at #/dev/inbox. See README "Email (Resend)" to turn on real sending.');
}
