import { h } from '../dom.js';
import { icon } from './icons.js';
import { saveButton } from './save-button.js';
import { META, gradeLabel, deadlineInfo } from '../meta.js';

const VERIFY_ICON = { verified: 'shield', source: 'link', unreviewed: 'help', demo: 'flag' };

export function verificationBadge(opp) {
  const key = opp.isDemo ? 'demo' : opp.verification;
  return h('span', { class: `badge badge--${key}` }, icon(VERIFY_ICON[key] || 'help', { size: 16 }), META.verification[key] || key);
}

/** Editorial ledger row: type, title, meta, and actions. The title link stretches over the whole row. */
export function opportunityRow(opp, ctx, { index = 0 } = {}) {
  const dl = deadlineInfo(opp);
  return h('article', { class: 'row reveal', style: { '--i': Math.min(index, 6) } },
    h('div', { class: 'row__type' }, h('span', { class: 'tag' }, opp.type), verificationBadge(opp)),
    h('div', { class: 'row__main' },
      h('h3', { class: 'row__title' }, h('a', { href: `#/o/${opp.id}` }, opp.title)),
      h('p', { class: 'row__org' }, opp.org),
      h('p', { class: 'row__sum' }, opp.summary),
      h('ul', { class: 'row__meta' },
        h('li', null, gradeLabel(opp.grades)),
        h('li', null, META.costs[opp.cost]),
        h('li', null, opp.format),
        h('li', { class: dl.soon ? 'is-soon' : '' }, dl.dated ? `Closes ${dl.text.split(' · ')[0]}` : dl.text))),
    h('div', { class: 'row__side' }, saveButton(opp, ctx)));
}

export const statusBadge = (status) => h('span', { class: `status status--${status}` }, META.statuses[status] || status);
