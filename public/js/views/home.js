import { h, observeReveals } from '../dom.js';
import { icon } from '../components/icons.js';
import { initDoor } from '../components/door.js';
import { thresholdArt } from '../components/threshold.js';
import { opportunityRow } from '../components/opportunity-row.js';
import { voicesSection } from '../components/voices.js';
import { api } from '../api.js';
import { session } from '../session.js';

const SOURCES = [
  'School counselor emails', 'University websites', 'Company career pages', 'Nonprofit newsletters',
  'Instagram', 'LinkedIn', 'Word of mouth', 'Parents and coaches', 'A lucky Google search',
];

const STEPS = [
  ['Discover', 'Search and filter real opportunities by interest, grade, location, cost, deadline and commitment.'],
  ['Evaluate', 'See eligibility, deadlines, pay or cost, requirements, who’s behind it, and how well we’ve verified it.'],
  ['Save', 'Keep the ones worth coming back to, synced across your devices.'],
  ['Prepare', 'Turn requirements into a checklist. Add notes and your own deadline.'],
  ['Apply', 'Go straight to the organization’s actual application. We never sit in the middle.'],
  ['Track', 'Move each one from Interested to Preparing, Applied, Interview, Accepted and Completed.'],
];

export default function home(ctx) {
  const door = h('div', { class: 'door', 'aria-hidden': 'true' },
    h('div', { class: 'door__frame' }, h('div', { class: 'door__floor' })),
    h('div', { class: 'door__spill' }),
    h('div', { class: 'door__leaf' }, h('span', { class: 'door__knob' })));
  initDoor(door, ctx);

  const featured = h('div', { class: 'rows', 'aria-live': 'polite' });
  const featuredFoot = h('div', { class: 'featured__foot' });
  // Live reach stat for the hero. Counts distinct states from the public facets so it can never overstate.
  const heroStat = h('p', { class: 'hero__stat', hidden: true });

  api.get('/api/opportunities?limit=5').then(({ items, total, facets }) => {
    const states = Object.keys(facets?.state || {}).length;
    if (total && states > 1) {
      heroStat.replaceChildren(h('strong', null, String(total)), ' opportunities across ', h('strong', null, String(states)), ' states.');
      heroStat.hidden = false;
    }
    if (!items.length) {
      featured.replaceChildren(h('p', { class: 'note', style: { padding: '1.5rem 0' } }, 'No opportunities are published yet. Check back soon, or submit one.'));
    } else {
      featured.replaceChildren(...items.map((o, i) => opportunityRow(o, ctx, { index: i })));
      observeReveals(featured, ctx);
    }
    featuredFoot.replaceChildren(
      h('a', { class: 'link-arrow', href: '#/opportunities' }, total ? `See all ${total} opportunities` : 'Browse opportunities', icon('arrow')),
      session.demoMode ? h('p', { class: 'note' }, 'Development build: listings marked Demo are fictional and exist only to test the product.') : null);
  }).catch(() => {
    featured.replaceChildren(h('p', { class: 'note', style: { padding: '1.5rem 0' } }, 'Listings are unavailable right now. Try Discover again in a moment.'));
    featuredFoot.replaceChildren(h('a', { class: 'link-arrow', href: '#/opportunities' }, 'Browse opportunities', icon('arrow')));
  });

  // Community Voices: approved student quotes. The whole section stays hidden until at least one exists,
  // so it never shows an empty shell or a fabricated quote.
  const voices = voicesSection(ctx);

  const scrollToJourney = (e) => {
    e.preventDefault();
    document.getElementById('journey').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return h('div', null,
    h('section', { class: 'hero' },
      h('div', { class: 'container hero__grid' },
        h('div', { class: 'hero__copy' },
          h('p', { class: 'eyebrow' }, 'Student-founded · Built for high-school students'),
          h('h1', null, 'Your next opportunity shouldn’t depend on ', h('em', null, 'who you know.')),
          h('p', { class: 'hero__sub' }, 'Open Ajar helps high-school students find internships and real, hands-on experience, then go from finding one to actually landing it.'),
          h('div', { class: 'hero__actions' },
            h('a', { class: 'btn', href: '#/apply' }, 'Become an intern', icon('arrow', { cls: 'arrow' })),
            h('a', { class: 'link-arrow', href: '#/opportunities' }, 'Browse opportunities', icon('arrow'))),
          heroStat),
        h('div', { class: 'hero__stage' }, door,
          h('p', { class: 'hero__caption' }, 'Not wide open. Open enough to see what’s there.')))),

    h('section', { class: 'scatter', 'aria-labelledby': 'scatter-h' },
      h('div', { class: 'container' },
        h('div', { class: 'scatter__grid' },
          h('h2', { class: 'scatter__lead reveal', id: 'scatter-h' }, 'Right now, opportunity is scattered.'),
          h('ul', { class: 'sources' }, SOURCES.map((s, i) => h('li', { class: 'reveal', style: { '--i': i % 4 } }, h('span', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), s)))),
        h('div', { class: 'scatter__turn reveal' },
          h('p', null, 'If you’re well connected, some of these reach you. If you’re not, most of them never do.'),
          h('strong', null, 'Open Ajar puts them in one place.')))),

    h('section', { class: 'section', id: 'journey', 'aria-labelledby': 'journey-h' },
      h('div', { class: 'container journey' },
        h('div', { class: 'section__head' },
          h('p', { class: 'eyebrow' }, 'Beyond a list'),
          h('h2', { id: 'journey-h' }, 'From finding it to walking through.'),
          h('p', null, 'Open Ajar isn’t a giant list. It follows an opportunity the whole way.')),
        h('ol', { class: 'journey__list' }, STEPS.map(([t, d], i) => h('li', { class: 'step reveal' },
          h('span', { class: 'step__n', 'aria-hidden': 'true' }, i + 1),
          h('div', null, h('h3', null, t), h('p', null, d))))))),

    h('section', { class: 'section', 'aria-labelledby': 'featured-h', style: { paddingTop: '0' } },
      h('div', { class: 'container' },
        h('div', { class: 'section__head' },
          h('p', { class: 'eyebrow' }, 'Featured'),
          h('h2', { id: 'featured-h' }, 'Open right now.')),
        featured, featuredFoot)),

    h('section', { class: 'jobs-band', 'aria-labelledby': 'biz-h' },
      h('div', { class: 'container jobs-band__inner' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'For businesses'),
          h('h2', { id: 'biz-h' }, 'Host a high-school intern.'),
          h('p', null, 'Run a small business or restaurant and could use an extra pair of hands? We help place motivated high-school students as interns, so you get help and a student gets real experience.')),
        h('div', { class: 'jobs-band__actions' },
          h('a', { class: 'btn', href: 'mailto:openajar27116@gmail.com?subject=Hosting%20an%20intern%20with%20Open%20Ajar' }, 'Partner with us', icon('arrow', { cls: 'arrow' })),
          h('a', { class: 'link-arrow', href: '#/opportunities?type=Internship' }, 'Browse internships', icon('arrow'))))),

    voices,

    h('section', { class: 'night', 'aria-labelledby': 'compound-h' },
      h('div', { class: 'night__wrap' },
        h('div', { class: 'container night__inner' },
          h('div', { class: 'night__copy' },
            h('p', { class: 'eyebrow' }, 'The longer idea'),
            h('h2', { id: 'compound-h' }, 'Access should ', h('em', null, 'compound.')),
            h('p', null, 'Students who find their way through can help the next student find theirs. Know an opportunity worth sharing? Put it in front of the students who need it.'),
            h('div', { class: 'night__actions' },
              h('a', { class: 'btn', href: '#/opportunities' }, 'Start with what’s in reach', icon('arrow', { cls: 'arrow' })),
              h('a', { class: 'link-arrow link-arrow--night', href: '#/submit' }, 'Submit an opportunity'))),
          h('div', { class: 'night__art' }, thresholdArt())))));
}
