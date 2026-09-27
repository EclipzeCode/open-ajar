import { api } from './api.js';
import { session, currentPath } from './session.js';
import { toast } from './components/toast.js';

/**
 * The signed-in student's saved and tracked opportunities, synced to the server.
 * Updates are optimistic (instant UI) and roll back with a message if the server refuses them.
 */
let state = { ready: false, saved: [], tracked: {}, opps: {} };
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());
let loading = null;

function reset() { state = { ready: false, saved: [], tracked: {}, opps: {} }; emit(); }

async function load() {
  if (!session.user) return reset();
  loading = api.get('/api/me/library').then((lib) => {
    state = { ready: true, saved: lib.saved, tracked: lib.tracked, opps: Object.fromEntries(lib.opportunities.map((o) => [o.id, o])) };
    emit();
  }).catch(() => { state.ready = true; emit(); });
  return loading;
}

let lastUser = null;
session.subscribe(() => {
  const id = session.user?.id ?? null;
  if (id !== lastUser) { lastUser = id; id ? load() : reset(); }
});

const needSignIn = (msg) => {
  toast(msg, { label: 'Sign in', onClick: () => { location.hash = `#/login?next=${encodeURIComponent(currentPath())}`; } });
};
const fail = (e, what) => { toast(e.message || `Couldn’t ${what}.`); return load(); };

const seedChecklist = (opp) => (opp?.requirements || []).map((text) => ({ text, done: false }));

export const library = {
  get ready() { return state.ready; },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  reload: load,
  whenReady: () => loading || Promise.resolve(),

  isSaved: (id) => state.saved.includes(id),
  savedIds: () => [...state.saved],
  trackedEntry: (id) => state.tracked[id] || null,
  trackedIds: () => Object.keys(state.tracked),
  opp: (id) => state.opps[id] || null,
  /** Distinct opportunities saved or tracked. */
  count: () => new Set([...state.saved, ...Object.keys(state.tracked)]).size,

  /** Returns the new saved state, or null if the student has to sign in first. */
  async toggleSave(opp) {
    if (!session.user) { needSignIn('Sign in to save opportunities and keep them across devices.'); return null; }
    const was = state.saved.includes(opp.id);
    state.opps[opp.id] ||= opp;
    state.saved = was ? state.saved.filter((x) => x !== opp.id) : [opp.id, ...state.saved];
    emit();
    try { await (was ? api.del(`/api/me/saved/${opp.id}`) : api.put(`/api/me/saved/${opp.id}`)); }
    catch (e) { await fail(e, 'update your saved list'); return was; }
    return !was;
  },

  async track(opp, stage = 'Interested') {
    if (!session.user) { needSignIn('Sign in to track applications.'); return false; }
    if (state.tracked[opp.id]) return true;
    state.opps[opp.id] ||= opp;
    state.tracked[opp.id] = { stage, notes: '', deadline: '', checklist: seedChecklist(opp), addedAt: new Date().toISOString() };
    emit();
    try {
      const { tracked } = await api.put(`/api/me/tracked/${opp.id}`, { stage });
      state.tracked[opp.id] = tracked; emit();
      return true;
    } catch (e) { await fail(e, 'start tracking'); return false; }
  },

  /** patch: { stage?, notes?, deadline?, checklist? }. silent skips re-render (used while typing notes). */
  async update(id, patch, { silent = false } = {}) {
    if (!state.tracked[id]) return;
    Object.assign(state.tracked[id], patch);
    if (!silent) emit();
    try { await api.put(`/api/me/tracked/${id}`, patch); }
    catch (e) { await fail(e, 'save your changes'); }
  },

  async untrack(id) {
    const prev = state.tracked[id];
    delete state.tracked[id]; emit();
    try { await api.del(`/api/me/tracked/${id}`); } catch (e) { await fail(e, 'stop tracking'); }
    return prev;
  },

  async restore(id, entry) {
    state.tracked[id] = entry; emit();
    try { await api.put(`/api/me/tracked/${id}`, { stage: entry.stage, notes: entry.notes, deadline: entry.deadline, checklist: entry.checklist }); }
    catch (e) { await fail(e, 'restore that'); }
  },
};
