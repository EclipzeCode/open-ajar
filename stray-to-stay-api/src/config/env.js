'use strict';
require('dotenv').config();

/** Fail fast if a required variable is missing, so misconfiguration surfaces at boot, not at request time. */
function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required environment variable: ${name}`);
  return String(v).trim();
}
const optional = (name, fallback) => (process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback);
const list = (name) => (process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (name, fallback) => { const n = parseInt(optional(name, ''), 10); return Number.isFinite(n) ? n : fallback; };

const nodeEnv = optional('NODE_ENV', 'development');

const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: int('PORT', 4000),
  corsOrigins: list('CORS_ORIGINS'),

  mongoUri: required('MONGODB_URI'),

  adminToken: required('ADMIN_API_TOKEN'),
  adminDashboardUrl: optional('ADMIN_DASHBOARD_URL', 'http://localhost:5173').replace(/\/+$/, ''),

  alertThreshold: Math.min(100, Math.max(1, int('ALERT_THRESHOLD', 75))),
  cofounderEmails: list('COFOUNDER_EMAILS'),

  smtp: {
    host: optional('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('EMAIL_FROM', 'Open Ajar Alerts <no-reply@openajar.org>'),
  },
};

// Email is optional: if it is not fully configured the API still runs, and critical alerts are skipped (logged).
env.emailEnabled = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass && env.cofounderEmails.length);

if (env.isProd && env.corsOrigins.length === 0) {
  console.warn('[config] CORS_ORIGINS is empty in production; all origins will be allowed. Set it to your dashboard URL.');
}

module.exports = env;
