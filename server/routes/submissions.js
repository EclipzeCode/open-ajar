import { createOpportunityService, ownerDto } from '../services/opportunities.js';
import { createLimiter } from '../http/ratelimit.js';
import { notFound, tooMany, HttpError } from '../http/errors.js';

const perUser = createLimiter({ windowMs: 60 * 60_000, max: 10 });
const svc = (repo) => createOpportunityService(repo);
/** Submitting requires a confirmed email: it gives reviewers a reachable, real person and slows spam. */
const needVerified = (user) => {
  if (!user.emailVerifiedAt) throw new HttpError(403, 'Confirm your email before submitting. We sent you a link when you signed up.', { code: 'email_unverified' });
};

export const submissionRoutes = [
  {
    method: 'POST', path: '/api/submissions', perm: 'submission.create',
    handler(ctx) {
      needVerified(ctx.user);
      // Anything submitted starts as pending_review: nothing becomes public without an admin's approval.
      if (!perUser.take(ctx.user.id)) throw tooMany('You’ve submitted several opportunities in the last hour. Please try again later.');
      const opp = svc(ctx.repo).submit(ctx.user, ctx.body);
      ctx.status = 201;
      return { submission: ownerDto(opp) };
    },
  },
  {
    method: 'GET', path: '/api/submissions/:id', perm: 'submission.read_own',
    handler({ repo, user, params }) {
      const opp = repo.getOpportunity(params.id);
      if (!opp || opp.submittedBy !== user.id) throw notFound();
      return { submission: ownerDto(opp), events: repo.listReviewEvents(opp.id) };
    },
  },
  {
    method: 'PUT', path: '/api/submissions/:id', perm: 'submission.create',
    handler({ repo, user, params, body }) {
      needVerified(user);
      return { submission: ownerDto(svc(repo).resubmit(user, params.id, body)) };
    },
  },
];
