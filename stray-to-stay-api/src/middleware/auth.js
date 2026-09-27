'use strict';
const crypto = require('crypto');
const env = require('./../config/env');

/** Constant-time compare so a wrong token can't be guessed by response timing. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Protects the founder-panel endpoints. The dashboard must send:
 *   Authorization: Bearer <ADMIN_API_TOKEN>
 *
 * This is a shared-secret gate suitable for a small 4-person team. For real per-user accounts,
 * roles, and audit trails, replace this with JWT/OAuth sessions.
 */
module.exports = function requireAdmin(req, res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token || !safeEqual(token, env.adminToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
};
