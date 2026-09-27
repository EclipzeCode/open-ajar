/**
 * SQLite implementation of the Open Ajar repository.
 *
 * ALL SQL lives in this folder. Routes and services only call the methods returned here, so moving to
 * PostgreSQL means writing `repo/postgres/` with the same method names (see ../README.md).
 * Every statement is parameterized; user input is never concatenated into SQL.
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateFromLocation } from '../../util/states.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();
const json = (v) => JSON.stringify(v ?? []);
const parse = (s, fallback = []) => { try { return JSON.parse(s); } catch { return fallback; } };
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function oppFromRow(r) {
  if (!r) return null;
  return {
    id: r.id, title: r.title, org: r.org_name, type: r.type, summary: r.summary, eligibility: r.eligibility,
    requirements: parse(r.requirements), interests: parse(r.interests), grades: parse(r.grades),
    cost: r.cost, costNote: r.cost_note, format: r.format, location: r.location,
    commitment: r.commitment, commitmentNote: r.commitment_note, state: r.state,
    deadlineDate: r.deadline_date, deadlineNote: r.deadline_note, url: r.url,
    verification: r.verification, status: r.status, isDemo: !!r.is_demo, source: r.source, externalId: r.external_id,
    submittedBy: r.submitted_by, contactEmail: r.contact_email, relationship: r.relationship,
    reviewerMessage: r.reviewer_message, sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at, expiresAt: r.expires_at,
  };
}

const internFromRow = (r) => r && ({ id: r.id, fullName: r.full_name, email: r.email, grade: r.grade, school: r.school, location: r.location, interests: parse(r.interests), skills: r.skills, availability: r.availability, statement: r.statement, link: r.link, status: r.status, adminNote: r.admin_note, createdAt: r.created_at, updatedAt: r.updated_at });
const testimonialFromRow = (r) => r && ({ id: r.id, userId: r.user_id, name: r.author_name, role: r.role_label, quote: r.quote, status: r.status, isDemo: !!r.is_demo, createdAt: r.created_at, updatedAt: r.updated_at });
const userFromRow = (r) => r && ({ id: r.id, email: r.email, passwordHash: r.password_hash, role: r.role, displayName: r.display_name, disabled: !!r.disabled, emailVerifiedAt: r.email_verified_at, emailReminders: r.email_reminders == null ? true : !!r.email_reminders, createdAt: r.created_at });

const OPP_COLUMNS = {
  title: 'title', org: 'org_name', type: 'type', summary: 'summary', eligibility: 'eligibility', cost: 'cost', costNote: 'cost_note',
  format: 'format', location: 'location', commitment: 'commitment', commitmentNote: 'commitment_note', deadlineDate: 'deadline_date',
  deadlineNote: 'deadline_note', url: 'url', verification: 'verification', expiresAt: 'expires_at', reviewerMessage: 'reviewer_message',
  contactEmail: 'contact_email', relationship: 'relationship', sortOrder: 'sort_order',
};
const OPP_JSON = { requirements: 'requirements', interests: 'interests', grades: 'grades' };

export function createSqliteRepo({ path: dbPath }) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  // Lightweight migrations for databases created before a column existed.
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  const oppCols = db.prepare('PRAGMA table_info(opportunities)').all().map((c) => c.name);
  if (!oppCols.includes('state')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN state TEXT');
    const upd = db.prepare('UPDATE opportunities SET state=? WHERE id=?');
    db.exec('BEGIN'); for (const r of db.prepare('SELECT id, location FROM opportunities').all()) upd.run(stateFromLocation(r.location), r.id); db.exec('COMMIT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_opp_state ON opportunities(state)');
  if (!cols.includes('email_reminders')) db.exec('ALTER TABLE users ADD COLUMN email_reminders INTEGER NOT NULL DEFAULT 1');
  const trackedCols = db.prepare('PRAGMA table_info(tracked)').all().map((c) => c.name);
  if (!trackedCols.includes('reminded_at')) db.exec('ALTER TABLE tracked ADD COLUMN reminded_at TEXT');
  if (!trackedCols.includes('reminded_for')) db.exec('ALTER TABLE tracked ADD COLUMN reminded_for TEXT');
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  /** WHERE clause shared by public listing and facets: approved and not expired. */
  const PUBLIC = "o.status = 'approved' AND (o.expires_at IS NULL OR o.expires_at > ?)";

  return {
    kind: 'sqlite',
    close: () => db.close(),
    transaction: tx,

    // ---------------- users ----------------
    countUsers: () => q('SELECT COUNT(*) n FROM users').get().n,
    createUser({ email, passwordHash, displayName, role = 'student', emailVerified = false }) {
      const id = crypto.randomUUID(), t = now();
      tx(() => {
        q('INSERT INTO users (id,email,password_hash,role,display_name,email_verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, email, passwordHash, role, displayName, emailVerified ? t : null, t, t);
        q('INSERT INTO profiles (user_id, updated_at) VALUES (?,?)').run(id, t);
      });
      return id;
    },
    getUserByEmail: (email) => userFromRow(q('SELECT * FROM users WHERE email = ?').get(email)),
    getUserById: (id) => userFromRow(q('SELECT * FROM users WHERE id = ?').get(id)),
    listUsers: () => q('SELECT id,email,role,display_name,disabled,email_verified_at,created_at FROM users ORDER BY created_at DESC LIMIT 500').all()
      .map((r) => ({ id: r.id, email: r.email, role: r.role, displayName: r.display_name, disabled: !!r.disabled, emailVerified: !!r.email_verified_at, createdAt: r.created_at })),
    countAdmins: () => q("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0").get().n,
    /** Deletes a user and everything owned by them. Submitted opportunities remain (submitted_by is nulled by FK), so
     * community listings are not lost; review-event and audit actor references are nulled/kept per the schema. */
    deleteUser: (id) => q('DELETE FROM users WHERE id=?').run(id).changes,
    markEmailVerified: (id) => q('UPDATE users SET email_verified_at=COALESCE(email_verified_at,?), updated_at=? WHERE id=?').run(now(), now(), id),
    updateUser(id, { role, disabled, displayName, passwordHash, emailReminders }) {
      const sets = [], vals = [];
      if (role !== undefined) { sets.push('role=?'); vals.push(role); }
      if (disabled !== undefined) { sets.push('disabled=?'); vals.push(disabled ? 1 : 0); }
      if (displayName !== undefined) { sets.push('display_name=?'); vals.push(displayName); }
      if (passwordHash !== undefined) { sets.push('password_hash=?'); vals.push(passwordHash); }
      if (emailReminders !== undefined) { sets.push('email_reminders=?'); vals.push(emailReminders ? 1 : 0); }
      if (!sets.length) return;
      q(`UPDATE users SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(...vals, now(), id);
    },

    getProfile(userId) {
      const r = q('SELECT * FROM profiles WHERE user_id=?').get(userId);
      return r ? { grade: r.grade, interests: parse(r.interests), location: r.location } : { grade: null, interests: [], location: '' };
    },
    upsertProfile(userId, { grade, interests, location }) {
      const cur = this.getProfile(userId);
      q(`INSERT INTO profiles (user_id,grade,interests,location,updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET grade=excluded.grade, interests=excluded.interests, location=excluded.location, updated_at=excluded.updated_at`)
        .run(userId, grade !== undefined ? grade : cur.grade, json(interests ?? cur.interests), location ?? cur.location, now());
    },

    // ---------------- sessions ----------------
    createSession({ idHash, userId, csrf, expiresAt, userAgent }) {
      const t = now();
      q('INSERT INTO sessions (id,user_id,csrf,created_at,expires_at,last_seen_at,user_agent) VALUES (?,?,?,?,?,?,?)').run(idHash, userId, csrf, t, expiresAt, t, (userAgent || '').slice(0, 200));
    },
    getSession(idHash) {
      const r = q('SELECT * FROM sessions WHERE id=?').get(idHash);
      return r ? { id: r.id, userId: r.user_id, csrf: r.csrf, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at } : null;
    },
    touchSession: (idHash) => q('UPDATE sessions SET last_seen_at=? WHERE id=?').run(now(), idHash),
    deleteSession: (idHash) => q('DELETE FROM sessions WHERE id=?').run(idHash),
    deleteUserSessions(userId, exceptIdHash = '') { q('DELETE FROM sessions WHERE user_id=? AND id<>?').run(userId, exceptIdHash); },
    purgeExpiredSessions: () => q('DELETE FROM sessions WHERE expires_at < ?').run(now()),

    // ---------------- email verification / password reset tokens ----------------
    /** Issues a token, invalidating any earlier unused one for the same user and purpose. */
    createAuthToken({ idHash, userId, purpose, expiresAt }) {
      tx(() => {
        q('DELETE FROM auth_tokens WHERE user_id=? AND purpose=? AND used_at IS NULL').run(userId, purpose);
        q('INSERT INTO auth_tokens (id,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').run(idHash, userId, purpose, expiresAt, now());
      });
    },
    /** Looks at a token without spending it. Returns the user id or null. */
    peekAuthToken(idHash, purpose) {
      const r = q('SELECT * FROM auth_tokens WHERE id=? AND purpose=?').get(idHash, purpose);
      return !r || r.used_at || new Date(r.expires_at) <= new Date() ? null : r.user_id;
    },
    /** Atomically spends a valid token. Returns the user id, or null if unknown, used, expired or the wrong purpose. */
    consumeAuthToken(idHash, purpose) {
      return tx(() => {
        const r = q('SELECT * FROM auth_tokens WHERE id=? AND purpose=?').get(idHash, purpose);
        if (!r || r.used_at || new Date(r.expires_at) <= new Date()) return null;
        q('UPDATE auth_tokens SET used_at=? WHERE id=?').run(now(), idHash);
        return r.user_id;
      });
    },
    purgeExpiredTokens: () => q('DELETE FROM auth_tokens WHERE expires_at < ? OR used_at IS NOT NULL').run(new Date(Date.now() - 864e5).toISOString()),

    // ---------------- opportunities ----------------
    getOpportunity: (id) => oppFromRow(q('SELECT * FROM opportunities o WHERE id=?').get(id)),
    getPublicOpportunity: (id) => oppFromRow(q(`SELECT o.* FROM opportunities o WHERE o.id=? AND ${PUBLIC}`).get(id, now())),
    countOpportunities: () => q('SELECT COUNT(*) n FROM opportunities').get().n,

    listPublic(opts) {
      const { q: text = '', types = [], grade, cost = [], format = [], commitment = [], interest = [], sort = 'featured', limit = 20, offset = 0 } = opts;
      const where = [PUBLIC], params = [now()];
      const tokens = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
      for (const tok of tokens) {
        const like = `%${likeEscape(tok)}%`;
        where.push(`(lower(o.title) LIKE ? ESCAPE '\\' OR lower(o.org_name) LIKE ? ESCAPE '\\' OR lower(o.summary) LIKE ? ESCAPE '\\' OR lower(o.type) LIKE ? ESCAPE '\\' OR lower(o.location) LIKE ? ESCAPE '\\' OR lower(o.interests) LIKE ? ESCAPE '\\')`);
        params.push(like, like, like, like, like, like);
      }
      const inList = (col, list) => { if (list.length) { where.push(`${col} IN (${list.map(() => '?').join(',')})`); params.push(...list); } };
      inList('o.type', types); inList('o.cost', cost); inList('o.format', format); inList('o.commitment', commitment);
      if (grade) { where.push('EXISTS (SELECT 1 FROM json_each(o.grades) g WHERE g.value = ?)'); params.push(Number(grade)); }
      if (opts.state) { where.push('o.state = ?'); params.push(opts.state); }
      if (opts.sector === 'jobs') where.push("o.type = 'Job'");
      else if (opts.sector === 'opportunities') where.push("o.type <> 'Job'");
      if (interest.length) { where.push(`EXISTS (SELECT 1 FROM json_each(o.interests) i WHERE i.value IN (${interest.map(() => '?').join(',')}))`); params.push(...interest); }

      const orderParams = [];
      let order = 'o.sort_order ASC, o.published_at DESC';
      if (sort === 'deadline') order = '(o.deadline_date IS NULL) ASC, o.deadline_date ASC, o.title ASC';
      else if (sort === 'title') order = 'lower(o.title) ASC';
      else if (tokens.length) { order = "(CASE WHEN lower(o.title) LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END) ASC, " + order; orderParams.push(`%${likeEscape(tokens[0])}%`); }

      const W = where.join(' AND ');
      const total = q(`SELECT COUNT(*) n FROM opportunities o WHERE ${W}`).get(...params).n;
      const rows = q(`SELECT o.* FROM opportunities o WHERE ${W} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, ...orderParams, limit, offset);
      return { items: rows.map(oppFromRow), total };
    },

    publicFacets(sector) {
      const t = now();
      const sec = sector === 'jobs' ? " AND o.type = 'Job'" : sector === 'opportunities' ? " AND o.type <> 'Job'" : '';
      const scalar = (col) => Object.fromEntries(q(`SELECT o.${col} v, COUNT(*) n FROM opportunities o WHERE ${PUBLIC}${sec} GROUP BY o.${col}`).all(t).map((r) => [r.v, r.n]));
      const arr = (col) => Object.fromEntries(q(`SELECT j.value v, COUNT(*) n FROM opportunities o, json_each(o.${col}) j WHERE ${PUBLIC}${sec} GROUP BY j.value`).all(t).map((r) => [r.v, r.n]));
      const stateCounts = Object.fromEntries(q(`SELECT o.state v, COUNT(*) n FROM opportunities o WHERE ${PUBLIC}${sec} AND o.state IS NOT NULL GROUP BY o.state`).all(t).map((r) => [r.v, r.n]));
      return { type: scalar('type'), cost: scalar('cost'), format: scalar('format'), commitment: scalar('commitment'), interest: arr('interests'), grade: arr('grades'), state: stateCounts };
    },

    createOpportunity(data, { status = 'pending_review', source = 'submission', externalId = null, submittedBy = null, isDemo = false, verification, publishedAt = null } = {}) {
      const id = crypto.randomUUID(), t = now();
      q(`INSERT INTO opportunities (id,title,org_name,type,summary,eligibility,requirements,interests,grades,cost,cost_note,format,location,state,commitment,commitment_note,
          deadline_date,deadline_note,url,verification,status,is_demo,source,external_id,submitted_by,contact_email,relationship,sort_order,created_at,updated_at,published_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, data.title, data.org, data.type, data.summary, data.eligibility || '', json(data.requirements), json(data.interests), json(data.grades),
        data.cost, data.costNote || '', data.format, data.location || '', stateFromLocation(data.location), data.commitment, data.commitmentNote || '',
        data.deadlineDate ?? null, data.deadlineNote || '', data.url ?? null, verification ?? data.verification ?? 'unreviewed', status, isDemo ? 1 : 0, source, externalId,
        submittedBy, data.contactEmail ?? null, data.relationship ?? null, data.sortOrder ?? 100, t, t, publishedAt, data.expiresAt ?? null);
      return id;
    },

    updateOpportunity(id, patch) {
      const sets = [], vals = [];
      for (const [k, col] of Object.entries(OPP_COLUMNS)) if (patch[k] !== undefined) { sets.push(`${col}=?`); vals.push(patch[k]); }
      for (const [k, col] of Object.entries(OPP_JSON)) if (patch[k] !== undefined) { sets.push(`${col}=?`); vals.push(json(patch[k])); }
      if (patch.location !== undefined) { sets.push('state=?'); vals.push(stateFromLocation(patch.location)); }
      if (patch.publishedAt !== undefined) { sets.push('published_at=?'); vals.push(patch.publishedAt); }
      if (!sets.length) return;
      q(`UPDATE opportunities SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(...vals, now(), id);
    },
    setOpportunityStatus(id, status, extra = {}) {
      this.updateOpportunity(id, extra);
      q('UPDATE opportunities SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
    },

    /** Every listing's identity fields, for import de-duplication (the table is small; this runs in an admin script). */
    listForDedupe: () => q('SELECT id, title, org_name, url, status, source, external_id FROM opportunities').all()
      .map((r) => ({ id: r.id, title: r.title, org: r.org_name, url: r.url, status: r.status, source: r.source, externalId: r.external_id })),
    /** Finds an imported row by upstream id within one provider family ("import:sheet" matches import:sheet:import and :recheck). */
    findByExternal(sourcePrefix, externalId) {
      const r = q('SELECT * FROM opportunities WHERE external_id=? AND (source=? OR source LIKE ?)').get(externalId, sourcePrefix, `${sourcePrefix}:%`);
      return oppFromRow(r);
    },
    /** Creates an imported listing. Refreshing existing rows is decided by the importer, which calls updateOpportunity itself. */
    createImported(source, externalId, data, opts) { return { id: this.createOpportunity(data, { ...opts, source, externalId }), created: true }; },
    moveSource: (id, source) => q('UPDATE opportunities SET source=? WHERE id=?').run(source, id),
    deleteDemoOpportunities: () => q('DELETE FROM opportunities WHERE is_demo=1').run().changes,

    listByStatus({ status, source, q: text = '', limit = 100, offset = 0 } = {}) {
      const where = [], params = [];
      if (status) { where.push('status=?'); params.push(status); }
      if (source) { where.push('source=?'); params.push(source); }
      if (text) { const like = `%${likeEscape(text.toLowerCase())}%`; where.push("(lower(title) LIKE ? ESCAPE '\\' OR lower(org_name) LIKE ? ESCAPE '\\')"); params.push(like, like); }
      const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return q(`SELECT * FROM opportunities ${W} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset).map(oppFromRow);
    },
    sourceCounts: (status) => q('SELECT source, COUNT(*) n FROM opportunities WHERE status=? GROUP BY source ORDER BY source').all(status).map((r) => ({ source: r.source, count: r.n })),
    countsByStatus: () => Object.fromEntries(q('SELECT status, COUNT(*) n FROM opportunities GROUP BY status').all().map((r) => [r.status, r.n])),
    listBySubmitter: (userId) => q('SELECT * FROM opportunities WHERE submitted_by=? ORDER BY updated_at DESC').all(userId).map(oppFromRow),
    /** Approved listings whose expires_at has passed: marked expired by the maintenance task. */
    expireDue() {
      return q("UPDATE opportunities SET status='expired', updated_at=? WHERE status='approved' AND expires_at IS NOT NULL AND expires_at <= ?").run(now(), now()).changes;
    },

    addReviewEvent({ opportunityId, actorId, action, fromStatus = null, toStatus = null, message = '' }) {
      q('INSERT INTO review_events (opportunity_id,actor_id,action,from_status,to_status,message,created_at) VALUES (?,?,?,?,?,?,?)').run(opportunityId, actorId, action, fromStatus, toStatus, message, now());
    },
    listReviewEvents: (opportunityId) => q(`SELECT e.*, u.display_name actor_name FROM review_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.opportunity_id=? ORDER BY e.id ASC`).all(opportunityId)
      .map((r) => ({ id: r.id, action: r.action, fromStatus: r.from_status, toStatus: r.to_status, message: r.message, actor: r.actor_name || 'System', createdAt: r.created_at })),
    recentActivity(limit = 40) {
      const events = q(`SELECT e.*, o.title, u.display_name actor_name FROM review_events e JOIN opportunities o ON o.id=e.opportunity_id LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT ?`).all(limit)
        .map((r) => ({ kind: 'review', id: `r${r.id}`, action: r.action, title: r.title, opportunityId: r.opportunity_id, actor: r.actor_name || 'System', message: r.message, at: r.created_at }));
      const audit = q(`SELECT a.*, u.display_name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?`).all(limit)
        .map((r) => ({ kind: 'audit', id: `a${r.id}`, action: r.action, title: `${r.target_type} ${r.target_id.slice(0, 8)}`, actor: r.actor_name || 'System', message: '', at: r.created_at }));
      return [...events, ...audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    },
    oldestPendingAt: () => q("SELECT MIN(created_at) t FROM opportunities WHERE status='pending_review'").get().t,
    addAudit: ({ actorId, action, targetType, targetId, detail = {} }) => q('INSERT INTO audit_log (actor_id,action,target_type,target_id,detail,created_at) VALUES (?,?,?,?,?,?)').run(actorId, action, targetType, targetId, JSON.stringify(detail), now()),

    // ---------------- library (saved + tracked) ----------------
    getLibrary(userId) {
      const saved = q('SELECT opportunity_id, created_at FROM saved WHERE user_id=? ORDER BY created_at DESC').all(userId).map((r) => r.opportunity_id);
      const tracked = {};
      for (const r of q('SELECT * FROM tracked WHERE user_id=?').all(userId)) {
        tracked[r.opportunity_id] = { stage: r.stage, notes: r.notes, deadline: r.deadline, checklist: parse(r.checklist), addedAt: r.added_at, updatedAt: r.updated_at };
      }
      const ids = [...new Set([...saved, ...Object.keys(tracked)])];
      const opportunities = ids.length
        ? q(`SELECT o.*, (o.status='approved' AND (o.expires_at IS NULL OR o.expires_at > ?)) AS available FROM opportunities o WHERE o.id IN (${ids.map(() => '?').join(',')})`).all(now(), ...ids)
          .map((r) => ({ ...oppFromRow(r), available: !!r.available }))
        : [];
      return { saved, tracked, opportunities };
    },
    save: (userId, oppId) => q('INSERT OR IGNORE INTO saved (user_id,opportunity_id,created_at) VALUES (?,?,?)').run(userId, oppId, now()),
    unsave: (userId, oppId) => q('DELETE FROM saved WHERE user_id=? AND opportunity_id=?').run(userId, oppId),
    getTracked(userId, oppId) {
      const r = q('SELECT * FROM tracked WHERE user_id=? AND opportunity_id=?').get(userId, oppId);
      return r && { stage: r.stage, notes: r.notes, deadline: r.deadline, checklist: parse(r.checklist), addedAt: r.added_at, updatedAt: r.updated_at };
    },
    upsertTracked(userId, oppId, entry) {
      const t = now();
      q(`INSERT INTO tracked (user_id,opportunity_id,stage,notes,deadline,checklist,added_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id,opportunity_id) DO UPDATE SET stage=excluded.stage, notes=excluded.notes, deadline=excluded.deadline, checklist=excluded.checklist, updated_at=excluded.updated_at`)
        .run(userId, oppId, entry.stage, entry.notes, entry.deadline, json(entry.checklist), entry.addedAt || t, t);
    },
    untrack: (userId, oppId) => q('DELETE FROM tracked WHERE user_id=? AND opportunity_id=?').run(userId, oppId),

    // ---------------- intern applications ----------------
    createInternApplication(a) {
      const id = crypto.randomUUID(), t = now();
      q(`INSERT INTO intern_applications (id,full_name,email,grade,school,location,interests,skills,availability,statement,link,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'new', ?, ?)`).run(
        id, a.fullName, a.email, a.grade ?? null, a.school || '', a.location || '', json(a.interests), a.skills || '', a.availability || '', a.statement || '', a.link ?? null, t, t);
      return id;
    },
    getInternApplication: (id) => internFromRow(q('SELECT * FROM intern_applications WHERE id=?').get(id)),
    listInternApplications({ status, limit = 300 } = {}) {
      const where = [], params = [];
      if (status) { where.push('status=?'); params.push(status); }
      const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return q(`SELECT * FROM intern_applications ${W} ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map(internFromRow);
    },
    internApplicationCounts: () => Object.fromEntries(q('SELECT status, COUNT(*) n FROM intern_applications GROUP BY status').all().map((r) => [r.status, r.n])),
    updateInternApplication(id, { status, adminNote }) {
      const sets = [], vals = [];
      if (status !== undefined) { sets.push('status=?'); vals.push(status); }
      if (adminNote !== undefined) { sets.push('admin_note=?'); vals.push(adminNote); }
      if (!sets.length) return;
      q(`UPDATE intern_applications SET ${sets.join(',')}, updated_at=? WHERE id=?`).run(...vals, now(), id);
    },

    // ---------------- community voices (testimonials) ----------------
    /** Each user has at most one testimonial. Submitting again replaces it and returns it to pending review. */
    upsertUserTestimonial({ userId, authorName, roleLabel, quote }) {
      const t = now();
      const existing = q('SELECT id FROM testimonials WHERE user_id=?').get(userId);
      if (existing) {
        q(`UPDATE testimonials SET author_name=?, role_label=?, quote=?, status='pending', updated_at=? WHERE id=?`)
          .run(authorName, roleLabel || '', quote, t, existing.id);
        return testimonialFromRow(q('SELECT * FROM testimonials WHERE id=?').get(existing.id));
      }
      const id = crypto.randomUUID();
      q(`INSERT INTO testimonials (id,user_id,author_name,role_label,quote,status,is_demo,created_at,updated_at)
         VALUES (?,?,?,?,?, 'pending', 0, ?, ?)`).run(id, userId, authorName, roleLabel || '', quote, t, t);
      return testimonialFromRow(q('SELECT * FROM testimonials WHERE id=?').get(id));
    },
    getUserTestimonial: (userId) => testimonialFromRow(q('SELECT * FROM testimonials WHERE user_id=?').get(userId)),
    getTestimonial: (id) => testimonialFromRow(q('SELECT * FROM testimonials WHERE id=?').get(id)),
    listPublicTestimonials: (limit = 24) => q("SELECT * FROM testimonials WHERE status='approved' ORDER BY is_demo ASC, updated_at DESC LIMIT ?").all(limit).map(testimonialFromRow),
    listTestimonials({ status, limit = 300 } = {}) {
      const where = [], params = [];
      if (status) { where.push('status=?'); params.push(status); }
      const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return q(`SELECT * FROM testimonials ${W} ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map(testimonialFromRow);
    },
    testimonialCounts: () => Object.fromEntries(q('SELECT status, COUNT(*) n FROM testimonials GROUP BY status').all().map((r) => [r.status, r.n])),
    updateTestimonial(id, { status }) {
      if (status === undefined) return;
      q('UPDATE testimonials SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
    },

    // ---------------- scheduler / reminders ----------------
    getMeta: (key) => { const r = q('SELECT value FROM app_meta WHERE key=?').get(key); return r ? r.value : null; },
    setMeta: (key, value) => q('INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)),
    /** Candidate tracked items for deadline reminders: live opp, early stage, verified opted-in user. Windowing is done in JS. */
    reminderCandidates: () => q(`SELECT t.user_id, t.opportunity_id, t.stage, t.deadline own_deadline, t.reminded_for,
             o.title, o.deadline_date, o.url, u.email, u.display_name
        FROM tracked t
        JOIN opportunities o ON o.id = t.opportunity_id AND o.status = 'approved'
        JOIN users u ON u.id = t.user_id
       WHERE u.disabled = 0 AND u.email_verified_at IS NOT NULL AND u.email_reminders = 1
         AND t.stage IN ('Interested','Preparing')`).all(),
    markReminded: (userId, oppId, deadline) => q('UPDATE tracked SET reminded_at=?, reminded_for=? WHERE user_id=? AND opportunity_id=?').run(now(), deadline, userId, oppId),
  };
}
