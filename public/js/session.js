import { api, setCsrf, setUnauthorizedHandler } from './api.js';

/** Who is signed in. The server is the source of truth; this is a cache of GET /api/session. */
const state = { user: null, demoMode: false, devInbox: false, ready: false };
const subs = new Set();
const emit = () => subs.forEach((fn) => fn());

function apply(data) {
  state.user = data.user || null;
  if (data.demoMode !== undefined) state.demoMode = data.demoMode;
  if (data.devInbox !== undefined) state.devInbox = data.devInbox;
  setCsrf(data.csrfToken);
  state.ready = true;
  emit();
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null; setCsrf(null); emit();
  location.hash = `#/login?next=${encodeURIComponent(currentPath())}&expired=1`;
});

export const currentPath = () => (location.hash.slice(1).split('?')[0] || '/');

export const session = {
  get user() { return state.user; },
  get demoMode() { return state.demoMode; },
  get devInbox() { return state.devInbox; },
  get ready() { return state.ready; },
  can: (perm) => !!state.user?.permissions?.includes(perm),
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

  async init() {
    try { apply(await api.get('/api/session')); }
    catch { state.ready = true; emit(); } // offline or server down: behave as signed out, pages show their own errors
  },
  async login(email, password) { apply(await api.post('/api/auth/login', { email, password })); },
  async register(input) { apply(await api.post('/api/auth/register', input)); },
  async deleteAccount(password) { await api.del('/api/me', { password }); state.user = null; setCsrf(null); emit(); },
  async logout() { try { await api.post('/api/auth/logout'); } finally { state.user = null; setCsrf(null); emit(); } },
  /** Re-reads /api/session (used after confirming an email in another tab or from a link). */
  refresh: async () => { try { apply(await api.get('/api/session')); } catch { /* keep current state */ } },
  async resendVerification() { return api.post('/api/auth/verify/request'); },
  async updateProfile(patch) { const { user } = await api.patch('/api/me', patch); state.user = user; emit(); return user; },
};

/** Only same-app hash paths are valid post-login destinations (never external URLs). */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/discover';
}
