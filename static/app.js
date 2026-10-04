// Small progressive enhancements. Every page works without this file.

// Fade sections up as they scroll into view
document.documentElement.classList.add('js');
const seen = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); seen.unobserve(e.target); }
}), { rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach((el) => seen.observe(el));

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Home: the search pill types a keyword, pauses, erases it, and moves to the next. Clicking searches that keyword.
const typer = document.querySelector('.typer[data-words]');
if (typer) {
  const words = typer.dataset.words.split('|');
  const out = typer.querySelector('.typer__word');
  const base = typer.getAttribute('href').split('?')[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const type = async (word) => { for (let n = 1; n <= word.length; n++) { out.textContent = word.slice(0, n); await sleep(65 + Math.random() * 45); } };
  const erase = async (word) => { for (let n = word.length - 1; n >= 0; n--) { out.textContent = word.slice(0, n); await sleep(28); } };
  (async function loop() {
    for (let i = 0; ; i = (i + 1) % words.length) {
      typer.href = `${base}?q=${encodeURIComponent(words[i])}`;
      if (calm) { out.textContent = words[i]; await sleep(2600); continue; }
      if (out.textContent !== words[i]) await type(words[i]); // the first word is already on the page
      await sleep(1700);
      await erase(words[i]);
      await sleep(250);
    }
  })();
}

// Home: numbers count up once they're on screen
const counter = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  counter.unobserve(e.target);
  const el = e.target, end = Number(el.dataset.count), t0 = performance.now(), ms = 1200;
  if (calm || !end) return;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
document.querySelectorAll('[data-count]').forEach((el) => counter.observe(el));

// Home: open the door as its section scrolls by (sets --p from 0 to 1), and tilt the scene a touch toward the pointer
const doorway = document.querySelector('.doorway');
if (doorway && !calm) {
  let queued = false;
  const update = () => {
    queued = false;
    const r = doorway.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    doorway.style.setProperty('--p', p.toFixed(3));
    doorway.classList.toggle('is-open', p > .55); // the links behind the door only respond once you can see them
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
  if (matchMedia('(pointer: fine)').matches) {
    const scene = doorway.querySelector('.doorway__scene');
    doorway.addEventListener('pointermove', (e) => {
      const r = scene.getBoundingClientRect();
      doorway.style.setProperty('--mx', (((e.clientX - r.left) / r.width) - .5).toFixed(3));
      doorway.style.setProperty('--my', (((e.clientY - r.top) / r.height) - .5).toFixed(3));
    });
    doorway.addEventListener('pointerleave', () => { doorway.style.setProperty('--mx', 0); doorway.style.setProperty('--my', 0); });
  }
}

// Home: the hero grid square under the pointer lifts; squares it leaves fade out behind it
const cells = document.querySelector('.hero__cells');
if (cells && !calm && matchMedia('(pointer: fine)').matches) {
  const hero = cells.parentElement, SIZE = 44;
  let current = null, key = '';
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / SIZE) * SIZE, y = Math.floor((e.clientY - r.top) / SIZE) * SIZE;
    if (`${x},${y}` === key) return;
    key = `${x},${y}`;
    leave();
    current = document.createElement('span');
    current.className = 'hero__cell';
    current.style.left = `${x}px`; current.style.top = `${y}px`;
    current.style.opacity = Math.max(0, 1 - (y / r.height) * 1.1).toFixed(2); // fade out toward the bottom like the grid
    cells.append(current);
  });
  hero.addEventListener('pointerleave', () => { leave(); key = ''; });
  function leave() {
    if (!current) return;
    const el = current; current = null;
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

// Mobile menu
const menuBtn = document.querySelector('.menu-btn');
menuBtn?.addEventListener('click', () => {
  const open = document.getElementById('nav').classList.toggle('is-open');
  menuBtn.setAttribute('aria-expanded', open);
});

// Form errors: our own message under each field instead of the browser's pop-up bubbles.
// The server still checks everything; this just gives quicker, nicer feedback.
const labelText = (el) => {
  const id = el.id.replace(/-native$/, '');
  const label = id && document.querySelector(`label[for="${id}"]`);
  const fieldset = el.closest('fieldset');
  const text = label ? label.textContent : fieldset?.querySelector('legend')?.textContent || el.getAttribute('aria-label') || '';
  return text.replace(/\(optional\)/i, '').trim();
};
const messageFor = (el) => {
  const v = el.validity, name = labelText(el).toLowerCase();
  if (v.valueMissing) {
    if (el.type === 'email') return 'Enter your email address';
    if (el.type === 'password') return name ? `Enter your ${name.replace(/^your /, '')}` : 'Enter your password';
    if (el.tagName === 'SELECT' || el.type === 'radio') return name ? `Choose ${name}` : 'Choose an option';
    if (el.type === 'checkbox') return 'Tick this box to continue';
    return name ? `Enter ${name}` : 'Fill in this field';
  }
  if (v.typeMismatch) return el.type === 'email' ? 'Enter a valid email address, like name@example.com' : 'Enter a full link starting with https://';
  if (v.tooShort) return `Use at least ${el.minLength} characters (you have ${el.value.length})`;
  if (v.tooLong) return `Use ${el.maxLength} characters or fewer`;
  if (v.badInput || v.patternMismatch) return 'That doesn’t look right. Check it and try again';
  return el.validationMessage;
};
const shownOn = (el) => (el.classList.contains('dd__native') ? el.parentElement.querySelector('.dd__btn') : el);
function clearError(el) {
  const target = shownOn(el);
  target.removeAttribute('aria-invalid');
  (el.closest('.field') || el.parentElement).querySelectorAll('.field__error').forEach((p) => p.remove());
}
function showError(el, msg) {
  clearError(el);
  const target = shownOn(el), box = el.closest('.field') || el.parentElement;
  const p = document.createElement('p');
  p.className = 'field__error';
  p.id = `${el.name || 'field'}-err-${Math.random().toString(36).slice(2, 7)}`;
  p.textContent = msg;
  box.append(p);
  target.setAttribute('aria-invalid', 'true');
  target.setAttribute('aria-describedby', p.id);
}
document.querySelectorAll('form').forEach((f) => { f.noValidate = true; });
document.addEventListener('submit', (e) => {
  const bad = [...e.target.elements].filter((el) => el.willValidate && !el.checkValidity());
  if (!bad.length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  bad.forEach((el) => showError(el, messageFor(el)));
  shownOn(bad[0]).focus();
}, true);
// clear a field's message as soon as what's typed becomes valid
['input', 'change'].forEach((type) => document.addEventListener(type, (e) => {
  const el = e.target;
  if (el.willValidate && shownOn(el).getAttribute('aria-invalid') === 'true' && el.checkValidity()) clearError(el);
}));

// "Are you sure?" for destructive buttons and forms
document.addEventListener('click', (e) => {
  const el = e.target.closest('button[data-confirm]');
  if (el && !confirm(el.dataset.confirm)) e.preventDefault();
});
document.addEventListener('submit', (e) => {
  if (e.target.dataset.confirm && !confirm(e.target.dataset.confirm)) e.preventDefault();
});

// Browse filter bar: one panel open at a time; radios apply at once, checkboxes apply when the panel closes
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  const pops = [...form.querySelectorAll('details.fpop')];
  let dirty = false;
  const closeAll = (except) => pops.forEach((d) => { if (d !== except) d.open = false; });
  form.querySelectorAll('.fpop__done').forEach((b) => b.addEventListener('click', () => { b.closest('details').open = false; }));
  pops.forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) closeAll(d);
    else if (dirty) form.requestSubmit();
  }));
  document.addEventListener('click', (e) => { if (!e.target.closest('details.fpop')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pops.filter((d) => d.open).forEach((d) => { d.open = false; d.querySelector('summary').focus(); }); });
  form.addEventListener('formdata', (e) => { // keep URLs tidy: no empty q=, grade=, state=
    for (const [k, v] of [...e.formData]) if (v === '' || (k === 'sort' && v === 'featured')) e.formData.delete(k);
  });
  form.addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox]')) dirty = true;
    else if (e.target.matches('input[type=radio], select')) form.requestSubmit();
  });
});

