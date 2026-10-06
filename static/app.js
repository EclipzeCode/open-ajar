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

// Home: the headline's words rise into place one after another
const headline = document.querySelector('.hero h1');
if (headline && !calm) {
  let i = 0;
  const split = (node) => [...node.childNodes].forEach((n) => {
    if (n.nodeType !== 3) return split(n);
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part.trim()) return frag.append(part);
      const w = document.createElement('span'), inner = document.createElement('span');
      w.className = 'word'; inner.textContent = part; inner.style.animationDelay = `${120 + i++ * 70}ms`;
      w.append(inner); frag.append(w);
    });
    n.replaceWith(frag);
  });
  split(headline);
  headline.classList.remove('reveal');
  headline.classList.add('is-split');
}

// Home: feature icons draw their outlines when the card scrolls in
document.querySelectorAll('.feature__icon svg *').forEach((p) => p.setAttribute('pathLength', '1'));

// Home: interest tabs swap the three "open right now" cards in place (each tab is still a normal link)
const explore = document.querySelector('[data-explore]');
if (explore) {
  const grid = document.querySelector('.explore__grid');
  const all = document.querySelector('[data-explore-all]');
  const glider = explore.querySelector('.explore__glider');
  const tabs = [...explore.querySelectorAll('a')];
  const cache = new Map();
  const place = (a) => {
    glider.style.width = `${a.offsetWidth}px`;
    glider.style.transform = `translateX(${a.offsetLeft}px)`;
  };
  const load = async (url) => {
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject())).then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return { cards: [...doc.querySelectorAll('.grid .card')].slice(0, 3), count: doc.querySelector('.results__count')?.textContent.trim() };
      }).catch((e) => { cache.delete(url); throw e; }));
    }
    return cache.get(url);
  };
  tabs.forEach((a) => {
    a.addEventListener('pointerenter', () => load(a.href).catch(() => {})); // warm the cache before the click
    a.addEventListener('click', async (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || a.getAttribute('aria-current') === 'true') return;
      e.preventDefault();
      tabs.forEach((t) => t.setAttribute('aria-current', t === a ? 'true' : 'false'));
      place(a);
      explore.scrollTo({ left: a.offsetLeft - (explore.clientWidth - a.offsetWidth) / 2, behavior: calm ? 'auto' : 'smooth' }); // keep the chosen tab in view on phones
      grid.style.minHeight = `${grid.offsetHeight}px`; // no jump while the cards change
      grid.classList.add('is-leaving');
      try {
        const [{ cards, count }] = await Promise.all([load(a.href), new Promise((r) => setTimeout(r, calm ? 0 : 180))]);
        if (!cards.length) { location.href = a.href; return; }
        grid.replaceChildren(...cards.map((c) => document.importNode(c, true)));
        all.href = a.href;
        all.textContent = `See all ${(count || '').replace(/ results?$/, '')} →`.replace('See all  →', 'See all →');
      } catch { location.href = a.href; return; }
      grid.classList.remove('is-leaving');
      grid.classList.add('is-swapped');
      grid.style.minHeight = '';
    });
  });
  place(tabs[0]);
  addEventListener('resize', () => place(explore.querySelector('[aria-current="true"]')));
  requestAnimationFrame(() => explore.classList.add('is-ready')); // the glider only animates after its first placement
}

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

