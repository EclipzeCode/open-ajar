import { h, debounce } from '../dom.js';
import { icon } from '../components/icons.js';
import { statusBadge } from '../components/opportunity-row.js';
import { oppForm } from '../components/opp-form.js';
import { skeletonRows, errorState, emptyState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { api, ApiError } from '../api.js';
import { META, fmtDate, daysUntil } from '../meta.js';
import { session } from '../session.js';

const guard = (ctx, title) => {
  ctx.setTitle(title);
  if (!session.user) { location.replace(`#/login?next=${encodeURIComponent(location.hash.slice(1))}`); return false; }
  if (!session.can('opportunity.review')) return false;
  return true;
};
const forbiddenView = () => h('div', { class: 'container' }, emptyState({ title: 'You don’t have access to this page', body: 'Review tools are limited to Open Ajar admins.', actions: [h('a', { class: 'btn', href: '#/' }, 'Back to home')] }));

const subnav = (active) => h('nav', { class: 'subnav', 'aria-label': 'Admin' },
  h('a', { href: '#/admin', 'aria-current': active === 'queue' ? 'page' : null }, 'Review queue'),
  h('a', { href: '#/admin/interns', 'aria-current': active === 'interns' ? 'page' : null }, 'Interns'),
  h('a', { href: '#/admin/voices', 'aria-current': active === 'voices' ? 'page' : null }, 'Voices'),
  h('a', { href: '#/admin/activity', 'aria-current': active === 'activity' ? 'page' : null }, 'Activity'),
  session.can('user.manage') ? h('a', { href: '#/admin/users', 'aria-current': active === 'users' ? 'page' : null }, 'Users') : null);

const ORDER = ['pending_review', 'changes_requested', 'approved', 'expired', 'rejected'];

// ------------------------------------------------------------------ queue
const SOURCE_LABELS = { submission: 'Submitted by people', demo: 'Demo data', 'import:sheet:import': 'Spreadsheet: Import tab', 'import:sheet:recheck': 'Spreadsheet: Recheck tab' };
const sourceLabel = (src) => SOURCE_LABELS[src] || src.replace(/^import:/, 'Import: ');

export function adminQueue(ctx) {
  if (!guard(ctx, 'Review queue')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  let status = ctx.params.get('status') || 'pending_review';
  let text = ctx.params.get('q') || '';
  let source = ctx.params.get('source') || '';
  let counts = {}, oldest = null, items = [], sources = [];
  const selected = new Set();
  const glance = h('p', { class: 'glance-line', role: 'status' });

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Filter by status' });
  const list = h('div', { 'aria-live': 'polite' }, skeletonRows(3));
  const bulk = h('div', { class: 'bulk', hidden: true });
  const search = h('input', { class: 'input', type: 'search', 'aria-label': 'Search by title or organization', placeholder: 'Search title or organization', value: text });
  const origin = h('select', { class: 'select select--sm', 'aria-label': 'Filter by origin' });
  origin.addEventListener('change', () => { source = origin.value; load(); });

  const drawTabs = () => tabs.replaceChildren(...ORDER.map((s) => h('button', {
    type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(s === status), onclick: () => { status = s; source = ''; selected.clear(); load(); },
  }, META.statuses[s], h('span', { class: 'n' }, counts[s] || 0))));

  const drawOrigin = () => {
    origin.replaceChildren(h('option', { value: '' }, 'All origins'), ...sources.map((x) => h('option', { value: x.source }, `${sourceLabel(x.source)} (${x.count})`)));
    origin.value = source; origin.hidden = sources.length < 2 && !source;
  };

  function drawBulk() {
    const canBulk = status === 'pending_review' && items.length > 0;
    bulk.hidden = !canBulk;
    if (!canBulk) return;
    const all = h('input', { type: 'checkbox', id: 'sel-all', checked: items.length > 0 && selected.size === items.length ? true : null });
    all.indeterminate = selected.size > 0 && selected.size < items.length;
    all.addEventListener('change', () => { all.checked ? items.forEach((o) => selected.add(o.id)) : selected.clear(); paint(); });
    const approve = h('button', { type: 'button', class: 'btn btn--sm', disabled: selected.size ? null : true }, selected.size ? `Approve ${selected.size} selected` : 'Approve selected');
    let armed = null;
    approve.addEventListener('click', async () => {
      if (!armed) {
        approve.textContent = `Click again to publish ${selected.size}`; approve.classList.add('btn--armed');
        armed = setTimeout(() => { armed = null; drawBulk(); }, 5000); return;
      }
      clearTimeout(armed); armed = null;
      approve.disabled = true; approve.classList.add('is-loading'); approve.textContent = 'Publishing…';
      try {
        const r = await api.post('/api/admin/opportunities/bulk-approve', { ids: [...selected] });
        selected.clear();
        toast(r.failed.length ? `Approved ${r.approved.length}. ${r.failed.length} couldn’t be approved: ${r.failed[0].reason}` : `Approved and published ${r.approved.length} ${r.approved.length === 1 ? 'listing' : 'listings'}`);
        load();
      } catch (e) { toast(e.message); drawBulk(); }
    });
    bulk.replaceChildren(
      h('label', { class: 'check check--inline' }, all, h('span', null, `Select all ${items.length} shown`)),
      h('span', { class: 'help', role: 'status' }, selected.size ? `${selected.size} selected` : 'Tick listings you’ve checked, then approve them together.'),
      approve);
  }

  function paint() {
    drawBulk();
    list.replaceChildren(items.length ? h('ul', { class: 'queue' }, items.map(row)) : emptyState({
      title: status === 'pending_review' ? 'The queue is clear' : `Nothing ${META.statuses[status].toLowerCase()}`,
      body: text || source ? 'No listings match those filters.' : status === 'pending_review' ? 'New submissions will appear here for review.' : 'Listings with this status will appear here.',
    }));
  }

  async function load() {
    drawTabs();
    const qs = `status=${status}${text ? `&q=${encodeURIComponent(text)}` : ''}${source ? `&source=${encodeURIComponent(source)}` : ''}`;
    history.replaceState(null, '', `#/admin?${qs}`);
    list.classList.add('is-updating');
    try {
      const [{ counts: c, oldestPendingAt }, res] = await Promise.all([api.get('/api/admin/summary'), api.get(`/api/admin/opportunities?${qs}&limit=300`)]);
      counts = c; oldest = oldestPendingAt; items = res.items; sources = res.sources || [];
      for (const id of [...selected]) if (!items.some((o) => o.id === id)) selected.delete(id);
      drawTabs(); drawGlance(); drawOrigin(); paint();
    } catch (e) { list.replaceChildren(errorState({ title: 'We couldn’t load the queue', body: e.message, onRetry: load })); }
    finally { list.classList.remove('is-updating'); }
  }

  function drawGlance() {
    const age = oldest ? Math.max(0, -daysUntil(oldest.slice(0, 10))) : 0;
    glance.replaceChildren(
      h('strong', null, `${counts.pending_review || 0} waiting for review`),
      h('span', null, oldest ? ` · oldest ${age === 0 ? 'came in today' : age === 1 ? 'is 1 day old' : `is ${age} days old`}` : ' · the queue is clear'),
      counts.changes_requested ? h('span', null, ` · ${counts.changes_requested} waiting on submitters`) : null,
      h('span', null, ` · ${counts.approved || 0} live`));
  }

  const row = (o) => {
    const pick = status === 'pending_review' ? h('input', { type: 'checkbox', 'aria-label': `Select ${o.title}`, checked: selected.has(o.id) ? true : null }) : null;
    pick?.addEventListener('change', () => { pick.checked ? selected.add(o.id) : selected.delete(o.id); drawBulk(); });
    return h('li', { class: `queue__row${pick ? ' queue__row--pick' : ''}` },
      pick ? h('div', { class: 'queue__pick' }, pick) : null,
      h('div', { class: 'queue__main' },
        h('h3', null, h('a', { href: `#/admin/o/${o.id}` }, o.title)),
        h('p', { class: 'queue__meta' }, `${o.org} · ${o.type} · Updated ${fmtDate(o.updatedAt)}`)),
      h('div', { class: 'queue__side' },
        o.isDemo ? h('span', { class: 'badge badge--demo' }, icon('flag', { size: 14 }), 'Demo') : h('span', { class: 'badge' }, sourceLabel(o.source)),
        statusBadge(o.status)));
  };

  search.addEventListener('input', debounce(() => { text = search.value.trim(); load(); }, 250));
  load();

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', null, 'Review queue'), h('p', null, 'Nothing reaches students until it’s approved here.')),
    subnav('queue'), glance, h('div', { class: 'queue__bar' }, tabs, h('div', { class: 'queue__search' }, origin, search)), bulk, list);
}

// ------------------------------------------------------------------ review one
export function adminReview(ctx) {
  if (!guard(ctx, 'Review')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  const id = ctx.match[1];
  const root = h('div', { class: 'container' });

  async function load() {
    root.replaceChildren(h('nav', { class: 'crumbs' }, h('a', { href: '#/admin' }, icon('back', { size: 18 }), 'Review queue')), skeletonRows(2));
    try { draw(await api.get(`/api/admin/opportunities/${encodeURIComponent(id)}`)); }
    catch (e) {
      root.replaceChildren(h('nav', { class: 'crumbs' }, h('a', { href: '#/admin' }, icon('back', { size: 18 }), 'Review queue')),
        e instanceof ApiError && e.status === 404 ? emptyState({ title: 'That listing doesn’t exist', body: 'It may have been removed.', actions: [h('a', { class: 'btn', href: '#/admin' }, 'Back to the queue')] }) : errorState({ title: 'We couldn’t load this listing', body: e.message, onRetry: load }));
    }
  }

  function draw({ opportunity: o, events, submitter, allowedActions }) {
    ctx.setTitle(`Review: ${o.title}`);
    const form = oppForm({ mode: 'admin', initial: o, submitLabel: 'Save edits', onSubmit: async (values) => {
      const { opportunity } = await api.patch(`/api/admin/opportunities/${encodeURIComponent(id)}`, values);
      toast('Edits saved'); Object.assign(o, opportunity); load();
    } });

    const message = h('textarea', { class: 'textarea', id: 'decision-msg', rows: 3, maxlength: '1000', placeholder: 'Required to reject or request changes. The submitter sees this.' });
    const msgErr = h('p', { class: 'field-error', hidden: true, id: 'decision-err' });
    message.setAttribute('aria-describedby', 'decision-err');
    const LABELS = { approve: ['Approve and publish', 'btn'], request_changes: ['Request changes', 'btn btn--ghost'], reject: ['Reject', 'btn btn--ghost btn--danger'], expire: ['Expire (hide from students)', 'btn btn--ghost'], reopen: ['Reopen for review', 'btn btn--ghost'] };
    const buttons = allowedActions.map((a) => {
      const [label, cls] = LABELS[a];
      const btn = h('button', { type: 'button', class: cls, onclick: async () => {
        msgErr.hidden = true; message.removeAttribute('aria-invalid');
        btn.classList.add('is-loading'); btn.disabled = true;
        try {
          await api.post(`/api/admin/opportunities/${encodeURIComponent(id)}/decision`, { action: a, message: message.value });
          toast(`${label.split(' (')[0]}: done`); load();
        } catch (e) {
          btn.classList.remove('is-loading'); btn.disabled = false;
          const m = e.errors?.message || e.message;
          msgErr.textContent = m; msgErr.hidden = false; message.setAttribute('aria-invalid', 'true'); message.focus();
        }
      } }, label);
      return btn;
    });

    root.replaceChildren(
      h('nav', { class: 'crumbs' }, h('a', { href: '#/admin' }, icon('back', { size: 18 }), 'Review queue')),
      h('div', { class: 'review' },
        h('div', { class: 'review__main' },
          h('div', { class: 'review__head' }, h('h1', null, o.title), h('div', { class: 'review__badges' }, statusBadge(o.status), o.isDemo ? h('span', { class: 'badge badge--demo' }, icon('flag', { size: 14 }), 'Demo') : null)),
          o.isDemo ? h('p', { class: 'demo-banner' }, icon('flag', { size: 18 }), h('span', null, h('strong', null, 'Demo listing.'), ' Fictional development data.')) : null,
          form.el),
        h('aside', { class: 'review__aside', 'aria-label': 'Decision' },
          h('section', { class: 'panel' },
            h('h2', null, 'Decision'),
            allowedActions.length ? [h('div', { class: 'field' }, h('label', { for: 'decision-msg' }, 'Message to submitter'), message, msgErr), h('div', { class: 'decision__buttons' }, buttons)] : h('p', { class: 'help' }, 'No decisions available for this status.'),
            o.status === 'approved' && o.url ? h('a', { class: 'link-arrow', href: `#/o/${o.id}` }, 'View public page', icon('arrow')) : null),
          h('section', { class: 'panel' },
            h('h2', null, 'Source'),
            h('dl', { class: 'glance' },
              h('div', null, h('dt', null, 'Origin'), h('dd', null, o.isDemo ? 'Demo data' : o.source === 'submission' ? 'Submission' : o.source)),
              submitter ? h('div', null, h('dt', null, 'Submitter'), h('dd', null, `${submitter.displayName} (${submitter.email})`)) : null,
              o.contactEmail ? h('div', null, h('dt', null, 'Contact'), h('dd', null, o.contactEmail)) : null,
              o.relationship ? h('div', null, h('dt', null, 'Relationship'), h('dd', null, META.relationships[o.relationship] || o.relationship)) : null,
              h('div', null, h('dt', null, 'Created'), h('dd', null, fmtDate(o.createdAt))))),
          h('section', { class: 'panel' },
            h('h2', null, 'History'),
            events.length ? h('ol', { class: 'timeline' }, events.map((e) => h('li', null,
              h('strong', null, e.action.replace('_', ' ')), h('span', { class: 'muted' }, ` · ${e.actor} · ${fmtDate(e.createdAt)}`), e.message ? h('p', null, e.message) : null))) : h('p', { class: 'help' }, 'No activity yet.')))));
  }

  load();
  return root;
}

// ------------------------------------------------------------------ users
export function adminUsers(ctx) {
  if (!guard(ctx, 'Users')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  if (!session.can('user.manage')) return h('div', { class: 'container' }, forbiddenView());
  const list = h('div', null, skeletonRows(3));

  async function load() {
    try {
      const { users, roles } = await api.get('/api/admin/users');
      list.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Name', 'Email', 'Role', 'Status', 'Joined'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, users.map((u) => {
          const self = u.id === session.user.id;
          const roleSel = h('select', { class: 'select select--sm', 'aria-label': `Role for ${u.displayName}`, disabled: self ? true : null }, roles.map((r) => h('option', { value: r }, r)));
          roleSel.value = u.role;
          roleSel.addEventListener('change', async () => {
            try { await api.patch(`/api/admin/users/${u.id}`, { role: roleSel.value }); toast(`${u.displayName} is now ${roleSel.value}. They’ve been signed out.`); }
            catch (e) { toast(e.message); } finally { load(); }
          });
          const toggle = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', disabled: self ? true : null, onclick: async () => {
            try { await api.patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled }); toast(u.disabled ? 'Account re-enabled' : 'Account disabled and signed out'); }
            catch (e) { toast(e.message); } finally { load(); }
          } }, u.disabled ? 'Enable' : 'Disable');
          return h('tr', null,
            h('th', { scope: 'row' }, u.displayName, self ? h('span', { class: 'muted' }, ' (you)') : null), h('td', null, u.email, u.emailVerified ? null : h('span', { class: 'muted' }, ' (unconfirmed)')),
            h('td', null, roleSel), h('td', null, u.disabled ? h('span', { class: 'status status--rejected' }, 'Disabled') : h('span', { class: 'status status--approved' }, 'Active'), ' ', toggle),
            h('td', null, fmtDate(u.createdAt)));
        })))),
        h('p', { class: 'help' }, 'Changing a role or disabling an account signs that person out everywhere. Every change is written to the audit log.'));
    } catch (e) { list.replaceChildren(errorState({ title: 'We couldn’t load users', body: e.message, onRetry: load })); }
  }
  load();
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', null, 'Users'), h('p', null, 'Everyone signs up as a student. Promote organizations, counselors and admins here.')),
    subnav('users'), list);
}

