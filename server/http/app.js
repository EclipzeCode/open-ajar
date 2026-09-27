import crypto from 'node:crypto';
import { HttpError, badRequest, forbidden, unauthorized, notFound, tooMany } from './errors.js';
import { createLimiter } from './ratelimit.js';
import { createStatic } from './static.js';
import { can } from '../auth/rbac.js';
import { authRoutes } from '../routes/auth.js';
import { publicRoutes } from '../routes/public.js';
import { meRoutes } from '../routes/me.js';
import { submissionRoutes } from '../routes/submissions.js';
import { adminRoutes } from '../routes/admin.js';
import { internRoutes } from '../routes/interns.js';
import { testimonialRoutes } from '../routes/testimonials.js';

import { COOKIE, sha256 } from './session.js';
const MAX_BODY = 64 * 1024;

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
  "img-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function compile(routes) {
  return routes.map((r) => {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    return { ...r, re, keys };
  });
}

export function createApp({ repo, config, mailer, accountEmails }) {
  const serveStatic = createStatic(config);
  const services = { repo, config, mailer, accountEmails };
  const routes = compile([...authRoutes, ...publicRoutes, ...meRoutes, ...submissionRoutes, ...adminRoutes, ...internRoutes, ...testimonialRoutes]);
  const globalLimit = createLimiter({ windowMs: 60_000, max: config.rateMax ?? 300 });
  const authLimit = createLimiter({ windowMs: 15 * 60_000, max: config.authRateMax ?? 15 });
  const writeLimit = createLimiter({ windowMs: 60_000, max: config.writeRateMax ?? 90 });

  const clientIp = (req) => (config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  function readBody(req, res) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0, done = false;
      req.on('data', (c) => {
        if (done) return;
        size += c.length;
        if (size > MAX_BODY) {
          // Stop buffering, tell the client why, and close the connection once the response is sent.
          done = true; chunks.length = 0; res.setHeader('Connection', 'close');
          reject(new HttpError(413, 'That request is too large'));
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (done) return;
        if (!size) return resolve(undefined);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(badRequest('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function loadSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 200) return {};
    const idHash = sha256(token);
    const s = repo.getSession(idHash);
    if (!s) return {};
    if (new Date(s.expiresAt) <= new Date()) { repo.deleteSession(idHash); return {}; }
    const user = repo.getUserById(s.userId);
    if (!user || user.disabled) { repo.deleteSession(idHash); return {}; }
    if (Date.now() - new Date(s.lastSeenAt).getTime() > 3600_000) repo.touchSession(idHash);
    return { session: { ...s, idHash }, user };
  }

  async function handleApi(req, res, url) {
    const ip = clientIp(req);
    if (!globalLimit.take(ip)) throw tooMany();

    let match = null, pathMatched = false;
    for (const r of routes) {
      const m = url.pathname.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method === req.method) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
    }
    if (!pathMatched) throw notFound();
    if (!match) throw new HttpError(405, 'Method not allowed');
    const { r, params } = match;

    const { session, user } = loadSession(req);
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    if (unsafe) {
      // Same-origin only: reject cross-site browsers outright, then require the per-session CSRF token.
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch { /* invalid */ } if (!ok) throw forbidden('Cross-origin request blocked'); }
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw forbidden('Cross-site request blocked');
      if (!writeLimit.take(ip)) throw tooMany();
      if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send JSON');
    }

    if (r.perm || r.auth) {
      if (!user) throw unauthorized();
      if (r.perm && !can(user, r.perm)) throw forbidden();
    }
    if (unsafe && session && !r.noCsrf) {
      const sent = req.headers['x-csrf-token'];
      const a = Buffer.from(String(sent || '')), b = Buffer.from(session.csrf);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw forbidden('Your session token is missing or stale. Refresh the page and try again.');
    }

    if (r.limit === 'auth' && !authLimit.take(`${ip}`)) throw tooMany('Too many attempts. Please wait a few minutes and try again.');

    const body = unsafe ? await readBody(req, res) : undefined;
    const cookies = [];
    const ctx = {
      req, res, params, body, user, session, ip, ...services,
      query: Object.fromEntries(url.searchParams),
      queryAll: (k) => url.searchParams.getAll(k).flatMap((v) => v.split('|')).filter(Boolean),
      status: 200,
      setCookie: (c) => cookies.push(c),
      authLimit,
    };
    const result = await r.handler(ctx);
    send(res, ctx.status, result, cookies.length ? { 'Set-Cookie': cookies } : {});
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.details || {}) });
      console.error('Unhandled error:', err);
      return send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    }
  };
}

