import { h } from '../dom.js';
import { icon } from './icons.js';
import { api } from '../api.js';
import { session } from '../session.js';

const initial = (name) => (name || '?').trim().slice(0, 1).toUpperCase();

/** One quote card: quote mark, the words, then an initial avatar with name and role. */
function card(t) {
  return h('figure', { class: 'voice' },
    h('span', { class: 'voice__mark', 'aria-hidden': 'true' }, '“'),
    t.isDemo ? h('span', { class: 'voice__demo' }, 'Demo') : null,
    h('blockquote', { class: 'voice__quote' }, t.quote),
    h('figcaption', { class: 'voice__by' },
      h('span', { class: 'voice__avatar', 'aria-hidden': 'true' }, initial(t.name)),
      h('span', { class: 'voice__id' },
        h('span', { class: 'voice__name' }, t.name),
        t.role ? h('span', { class: 'voice__role' }, t.role) : null)));
}

/**
 * The "Community Voices" section. Fetches approved testimonials and renders a horizontal, scroll-snapping
 * row of cards. Returns an empty placeholder that removes itself if there are no approved quotes, so the
 * home page never shows an empty section or an invented testimonial.
 */
export function voicesSection() {
  const root = h('div');

  api.get('/api/testimonials').then(({ items }) => {
    if (!items.length) { root.remove(); return; }
    // The belt scrolls one full copy of the list, then repeats. We render the list twice so the loop is
    // seamless; the second copy is aria-hidden so screen readers and tab order only see each quote once.
    const lane = (hidden) => items.map((t) => h('div', { class: 'voices__item', role: hidden ? null : 'listitem', 'aria-hidden': hidden ? 'true' : null }, card(t)));
    const track = h('div', { class: 'voices__track' }, ...lane(false), ...lane(true));
    // Constant, smooth speed in pixels per second (independent of how many cards there are), so the belt
    // glides at the same steady rate as the reference. Duration = distance of one full copy / speed.
    const SPEED = 38; // px per second
    // Estimate up front so it never sits on the fallback, then refine from the real measured width.
    const estCard = Math.min(288, Math.round(innerWidth * 0.78)) + 16;
    track.style.setProperty('--voices-dur', `${Math.max(20, Math.round((items.length * estCard) / SPEED))}s`);
    const applyDur = () => {
      const half = track.scrollWidth / 2;
      if (half > 0) { track.style.setProperty('--voices-dur', `${Math.round(half / SPEED)}s`); return true; }
      return false;
    };
    // Timers fire even while the pane/tab is hidden (rAF does not), so measurement always lands.
    if (!applyDur()) { let n = 0; const id = setInterval(() => { if (applyDur() || ++n > 20) clearInterval(id); }, 100); }

    root.replaceChildren(
      h('section', { class: 'section voices', 'aria-labelledby': 'voices-h' },
        h('div', { class: 'container' },
          h('div', { class: 'section__head section__head--center' },
            h('p', { class: 'eyebrow' }, 'Community voices'),
            h('h2', { id: 'voices-h' }, 'What students say.'),
            h('p', null, 'Hear from students about their experience with Open Ajar and the difference it made.')),
          session.demoMode && items.some((t) => t.isDemo)
            ? h('p', { class: 'voices__note' }, 'Development build: cards marked Demo are examples, not real students.') : null),
        h('div', { class: 'voices__viewport', role: 'list', 'aria-label': 'Student quotes' }, track)));
  }).catch(() => root.remove());

  return root;
}
