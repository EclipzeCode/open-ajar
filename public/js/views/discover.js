import { h, debounce, observeReveals } from '../dom.js';
import { icon } from '../components/icons.js';
import { opportunityRow } from '../components/opportunity-row.js';
import { skeletonRows, errorState, emptyState } from '../components/states.js';
import { api } from '../api.js';
import { META } from '../meta.js';
import { session } from '../session.js';

export const lastDiscoverHash = { value: '#/opportunities' };

const SET_KEYS = ['type', 'cost', 'format', 'commitment', 'interest'];
const emptyFilters = () => ({ q: '', grade: '', state: '', sort: 'featured', type: new Set(), cost: new Set(), format: new Set(), commitment: new Set(), interest: new Set() });

function fromParams(params) {
  const f = emptyFilters();
  f.q = params.get('q') || ''; f.grade = params.get('grade') || ''; f.state = params.get('state') || ''; f.sort = params.get('sort') || 'featured';
  for (const k of SET_KEYS) (params.get(k) || '').split('|').filter(Boolean).forEach((v) => f[k].add(v));
  return f;
}
function toParams(f) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.grade) p.set('grade', f.grade);
  if (f.state) p.set('state', f.state);
  if (f.sort !== 'featured') p.set('sort', f.sort);
  for (const k of SET_KEYS) if (f[k].size) p.set(k, [...f[k]].join('|'));
  return p;
}
const activeCount = (f) => SET_KEYS.reduce((n, k) => n + f[k].size, 0) + (f.grade ? 1 : 0) + (f.state ? 1 : 0);