// Home: once the door is open, its light continues as a ribbon that widens as it curves off the left edge,
// revealed in step with the scroll. It sits behind the content.
const trail = document.querySelector('.trail');
if (trail && doorway) {
  const sec = trail.parentElement, wrap = sec.querySelector('.wrap'), target = wrap.querySelector('h2');
  const spill = doorway.querySelector('.doorway__spill'), sticky = doorway.querySelector('.doorway__sticky');
  const ribbon = trail.querySelector('.trail__ribbon'), reveal = trail.querySelector('.trail__reveal'), grad = trail.querySelector('linearGradient');
  reveal.setAttribute('pathLength', '1');
  let top = 0, span = 1, queued = false;
  const draw = () => {
    queued = false;
    const p = calm ? 1 : Math.min(1, Math.max(0, (innerHeight * .85 - (sec.getBoundingClientRect().top + top)) / span));
    reveal.style.strokeDashoffset = (1 - p).toFixed(4);
  };
  const layout = () => {
    const s = sec.getBoundingClientRect(), sp = spill.getBoundingClientRect(), st = sticky.getBoundingClientRect();
    // where the spill sits once the sticky door scene has scrolled to the end of its section
    const sx = sp.left + sp.width / 2 - s.left;
    top = doorway.getBoundingClientRect().bottom - sticky.offsetHeight + (sp.top - st.top) + sp.height * .5 - s.top;
    const w = s.width, end = Math.max(56, Math.min(180, w * .14)); // final width
    const h = Math.max(120, wrap.offsetTop + target.offsetTop + target.offsetHeight / 2 - top); // level with the heading
    // centerline: straight down out of the light, then a long sweep left until it's past the edge
    const d = `M${sx} 0 C${sx} ${h * .55} ${sx * .55} ${h} ${-end} ${h}`;
    reveal.setAttribute('d', d);
    reveal.style.strokeWidth = `${end * 1.4}px`;
    // outline: walk the centerline and offset each side by half the width, which grows from 6px to `end`
    const len = reveal.getTotalLength(), n = 120, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = reveal.getPointAtLength(len * t), b = reveal.getPointAtLength(Math.min(len, len * t + 1)), c = reveal.getPointAtLength(Math.max(0, len * t - 1));
      const dx = b.x - c.x, dy = b.y - c.y, m = Math.hypot(dx, dy) || 1, half = (3 + (end / 2 - 3) * Math.pow(t, 1.4));
      left.push(`${(a.x - dy / m * half).toFixed(1)} ${(a.y + dx / m * half).toFixed(1)}`);
      right.push(`${(a.x + dy / m * half).toFixed(1)} ${(a.y - dx / m * half).toFixed(1)}`);
    }
    ribbon.setAttribute('d', `M${left.join(' L')} L${right.reverse().join(' L')} Z`);
    grad.setAttribute('x1', sx); grad.setAttribute('y1', 0); grad.setAttribute('x2', 0); grad.setAttribute('y2', h);
    trail.style.top = `${top}px`;
    trail.style.height = `${h + end}px`;
    trail.setAttribute('viewBox', `0 0 ${w} ${h + end}`);
    span = h + w * .35; // a bit more scrolling than its height, since the last stretch runs sideways
    draw();
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(draw); } }, { passive: true });
  addEventListener('resize', layout);
  addEventListener('load', layout); // fonts and images can shift the heading
  layout();
}

