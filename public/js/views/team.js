import { h } from '../dom.js';
import { icon } from '../components/icons.js';
import { TEAM, CREW, TEAM_CONTACT } from '../data/team.js';

const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function person(p, i) {
  const portrait = p.photo
    ? h('img', { class: 'person__img', src: p.photo, alt: `Portrait of ${p.name}`, width: '640', height: '800', loading: 'lazy', decoding: 'async' })
    : h('div', { class: 'person__mono', 'aria-hidden': 'true' }, h('span', null, initials(p.name)));
  const contact = [
    p.email ? h('a', { class: 'link-arrow', href: `mailto:${p.email}` }, p.email) : null,
    ...(p.links || []).map((l) => h('a', { class: 'link-arrow', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label, icon('external', { size: 16 }), h('span', { class: 'sr-only' }, '(opens in a new tab)'))),
  ].filter(Boolean);

  return h('article', { class: `person reveal person--${i % 2 ? 'b' : 'a'}`, 'aria-labelledby': `person-${i}` },
    h('div', { class: 'person__frame' }, portrait),
    h('div', { class: 'person__body' },
      h('p', { class: 'eyebrow' }, p.role),
      h('h2', { id: `person-${i}`, class: 'person__name' }, p.name),
      p.bio ? h('p', { class: 'person__bio' }, p.bio) : null,
      contact.length ? h('div', { class: 'person__contact' }, contact) : null));
}

function memberCard(p, i) {
  const badge = p.photo
    ? h('img', { class: 'member__img', src: p.photo, alt: `Portrait of ${p.name}`, width: '160', height: '160', loading: 'lazy', decoding: 'async' })
    : h('div', { class: 'member__mono', 'aria-hidden': 'true' }, initials(p.name));
  const links = [
    p.email ? h('a', { class: 'link-arrow', href: `mailto:${p.email}` }, p.email) : null,
    ...(p.links || []).map((l) => h('a', { class: 'link-arrow', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label, icon('external', { size: 16 }), h('span', { class: 'sr-only' }, '(opens in a new tab)'))),
  ].filter(Boolean);
  return h('article', { class: 'member reveal', 'aria-labelledby': `member-${i}` }, badge,
    h('div', { class: 'member__body' },
      h('h3', { id: `member-${i}`, class: 'member__name' }, p.name),
      h('p', { class: 'member__role' }, p.role),
      p.bio ? h('p', { class: 'member__bio' }, p.bio) : null,
      links.length ? h('div', { class: 'member__contact' }, links) : null));
}

export default function team(ctx) {
  ctx.setTitle('Team');
  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Team'),
      h('h1', null, 'The people behind Open Ajar.'),
      h('p', null, 'Open Ajar was founded by Jayden Lee, a high-school student who saw how much opportunity depends on who you know.')),
    h('div', { class: 'team' }, TEAM.map(person)),
    CREW.length ? h('section', { class: 'team-more', 'aria-labelledby': 'crew-h' },
      h('h2', { id: 'crew-h', class: 'team-more__h' }, 'The rest of the team'),
      h('div', { class: 'crew' }, CREW.map(memberCard))) : null,
    TEAM_CONTACT.email ? h('section', { class: 'team__contact reveal', 'aria-labelledby': 'tc-h' },
      h('h2', { id: 'tc-h' }, TEAM_CONTACT.label),
      h('a', { class: 'btn', href: `mailto:${TEAM_CONTACT.email}` }, `Email ${TEAM_CONTACT.email}`)) : null);
}
