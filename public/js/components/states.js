import { h } from '../dom.js';

export function skeletonRows(n = 4) {
  return h('div', { role: 'status', 'aria-label': 'Loading opportunities' },
    Array.from({ length: n }, () => h('div', { class: 'skel-row', 'aria-hidden': 'true' },
      h('div', { class: 'skeleton skel-line skel-line--md' }),
      h('div', { class: 'skeleton skel-line skel-line--lg' }),
      h('div', { class: 'skeleton skel-line skel-line--full' }))));
}

export function errorState({ title = 'We couldn’t load the opportunities', body, onRetry }) {
  const retry = h('button', { type: 'button', class: 'btn', onclick: () => { retry.classList.add('is-loading'); retry.textContent = 'Trying again'; onRetry(); } }, 'Try again');
  return h('div', { class: 'state state--error', role: 'alert' },
    h('h2', null, title),
    h('p', null, body || 'Check your connection and try again. If the problem continues, the listings file may be unavailable, or the page may have been opened straight from disk instead of a web server.'),
    h('div', { class: 'state__actions' }, retry));
}

export function emptyState({ title, body, actions = [] }) {
  return h('div', { class: 'state' },
    h('div', { class: 'mini-door', 'aria-hidden': 'true' }),
    h('h2', null, title),
    h('p', null, body),
    actions.length ? h('div', { class: 'state__actions' }, actions) : null);
}
