'use strict';
const nodemailer = require('nodemailer');
const env = require('./../config/env');

let transporter = null;

/** Lazily creates the SMTP transporter, or returns null when email is not configured. */
function getTransporter() {
  if (!env.emailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465, // true for 465, false for 587/25 (STARTTLS)
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Sends the critical alert to all co-founders. Resolves with { skipped } when email is off.
 * Callers must wrap this so a mail failure never fails the API request.
 */
async function sendCriticalAlert(application, indicators = []) {
  const t = getTransporter();
  if (!t) {
    console.warn(`[email] not configured; skipping critical alert for "${application.name}"`);
    return { skipped: true };
  }

  const reviewUrl = `${env.adminDashboardUrl}/applications/${application._id}`;
  const lines = indicators.length ? indicators : ['No individual indicators were provided.'];
  const subject = `URGENT: ${application.name} flagged (vulnerability ${application.vulnerabilityScore}/100)`;

  const text = [
    `A new Stray-to-Stay application scored ${application.vulnerabilityScore}/100 (alert threshold ${env.alertThreshold}).`,
    '',
    `Restaurant: ${application.name}`,
    `Owner: ${application.owner}`,
    `Address: ${application.address}`,
    '',
    'Operating distress indicators:',
    ...lines.map((l) => `  - ${l}`),
    '',
    `Review this application: ${reviewUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#15140f">
      <h2 style="margin:0 0 8px">Urgent application flagged</h2>
      <p style="margin:0 0 16px">Scored <strong>${application.vulnerabilityScore}/100</strong> (alert threshold ${env.alertThreshold}).</p>
      <p style="margin:0 0 16px">
        <strong>${escapeHtml(application.name)}</strong><br/>
        Owner: ${escapeHtml(application.owner)}<br/>
        Address: ${escapeHtml(application.address)}
      </p>
      <p style="margin:0 0 4px"><strong>Operating distress indicators</strong></p>
      <ul style="margin:0 0 20px">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      <p><a href="${escapeHtml(reviewUrl)}" style="background:#15140f;color:#fff;padding:12px 20px;border-radius:4px;text-decoration:none;display:inline-block">Review application</a></p>
    </div>`;

  const info = await t.sendMail({
    from: env.smtp.from,
    to: env.cofounderEmails.join(','),
    subject,
    text,
    html,
  });
  return { skipped: false, messageId: info.messageId };
}

module.exports = { getTransporter, sendCriticalAlert };
