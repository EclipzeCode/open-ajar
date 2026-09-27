import crypto from 'node:crypto';

export const COOKIE = 'oa_sid';
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const cookie = (value, { maxAge, secure }) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

/** Creates a fresh session (new token every sign-in, so a fixated pre-login token is useless) and sets the cookie. */
export function startSession(ctx, user) {
  const { repo, config } = ctx;
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const maxAge = config.sessionDays * 86400;
  repo.createSession({
    idHash: sha256(token), userId: user.id, csrf,
    expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(), userAgent: ctx.req.headers['user-agent'],
  });
  ctx.setCookie(cookie(token, { maxAge, secure: config.secureCookies }));
  return { csrfToken: csrf, idHash: sha256(token) };
}

export const endSession = (ctx) => ctx.setCookie(cookie('', { maxAge: 0, secure: ctx.config.secureCookies }));
