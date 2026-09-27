import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { thresholdArt } from '../components/threshold.js';
import { input, formState, submitButton } from '../components/form.js';
import { session, safeNext } from '../session.js';
import { api, ApiError } from '../api.js';
import { toast } from '../components/toast.js';

function authShell({ title, lead, form, footer }) {
  return h('div', { class: 'container auth' },
    h('div', { class: 'auth__art', 'aria-hidden': 'true' }, thresholdArt({ frames: 5 })),
    h('div', { class: 'auth__panel' },
      h('h1', null, title),
      lead && h('p', { class: 'auth__lead' }, lead),
      form,
      footer && h('p', { class: 'auth__foot' }, footer)));
}

export function login(ctx) {
  ctx.setTitle('Sign in');
  if (session.user) { location.replace(`#${safeNext(ctx.params.get('next'))}`); return h('div'); }
  const next = safeNext(ctx.params.get('next'));
  const fields = [
    input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true }),
    input({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', required: true }),
  ];
  const state = formState(fields);
  const btn = submitButton('Sign in');
  const form = h('form', { class: 'auth__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); state.clearErrors();
    const v = state.values();
    const errs = {};
    if (!v.email.trim()) errs.email = 'Enter your email';
    if (!v.password) errs.password = 'Enter your password';
    if (Object.keys(errs).length) return state.showErrors(errs);
    btn.setBusy(true, 'Signing in…');
    try { await session.login(v.email, v.password); location.hash = `#${next}`; toast(`Welcome back, ${session.user.displayName.split(' ')[0]}`); }
    catch (err) { state.showErrors(err.errors, err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'); btn.setBusy(false); }
  } },
    ctx.params.get('expired') ? h('p', { class: 'auth__note', role: 'status' }, 'Your session ended. Please sign in again.') : null,
    ctx.params.get('reset') ? h('p', { class: 'auth__note', role: 'status' }, 'Your password was changed. Sign in with the new one.') : null,
    state.summary, ...fields.map((f) => f.el), h('div', { class: 'form-actions' }, btn, h('a', { class: 'link-arrow', href: '#/forgot' }, 'Forgot your password?')));

  return authShell({
    title: 'Welcome back.', lead: 'Sign in to see what you’ve saved and where each application stands.', form,
    footer: [ 'New here? ', h('a', { href: `#/register?next=${encodeURIComponent(next)}` }, 'Create an account') ],
  });
}

export function register(ctx) {
  ctx.setTitle('Create your account');
  if (session.user) { location.replace(`#${safeNext(ctx.params.get('next'))}`); return h('div'); }
  const next = safeNext(ctx.params.get('next'));
  const fields = [
    input({ name: 'displayName', label: 'Your name', autocomplete: 'name', required: true, maxlength: 80 }),
    input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true }),
    input({ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', required: true, help: 'At least 10 characters. A few words strung together works well.' }),
  ];
  const state = formState(fields);
  const btn = submitButton('Create account');
  const form = h('form', { class: 'auth__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); state.clearErrors();
    btn.setBusy(true, 'Creating…');
    try { await session.register(state.values()); location.hash = `#${next}`; toast(session.devInbox ? 'Account created. Email sending isn’t set up yet, so read your confirmation link in the Dev inbox (footer).' : 'Account created. Check your email to confirm your address.'); }
    catch (err) { state.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null); btn.setBusy(false); }
  } },
    state.summary, ...fields.map((f) => f.el),
    h('p', { class: 'help' }, 'Student accounts are free. Organizations and counselors: create an account, then submit from it. Dedicated portals are on the way.'),
    h('div', { class: 'form-actions' }, btn));

  return authShell({
    title: 'Start with an account.', lead: 'Save opportunities, keep notes, and track applications across every device.', form,
    footer: [ 'Already have one? ', h('a', { href: `#/login?next=${encodeURIComponent(next)}` }, 'Sign in') ],
  });
}

