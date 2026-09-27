import { hashPassword, verifyPassword, passwordProblem, DUMMY_HASH } from '../auth/passwords.js';
import { PERMISSIONS } from '../auth/rbac.js';
import { startSession, endSession } from '../http/session.js';
import { isEmail, normEmail, validateProfile } from '../validation/validate.js';
import { invalid, conflict, HttpError, badRequest, tooMany } from '../http/errors.js';
import { createLimiter } from '../http/ratelimit.js';

const perEmail = createLimiter({ windowMs: 60 * 60_000, max: 3 });   // reset emails per address per hour
const perUserVerify = createLimiter({ windowMs: 60 * 60_000, max: 4 }); // verification emails per user per hour
const logMailFailure = (what, e) => console.error(`[email] ${what} failed: ${e.message}`);

export function userDto(repo, user) {
  return { id: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt, emailReminders: user.emailReminders !== false, displayName: user.displayName, role: user.role, permissions: PERMISSIONS[user.role] || [], profile: repo.getProfile(user.id) };
}

const need = (body) => { if (!body || typeof body !== 'object') throw badRequest('Expected a JSON body'); return body; };
const BAD_LOGIN = new HttpError(401, 'That email and password don’t match. Check them and try again.');

export const authRoutes = [
  {
    method: 'GET', path: '/api/session',
    handler({ repo, user, session, config }) {
      return { user: user ? userDto(repo, user) : null, csrfToken: session?.csrf || null, demoMode: config.demoMode, devInbox: config.emailProvider === 'console' && !config.production };
    },
  },
  {
    // Self-registration ALWAYS creates a student. Roles are never accepted from the client.
    method: 'POST', path: '/api/auth/register', limit: 'auth', noCsrf: true,
    async handler(ctx) {
      const { repo, session } = ctx;
      const b = need(ctx.body);
      const errors = {};
      const email = typeof b.email === 'string' ? normEmail(b.email) : '';
      const name = typeof b.displayName === 'string' ? b.displayName.replace(/[\u0000-\u001F\u007F]/g, '').trim() : '';
      if (!isEmail(email)) errors.email = 'Enter a valid email address';
      if (name.length < 1 || name.length > 80) errors.displayName = 'Enter your name (up to 80 characters)';
      const pw = passwordProblem(b.password, email);
      if (pw) errors.password = pw;
      if (Object.keys(errors).length) throw invalid(errors);

      if (repo.getUserByEmail(email)) throw conflict('An account with that email may already exist. Try signing in instead.', { errors: { email: 'That email may already be registered. Try signing in.' } });
      const id = repo.createUser({ email, passwordHash: await hashPassword(b.password), displayName: name, role: 'student' });
      if (session) repo.deleteSession(session.idHash);
      const { csrfToken } = startSession(ctx, { id });
      const created = repo.getUserById(id);
      // Don't make sign-up wait on (or fail because of) email delivery; the account page offers a resend.
      ctx.accountEmails.sendVerification(created).catch((e) => logMailFailure('verification', e));
      ctx.status = 201;
      return { user: userDto(repo, created), csrfToken };
    },
  },
  {
    method: 'POST', path: '/api/auth/login', limit: 'auth', noCsrf: true,
    async handler(ctx) {
      const { repo, session } = ctx;
      const b = need(ctx.body);
      const email = typeof b.email === 'string' ? normEmail(b.email) : '';
      const user = email && typeof b.password === 'string' && b.password.length <= 128 ? repo.getUserByEmail(email) : null;
      // Always run one scrypt verification so response time doesn't reveal whether the email exists.
      const ok = await verifyPassword(typeof b.password === 'string' ? b.password.slice(0, 128) : '', user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok || user.disabled) throw BAD_LOGIN;
      if (session) repo.deleteSession(session.idHash);
      const { csrfToken } = startSession(ctx, user);
      return { user: userDto(repo, user), csrfToken };
    },
  },
  {
    method: 'POST', path: '/api/auth/logout', auth: true,
    handler(ctx) {
      ctx.repo.deleteSession(ctx.session.idHash);
      endSession(ctx);
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/auth/password', auth: true, limit: 'auth',
    async handler(ctx) {
      const { repo, user, session } = ctx;
      const b = need(ctx.body);
      if (!(await verifyPassword(String(b.currentPassword || '').slice(0, 128), user.passwordHash))) throw invalid({ currentPassword: 'That isn’t your current password' });
      const problem = passwordProblem(b.newPassword, user.email);
      if (problem) throw invalid({ newPassword: problem });
      repo.updateUser(user.id, { passwordHash: await hashPassword(b.newPassword) });
      repo.deleteUserSessions(user.id, session.idHash); // sign out every other device
      repo.addAudit({ actorId: user.id, action: 'password_changed', targetType: 'user', targetId: user.id });
      return { ok: true };
    },
  },
];

// ---------------------------------------------------------------- email verification + password reset
authRoutes.push(
  {
    method: 'POST', path: '/api/auth/verify/request', auth: true,
    async handler(ctx) {
      const { user } = ctx;
      if (user.emailVerifiedAt) return { alreadyVerified: true };
      if (!perUserVerify.take(user.id)) throw tooMany('We’ve sent several emails recently. Please check your inbox and spam folder, or try again in an hour.');
      try { await ctx.accountEmails.sendVerification(user); }
      catch (e) { logMailFailure('verification', e); throw new HttpError(502, 'We couldn’t send the email just now. Please try again in a few minutes.'); }
      return { sent: true };
    },
  },
  {
    // Opened from an email link, possibly in a different browser than the one that signed up, so no session/CSRF needed.
    method: 'POST', path: '/api/auth/verify', limit: 'auth', noCsrf: true,
    handler(ctx) { need(ctx.body); ctx.accountEmails.verifyEmail(ctx.body.token); return { verified: true }; },
  },
  {
    // Always answers identically, whether or not the address has an account, and doesn't wait for the email to send,
    // so neither the response nor its timing reveals which addresses are registered.
    method: 'POST', path: '/api/auth/forgot', limit: 'auth', noCsrf: true,
    handler(ctx) {
      const b = need(ctx.body);
      const email = typeof b.email === 'string' ? normEmail(b.email) : '';
      if (!isEmail(email)) throw invalid({ email: 'Enter a valid email address' });
      const user = ctx.repo.getUserByEmail(email);
      if (user && !user.disabled && perEmail.take(email)) {
        ctx.accountEmails.sendPasswordReset(user).catch((e) => logMailFailure('password reset', e));
      }
      return { ok: true };
    },
  },
  {
    method: 'POST', path: '/api/auth/reset', limit: 'auth', noCsrf: true,
    async handler(ctx) {
      const b = need(ctx.body);
      await ctx.accountEmails.resetPassword(b.token, b.password);
      return { ok: true };
    },
  },
);

export { validateProfile };
