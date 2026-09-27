import { api } from './api.js';

/** Taxonomy (types, grades, costs, stages...) comes from the server so both sides always agree. */
export const META = {};
let pending = null;

export function ensureMeta() {
  if (!pending) {
    pending = api.get('/api/meta').then((m) => { Object.assign(META, m); return META; }).catch((e) => { pending = null; throw e; });
  }
  return pending;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DAY = 86400000;
export const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00:00`) - new Date(new Date().toDateString())) / DAY);

export function fmtDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, opts);
}

/** { text, soon } for a listing's deadline. */
export function deadlineInfo(o) {
  if (!o.deadlineDate) return { text: o.deadlineNote || 'Rolling', soon: false, dated: false };
  const d = daysUntil(o.deadlineDate);
  if (d < 0) return { text: `Closed ${fmtDate(o.deadlineDate)}`, soon: false, dated: true };
  const rel = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  return { text: `${fmtDate(o.deadlineDate)} · closes ${rel}`, soon: d <= 14, dated: true };
}

export const gradeLabel = (grades) => (grades.length === 4 ? 'Grades 9–12' : grades.length === 1 ? `Grade ${grades[0]}` : `Grades ${grades[0]}–${grades[grades.length - 1]}`);
