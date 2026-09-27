import crypto from 'node:crypto';
import * as templates from './email/templates.js';
import { hashPassword, passwordProblem } from '../auth/passwords.js';
import { badRequest, invalid } from '../http/errors.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const HOURS = 3600_000;

/** Verification and password-reset flows. Tokens are random, single-use and stored only as hashes. */
export function createAccountEmails({ repo, mailer, config }) {
  const link = (path, token) => `${config.appUrl}/#/${path}?token=${token}`;

  function issue(user, purpose, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    repo.createAuthToken({ idHash: sha256(token), userId: user.id, purpose, expiresAt: new Date(Date.now() + ttlMs).toISOString() });
    return token;
  }

  return {
    async sendVerification(user) {
      const token = issue(user, 'verify_email', 24 * HOURS);
      await mailer.send({ ...templates.verifyEmail({ to: user.email, name: user.displayName, link: link('verify', token) }), idempotencyKey: `verify-${sha256(token).slice(0, 32)}` });
    },

    async sendPasswordReset(user) {
      const token = issue(user, 'reset_password', 1 * HOURS);
      await mailer.send({ ...templates.resetPassword({ to: user.email, name: user.displayName, link: link('reset', token) }), idempotencyKey: `reset-${sha256(token).slice(0, 32)}` });
    },

    verifyEmail(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw badRequest('That link isn’t valid. Request a new one.');
      const userId = repo.consumeAuthToken(sha256(token), 'verify_email');
      if (!userId) throw badRequest('That link has expired or was already used. Request a new one.');
      repo.markEmailVerified(userId);
      return userId;
    },

    async resetPassword(token, newPassword) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw badRequest('That link isn’t valid. Request a new one.');
      const idHash = sha256(token);
      // Look before spending: a weak password must not burn the single-use link.
      const peeked = repo.peekAuthToken(idHash, 'reset_password');
      if (!peeked) throw badRequest('That link has expired or was already used. Request a new one.');
      const problem = passwordProblem(newPassword, repo.getUserById(peeked)?.email);
      if (problem) throw invalid({ password: problem });
      const userId = repo.consumeAuthToken(idHash, 'reset_password');
      if (!userId) throw badRequest('That link has expired or was already used. Request a new one.');
      repo.updateUser(userId, { passwordHash: await hashPassword(newPassword) });
      repo.deleteUserSessions(userId);         // every device must sign in again with the new password
      repo.markEmailVerified(userId);          // they just proved they control this inbox
      repo.addAudit({ actorId: userId, action: 'password_reset', targetType: 'user', targetId: userId });
      return userId;
    },
  };
}