// Styled dropdowns. Each <select> gets a button + list; the real select stays (hidden) so forms submit exactly as before.
let ddCount = 0;
function enhanceSelect(sel) {
  const id = sel.id || `dd-${++ddCount}`;
  const label = document.querySelector(`label[for="${id}"]`);
  const wrap = document.createElement('div');
  wrap.className = 'dd' + (sel.classList.contains('select--pill') ? ' dd--pill' : '');
  sel.replaceWith(wrap);
  sel.id = `${id}-native`;
  sel.classList.add('dd__native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'dd__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const value = document.createElement('span');
  value.className = 'dd__value';
  value.id = `${id}-value`;
  btn.append(value);
  if (label) { label.id ||= `${id}-label`; btn.setAttribute('aria-labelledby', `${label.id} ${value.id}`); }
  else if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
  ['aria-invalid', 'aria-describedby'].forEach((a) => { if (sel.hasAttribute(a)) btn.setAttribute(a, sel.getAttribute(a)); });

  const list = document.createElement('ul');
  list.className = 'dd__list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.hidden = true;
  const opts = [...sel.options].map((o, i) => {
    const li = document.createElement('li');
    li.className = 'dd__opt' + (o.value === '' ? ' dd__opt--empty' : '');
    li.id = `${id}-opt-${i}`;
    li.setAttribute('role', 'option');
    li.textContent = o.textContent;
    li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the list
    li.addEventListener('click', () => { choose(i); close(true); });
    li.addEventListener('mousemove', () => highlight(i));
    list.append(li);
    return li;
  });
  wrap.append(sel, btn, list);

  let active = sel.selectedIndex;
  const sync = () => {
    const o = sel.options[sel.selectedIndex];
    value.textContent = o ? o.textContent : '';
    btn.classList.toggle('is-placeholder', !o || o.value === '');
    opts.forEach((li, i) => li.setAttribute('aria-selected', i === sel.selectedIndex));
  };
  const highlight = (i) => {
    active = Math.max(0, Math.min(opts.length - 1, i));
    opts.forEach((li, j) => li.classList.toggle('is-active', j === active));
    list.setAttribute('aria-activedescendant', opts[active].id);
    opts[active].scrollIntoView({ block: 'nearest' });
  };
  const choose = (i) => {
    if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    sync();
  };
  const open = () => {
    document.querySelectorAll('.dd.is-open').forEach((d) => d !== wrap && d.dispatchEvent(new Event('dd:close')));
    list.hidden = false; wrap.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
    highlight(Math.max(0, sel.selectedIndex)); list.focus();
  };
  const close = (refocus) => {
    list.hidden = true; wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  };
  wrap.addEventListener('dd:close', () => close(false));
  btn.addEventListener('click', () => (list.hidden ? open() : close(true)));
  btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } });
  let typed = '', typedAt = 0;
  list.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') highlight(active + 1);
    else if (k === 'ArrowUp') highlight(active - 1);
    else if (k === 'Home') highlight(0);
    else if (k === 'End') highlight(opts.length - 1);
    else if (k === 'Enter' || k === ' ') { choose(active); close(true); }
    else if (k === 'Escape') close(true);
    else if (k === 'Tab') { close(false); return; }
    else if (k.length === 1) { // type to jump, e.g. "ne" for New York
      typed = (Date.now() - typedAt > 700 ? '' : typed) + k.toLowerCase(); typedAt = Date.now();
      const hit = opts.findIndex((li) => li.textContent.toLowerCase().startsWith(typed));
      if (hit >= 0) highlight(hit);
    } else return;
    e.preventDefault();
  });
  list.addEventListener('blur', (e) => { if (!wrap.contains(e.relatedTarget)) close(false); });
  sel.form?.addEventListener('reset', () => setTimeout(sync));
  sync();
}
document.querySelectorAll('select:not([multiple])').forEach(enhanceSelect);
document.addEventListener('click', (e) => document.querySelectorAll('.dd.is-open').forEach((d) => { if (!d.contains(e.target)) d.dispatchEvent(new Event('dd:close')); }));

// Admin queue: select-all checkbox
document.querySelector('[data-select-all]')?.addEventListener('change', (e) => {
  e.target.closest('form').querySelectorAll('input[name=ids]').forEach((c) => { c.checked = e.target.checked; });
});

// Tracker: save stage, checklist ticks, deadline and notes in the background as they change
document.querySelectorAll('form[data-autosave]').forEach((form) => {
  const status = form.querySelector('.save-state');
  let timer;
  const save = async () => {
    const body = new FormData(form);
    body.delete('new_item'); // adding an item reloads the page so it shows up
    status.textContent = 'Saving…';
    try {
      const r = await fetch(form.getAttribute('action'), { method: 'POST', body, headers: { 'X-Requested-With': 'fetch' } });
      if (!r.ok) throw new Error();
      status.textContent = 'Saved';
    } catch { status.textContent = 'Couldn’t save. Check your connection and try again.'; }
  };
  form.addEventListener('change', (e) => { if (e.target.name !== 'new_item') { clearTimeout(timer); save(); } });
  form.querySelector('textarea')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 800); });
});
