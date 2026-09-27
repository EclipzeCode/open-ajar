import { validateOpportunity } from '../validation/validate.js';

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
const jaccard = (a, b) => { const x = tokens(a), y = tokens(b); if (!x.size || !y.size) return 0; let n = 0; for (const t of x) if (y.has(t)) n++; return n / (x.size + y.size - n); };
/** How much of the SHORTER title appears in the longer one (needs 3+ words, so short generic titles can't match loosely). */
const overlap = (a, b) => { const x = tokens(a), y = tokens(b); const m = Math.min(x.size, y.size); if (m < 3) return 0; let n = 0; for (const t of x) if (y.has(t)) n++; return n / m; };

/** Is this incoming row the same program as an existing listing? Exact title (+ same organization), or a same-link, near-identical title. */
export function findDuplicate(existing, { title, org, url }) {
  const t = norm(title), o = norm(org);
  for (const e of existing) if (norm(e.title) === t && (!o || !norm(e.org) || norm(e.org) === o)) return e;
  for (const e of existing) if (url && e.url === url && (jaccard(e.title, title) >= 0.75 || overlap(e.title, title) >= 0.9)) return e;
  return null;
}

/**
 * Runs a provider and adds its listings. Trust rules:
 *  - Real providers (anything without `demo: true`) are ALWAYS written as pending_review. Nothing an importer produces goes public.
 *  - Never overwrites what's live: an existing APPROVED listing is left exactly as it is.
 *  - Row ids are not trusted to be stable (spreadsheet exports get renumbered). A known id is only refreshed if it still
 *    names the same program; if the id now points at a different program it is reported as a conflict and skipped.
 *  - Rows that describe a program already listed (by title/organization or link) are skipped and reported as duplicates.
 *  - Invalid rows are skipped and reported, never partially saved.
 */
export async function runProvider(repo, provider, opts = {}) {
  const isDemo = provider.demo === true;
  const result = { created: 0, updated: 0, unchangedLive: 0, skipped: [], duplicates: [], conflicts: [] };
  const existing = repo.listForDedupe();

  for await (const item of provider.fetch(opts)) {
    const { externalId, status: wanted, group, importNote, ...fields } = item;
    const family = isDemo ? 'demo' : `import:${provider.name}`;
    const source = group ? `${family}:${group}` : family;
    if (!externalId) { result.skipped.push({ externalId, reason: 'missing externalId' }); continue; }

    let data;
    try { data = validateOpportunity({ ...fields, deadlineDate: fields.deadlineDate ?? null }); }
    catch (e) { result.skipped.push({ externalId, reason: JSON.stringify(e.details?.errors || e.message) }); continue; }

    const known = repo.findByExternal(family, String(externalId));
    if (known) {
      if (jaccard(known.title, data.title) < 0.5) { result.conflicts.push({ externalId, incoming: data.title, existing: known.title }); continue; }
      if (known.status === 'approved') { result.unchangedLive++; continue; }
      repo.updateOpportunity(known.id, data);
      if (known.source !== source) repo.moveSource(known.id, source);
      result.updated++;
      continue;
    }

    const dup = findDuplicate(existing, { title: data.title, org: data.org, url: data.url });
    if (dup) { result.duplicates.push({ externalId, title: data.title, matches: dup.title, status: dup.status }); continue; }

    const status = isDemo ? (wanted || 'approved') : 'pending_review';
    const r = repo.createImported(source, String(externalId), data, {
      status, isDemo, verification: isDemo ? 'demo' : 'unreviewed', publishedAt: status === 'approved' ? new Date().toISOString() : null,
    });
    existing.push({ id: r.id, title: data.title, org: data.org, url: data.url, status, source, externalId: String(externalId) });
    repo.addReviewEvent({ opportunityId: r.id, actorId: null, action: 'imported', toStatus: status, message: importNote || `Imported from ${provider.name}` });
    result.created++;
  }
  return result;
}
