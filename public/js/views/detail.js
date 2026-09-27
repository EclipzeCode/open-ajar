import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { saveButton } from '../components/save-button.js';
import { verificationBadge } from '../components/opportunity-row.js';
import { skeletonRows, errorState, emptyState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { api, ApiError } from '../api.js';
import { META, gradeLabel, deadlineInfo } from '../meta.js';
import { library } from '../library.js';
import { lastDiscoverHash } from './discover.js';

export default function detail(ctx) {
  const id = ctx.match[1];
  const root = h('div', { class: 'container' });
  const back = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
    h('a', { href: lastDiscoverHash.value }, icon('back', { size: 18 }), 'Back to Discover'));

  function focusHeading() {
    const app = document.getElementById('app');
    if (document.activeElement === app) { const h1 = root.querySelector('h1'); h1?.setAttribute('tabindex', '-1'); h1?.focus({ preventScroll: true }); }
  }

  function load() {
    root.replaceChildren(back, h('div', { style: { paddingBlock: '2rem' } }, skeletonRows(2)));
    api.get(`/api/opportunities/${encodeURIComponent(id)}`).then((opp) => {
      ctx.setTitle(opp.title);
      root.replaceChildren(back, render(opp));
      focusHeading();
    }).catch((e) => {
      if (e instanceof ApiError && e.status === 404) {
        ctx.setTitle('Not available');
        root.replaceChildren(back, emptyState({ title: 'That opportunity isn’t available', body: e.message, actions: [h('a', { class: 'btn', href: '#/opportunities' }, 'Browse all opportunities')] }));
        focusHeading();
      } else root.replaceChildren(back, errorState({ title: 'We couldn’t load this opportunity', body: e.message, onRetry: load }));
    });
  }

  function render(opp) {
    const trackSlot = h('div', { class: 'aside__actions' });
    const syncTrack = () => {
      const entry = library.trackedEntry(opp.id);
      if (entry) {
        trackSlot.replaceChildren(
          h('p', { class: 'help', role: 'status' }, `Tracking · ${entry.stage}`),
          h('a', { class: 'btn btn--ghost', href: '#/tracker' }, 'Open in tracker', icon('arrow', { cls: 'arrow' })));
      } else {
        trackSlot.replaceChildren(h('button', {
          type: 'button', class: 'btn btn--ghost',
          onclick: async () => { if (await library.track(opp)) toast(`Tracking “${opp.title}”`, { label: 'Open tracker', onClick: () => { location.hash = '#/tracker'; } }); },
        }, icon('plus', { size: 18 }), 'Start tracking'));
      }
    };
    syncTrack();
    ctx.onCleanup(library.subscribe(syncTrack));

    const dl = deadlineInfo(opp);
    const key = opp.isDemo ? 'demo' : opp.verification;
    const apply = opp.url
      ? h('a', { class: 'btn btn--light', href: opp.url, target: '_blank', rel: 'noopener noreferrer' }, 'Apply on official site', icon('external', { size: 18 }), h('span', { class: 'sr-only' }, '(opens in a new tab)'))
      : h('p', { class: 'help apply-none' }, opp.isDemo ? 'Demo listing: there is no real application.' : 'No official application link has been provided yet.');

    return h('article', { class: 'detail' },
      opp.isDemo ? h('p', { class: 'demo-banner', role: 'note' }, icon('flag', { size: 18 }), h('span', null, h('strong', null, 'Demo listing.'), ' This opportunity is fictional and exists only for development. Nothing here is real.')) : null,
      h('header', { class: 'detail__head' },
        h('p', { class: 'eyebrow' }, opp.type),
        h('h1', null, opp.title),
        h('p', { class: 'detail__org' }, opp.org)),
      h('div', { class: 'detail__body' },
        h('div', { class: 'detail__main', style: { display: 'grid', gap: '3rem' } },
          h('section', { class: 'prose-block', 'aria-labelledby': 'about-h' }, h('h2', { id: 'about-h' }, 'What it is'), h('p', null, opp.summary)),
          opp.eligibility ? h('section', { class: 'prose-block', 'aria-labelledby': 'elig-h' }, h('h2', { id: 'elig-h' }, 'Who it’s for'), h('p', null, opp.eligibility)) : null,
          opp.requirements.length ? h('section', { class: 'prose-block', 'aria-labelledby': 'req-h' },
            h('h2', { id: 'req-h' }, 'What you’ll likely need'),
            h('ul', { class: 'reqs' }, opp.requirements.map((r) => h('li', null, icon('check', { size: 16 }), r))),
            h('p', { class: 'help' }, 'Start tracking to turn these into a checklist you can tick off.')) : null),
        h('aside', { class: 'aside', 'aria-label': 'At a glance' },
          h('dl', { class: 'glance' },
            row('Grade', gradeLabel(opp.grades)),
            row('Cost', [META.costs[opp.cost], opp.costNote].filter(Boolean).join('. ')),
            row('Format', `${opp.format} · ${opp.location}`),
            row('Commitment', [opp.commitment, opp.commitmentNote].filter(Boolean).join(' · ')),
            row('Deadline', dl.text, dl.soon)),
          h('div', { class: 'aside__actions' }, apply, saveButton(opp, ctx), trackSlot),
          h('div', { class: 'verify' },
            h('strong', null, verificationBadge(opp)),
            h('span', null, opp.isDemo ? 'Fictional listing for development.' : key === 'verified' ? 'An Open Ajar reviewer checked the official page recently.' : key === 'source' ? 'Approved by a reviewer. Details come from the organization’s page and may have changed.' : 'Not yet independently checked.'),
            h('span', null, 'Always confirm details on the official page before applying.')))));
  }

  const row = (k, v, soon) => h('div', { class: soon ? 'is-soon' : '' }, h('dt', null, k), h('dd', null, v));

  load();
  return root;
}
