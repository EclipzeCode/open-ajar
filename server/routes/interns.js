import { createLimiter } from '../http/ratelimit.js';
import { badRequest, invalid, notFound, tooMany } from '../http/errors.js';
import { isEmail, normEmail } from '../validation/validate.js';
import { META } from '../validation/meta.js';

const perIp = createLimiter({ windowMs: 60 * 60_000, max: 8 }); // intern applications per IP per hour
const clean = (s) => String(s).replace(/[\u0000-\u001F\u007F]/g, '').trim();
const cleanMulti = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

/** Validates a public intern application. Returns the cleaned record or throws a 422. */
function validateApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Expected a JSON object');
  const errors = {};
  const out = {};
  const text = (key, label, { min = 0, max, required = true, multi = false } = {}) => {
    const v = typeof input[key] === 'string' ? (multi ? cleanMulti(input[key]) : clean(input[key])) : '';
    if (!v) { if (required) errors[key] = `Enter ${label.toLowerCase()}`; else out[key] = ''; return; }
    if (v.length < min) errors[key] = `${label} needs at least ${min} characters`;
    else if (max && v.length > max) errors[key] = `${label} must be ${max} characters or fewer`;
    else out[key] = v;
  };

  text('fullName', 'Your name', { min: 2, max: 120 });
  if (!isEmail(input.email)) errors.email = 'Enter a valid email'; else out.email = normEmail(input.email);
  if (input.grade === '' || input.grade == null) out.grade = null;
  else if (!META.grades.includes(Number(input.grade))) errors.grade = 'Choose a grade from 9 to 12'; else out.grade = Number(input.grade);
  text('school', 'Your school', { max: 160, required: false });
  text('location', 'Your city or area', { max: 160, required: false });
  const interests = Array.isArray(input.interests) ? input.interests.filter((i) => META.interests.includes(i)) : [];
  out.interests = [...new Set(interests)];
  text('skills', 'Skills or experience', { max: 1000, required: false, multi: true });
  text('availability', 'Availability', { max: 300, required: false });
  text('statement', 'Why you want to intern', { min: 10, max: 2000, required: true, multi: true });
  if (input.link) {
    try {
      const u = new URL(String(input.link));
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      out.link = u.toString();
    } catch { errors.link = 'Enter a full link starting with https://'; }
  } else out.link = null;

  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

export const internRoutes = [
  {
    // Public: a student applies to join the intern pool. No account required.
    method: 'POST', path: '/api/intern-applications', noCsrf: true,
    handler(ctx) {
      if (!perIp.take(ctx.ip)) throw tooMany('You’ve submitted a few applications recently. Please try again later.');
      const data = validateApplication(ctx.body);
      const id = ctx.repo.createInternApplication(data);
      ctx.status = 201;
      return { ok: true, id };
    },
  },
  {
    // Admin roster.
    method: 'GET', path: '/api/admin/intern-applications', perm: 'opportunity.review',
    handler({ repo, query }) {
      const status = ['new', 'contacted', 'placed', 'declined'].includes(query.status) ? query.status : undefined;
      return { items: repo.listInternApplications({ status }), counts: repo.internApplicationCounts() };
    },
  },
  {
    method: 'PATCH', path: '/api/admin/intern-applications/:id', perm: 'opportunity.review',
    handler({ repo, params, body }) {
      const app = repo.getInternApplication(params.id);
      if (!app) throw notFound();
      const patch = {};
      if (body && body.status !== undefined) {
        if (!['new', 'contacted', 'placed', 'declined'].includes(body.status)) throw badRequest('Unknown status');
        patch.status = body.status;
      }
      if (body && body.adminNote !== undefined) {
        if (typeof body.adminNote !== 'string' || body.adminNote.length > 2000) throw invalid({ adminNote: 'Note must be 2000 characters or fewer' });
        patch.adminNote = cleanMulti(body.adminNote);
      }
      repo.updateInternApplication(params.id, patch);
      return { application: repo.getInternApplication(params.id) };
    },
  },
];

export { validateApplication };
