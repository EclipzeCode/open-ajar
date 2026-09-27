import { META } from '../validation/meta.js';
import { publicDto } from '../services/opportunities.js';
import { notFound } from '../http/errors.js';

const clampInt = (v, min, max, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
const only = (list, allowed) => list.filter((v) => allowed.includes(v));

export const publicRoutes = [
  {
    // Development only: shows emails recorded by the console provider. Absent when a real provider is configured or in production.
    method: 'GET', path: '/api/dev/outbox',
    handler({ config, mailer }) {
      if (config.production || config.emailProvider !== 'console') throw notFound();
      return { items: mailer.outbox || [] };
    },
  },
  { method: 'GET', path: '/api/meta', handler: () => META },

  {
    method: 'GET', path: '/api/opportunities',
    handler({ repo, query, queryAll }) {
      const limit = clampInt(query.limit, 1, 50, 20);
      const page = clampInt(query.page, 1, 1000, 1);
      const { items, total } = repo.listPublic({
        q: (query.q || '').slice(0, 100),
        types: only(queryAll('type'), META.types),
        grade: META.grades.includes(Number(query.grade)) ? Number(query.grade) : null,
        cost: only(queryAll('cost'), Object.keys(META.costs)),
        format: only(queryAll('format'), META.formats),
        commitment: only(queryAll('commitment'), META.commitments),
        interest: only(queryAll('interest'), META.interests),
        state: /^[A-Za-z]{2}$/.test(query.state || '') && META.states[query.state.toUpperCase()] ? query.state.toUpperCase() : null,
        sector: ['jobs', 'opportunities'].includes(query.sector) ? query.sector : undefined,
        sort: ['featured', 'deadline', 'title'].includes(query.sort) ? query.sort : 'featured',
        limit, offset: (page - 1) * limit,
      });
      const sector = ['jobs', 'opportunities'].includes(query.sector) ? query.sector : undefined;
      return { items: items.map(publicDto), total, page, pageSize: limit, facets: repo.publicFacets(sector) };
    },
  },

  {
    method: 'GET', path: '/api/opportunities/:id',
    handler({ repo, params }) {
      const o = repo.getPublicOpportunity(params.id);
      if (!o) throw notFound('That opportunity isn’t available. It may have closed or been removed.');
      return publicDto(o);
    },
  },
];
