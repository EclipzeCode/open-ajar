import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { thresholdArt } from '../components/threshold.js';
import { SUPPORT, USES } from '../data/support.js';

const money = (n) => '$' + Number(n).toLocaleString('en-US');

function donateHref() {
  if (SUPPORT.donateUrl) return SUPPORT.donateUrl;
  return `mailto:${SUPPORT.contactEmail}?subject=${encodeURIComponent('I want to support Open Ajar')}`;
}

/**
 * Funding page for Open Ajar's mission: expanding access to opportunities for high-school students.
 * Kept honest: the figures shown (raised, used, remaining) reflect real money only, set in
 * data/support.js. Remaining is computed as raised - used. Do not put made-up numbers here, do not
 * invent a line-item breakdown of what was spent, and do not claim tax-deductible or nonprofit status.
 */
export default function support(ctx) {
  ctx.setTitle('Support Open Ajar');
  const remaining = Math.max(0, SUPPORT.raised - SUPPORT.used);
  const external = SUPPORT.donateUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {};
  const donateIcon = () => icon(SUPPORT.donateUrl ? 'external' : 'arrow', { cls: SUPPORT.donateUrl ? '' : 'arrow', size: 18 });

  const statCard = (figure, label, mod) => h('div', { class: `stat${mod ? ` stat--${mod}` : ''}` },
    h('p', { class: 'stat__figure' }, money(figure)),
    h('p', { class: 'stat__label' }, label));

  const stats = h('div', { class: 'fund-stats', role: 'group', 'aria-label': 'Funding to date' },
    statCard(SUPPORT.raised, 'Raised'),
    statCard(SUPPORT.used, 'Used to expand student opportunities'),
    statCard(remaining, 'Remaining', 'remaining'));

  const donate = h('a', { class: 'btn btn--light', href: donateHref(), ...external },
    'Donate', donateIcon(), SUPPORT.donateUrl ? h('span', { class: 'sr-only' }, '(opens in a new tab)') : null);

  return h('div', null,
    h('section', { class: 'fund-hero' },
      h('div', { class: 'container fund-hero__grid' },
        h('div', { class: 'fund-hero__copy' },
          h('p', { class: 'eyebrow' }, 'Support Open Ajar'),
          h('h1', null, 'Open more doors for more students.'),
          h('p', { class: 'fund-hero__sub' }, 'Open Ajar helps high-school students find real opportunities and actually pursue them, whether or not they know the right people. Support helps us reach more students, keep the platform free, and create new hands-on experiences with local organizations and businesses.'),
          stats,
          h('div', { class: 'fund-hero__actions' }, donate,
            h('a', { class: 'link-arrow', href: '#/about' }, 'Why we exist', icon('arrow'))),
          SUPPORT.donateUrl && SUPPORT.donateNote ? h('p', { class: 'fund__disclosure' }, SUPPORT.donateNote) : null),
        h('div', { class: 'fund-hero__art', 'aria-hidden': 'true' }, thresholdArt()))),

    h('section', { class: 'section', 'aria-labelledby': 'gap-h' },
      h('div', { class: 'container fund-gap' },
        h('div', { class: 'section__head' },
          h('p', { class: 'eyebrow' }, 'Where the money goes'),
          h('h2', { id: 'gap-h' }, 'Support that reaches students.')),
        h('p', { class: 'fund-gap__lead' }, 'Funds raised through Open Ajar help expand access to meaningful opportunities for high-school students. Funding supports student participation, opportunity-related materials, outreach, platform development, and the creation of new experiential opportunities with local organizations and businesses.'))),

    h('section', { class: 'section fund-uses', 'aria-labelledby': 'uses-h', style: { paddingTop: '0' } },
      h('div', { class: 'container' },
        h('div', { class: 'section__head' },
          h('p', { class: 'eyebrow' }, 'What support makes possible'),
          h('h2', { id: 'uses-h' }, 'What your support does.'),
          h('p', null, 'The kinds of work contributions go toward. These describe how support is put to use, not a line-item breakdown.')),
        h('ol', { class: 'uses' }, USES.map((u, i) => h('li', { class: 'use reveal' },
          h('span', { class: 'use__n', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
          h('div', null, h('h3', null, u.label), h('p', null, u.note))))),
        h('p', { class: 'fund__transparency' }, 'Open Ajar tracks funds raised and used to help ensure that financial support directly contributes to expanding student access to opportunities.'))),

    h('section', { class: 'night', 'aria-labelledby': 'give-h' },
      h('div', { class: 'night__wrap' },
        h('div', { class: 'container night__inner' },
          h('div', { class: 'night__copy' },
            h('p', { class: 'eyebrow' }, 'Help open the door'),
            h('h2', null, 'Access should ', h('em', null, 'compound.')),
            h('p', null, 'Every contribution helps another student find an opportunity and take it. Want to support the work, or partner with us on placements? Email the team.'),
            h('div', { class: 'night__actions' },
              h('a', { class: 'btn', href: donateHref(), ...external }, 'Donate', donateIcon()),
              h('a', { class: 'link-arrow link-arrow--night', href: `mailto:${SUPPORT.contactEmail}` }, 'Email the team'))),
          h('div', { class: 'night__art' }, thresholdArt())))));
}