// Home: arrows under the testimonials glide the strip one card either way, then it keeps drifting on its own.
// The strip is a looping CSS animation, so stepping means moving the animation's clock (the cards are listed
// twice, so one full loop later looks identical, which lets it wrap in both directions).
const marquee = document.querySelector('.marquee');
if (marquee) {
  const track = marquee.querySelector('.marquee__track');
  let tween = 0;
  document.querySelectorAll('.marquee__btn').forEach((b) => b.addEventListener('click', () => {
    const card = track.querySelector('.quote');
    const step = (card.offsetWidth + parseFloat(getComputedStyle(card).marginLeft) * 2) * +b.dataset.dir;
    const anim = track.getAnimations()[0];
    if (!anim) { marquee.scrollBy({ left: step, behavior: calm ? 'auto' : 'smooth' }); return; } // reduce motion: a plain scroller
    const loop = anim.effect.getTiming().duration;
    let from = anim.currentTime % loop;
    if (from + step / (track.scrollWidth / 2) * loop < 0) from += loop;
    const to = from + step / (track.scrollWidth / 2) * loop, t0 = performance.now(), id = ++tween;
    const frame = (now) => {
      if (id !== tween) return; // a newer click took over
      const p = Math.min(1, (now - t0) / 450);
      anim.currentTime = from + (to - from) * (1 - Math.pow(1 - p, 3));
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
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

// Account page: highlight the section you're looking at in the side menu.
const acctLinks = [...document.querySelectorAll('.acct-nav a[href^="#"]')];
if (acctLinks.length) {
  const cards = [...document.querySelectorAll('.acct-card')];
  const mark = (id) => acctLinks.forEach((a) => a.setAttribute('aria-current', a.hash === `#${id}` ? 'true' : 'false'));
  const update = () => {
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    let id = cards[0].id;
    for (const c of cards) if (c.getBoundingClientRect().top <= 180) id = c.id;
    mark(atEnd ? cards[cards.length - 1].id : id);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
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
const shownOn = (el) => (el.matches('.dd__native, .dp__native') ? el.parentElement.querySelector('.dd__btn') : el);
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

// Styled date picker. Each <input type=date> gets a button + calendar; the real input stays (hidden) so forms submit
// the same YYYY-MM-DD value. Keyboard: arrows move a day/week, PageUp/PageDown a month, Enter picks, Escape closes.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseIso = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const longDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
function enhanceDate(input) {
  const id = input.id || `dp-${++ddCount}`;
  const label = document.querySelector(`label[for="${id}"]`);
  const wrap = document.createElement('div');
  wrap.className = 'dd dp';
  input.replaceWith(wrap);
  input.id = `${id}-native`;
  input.classList.add('dp__native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.className = 'dd__btn dp__btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="dd__value"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const value = btn.firstChild;
  value.id = `${id}-value`;
  if (label) { label.id ||= `${id}-label`; btn.setAttribute('aria-labelledby', `${label.id} ${value.id}`); }
  ['aria-invalid', 'aria-describedby'].forEach((a) => { if (input.hasAttribute(a)) btn.setAttribute(a, input.getAttribute(a)); });

  const pop = document.createElement('div');
  pop.className = 'dp__pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Choose a date');
  pop.hidden = true;
  pop.innerHTML = `<div class="dp__head"><button type="button" class="dp__nav" data-step="-1" aria-label="Previous month">‹</button>
    <span class="dp__title" aria-live="polite"></span><button type="button" class="dp__nav" data-step="1" aria-label="Next month">›</button></div>
    <div class="dp__grid" role="grid"></div>
    <div class="dp__foot"><button type="button" class="dp__link" data-act="clear">Clear</button><button type="button" class="dp__link" data-act="today">Today</button></div>`;
  wrap.append(input, btn, pop);
  const title = pop.querySelector('.dp__title'), grid = pop.querySelector('.dp__grid');

  let focus = new Date();
  const render = () => {
    const sel = parseIso(input.value), today = iso(new Date());
    title.textContent = `${MONTHS[focus.getMonth()]} ${focus.getFullYear()}`;
    const start = new Date(focus.getFullYear(), focus.getMonth(), 1);
    start.setDate(1 - start.getDay()); // back up to Sunday
    grid.innerHTML = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<span class="dp__dow" aria-hidden="true">${d}</span>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dp__day';
      b.textContent = d.getDate();
      b.dataset.date = iso(d);
      b.setAttribute('aria-label', longDate(d));
      b.tabIndex = iso(d) === iso(focus) ? 0 : -1;
      if (d.getMonth() !== focus.getMonth()) b.classList.add('is-out');
      if (iso(d) === today) b.classList.add('is-today');
      if (sel && iso(d) === iso(sel)) { b.classList.add('is-selected'); b.setAttribute('aria-pressed', 'true'); }
      grid.append(b);
    }
  };
  const sync = () => {
    const d = parseIso(input.value);
    value.textContent = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pick a date';
    btn.classList.toggle('is-placeholder', !d);
  };
  const set = (v) => {
    if (input.value !== v) { input.value = v; ['input', 'change'].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true }))); }
    sync();
  };
  const moveTo = (d) => { focus = d; render(); grid.querySelector('[tabindex="0"]').focus(); };
  const open = () => {
    document.querySelectorAll('.dd.is-open').forEach((d) => d !== wrap && d.dispatchEvent(new Event('dd:close')));
    focus = parseIso(input.value) || new Date();
    render();
    pop.hidden = false; wrap.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
    grid.querySelector('[tabindex="0"]').focus();
  };
  const close = (refocus) => {
    pop.hidden = true; wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false');
    if (refocus) btn.focus();
  };
  wrap.addEventListener('dd:close', () => close(false));
  btn.addEventListener('click', () => (pop.hidden ? open() : close(true)));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } });
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.step) { focus = new Date(focus.getFullYear(), focus.getMonth() + +t.dataset.step, 1); render(); }
    else if (t.dataset.date) { set(t.dataset.date); close(true); }
    else if (t.dataset.act === 'clear') { set(''); close(true); }
    else if (t.dataset.act === 'today') { set(iso(new Date())); close(true); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (!e.target.dataset.date) return;
    const y = focus.getFullYear(), m = focus.getMonth(), d = focus.getDate();
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) moveTo(new Date(y, m, d + step));
    else if (e.key === 'PageUp' || e.key === 'PageDown') moveTo(new Date(y, m + (e.key === 'PageUp' ? -1 : 1), Math.min(d, 28)));
    else if (e.key === 'Home') moveTo(new Date(y, m, d - focus.getDay()));
    else if (e.key === 'End') moveTo(new Date(y, m, d + 6 - focus.getDay()));
    else return;
    e.preventDefault();
  });
  pop.addEventListener('focusout', (e) => { if (!wrap.contains(e.relatedTarget) && e.relatedTarget) close(false); });
  input.form?.addEventListener('reset', () => setTimeout(sync));
  sync();
}
document.querySelectorAll('input[type=date]').forEach(enhanceDate);

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
  // Ask "found it here?" as soon as the stage moves to Accepted/Completed
  const stage = form.querySelector('select[name="stage"]');
  const found = form.querySelector('[data-found]');
  if (stage && found) stage.addEventListener('change', () => { found.hidden = !stage.dataset.won.split('|').includes(stage.value); });
  form.querySelector('textarea')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 800); });
});
