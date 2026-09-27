import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines from <project>/.env.
 * Real environment variables always win. The file is git-ignored, so keys stay off GitHub.
 */
function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, '');
      if (process.env[m[1]] === undefined && v !== '') process.env[m[1]] = v;
    }
  } catch { /* no .env file: fine */ }
}
loadDotEnv();
const env = process.env;
const production = env.NODE_ENV === 'production';

export const config = {
  root,
  production,
  host: env.HOST || '127.0.0.1',
  port: Number(env.PORT || 4173),
  publicDir: path.join(root, 'public'),
  dbPath: env.DB_PATH || path.join(root, 'var', 'openajar.db'),
  rateMax: Number(env.RATE_MAX || 300),          // requests per IP per minute
  writeRateMax: Number(env.WRITE_RATE_MAX || 90), // write requests per IP per minute
  authRateMax: Number(env.AUTH_RATE_MAX || 15),
  sessionDays: Number(env.SESSION_DAYS || 30),
  /** Cookies are Secure in production. Set SECURE_COOKIES=0 only when testing production mode over plain HTTP. */
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === '1' : production,
  /** Only trust X-Forwarded-For when running behind your own reverse proxy. */
  trustProxy: env.TRUST_PROXY === '1',
  /** Dev convenience: seed clearly-labelled DEMO listings into an empty database. Never in production unless forced. */
  seedDemo: env.SEED_DEMO ? env.SEED_DEMO === '1' : !production,
  /** Public base URL used in email links. */
  appUrl: (env.APP_URL || `http://${env.HOST || '127.0.0.1'}:${env.PORT || 4173}`).replace(/\/$/, ''),
  /** 'resend' sends real email. 'console' records emails locally (development only; refused in production). */
  emailProvider: env.EMAIL_PROVIDER || (env.RESEND_API_KEY ? 'resend' : 'console'),
  resendApiKey: env.RESEND_API_KEY || '',
  /** Must be an address on a domain you've verified in Resend. Resend's onboarding@resend.dev only delivers to your own account email. */
  emailFrom: env.EMAIL_FROM || 'Open Ajar <onboarding@resend.dev>',
  reminderDays: Math.min(30, Math.max(1, Number(env.REMINDER_DAYS || 7))),
  remindersEnabled: env.REMINDERS_ENABLED ? env.REMINDERS_ENABLED === '1' : true,
  demoMode: env.DEMO_MODE ? env.DEMO_MODE === '1' : !production,
};
