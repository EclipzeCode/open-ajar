import { validateProfile, validateTracked } from '../validation/validate.js';
import { verifyPassword } from '../auth/passwords.js';
import { endSession } from '../http/session.js';
import { publicDto, ownerDto } from '../services/opportunities.js';
import { notFound, badRequest, invalid, conflict } from '../http/errors.js';
import { userDto } from './auth.js';

const UUID = /^[0-9a-f-]{36}$/i;

export const meRoutes = [
  {
    method: 'PATCH', path: '/api/me', perm: 'profile.edit',
    handler({ repo, user, body }) {
      if (!body || typeof body !== 'object') throw badRequest('Expected a JSON body');
      const p = validateProfile(body);
      if (p.displayName !== undefined) repo.updateUser(user.id, { displayName: p.displayName });
      if (p.emailReminders !== undefined) repo.updateUser(user.id, { emailReminders: p.emailReminders });
      if (p.grade !== undefined || p.interests !== undefined || p.location !== undefined) repo.upsertProfile(user.id, p);
      return { user: userDto(repo, repo.getUserById(user.id)) };
    },
  },

  {
    // Permanently deletes the signed-in user's account. Requires the current password as a confirmation.
    // Community-submitted listings are kept (their submitter link is nulled), so deleting an account never removes
    // opportunities other students rely on.
    method: 'DELETE', path: '/api/me', perm: 'profile.edit', limit: 'auth',
    async handler(ctx) {
      const { repo, user, body } = ctx;
      const password = body && typeof body.password === 'string' ? body.password.slice(0, 128) : '';
      if (!(await verifyPassword(password, user.passwordHash))) throw invalid({ password: 'Enter your current password to confirm' });
      if (user.role === 'admin' && repo.countAdmins() <= 1) throw conflict('You are the only admin. Make someone else an admin before deleting your account.');
      repo.addAudit({ actorId: user.id, action: 'account_deleted', targetType: 'user', targetId: user.id, detail: { email: user.email } });
      repo.deleteUser(user.id);   // cascades sessions, profile, saved, tracked, and reset/verify tokens
      endSession(ctx);
      return { ok: true };
    },
  },

  {
    // Everything the tracker needs in one round trip, including listings that have since closed.
    method: 'GET', path: '/api/me/library', perm: 'library.manage',
    handler({ repo, user }) {
      const lib = repo.getLibrary(user.id);
      return { saved: lib.saved, tracked: lib.tracked, opportunities: lib.opportunities.map(publicDto) };
    },
  },

  {
    method: 'PUT', path: '/api/me/saved/:id', perm: 'library.manage',
    handler({ repo, user, params }) {
      if (!repo.getPublicOpportunity(params.id)) throw notFound('That opportunity isn’t available to save');
      repo.save(user.id, params.id);
      return { saved: true };
    },
  },
  {
    method: 'DELETE', path: '/api/me/saved/:id', perm: 'library.manage',
    handler({ repo, user, params }) { repo.unsave(user.id, params.id); return { saved: false }; },
  },

  {
    // Create or update a tracked entry. Creating seeds the checklist from the opportunity's requirements.
    method: 'PUT', path: '/api/me/tracked/:id', perm: 'library.manage',
    handler({ repo, user, params, body }) {
      if (!UUID.test(params.id)) throw notFound();
      const patch = validateTracked(body ?? {});
      const existing = repo.getTracked(user.id, params.id);
      if (!existing) {
        const opp = repo.getPublicOpportunity(params.id);
        if (!opp) throw notFound('That opportunity isn’t available to track');
        const entry = {
          stage: 'Interested', notes: '', deadline: '', addedAt: null,
          checklist: opp.requirements.map((text) => ({ text, done: false })), ...patch,
        };
        repo.upsertTracked(user.id, params.id, entry);
      } else {
        repo.upsertTracked(user.id, params.id, { ...existing, ...patch });
      }
      return { tracked: repo.getTracked(user.id, params.id) };
    },
  },
  {
    method: 'DELETE', path: '/api/me/tracked/:id', perm: 'library.manage',
    handler({ repo, user, params }) { repo.untrack(user.id, params.id); return { tracked: null }; },
  },

  {
    method: 'GET', path: '/api/me/submissions', perm: 'submission.read_own',
    handler({ repo, user }) {
      const items = repo.listBySubmitter(user.id).map(ownerDto);
      return { items: items.map((o) => ({ ...o, events: repo.listReviewEvents(o.id).filter((e) => e.message || ['approved', 'rejected', 'changes_requested', 'expired'].includes(e.toStatus)) })) };
    },
  },
];
