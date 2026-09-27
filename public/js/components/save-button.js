import { h } from '../dom.js';
import { icon } from './icons.js';
import { library } from '../library.js';
import { toast } from './toast.js';

/** Bookmark toggle synced to the student's account. Signed-out visitors are invited to sign in. */
export function saveButton(opp, ctx) {
  const label = h('span', { class: 'save__label' });
  const glyph = h('span', { 'aria-hidden': 'true', style: { display: 'inline-grid' } });
  const btn = h('button', { type: 'button', class: 'save', 'aria-label': `Save ${opp.title}` }, glyph, label);

  const sync = () => {
    const on = library.isSaved(opp.id);
    btn.setAttribute('aria-pressed', on);
    glyph.replaceChildren(icon(on ? 'bookmark-filled' : 'bookmark'));
    label.textContent = on ? 'Saved' : 'Save';
  };

  btn.addEventListener('click', async () => {
    const now = await library.toggleSave(opp);
    if (now === null) return; // needed sign-in; library.js already showed the prompt
    toast(now ? `Saved “${opp.title}”` : `Removed “${opp.title}” from saved`, { label: 'Undo', onClick: () => library.toggleSave(opp) });
  });

  sync();
  ctx?.onCleanup(library.subscribe(sync));
  return btn;
}
