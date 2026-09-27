import { h } from '../dom.js';
import { icon } from '../components/icons.js';

const LEVELS = [
  ['verified', 'shield', 'Verified', 'A reviewer checked the official page recently.'],
  ['source', 'link', 'Source-linked', 'Approved by a reviewer. Details come from the organization’s page and may have changed.'],
  ['unreviewed', 'help', 'Unreviewed', 'Not yet independently checked.'],
  ['demo', 'flag', 'Demo', 'Fictional listings used only during development. They’re always labelled and have no real application.'],
];

export default function about(ctx) {
  ctx.setTitle('About');
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'About'),
      h('h1', null, 'A door that’s open enough to see through.')),
    h('div', { class: 'about' },
      h('section', { class: 'about__block reveal', 'aria-labelledby': 'a1' },
        h('h2', { id: 'a1' }, 'Why we exist'),
        h('div', { style: { display: 'grid', gap: '1.25rem' } },
          h('p', { class: 'about__pull' }, 'Your next opportunity shouldn’t depend on who you know.'),
          h('p', null, 'Opportunities live in counselor emails, university sites, career pages, nonprofit newsletters, Instagram, LinkedIn, and conversations with parents and coaches. Students with strong networks tend to hear about the good ones. Students without those connections can miss them entirely.'),
          h('p', null, 'Open Ajar is a student-founded attempt to change that: one organized place to find opportunities, understand them, and follow them through.'))),
      h('section', { class: 'about__block reveal', 'aria-labelledby': 'a2' },
        h('h2', { id: 'a2' }, 'Why “ajar”'),
        h('div', { style: { display: 'grid', gap: '1.25rem' } },
          h('p', null, 'An ajar door isn’t completely open, but it’s open enough for you to see that something is on the other side.'),
          h('p', null, 'That’s the idea behind the company. Opportunity shouldn’t be hidden behind connections or luck. We make the door easier to find and give you the tools to walk through it.'))),
      h('section', { class: 'about__block reveal', 'aria-labelledby': 'a3' },
        h('h2', { id: 'a3' }, 'How listings get here'),
        h('div', { style: { display: 'grid', gap: '1.25rem' } },
          h('p', null, 'Nothing is published automatically. Every listing, whether submitted by a person or imported from another source, waits in a review queue until an admin approves it, asks for changes, or declines it. Students always apply on the organization’s own site.'),
          h('ul', { class: 'levels' }, LEVELS.map(([k, ic, label, text]) => h('li', null,
            h('strong', { class: `badge badge--${k}` }, icon(ic, { size: 16 }), label), h('span', null, text)))))),
      h('section', { class: 'about__block reveal', 'aria-labelledby': 'a4' },
        h('h2', { id: 'a4' }, 'The longer view'),
        h('div', { style: { display: 'grid', gap: '1.25rem' } },
          h('p', null, 'Students who benefit from Open Ajar can eventually help other students discover opportunities, so that access compounds instead of staying with the people who already have it.'),
          h('div', { class: 'hero__actions' }, h('a', { class: 'btn', href: '#/opportunities' }, 'Browse opportunities', icon('arrow', { cls: 'arrow' })), h('a', { class: 'link-arrow', href: '#/submit' }, 'Submit an opportunity'))))));
}