// ------------------------------------------------------------------ activity
const ACTION_TEXT = { submitted: 'submitted', resubmitted: 'resubmitted', edited: 'edited', approve: 'approved', reject: 'rejected', request_changes: 'requested changes on', expire: 'expired', reopen: 'reopened', password_changed: 'changed their password', password_reset: 'reset their password', user_updated: 'updated a user', admin_created_cli: 'created an admin', admin_granted_cli: 'granted admin to' };
export function adminActivity(ctx) {
  if (!guard(ctx, 'Activity')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  const list = h('div', null, skeletonRows(3));
  const load = () => api.get('/api/admin/activity').then(({ items }) => {
    list.replaceChildren(items.length ? h('ol', { class: 'feed' }, items.map((e) => h('li', { class: 'feed__item' },
      h('span', { class: 'feed__when muted' }, new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
      h('p', null, h('strong', null, e.actor), ` ${ACTION_TEXT[e.action] || e.action} `, e.kind === 'review' && e.opportunityId ? h('a', { href: `#/admin/o/${e.opportunityId}` }, e.title) : h('span', null, e.kind === 'review' ? e.title : ''),
        e.message ? h('span', { class: 'feed__msg' }, e.message) : null)))) : emptyState({ title: 'No activity yet', body: 'Reviews, edits and account changes will appear here.' }));
  }).catch((e) => list.replaceChildren(errorState({ title: 'We couldn’t load activity', body: e.message, onRetry: load })));
  load();
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', null, 'Activity'), h('p', null, 'Every review decision and account change, newest first.')),
    subnav('activity'), list);
}

// ------------------------------------------------------------------ intern applicants
const INTERN_STATUS = { new: 'New', contacted: 'Contacted', placed: 'Placed', declined: 'Declined' };
export function adminInterns(ctx) {
  if (!guard(ctx, 'Interns')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  const list = h('div', null, skeletonRows(3));
  let statusFilter = '';

  const load = () => api.get(`/api/admin/intern-applications${statusFilter ? `?status=${statusFilter}` : ''}`).then(({ items, counts }) => {
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(!statusFilter), onclick: () => { statusFilter = ''; load(); } }, 'All'),
      Object.entries(INTERN_STATUS).map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(statusFilter === k), onclick: () => { statusFilter = k; load(); } }, label, h('span', { class: 'n' }, counts[k] || 0))));
    const rows = items.length ? h('ul', { class: 'queue' }, items.map(internRow)) : emptyState({ title: 'No applicants yet', body: 'When students apply to intern, they show up here.' });
    list.replaceChildren(tabs, rows);
  }).catch((e) => list.replaceChildren(errorState({ title: 'We couldn’t load applicants', body: e.message, onRetry: load })));

  function internRow(a) {
    const statusSel = h('select', { class: 'select select--sm', 'aria-label': `Status for ${a.fullName}` }, Object.entries(INTERN_STATUS).map(([k, l]) => h('option', { value: k }, l)));
    statusSel.value = a.status;
    statusSel.addEventListener('change', async () => {
      try { await api.patch(`/api/admin/intern-applications/${a.id}`, { status: statusSel.value }); toast(`Marked ${INTERN_STATUS[statusSel.value]}`); }
      catch (e) { toast(e.message); statusSel.value = a.status; }
    });
    const details = [
      a.grade ? `Grade ${a.grade}` : null, a.school || null, a.location || null,
      a.interests.length ? a.interests.join(', ') : null,
    ].filter(Boolean).join(' · ');
    return h('li', { class: 'queue__row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'queue__main' },
        h('h3', null, a.fullName, ' ', h('a', { class: 'muted', href: `mailto:${a.email}`, style: { fontSize: 'var(--fs-sm)', fontWeight: '400' } }, a.email)),
        details ? h('p', { class: 'queue__meta' }, details) : null,
        a.availability ? h('p', { class: 'queue__meta' }, `Available: ${a.availability}`) : null,
        a.skills ? h('p', { class: 'sub__meta' }, `Skills: ${a.skills}`) : null,
        h('p', { class: 'intern__statement' }, a.statement),
        a.link ? h('a', { class: 'link-arrow', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, 'Their link', icon('external', { size: 16 })) : null),
      h('div', { class: 'queue__side' }, statusSel));
  }

  load();
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', null, 'Intern applicants'), h('p', null, 'Students who applied to intern with Open Ajar. Move each one from New to Contacted to Placed as you work them.')),
    subnav('interns'), list);
}

