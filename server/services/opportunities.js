import { badRequest, conflict, forbidden, notFound, invalid } from '../http/errors.js';
import { validateOpportunity, validateSubmitterMeta } from '../validation/validate.js';

/** What the public (and any signed-in student) may see. Never leaks submitter, contact, review or source details. */
export function publicDto(o) {
  return {
    id: o.id, title: o.title, org: o.org, type: o.type, summary: o.summary, eligibility: o.eligibility,
    requirements: o.requirements, interests: o.interests, grades: o.grades, cost: o.cost, costNote: o.costNote,
    format: o.format, location: o.location, state: o.state, commitment: o.commitment, commitmentNote: o.commitmentNote,
    deadlineDate: o.deadlineDate, deadlineNote: o.deadlineNote, url: o.url,
    verification: o.isDemo ? 'demo' : o.verification, isDemo: o.isDemo, publishedAt: o.publishedAt,
    ...(o.available !== undefined ? { available: o.available } : {}),
  };
}

/** Owner view: public fields plus their own submission status and reviewer message. */
export const ownerDto = (o) => ({
  ...publicDto(o), status: o.status, reviewerMessage: o.reviewerMessage, relationship: o.relationship,
  contactEmail: o.contactEmail, createdAt: o.createdAt, updatedAt: o.updatedAt,
});

/** Admin view: everything. */
export const adminDto = (o) => ({ ...ownerDto(o), source: o.source, externalId: o.externalId, submittedBy: o.submittedBy, expiresAt: o.expiresAt, sortOrder: o.sortOrder, rawVerification: o.verification });

/** Allowed review transitions: action -> { from: [...], to } */
export const TRANSITIONS = {
  approve: { from: ['pending_review', 'changes_requested', 'expired'], to: 'approved' },
  reject: { from: ['pending_review', 'changes_requested', 'expired', 'approved'], to: 'rejected', needsMessage: true },
  request_changes: { from: ['pending_review', 'approved'], to: 'changes_requested', needsMessage: true },
  expire: { from: ['approved'], to: 'expired' },
  reopen: { from: ['rejected', 'expired'], to: 'pending_review' },
};

const dayAfter = (date) => new Date(new Date(`${date}T00:00:00Z`).getTime() + 2 * 864e5).toISOString();

export function createOpportunityService(repo) {
  return {
    submit(user, input) {
      const data = { ...validateOpportunity(input), ...validateSubmitterMeta(input) };
      const id = repo.createOpportunity(data, { status: 'pending_review', source: 'submission', submittedBy: user.id, verification: 'unreviewed' });
      repo.addReviewEvent({ opportunityId: id, actorId: user.id, action: 'submitted', toStatus: 'pending_review' });
      return repo.getOpportunity(id);
    },

    /** The submitter edits after "changes requested" and sends it back to review. */
    resubmit(user, id, input) {
      const opp = repo.getOpportunity(id);
      if (!opp || opp.submittedBy !== user.id) throw notFound();
      if (opp.status !== 'changes_requested') throw conflict('This submission can only be edited when changes have been requested');
      const data = { ...validateOpportunity(input), ...validateSubmitterMeta(input) };
      repo.transaction(() => {
        repo.updateOpportunity(id, data);
        repo.setOpportunityStatus(id, 'pending_review');
        repo.addReviewEvent({ opportunityId: id, actorId: user.id, action: 'resubmitted', fromStatus: 'changes_requested', toStatus: 'pending_review' });
      });
      return repo.getOpportunity(id);
    },

    adminEdit(admin, id, input) {
      const opp = repo.getOpportunity(id);
      if (!opp) throw notFound();
      const data = validateOpportunity(input, { admin: true });
      repo.transaction(() => {
        repo.updateOpportunity(id, data);
        repo.addReviewEvent({ opportunityId: id, actorId: admin.id, action: 'edited', fromStatus: opp.status, toStatus: opp.status });
      });
      return repo.getOpportunity(id);
    },

    decide(admin, id, action, message = '') {
      const rule = TRANSITIONS[action];
      if (!rule) throw badRequest('Unknown action');
      const opp = repo.getOpportunity(id);
      if (!opp) throw notFound();
      if (!rule.from.includes(opp.status)) throw conflict(`You can’t ${action.replace('_', ' ')} a listing that is ${opp.status.replace('_', ' ')}`);
      const msg = typeof message === 'string' ? message.trim().slice(0, 1000) : '';
      if (rule.needsMessage && msg.length < 5) throw invalid({ message: 'Explain your decision so the submitter knows what to do next (5+ characters)' });

      const extra = { reviewerMessage: rule.needsMessage ? msg : '' };
      if (action === 'approve') {
        extra.publishedAt = opp.publishedAt || new Date().toISOString();
        if (opp.verification === 'unreviewed') extra.verification = 'source';
        // A dated listing hides itself shortly after its deadline unless an admin set an explicit expiry.
        if (opp.deadlineDate && !opp.expiresAt) extra.expiresAt = dayAfter(opp.deadlineDate);
        if (opp.expiresAt && new Date(opp.expiresAt) <= new Date()) throw conflict('This listing’s expiry date has already passed. Edit the expiry before approving.');
      }
      repo.transaction(() => {
        repo.setOpportunityStatus(id, rule.to, extra);
        repo.addReviewEvent({ opportunityId: id, actorId: admin.id, action, fromStatus: opp.status, toStatus: rule.to, message: msg });
      });
      return repo.getOpportunity(id);
    },
  };
}
