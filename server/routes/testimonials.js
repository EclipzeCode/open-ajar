import { createLimiter } from '../http/ratelimit.js';
import { badRequest, invalid, notFound, tooMany } from '../http/errors.js';

const perUser = createLimiter({ windowMs: 60 * 60_000, max: 12 }); // testimonial submits per user per hour
const cleanMulti = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const clean = (s) => String(s).replace(/[\u0000-\u001F\u007F]/g, '').trim();

/** Validates a student's own testimonial. Returns { quote, roleLabel } or throws a 422. */
function validateTestimonial(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Expected a JSON object');
  const errors = {};
  const quote = typeof input.quote === 'string' ? cleanMulti(input.quote) : '';
  if (!quote) errors.quote = 'Write a short quote';
  else if (quote.length < 15) errors.quote = 'Your quote needs at least 15 characters';
  else if (quote.length > 400) errors.quote = 'Please keep your quote to 400 characters or fewer';
  const roleLabel = typeof input.role === 'string' ? clean(input.role) : '';
  if (roleLabel.length > 80) errors.role = 'Keep this to 80 characters or fewer';
  if (Object.keys(errors).length) throw invalid(errors);
  return { quote, roleLabel };
}

/** What the public carousel sees: no user id, no email, just the words and who said them. */
const publicDto = (t) => ({ id: t.id, quote: t.quote, name: t.name, role: t.role, isDemo: t.isDemo });

export const testimonialRoutes = [
  {
    // Public: approved testimonials for the Community Voices carousel.
    method: 'GET', path: '/api/testimonials',
    handler({ repo }) {
      return { items: repo.listPublicTestimonials().map(publicDto) };
    },
  },
  {
    // The signed-in student's own testimonial and its review status (for the account page).
    method: 'GET', path: '/api/me/testimonial', perm: 'profile.edit',
    handler({ repo, user }) {
      const t = repo.getUserTestimonial(user.id);
      return { testimonial: t ? { quote: t.quote, role: t.role, status: t.status } : null };
    },
  },
  {
    // A signed-in student submits or updates their own quote. It goes back to pending for review.
    method: 'POST', path: '/api/testimonials', perm: 'profile.edit',
    handler(ctx) {
      const { repo, user } = ctx;
      if (!perUser.take(user.id)) throw tooMany('You’ve saved your quote a few times just now. Please try again later.');
      const { quote, roleLabel } = validateTestimonial(ctx.body);
      const t = repo.upsertUserTestimonial({ userId: user.id, authorName: user.displayName, roleLabel, quote });
      ctx.status = 201;
      return { testimonial: { quote: t.quote, role: t.role, status: t.status } };
    },
  },
  {
    // Admin roster.
    method: 'GET', path: '/api/admin/testimonials', perm: 'opportunity.review',
    handler({ repo, query }) {
      const status = ['pending', 'approved', 'declined'].includes(query.status) ? query.status : undefined;
      return { items: repo.listTestimonials({ status }), counts: repo.testimonialCounts() };
    },
  },
  {
    method: 'PATCH', path: '/api/admin/testimonials/:id', perm: 'opportunity.review',
    handler({ repo, params, body }) {
      const t = repo.getTestimonial(params.id);
      if (!t) throw notFound();
      if (!body || !['pending', 'approved', 'declined'].includes(body.status)) throw badRequest('Unknown status');
      repo.updateTestimonial(params.id, { status: body.status });
      return { testimonial: repo.getTestimonial(params.id) };
    },
  },
];

export { validateTestimonial };