const VOICE_STATUS = { pending: 'Pending', approved: 'Approved', declined: 'Declined' };
export function adminVoices(ctx) {
  if (!guard(ctx, 'Voices')) return h('div', { class: 'container' }, session.user ? forbiddenView() : h('div'));
  const list = h('div', null, skeletonRows(3));
  let statusFilter = '';

  const load = () => api.get(`/api/admin/testimonials${statusFilter ? `?status=${statusFilter}` : ''}`).then(({ items, counts }) => {
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(!statusFilter), onclick: () => { statusFilter = ''; load(); } }, 'All'),
      Object.entries(VOICE_STATUS).map(([k, label]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(statusFilter === k), onclick: () => { statusFilter = k; load(); } }, label, h('span', { class: 'n' }, counts[k] || 0))));
    const rows = items.length ? h('ul', { class: 'queue' }, items.map(voiceRow)) : emptyState({ title: 'No quotes yet', body: 'When a signed-in student shares a quote, it shows up here for review.' });
    list.replaceChildren(tabs, rows);
  }).catch((e) => list.replaceChildren(errorState({ title: 'We couldn’t load quotes', body: e.message, onRetry: load })));

  const setStatus = async (t, status) => {
    try { await api.patch(`/api/admin/testimonials/${t.id}`, { status }); toast(status === 'approved' ? 'Quote approved and now live' : status === 'declined' ? 'Quote declined' : 'Moved back to pending'); load(); }
    catch (e) { toast(e.message); }
  };

  function voiceRow(t) {
    const meta = [t.name, t.role || null, t.isDemo ? 'Demo' : null].filter(Boolean).join(' · ');
    const actions = [];
    if (t.status !== 'approved') actions.push(h('button', { type: 'button', class: 'btn btn--sm', onclick: () => setStatus(t, 'approved') }, 'Approve'));
    if (t.status !== 'declined') actions.push(h('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => setStatus(t, 'declined') }, 'Decline'));
    if (t.status !== 'pending') actions.push(h('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => setStatus(t, 'pending') }, 'Unpublish'));
    return h('li', { class: 'queue__row', style: { alignItems: 'flex-start' } },
      h('div', { class: 'queue__main' },
        h('h3', null, `“${t.quote}”`),
        h('p', { class: 'queue__meta' }, meta, ' · ', h('span', { class: 'muted' }, VOICE_STATUS[t.status]))),
      h('div', { class: 'queue__side', style: { display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' } }, actions));
  }

  load();
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Admin'), h('h1', null, 'Community voices'), h('p', null, 'Quotes students shared about Open Ajar. Approve the ones you want on the home page.')),
    subnav('voices'), list);
}
