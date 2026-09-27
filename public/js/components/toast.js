import { h } from '../dom.js';

let timer;

/** Announces via the polite live region in index.html. Never steals focus. */
export function toast(message, action) {
  const region = document.getElementById('toast-region');
  clearTimeout(timer);
  const close = () => {
    const el = region.firstElementChild;
    if (!el) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  };
  const el = h('div', { class: 'toast' },
    h('span', null, message),
    action && h('button', { type: 'button', onclick: () => { action.onClick(); close(); } }, action.label));
  region.replaceChildren(el);
  timer = setTimeout(close, action ? 6000 : 3500);
}
