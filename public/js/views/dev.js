import { h } from '../dom.js';
import { skeletonRows, emptyState, errorState } from '../components/states.js';
import { api } from '../api.js';
import { session } from '../session.js';

/** DEVELOPMENT ONLY. Shows emails the console provider "sent", since nothing leaves the machine. */
export default function devInbox(ctx) {
  ctx.setTitle('Dev inbox');
  const root = h('div', { class: 'container' });
  if (!session.devInbox) {
    root.append(emptyState({ title: 'Not available', body: 'The dev inbox only exists when running locally without a real email provider.', actions: [h('a', { class: 'btn', href: '#/' }, 'Back to home')] }));
    return root;
  }
  const list = h('div', null, skeletonRows(2));
  const load = () => api.get('/api/dev/outbox').then(({ items }) => {
    list.replaceChildren(items.length ? h('ul', { class: 'inbox' }, items.map((m) => {
      const links = [...m.text.matchAll(/https?:\/\/[^\s]+#\/[^\s]+/g)].map((x) => x[0]);
      return h('li', { class: 'inbox__item' },
        h('div', { class: 'inbox__head' }, h('strong', null, m.subject), h('span', { class: 'muted' }, `To ${m.to} · ${new Date(m.at).toLocaleTimeString()}`)),
        h('pre', { class: 'inbox__body' }, m.text),
        links.map((l) => h('a', { class: 'btn btn--sm', href: l.slice(l.indexOf('#')) }, 'Open the link in this email')));
    })) : emptyState({ title: 'No emails yet', body: 'Create an account or use “Forgot your password?” and the email will appear here.' }));
  }).catch((e) => list.replaceChildren(errorState({ title: 'We couldn’t load the dev inbox', body: e.message, onRetry: load })));
  load();
  root.append(
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Development only'), h('h1', null, 'Dev inbox'),
      h('p', null, 'Nothing here was actually sent. Set RESEND_API_KEY to send real email, and this page disappears.')),
    h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: load }, 'Refresh'), list);
  return root;
}
