import { session } from './session.js';
import { library } from './library.js';
import { ensureMeta } from './meta.js';
import { mountHeader } from './components/header.js';
import home from './views/home.js';
import discover from './views/discover.js';
import detail from './views/detail.js';
import tracker from './views/tracker.js';
import about from './views/about.js';
import team from './views/team.js';
import { privacy, terms } from './views/legal.js';
import supportView from './views/support.js';
import submit from './views/submit.js';
import apply from './views/apply.js';
import account from './views/account.js';
import { login, register, forgot, reset, verify } from './views/auth.js';
import devInbox from './views/dev.js';
import { adminQueue, adminReview, adminUsers, adminActivity, adminInterns, adminVoices } from './views/admin.js';
import { h, observeReveals } from './dom.js';
import { errorState } from './components/states.js';

document.documentElement.classList.add('js');

const routes = [
  { re: /^\/$/, view: home, nav: null },
  { re: /^\/opportunities$/, view: discover, nav: 'opportunities', sector: 'opportunities' },
  { re: /^\/discover$/, view: discover, nav: 'opportunities', sector: 'opportunities' },
  { re: /^\/o\/([\w-]+)$/, view: detail, nav: null },
  { re: /^\/tracker$/, view: tracker, nav: 'tracker' },
  { re: /^\/submit(?:\/([\w-]+))?$/, view: submit, nav: 'submit' },
  { re: /^\/apply$/, view: apply, nav: 'apply' },
  { re: /^\/about$/, view: about, nav: 'about' },
  { re: /^\/team$/, view: team, nav: 'team' },
  { re: /^\/support$/, view: supportView, nav: 'support' },
  { re: /^\/privacy$/, view: privacy, nav: null },
  { re: /^\/terms$/, view: terms, nav: null },
  { re: /^\/login$/, view: login, nav: 'login' },
  { re: /^\/register$/, view: register, nav: 'login' },
  { re: /^\/forgot$/, view: forgot, nav: 'login' },
  { re: /^\/reset$/, view: reset, nav: 'login' },
  { re: /^\/verify$/, view: verify, nav: 'login' },
  { re: /^\/dev\/inbox$/, view: devInbox, nav: null },
  { re: /^\/account$/, view: account, nav: 'account' },
  { re: /^\/admin$/, view: adminQueue, nav: 'admin' },
  { re: /^\/admin\/users$/, view: adminUsers, nav: 'admin' },
  { re: /^\/admin\/activity$/, view: adminActivity, nav: 'admin' },
  { re: /^\/admin\/interns$/, view: adminInterns, nav: 'admin' },
  { re: /^\/admin\/voices$/, view: adminVoices, nav: 'admin' },
  { re: /^\/admin\/o\/([\w-]+)$/, view: adminReview, nav: 'admin' },
];

const app = document.getElementById('app');
const BASE_TITLE = 'Open Ajar';
let cleanups = [];
let first = true;

function parse() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, params: new URLSearchParams(qs) };
}
const currentNav = () => routes.find((r) => r.re.test(parse().path))?.nav ?? null;

function render() {
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanups = [];

  const { path, params } = parse();
  if (path === '/jobs') { location.replace('#/opportunities'); return; }
  const route = routes.find((r) => r.re.test(path));
  const ctx = {
    params,
    match: route ? path.match(route.re) : null,
    onCleanup: (fn) => cleanups.push(fn),
    sector: route ? route.sector || null : null,
    setTitle: (t) => { document.title = t ? `${t} | ${BASE_TITLE}` : `${BASE_TITLE}: Opportunity shouldn't depend on who you know`; },
  };

  let node;
  if (route) {
    ctx.setTitle(null);
    try { node = route.view(ctx); }
    catch (err) {
      console.error(err);
      node = h('div', { class: 'container' }, errorState({ title: 'This page hit a problem', body: 'Try reloading. If it keeps happening, let us know.', onRetry: () => location.reload() }));
    }
  } else {
    ctx.setTitle('Page not found');
    node = h('div', { class: 'container' }, h('div', { class: 'state' },
      h('h1', { tabindex: '-1' }, 'That door isn’t here'),
      h('p', null, 'The page you’re looking for doesn’t exist.'),
      h('div', { class: 'state__actions' }, h('a', { class: 'btn', href: '#/' }, 'Back to home'))));
  }

  node.classList.add('view');
  app.replaceChildren(node);
  observeReveals(app, ctx);

  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!first) {
    const target = app.querySelector('h1') || app;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  first = false;
  refreshHeader();
}

let refreshHeader = () => {};

async function boot() {
  const header = document.getElementById('site-header');
  const skip = document.querySelector('[data-skip]');
  skip.addEventListener('click', (e) => { e.preventDefault(); app.focus(); });
  document.getElementById('year').textContent = new Date().getFullYear();
  window.addEventListener('scroll', () => header.classList.toggle('is-stuck', window.scrollY > 8), { passive: true });

  refreshHeader = mountHeader(header, currentNav);
  app.setAttribute('aria-busy', 'true');

  // Session and taxonomy are needed before any view can render correctly.
  await Promise.allSettled([session.init(), ensureMeta()]);
  app.removeAttribute('aria-busy');

  try { await ensureMeta(); }
  catch {
    app.replaceChildren(h('div', { class: 'container' }, errorState({ title: 'We couldn’t reach Open Ajar', body: 'Check your connection and try again.', onRetry: () => location.reload() })));
    return;
  }

  if (session.devInbox) {
    const nav = document.querySelector('.site-footer nav');
    nav?.append(h('a', { href: '#/dev/inbox' }, 'Dev inbox'));
  }

  window.addEventListener('hashchange', render);
  render();
}

boot();
