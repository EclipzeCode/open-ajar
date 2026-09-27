import { createOpportunityService, adminDto, TRANSITIONS } from '../services/opportunities.js';
import { ROLES } from '../auth/rbac.js';
import { META } from '../validation/meta.js';
import { notFound, conflict, forbidden, badRequest } from '../http/errors.js';

const svc = (repo) => createOpportunityService(repo);
const REVIEW = { perm: 'opportunity.review' };

export const adminRoutes = [
  {
    method: 'GET', path: '/api/admin/summary', ...REVIEW,
    handler({ repo }) { repo.expireDue(); return { counts: repo.countsByStatus(), statuses: META.statuses, oldestPendingAt: repo.oldestPendingAt() }; },
  },
  {
    method: 'GET', path: '/api/admin/activity', ...REVIEW,
    handler({ repo, user }) { return { items: repo.recentActivity(50).filter((e) => e.kind === 'review' || user.role === 'admin') }; },
  },
  {
    method: 'GET', path: '/api/admin/opportunities', ...REVIEW,
    handler({ repo, query }) {
      const status = Object.keys(META.statuses).includes(query.status) ? query.status : undefined;
      const source = typeof query.source === 'string' && /^[\w:.-]{1,60}$/.test(query.source) ? query.source : undefined;
      const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 100));
      return { items: repo.listByStatus({ status, source, q: (query.q || '').slice(0, 100), limit }).map(adminDto), sources: status ? repo.sourceCounts(status) : [] };
    },
  },
  {
    // Approve many at once (e.g. a reviewed import). Approve only: rejecting or requesting changes needs a per-listing message.
    // Each listing goes through the same state machine as a single approval; failures are reported, not fatal.
    method: 'POST', path: '/api/admin/opportunities/bulk-approve', ...REVIEW,
    handler({ repo, user, body }) {
      const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))] : [];
      if (!ids.length) throw badRequest('Select at least one listing');
      if (ids.length > 200) throw badRequest('Approve up to 200 listings at a time');
      const results = { approved: [], failed: [] };
      for (const id of ids) {
        try { svc(repo).decide(user, id, 'approve'); results.approved.push(id); }
        catch (e) { results.failed.push({ id, reason: e.message }); }
      }
      repo.addAudit({ actorId: user.id, action: 'bulk_approve', targetType: 'opportunities', targetId: `${results.approved.length}`, detail: { approved: results.approved.length, failed: results.failed.length } });
      return results;
    },
  },
  {
    method: 'GET', path: '/api/admin/opportunities/:id', ...REVIEW,
    handler({ repo, params }) {
      const o = repo.getOpportunity(params.id);
      if (!o) throw notFound();
      const submitter = o.submittedBy ? repo.getUserById(o.submittedBy) : null;
      return {
        opportunity: adminDto(o), events: repo.listReviewEvents(o.id),
        submitter: submitter ? { id: submitter.id, displayName: submitter.displayName, email: submitter.email } : null,
        allowedActions: Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(o.status)).map(([a]) => a),
      };
    },
  },
  {
    method: 'PATCH', path: '/api/admin/opportunities/:id', ...REVIEW,
    handler({ repo, user, params, body }) { return { opportunity: adminDto(svc(repo).adminEdit(user, params.id, body)) }; },
  },
  {
    method: 'POST', path: '/api/admin/opportunities/:id/decision', ...REVIEW,
    handler({ repo, user, params, body }) {
      if (!body || typeof body.action !== 'string') throw badRequest('Choose an action');
      const opp = svc(repo).decide(user, params.id, body.action, body.message);
      return { opportunity: adminDto(opp), events: repo.listReviewEvents(opp.id) };
    },
  },

  {
    method: 'GET', path: '/api/admin/users', perm: 'user.manage',
    handler({ repo }) { return { users: repo.listUsers(), roles: ROLES }; },
  },
  {
    method: 'PATCH', path: '/api/admin/users/:id', perm: 'user.manage',
    handler({ repo, user, params, body }) {
      const target = repo.getUserById(params.id);
      if (!target) throw notFound();
      if (!body || typeof body !== 'object') throw badRequest('Expected a JSON body');
      const patch = {};
      if (body.role !== undefined) { if (!ROLES.includes(body.role)) throw badRequest('Unknown role'); patch.role = body.role; }
      if (body.disabled !== undefined) patch.disabled = body.disabled === true;
      if (target.id === user.id && (patch.role !== undefined && patch.role !== 'admin' || patch.disabled)) throw forbidden('You can’t demote or disable your own account');
      const losesAdmin = target.role === 'admin' && (patch.role && patch.role !== 'admin' || patch.disabled);
      if (losesAdmin && repo.countAdmins() <= 1) throw conflict('That would leave no active admin');
      repo.transaction(() => {
        repo.updateUser(target.id, patch);
        if (patch.disabled || (patch.role && patch.role !== target.role)) repo.deleteUserSessions(target.id); // force re-auth with new permissions
        repo.addAudit({ actorId: user.id, action: 'user_updated', targetType: 'user', targetId: target.id, detail: { from: { role: target.role, disabled: target.disabled }, to: patch } });
      });
      const u = repo.getUserById(target.id);
      return { user: { id: u.id, email: u.email, role: u.role, displayName: u.displayName, disabled: u.disabled } };
    },
  },
];
