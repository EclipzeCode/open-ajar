/** Thin fetch wrapper: JSON in/out, CSRF header, and typed errors the UI can render. */
export class ApiError extends Error {
  constructor(status, message, errors) { super(message); this.status = status; this.errors = errors || {}; }
}

let csrf = '';
let onUnauthorized = () => {};
export const setCsrf = (t) => { csrf = t || ''; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'You appear to be offline, or the server can’t be reached.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/session') onUnauthorized();
    throw new ApiError(res.status, data?.error || 'Something went wrong. Please try again.', data?.errors);
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  put: (p, b, o) => request('PUT', p, b ?? {}, o),
  patch: (p, b, o) => request('PATCH', p, b ?? {}, o),
  del: (p, b, o) => request('DELETE', p, b, o),
};
