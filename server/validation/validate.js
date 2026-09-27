import { META } from './meta.js';
import { invalid, badRequest } from '../http/errors.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
// Strip control characters (except newline/tab in multi-line fields) so stored text is always printable.
const clean = (s, multiline = false) => String(s).replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, '').trim();

export const isEmail = (s) => typeof s === 'string' && s.length <= 320 && EMAIL.test(s.trim());
export const normEmail = (s) => s.trim().toLowerCase();

export function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export function parseUrl(s) {
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

/**
 * Validates opportunity fields. Returns the cleaned value or throws a 422 with per-field errors.
 * Only whitelisted fields are ever copied, so clients can't set status, source, is_demo, etc.
 */
export function validateOpportunity(input, { admin = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Expected a JSON object');
  const errors = {};
  const out = {};

  const text = (key, { min = 0, max, label, multiline = false, required = true }) => {
    const raw = input[key];
    const v = raw == null ? '' : typeof raw === 'string' ? clean(raw, multiline) : null;
    if (v === null) { errors[key] = `${label} must be text`; return; }
    if (!v && !required) { out[key] = ''; return; }
    if (v.length < min) errors[key] = v ? `${label} needs at least ${min} characters` : `Enter ${label.toLowerCase()}`;
    else if (v.length > max) errors[key] = `${label} must be ${max} characters or fewer`;
    else out[key] = v;
  };
  const oneOf = (key, list, label) => {
    if (!list.includes(input[key])) errors[key] = `Choose ${label}`; else out[key] = input[key];
  };

  text('title', { min: 3, max: 140, label: 'Title' });
  text('org', { min: 2, max: 140, label: 'Organization' });
  oneOf('type', META.types, 'a type');
  text('summary', { min: 20, max: 600, label: 'Summary', multiline: true });
  text('eligibility', { min: 10, max: 600, label: 'Eligibility', multiline: true });
  oneOf('cost', Object.keys(META.costs), 'a cost');
  text('costNote', { max: 200, label: 'Cost note', required: false });
  oneOf('format', META.formats, 'a format');
  text('location', { min: 2, max: 200, label: 'Location' });
  oneOf('commitment', META.commitments, 'a commitment');
  text('commitmentNote', { max: 200, label: 'Commitment detail', required: false });
  text('deadlineNote', { max: 200, label: 'Deadline note', required: false });

  // Requirements: array or newline-separated string
  let reqs = input.requirements;
  if (typeof reqs === 'string') reqs = reqs.split('\n');
  if (!Array.isArray(reqs)) reqs = [];
  reqs = reqs.map((r) => (typeof r === 'string' ? clean(r) : '')).filter(Boolean);
  if (reqs.length > 12) errors.requirements = 'List up to 12 requirements';
  else if (reqs.some((r) => r.length > 300)) errors.requirements = 'Keep each requirement under 300 characters';
  else out.requirements = reqs;

  // Grades and interests
  const grades = Array.isArray(input.grades) ? [...new Set(input.grades.map(Number))].sort() : [];
  if (!grades.length || !grades.every((g) => META.grades.includes(g))) errors.grades = 'Choose at least one grade';
  else out.grades = grades;
  const interests = Array.isArray(input.interests) ? [...new Set(input.interests)] : [];
  if (!interests.every((i) => META.interests.includes(i))) errors.interests = 'Choose interests from the list';
  else out.interests = interests;

  // Deadline (optional) and URL (optional)
  if (input.deadlineDate) {
    const d = parseDate(input.deadlineDate);
    if (!d) errors.deadlineDate = 'Use a valid date';
    else if (d.getTime() > Date.now() + 3 * 365 * 864e5) errors.deadlineDate = 'That date is too far away';
    else out.deadlineDate = input.deadlineDate;
  } else out.deadlineDate = null;

  if (input.url) {
    const u = typeof input.url === 'string' && input.url.length <= 500 ? parseUrl(input.url.trim()) : null;
    if (!u) errors.url = 'Enter a full link starting with https://';
    else out.url = u;
  } else out.url = null;

  if (admin) {
    if (input.verification !== undefined) {
      if (!['unreviewed', 'source', 'verified'].includes(input.verification)) errors.verification = 'Choose a verification level';
      else out.verification = input.verification;
    }
    if (input.expiresAt) {
      const t = new Date(input.expiresAt);
      if (Number.isNaN(t.getTime())) errors.expiresAt = 'Use a valid date'; else out.expiresAt = t.toISOString();
    } else if (input.expiresAt === null || input.expiresAt === '') out.expiresAt = null;
  }

  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

/** Submitter-only fields, stored for reviewers and never shown publicly. */
export function validateSubmitterMeta(input) {
  const errors = {};
  const out = {};
  if (!META.relationships[input.relationship]) errors.relationship = 'Tell us how you’re connected'; else out.relationship = input.relationship;
  if (!isEmail(input.contactEmail)) errors.contactEmail = 'Enter an email a reviewer can reach'; else out.contactEmail = normEmail(input.contactEmail);
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

export function validateTracked(input) {
  if (!input || typeof input !== 'object') throw badRequest('Expected a JSON object');
  const out = {};
  const errors = {};
  if (input.stage !== undefined) { if (!META.stages.includes(input.stage)) errors.stage = 'Unknown stage'; else out.stage = input.stage; }
  if (input.notes !== undefined) { if (typeof input.notes !== 'string' || input.notes.length > 2000) errors.notes = 'Notes must be 2000 characters or fewer'; else out.notes = clean(input.notes, true); }
  if (input.deadline !== undefined) {
    if (input.deadline === '' || input.deadline === null) out.deadline = '';
    else if (!parseDate(input.deadline)) errors.deadline = 'Use a valid date'; else out.deadline = input.deadline;
  }
  if (input.checklist !== undefined) {
    const list = input.checklist;
    if (!Array.isArray(list) || list.length > 30 || list.some((c) => !c || typeof c.text !== 'string' || !clean(c.text) || c.text.length > 200)) errors.checklist = 'Checklist items must be 1–200 characters (30 max)';
    else out.checklist = list.map((c) => ({ text: clean(c.text), done: c.done === true }));
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

export function validateProfile(input) {
  const out = {};
  const errors = {};
  if (input.displayName !== undefined) {
    const n = typeof input.displayName === 'string' ? clean(input.displayName) : '';
    if (n.length < 1 || n.length > 80) errors.displayName = 'Use 1–80 characters'; else out.displayName = n;
  }
  if (input.grade !== undefined) {
    if (input.grade === null || input.grade === '') out.grade = null;
    else if (!META.grades.includes(Number(input.grade))) errors.grade = 'Choose a grade from 9 to 12'; else out.grade = Number(input.grade);
  }
  if (input.interests !== undefined) {
    if (!Array.isArray(input.interests) || !input.interests.every((i) => META.interests.includes(i))) errors.interests = 'Choose interests from the list';
    else out.interests = [...new Set(input.interests)];
  }
  if (input.emailReminders !== undefined) {
    if (typeof input.emailReminders !== 'boolean') errors.emailReminders = 'Invalid value'; else out.emailReminders = input.emailReminders;
  }
  if (input.location !== undefined) {
    const l = typeof input.location === 'string' ? clean(input.location) : null;
    if (l === null || l.length > 120) errors.location = 'Use 120 characters or fewer'; else out.location = l;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}