// ------------------------------------------------------------------ forgot / reset / verify
export function forgot(ctx) {
  ctx.setTitle('Reset your password');
  const email = input({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true });
  const state = formState([email]);
  const btn = submitButton('Send reset link');
  const panel = h('div', { class: 'auth__form' });
  const form = h('form', { class: 'auth__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); state.clearErrors(); btn.setBusy(true, 'Sending…');
    try {
      await api.post('/api/auth/forgot', { email: email.get() });
      panel.replaceChildren(h('div', { class: 'auth__done', role: 'status', tabindex: '-1' },
        h('p', { class: 'auth__done-title' }, 'Check your email'),
        h('p', null, 'If an account exists for that address, a reset link is on its way. It works once and expires in an hour.'),
        h('p', { class: 'help' }, session.devInbox ? 'Email sending isn’t set up on this copy of the site, so nothing was delivered. Read the message in the Dev inbox (footer).' : 'Nothing arrived? Check spam, or try again in a few minutes.')));
      panel.firstChild.focus();
    } catch (err) { state.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null); btn.setBusy(false); }
  } }, state.summary, email.el, h('div', { class: 'form-actions' }, btn, h('a', { class: 'link-arrow', href: '#/login' }, 'Back to sign in')));
  panel.append(form);
  return authShell({ title: 'Forgot your password?', lead: 'Enter your email and we’ll send a link to choose a new one.', form: panel });
}

export function reset(ctx) {
  ctx.setTitle('Choose a new password');
  const token = ctx.params.get('token') || '';
  history.replaceState(null, '', '#/reset'); // keep the token out of the address bar, history and shared screenshots
  const problem = (msg) => authShell({ title: 'This link can’t be used.', lead: msg, form: h('div', { class: 'form-actions' }, h('a', { class: 'btn', href: '#/forgot' }, 'Get a new link')) });
  if (!token) return problem('It’s missing its token. Request a fresh reset link and use the newest email.');

  const pw = input({ name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', required: true, help: 'At least 10 characters. Changing it signs you out everywhere.' });
  const state = formState([pw]);
  const btn = submitButton('Change password');
  const form = h('form', { class: 'auth__form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); state.clearErrors(); btn.setBusy(true, 'Saving…');
    try { await api.post('/api/auth/reset', { token, password: pw.get() }); await session.refresh(); location.hash = '#/login?reset=1'; toast('Password changed. Please sign in.'); }
    catch (err) {
      if (err instanceof ApiError && err.status === 400) { state.showErrors({}, err.message); form.append(h('p', null, h('a', { href: '#/forgot' }, 'Request a new link'))); }
      else state.showErrors(err.errors, err instanceof ApiError && !Object.keys(err.errors || {}).length ? err.message : null);
      btn.setBusy(false);
    }
  } }, state.summary, pw.el, h('div', { class: 'form-actions' }, btn));
  return authShell({ title: 'Choose a new password.', lead: 'Pick something you don’t use anywhere else.', form });
}

export function verify(ctx) {
  ctx.setTitle('Confirm your email');
  const token = ctx.params.get('token') || '';
  history.replaceState(null, '', '#/verify');
  const body = h('div', { class: 'auth__form', 'aria-live': 'polite' }, h('div', { class: 'skeleton skel-line skel-line--full' }));
  const node = authShell({ title: 'Confirming your email…', lead: null, form: body });
  const setTitle = (t) => { node.querySelector('h1').textContent = t; };

  (async () => {
    try {
      if (!token) throw new ApiError(400, 'That link is missing its token.');
      await api.post('/api/auth/verify', { token });
      await session.refresh();
      setTitle('Email confirmed.');
      body.replaceChildren(h('p', { class: 'auth__lead' }, 'Thanks. You can now submit opportunities.'),
        h('div', { class: 'form-actions' }, session.user ? h('a', { class: 'btn', href: '#/submit' }, 'Submit an opportunity') : h('a', { class: 'btn', href: '#/login?next=%2Fsubmit' }, 'Sign in'), h('a', { class: 'link-arrow', href: '#/discover' }, 'Browse opportunities')));
    } catch (err) {
      setTitle('This link can’t be used.');
      body.replaceChildren(h('p', { class: 'auth__lead' }, err instanceof ApiError ? err.message : 'Something went wrong.'),
        h('div', { class: 'form-actions' }, session.user ? h('a', { class: 'btn', href: '#/account' }, 'Get a new link from your account') : h('a', { class: 'btn', href: '#/login?next=%2Faccount' }, 'Sign in to get a new link')));
    }
    node.querySelector('h1').setAttribute('tabindex', '-1'); node.querySelector('h1').focus();
  })();
  return node;
}