export default function discover(ctx) {
  const sector = ctx.sector || null; // 'jobs' | 'opportunities' | null
  const COPY = {
    jobs: { title: 'Teen jobs', eyebrow: 'Jobs', h1: 'Teen jobs, across the country.', sub: 'Paid, part-time work for high-school students. Narrow by state, grade, and commitment.', empty: 'No jobs match that yet' },
    opportunities: { title: 'Discover opportunities', eyebrow: 'Opportunities', h1: 'Find what’s within reach.', sub: 'Internships, programs, scholarships, competitions and more. Search, then narrow by grade, state, cost and commitment.', empty: 'Nothing matches that yet' },
  };
  const copy = COPY[sector] || COPY.opportunities;
  const basePath = sector === 'jobs' ? '#/jobs' : '#/opportunities';
  ctx.setTitle(copy.title);
  const f = fromParams(ctx.params);
  const PAGE = 20;
  let facets = {}, items = [], total = 0, page = 1, filtersOpen = false, controller = null;

  const status = h('p', { class: 'discover__status', role: 'status', 'aria-live': 'polite' }, 'Loading…');
  const results = h('div', { class: 'results' }, skeletonRows(4));
  const actives = h('div', { class: 'actives', role: 'group', 'aria-label': 'Active filters' });
  const banner = h('p', { class: 'discover__banner', hidden: !session.demoMode }, 'Development build: listings marked Demo are fictional and exist only to test the product.');

  const search = h('input', { class: 'input', type: 'search', id: 'q', name: 'q', value: f.q, autocomplete: 'off', enterkeyhint: 'search', placeholder: sector === 'jobs' ? 'Search jobs, e.g. cashier or lifeguard' : 'Search, e.g. research or coding', 'aria-label': 'Search opportunities', maxlength: '100' });
  const sort = h('select', { class: 'select', id: 'sort', 'aria-label': 'Sort results' },
    h('option', { value: 'featured' }, 'Featured'), h('option', { value: 'deadline' }, 'Deadline soonest'), h('option', { value: 'title' }, 'A to Z'));
  sort.value = f.sort;

  const filtersBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm filters-toggle', 'aria-expanded': 'false', 'aria-controls': 'filters' });
  const filtersPanel = h('form', { class: 'filters', id: 'filters', 'aria-label': 'Filter opportunities', onsubmit: (e) => e.preventDefault() });

  // ---------- filter UI ----------
  function facet(title, key, options, labelOf = (x) => x) {
    return h('fieldset', { class: 'facet' }, h('legend', null, title),
      h('div', { class: 'facet__list' }, options.map((opt) => {
        const input = h('input', { type: 'checkbox', name: key, value: opt });
        input.checked = f[key].has(String(opt));
        input.addEventListener('change', () => { input.checked ? f[key].add(String(opt)) : f[key].delete(String(opt)); refresh(); });
        const n = facets[key]?.[opt] ?? 0;
        return h('label', { class: 'check' }, input, h('span', null, labelOf(opt)), h('span', { class: 'check__n', 'aria-label': `${n} listings` }, n));
      })));
  }

  function buildFilters() {
    const gradeSelect = h('select', { class: 'select', id: 'grade', name: 'grade' }, h('option', { value: '' }, 'Any grade'), META.grades.map((g) => h('option', { value: g }, `Grade ${g}`)));
    gradeSelect.value = f.grade;
    gradeSelect.addEventListener('change', () => { f.grade = gradeSelect.value; refresh(); });
    const stateEntries = Object.entries(facets.state || {}).filter(([, n]) => n > 0)
      .map(([code, n]) => ({ code, name: META.states[code] || code, n })).sort((a, b) => a.name.localeCompare(b.name));
    const stateSelect = h('select', { class: 'select', id: 'state', name: 'state' },
      h('option', { value: '' }, 'Any state'),
      stateEntries.map((x) => h('option', { value: x.code }, `${x.name} (${x.n})`)));
    stateSelect.value = f.state;
    stateSelect.addEventListener('change', () => { f.state = stateSelect.value; refresh(); });

    filtersPanel.replaceChildren(...[
      (() => { const opts = META.types.filter((t) => t !== 'Job' && (facets.type?.[t] || 0) > 0); return sector === 'jobs' || opts.length < 2 ? null : facet('Type', 'type', opts); })(),
      h('div', { class: 'field' }, h('label', { for: 'grade', class: 'legend' }, 'Grade'), gradeSelect),
      stateEntries.length ? h('div', { class: 'field' }, h('label', { for: 'state', class: 'legend' }, 'State'), stateSelect) : null,
      sector === 'jobs' ? null : facet('Cost', 'cost', Object.keys(META.costs), (c) => META.costs[c]),
      sector === 'jobs' ? null : facet('Format', 'format', META.formats),
      facet('Commitment', 'commitment', META.commitments),
      sector === 'jobs' ? null : facet('Interest', 'interest', META.interests),
    ].filter(Boolean));
  }

  function syncFiltersBtn() {
    const n = activeCount(f);
    filtersBtn.replaceChildren(icon('filter', { size: 18 }), n ? `Filters (${n})` : 'Filters');
    filtersBtn.setAttribute('aria-expanded', filtersOpen);
    filtersPanel.classList.toggle('is-open', filtersOpen);
  }
  filtersBtn.addEventListener('click', () => { filtersOpen = !filtersOpen; syncFiltersBtn(); });

  function chips() {
    const out = [];
    const add = (label, remove) => out.push(h('button', { type: 'button', class: 'chip', 'aria-label': `Remove filter: ${label}`, onclick: () => { remove(); syncControls(); refresh(); } }, label, icon('close', { size: 14 })));
    if (f.q) add(`“${f.q}”`, () => { f.q = ''; });
    if (f.grade) add(`Grade ${f.grade}`, () => { f.grade = ''; });
    if (f.state) add(META.states[f.state] || f.state, () => { f.state = ''; });
    for (const k of SET_KEYS) f[k].forEach((v) => add(k === 'cost' ? META.costs[v] : v, () => f[k].delete(v)));
    if (out.length > 1) out.push(h('button', { type: 'button', class: 'clear', onclick: clearAll }, 'Clear all'));
    return out;
  }

  function syncControls() {
    search.value = f.q;
    filtersPanel.querySelectorAll('input[type=checkbox]').forEach((i) => { i.checked = f[i.name].has(i.value); });
    const g = filtersPanel.querySelector('#grade'); if (g) g.value = f.grade;
    const st = filtersPanel.querySelector('#state'); if (st) st.value = f.state;
  }
  function clearAll() { Object.assign(f, emptyFilters(), { sort: f.sort }); syncControls(); refresh(); search.focus(); }

  // ---------- data ----------
  async function fetchPage(reset) {
    if (controller) controller.abort();
    controller = new AbortController();
    const p = toParams(f);
    if (sector) p.set('sector', sector);
    p.set('limit', PAGE); p.set('page', reset ? 1 : page + 1);
    const data = await api.get(`/api/opportunities?${p}`, { signal: controller.signal });
    page = data.page; total = data.total; facets = data.facets;
    items = reset ? data.items : [...items, ...data.items];
  }

  function paint({ from = 0 } = {}) {
    actives.replaceChildren(...chips());
    syncFiltersBtn();
    const noun = sector === 'jobs' ? ['job', 'jobs'] : ['opportunity', 'opportunities'];
    status.textContent = total === 1 ? `1 ${noun[0]}` : `${total} ${noun[1]}`;

    if (!items.length) {
      results.replaceChildren(emptyState({
        title: activeCount(f) || f.q ? copy.empty : (sector === 'jobs' ? 'No jobs are published yet' : 'No opportunities are published yet'),
        body: activeCount(f) || f.q ? 'Try removing a filter or searching a broader word. New opportunities are added as they’re reviewed.' : 'Check back soon, or submit one you know about.',
        actions: activeCount(f) || f.q ? [h('button', { type: 'button', class: 'btn', onclick: clearAll }, 'Clear all filters')] : [h('a', { class: 'btn', href: '#/submit' }, 'Submit an opportunity')],
      }));
      return;
    }
    const rows = h('div', { class: 'rows' }, items.map((o, i) => opportunityRow(o, ctx, { index: Math.max(0, i - from) })));
    const more = items.length < total
      ? h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn btn--ghost', id: 'more', onclick: loadMore }, `Show more (${total - items.length} left)`))
      : null;
    results.replaceChildren(rows, more);
    observeReveals(results, ctx);
  }

  async function refresh() {
    const hash = basePath + (toParams(f).toString() ? `?${toParams(f)}` : '');
    lastDiscoverHash.value = hash;
    history.replaceState(null, '', hash);
    results.classList.add('is-updating');
    try { await fetchPage(true); paint(); }
    catch (e) { if (e.name !== 'AbortError') showError(); }
    finally { results.classList.remove('is-updating'); }
  }

  async function loadMore() {
    const btn = results.querySelector('#more');
    btn?.classList.add('is-loading'); if (btn) btn.disabled = true;
    const prev = items.length;
    try { await fetchPage(false); paint({ from: prev }); results.querySelectorAll('.row')[prev]?.querySelector('a')?.focus(); }
    catch (e) { if (e.name !== 'AbortError') { if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); } status.textContent = 'Couldn’t load more. Try again.'; } }
  }

  function showError() {
    status.textContent = 'Couldn’t load';
    results.replaceChildren(errorState({ onRetry: init }));
  }

  async function init() {
    results.replaceChildren(skeletonRows(4));
    status.textContent = 'Loading…';
    try { await fetchPage(true); buildFilters(); paint(); }
    catch (e) { if (e.name !== 'AbortError') showError(); }
  }

  const onSearch = debounce(() => { f.q = search.value.trim(); refresh(); }, 220);
  search.addEventListener('input', onSearch);
  search.addEventListener('search', () => { f.q = search.value.trim(); refresh(); });
  sort.addEventListener('change', () => { f.sort = sort.value; refresh(); });

  // "Match my profile" fills grade and interests from the student's saved preferences.
  const profile = session.user?.profile;
  const matchBtn = (profile && (profile.grade || profile.interests.length))
    ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => {
      if (profile.grade) f.grade = String(profile.grade);
      profile.interests.forEach((i) => f.interest.add(i));
      syncControls(); refresh();
    } }, icon('user', { size: 18 }), 'Match my profile')
    : null;

  syncFiltersBtn();
  ctx.onCleanup(() => controller?.abort());

  const node = h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, copy.eyebrow),
      h('h1', null, copy.h1),
      h('p', null, copy.sub)),
    h('div', { class: 'discover' },
      h('div', { class: 'searchbar' }, icon('search', { size: 22 }), search),
      h('div', { class: 'discover__bar' }, status,
        h('div', { class: 'discover__tools' }, matchBtn, filtersBtn, h('label', { class: 'sr-only', for: 'sort' }, 'Sort by'), sort)),
      h('div', { class: 'discover__side' }, filtersPanel),
      actives, banner, results));

  init();
  return node;
}
