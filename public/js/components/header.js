import { h } from '../dom.js';
import { brandMark, BRAND_NAME } from './logo.js';
import { session } from '../session.js';
import { library } from '../library.js';

/** Renders the site header. Auth-aware: re-renders when the session or library changes. */
export function mountHeader(root, getRoute) {
  const render = () => {
    const user = session.user;
    const n = library.count();
    const active = getRoute();

    const link = (href, key, ...kids) => h('a', { href, 'data-nav': key, 'aria-current': active === key ? 'page' : null }, ...kids);
    const nav = h('nav', { class: 'site-nav', 'aria-label': 'Primary' },
      link('#/opportunities', 'opportunities', 'Opportunities'),
      h('a', { href: '#/apply', class: 'nav-support', 'data-nav': 'apply', 'aria-current': active === 'apply' ? 'page' : null }, 'Become an intern'),
      link('#/submit', 'submit', 'Submit'),
      link('#/tracker', 'tracker', 'Tracker', n ? h('span', { class: 'count', 'aria-hidden': 'true' }, n) : null),
      link('#/support', 'support', 'Support'),
      link('#/about', 'about', 'About'),
      link('#/team', 'team', 'Team'),
      user?.permissions.includes('opportunity.review') ? link('#/admin', 'admin', 'Review') : null,
      user
        ? link('#/account', 'account', h('span', { class: 'avatar', 'aria-hidden': 'true' }, (user.displayName || '?').slice(0, 1).toUpperCase()), h('span', { class: 'nav-account' }, 'Account'))
        : h('a', { href: '#/login', class: 'nav-signin', 'data-nav': 'login', 'aria-current': active === 'login' ? 'page' : null }, 'Sign in'));

    if (n) nav.querySelector('[data-nav="tracker"]').setAttribute('aria-label', `Tracker, ${n} ${n === 1 ? 'opportunity' : 'opportunities'} saved or tracked`);

    root.replaceChildren(h('div', { class: 'container site-header__inner' },
      h('a', { class: 'wordmark', href: '#/', 'aria-label': `${BRAND_NAME}, home` }, brandMark(), h('span', { class: 'wordmark__text' }, BRAND_NAME)),
      nav));
  };
  render();
  session.subscribe(render);
  library.subscribe(render);
  return render;
}
