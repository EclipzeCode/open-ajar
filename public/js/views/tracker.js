import { h, debounce } from '../dom.js';
import { icon } from '../components/icons.js';
import { skeletonRows, emptyState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { META, fmtDate, daysUntil } from '../meta.js';
import { library } from '../library.js';
import { session } from '../session.js';

export default function tracker(ctx) {
  ctx.setTitle('Your tracker');
  const root = h('div', { class: 'container' });
  const body = h('div');
  const open = new Set();
  let focusAfter = null;

  root.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Tracker'),
      h('h1', null, 'Where everything stands.'),
      h('p', null, 'Saved opportunities and the ones you’re working toward. Synced to your account, so it’s the same on every device.')),
    body);

  function render() {
    if (!session.user) {
      body.replaceChildren(emptyState({
        title: 'Sign in to keep track',
        body: 'Your saved opportunities, notes and application stages live in your account so they follow you from phone to laptop.',
        actions: [h('a', { class: 'btn', href: '#/login?next=%2Ftracker' }, 'Sign in'), h('a', { class: 'btn btn--ghost', href: '#/register?next=%2Ftracker' }, 'Create an account')],
      }));
      return;
    }
    if (!library.ready) { body.replaceChildren(skeletonRows(3)); return; }

    const saved = library.savedIds().filter((id) => !library.trackedEntry(id) && library.opp(id));
    const tracked = library.trackedIds().filter((id) => library.opp(id));

    if (!saved.length && !tracked.length) {
      body.replaceChildren(emptyState({
        title: 'Nothing here yet',
        body: 'Save an opportunity to come back to it, or start tracking one to keep its deadline, notes and checklist together.',
        actions: [h('a', { class: 'btn', href: '#/opportunities' }, 'Browse opportunities', icon('arrow', { cls: 'arrow' }))],
      }));
      return;
    }

    const parts = [];

    // Upcoming deadlines: the student's own date wins, otherwise the listing's official one.
    const dated = tracked.map((id) => {
      const e = library.trackedEntry(id), o = library.opp(id);
      return { id, date: e.deadline || o.deadlineDate, own: !!e.deadline, stage: e.stage, o };
    }).filter((x) => x.date && !['Accepted', 'Completed'].includes(x.stage) && daysUntil(x.date) >= -1)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    if (dated.length) {
      parts.push(h('section', { class: 'next-up', 'aria-labelledby': 'next-h' },
        h('h2', { id: 'next-h', class: 'eyebrow' }, 'Your next deadlines'),
        h('ul', null, dated.map(({ id, date, own, o }) => {
          const d = daysUntil(date);
          const rel = d < 0 ? 'Yesterday' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
          return h('li', { class: d >= 0 && d <= 7 ? 'is-soon' : '' },
            h('a', { href: `#/o/${id}` }, o.title, own ? null : h('span', { class: 'muted' }, ' · official date')),
            h('time', { datetime: date }, `${fmtDate(date)} · ${rel}`));
        }))));
    }

    const groups = [{ key: 'Saved', ids: saved, saved: true }, ...META.stages.map((s) => ({ key: s, ids: tracked.filter((id) => library.trackedEntry(id).stage === s) }))];

    parts.push(h('nav', { class: 'stagenav', 'aria-label': 'Jump to stage' },
      groups.map((g) => h('a', { href: '#/tracker', 'data-n': g.ids.length, onclick: (e) => { e.preventDefault(); document.getElementById(`stage-${g.key}`)?.scrollIntoView({ behavior: 'smooth' }); } },
        g.key, h('span', { class: 'n' }, g.ids.length)))));

    groups.forEach((g) => {
      parts.push(h('section', { class: 'stage', id: `stage-${g.key}`, 'aria-labelledby': `stage-h-${g.key}` },
        h('div', { class: 'stage__head' }, h('h2', { id: `stage-h-${g.key}` }, g.key), h('span', null, g.ids.length)),
        g.ids.length ? g.ids.map((id) => item(id, g.saved)) : h('p', { class: 'stage__empty' }, g.saved ? 'Saved opportunities you haven’t started tracking appear here.' : 'Nothing at this stage.')));
    });

    body.replaceChildren(...parts);
    if (focusAfter) { document.getElementById(`toggle-${focusAfter}`)?.focus(); focusAfter = null; }
  }

  function item(id, isSavedOnly) {
    const opp = library.opp(id);
    const entry = library.trackedEntry(id);
    const isOpen = open.has(id);
    const panelId = `panel-${id}`;
    const sub = [opp.type, isSavedOnly ? null : entry.deadline && `Due ${fmtDate(entry.deadline)}`, opp.available === false ? 'No longer listed' : null].filter(Boolean).join(' · ');

    const toggle = h('button', {
      type: 'button', class: 'item__toggle', id: `toggle-${id}`, 'aria-expanded': String(isOpen), 'aria-controls': panelId,
      onclick: () => { open.has(id) ? open.delete(id) : open.add(id); focusAfter = id; render(); },
    }, h('span', null, h('span', { class: 'item__title' }, opp.title), h('span', { class: 'item__sub' }, sub)), icon('chevron', { cls: 'item__chev' }));

    const panel = h('div', { class: 'item__panel', id: panelId, role: 'region', 'aria-labelledby': `toggle-${id}`, hidden: !isOpen });
    if (isOpen) panel.append(isSavedOnly ? savedPanel(opp) : trackedPanel(opp, entry));
    return h('div', { class: 'item' }, h('h3', { class: 'item__h' }, toggle), panel);
  }

  function savedPanel(opp) {
    return h('div', { class: 'item__foot' },
      opp.available === false ? null : h('button', { type: 'button', class: 'btn', onclick: async () => { open.add(opp.id); focusAfter = opp.id; if (await library.track(opp)) toast(`Tracking “${opp.title}”`); } }, icon('plus', { size: 18 }), 'Start tracking'),
      h('a', { class: 'link-arrow', href: `#/o/${opp.id}` }, 'View details', icon('arrow')),
      h('button', { type: 'button', class: 'danger', onclick: () => { library.toggleSave(opp); toast(`Removed “${opp.title}”`, { label: 'Undo', onClick: () => library.toggleSave(opp) }); } }, 'Remove from saved'));
  }

  function trackedPanel(opp, entry) {
    const id = opp.id;
    const stage = h('select', { class: 'select', id: `stage-${id}` }, META.stages.map((s) => h('option', { value: s }, s)));
    stage.value = entry.stage;
    stage.addEventListener('change', () => { focusAfter = id; library.update(id, { stage: stage.value }); toast(`Moved to ${stage.value}`); });

    const date = h('input', { class: 'input', type: 'date', id: `date-${id}`, value: entry.deadline || '' });
    date.addEventListener('change', () => { focusAfter = id; library.update(id, { deadline: date.value }); });

    const notes = h('textarea', { class: 'textarea', id: `notes-${id}`, maxlength: '2000', placeholder: 'Who to ask for a recommendation, essay ideas, questions to answer…' });
    notes.value = entry.notes || '';
    const saveNotes = debounce(() => library.update(id, { notes: notes.value }, { silent: true }), 500);
    notes.addEventListener('input', saveNotes);
    notes.addEventListener('blur', () => library.update(id, { notes: notes.value }, { silent: true }));

    const list = h('div', { class: 'checklist', role: 'group', 'aria-label': 'Preparation checklist' });
    const drawList = () => {
      list.replaceChildren(...entry.checklist.map((c, i) => {
        const box = h('input', { type: 'checkbox' });
        box.checked = c.done;
        const label = h('label', { class: `check${c.done ? ' is-done' : ''}` }, box, h('span', null, c.text));
        box.addEventListener('change', () => {
          const next = entry.checklist.map((x, j) => (j === i ? { ...x, done: box.checked } : x));
          entry.checklist = next;
          label.classList.toggle('is-done', box.checked);
          library.update(id, { checklist: next }, { silent: true });
        });
        return label;
      }));
    };
    drawList();

    const addInput = h('input', { class: 'input', type: 'text', id: `add-${id}`, 'aria-label': 'Add a checklist item', placeholder: 'Add a step', maxlength: '200' });
    const addItem = () => {
      const t = addInput.value.trim();
      if (!t || entry.checklist.length >= 30) return;
      const next = [...entry.checklist, { text: t, done: false }];
      entry.checklist = next;
      library.update(id, { checklist: next }, { silent: true });
      addInput.value = '';
      drawList();
      addInput.focus();
    };
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

    const officialDate = opp.deadlineDate ? `Official deadline: ${fmtDate(opp.deadlineDate)}.` : opp.deadlineNote ? `Official timing: ${opp.deadlineNote.toLowerCase()}.` : '';

    return h('div', { class: 'item__inner' },
      h('div', { class: 'item__grid' },
        h('div', { class: 'field' }, h('label', { for: `stage-${id}` }, 'Stage'), stage),
        h('div', { class: 'field' }, h('label', { for: `date-${id}` }, 'Your deadline'), date, officialDate && h('span', { class: 'help' }, officialDate))),
      h('div', { class: 'field' }, h('span', { class: 'legend' }, 'Prepare'), list,
        h('div', { class: 'item__add' }, addInput, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: addItem }, 'Add'))),
      h('div', { class: 'field' }, h('label', { for: `notes-${id}` }, 'Notes'), notes),
      h('div', { class: 'item__foot' },
        opp.url ? h('a', { class: 'btn btn--light btn--sm', href: opp.url, target: '_blank', rel: 'noopener noreferrer' }, 'Apply on official site', icon('external', { size: 16 }), h('span', { class: 'sr-only' }, '(opens in a new tab)')) : null,
        h('a', { class: 'link-arrow', href: `#/o/${id}` }, 'View details', icon('arrow')),
        h('button', { type: 'button', class: 'danger', onclick: async () => {
          const snapshot = JSON.parse(JSON.stringify(entry));
          await library.untrack(id);
          toast(`Stopped tracking “${opp.title}”`, { label: 'Undo', onClick: () => library.restore(id, snapshot) });
        } }, 'Stop tracking')));
  }

  ctx.onCleanup(library.subscribe(render));
  ctx.onCleanup(session.subscribe(render));
  render();
  return root;
}
