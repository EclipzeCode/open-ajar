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

// Home: each feature row slides in from its own side (left for the 1st, 3rd, 5th) as it scrolls into view, while its
// icon rises and draws in on the opposite side. Progress only ever grows, so rows stay put when you scroll back up.
const story = document.querySelector('[data-story]');
if (story && !calm) {
  const ease = (v) => 1 - Math.pow(1 - v, 3);
  const rows = [...story.querySelectorAll('.story__item')].map((el, i) => ({
    el, side: i % 2 ? 1 : -1, seen: 0, text: el.querySelector('.story__text'), icon: el.querySelector('.story__icon'),
    lines: [...el.querySelectorAll('.story__icon svg *')],
  }));
  rows.forEach(({ lines }) => lines.forEach((l) => { l.setAttribute('pathLength', '1'); l.style.strokeDasharray = '1'; }));
  let queued = false;
  const update = () => {
    queued = false;
    for (const row of rows) {
      const t = Math.min(1, Math.max(0, (innerHeight * .92 - row.el.getBoundingClientRect().top) / (innerHeight * .42)));
      if (t <= row.seen && row.seen) continue;
      row.seen = Math.max(row.seen, t);
      const p = ease(row.seen);
      row.text.style.opacity = p.toFixed(3);
      row.text.style.transform = `translateX(${(row.side * (1 - p) * 40).toFixed(2)}vw)`;
      row.icon.style.opacity = p.toFixed(3);
      row.icon.style.transform = `translateY(${((1 - p) * 28).toFixed(2)}vh)`;
      row.lines.forEach((l) => { l.style.strokeDashoffset = (1 - p).toFixed(3); });
    }
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
}

// Home: open the door as its section scrolls by (sets --p from 0 to 1), and tilt the scene a touch toward the pointer.
// It only ever opens further. Once fully open, the section's extra scroll length is removed (and the page shifted by the
// same amount so nothing moves on screen), so scrolling back up passes straight over it.
const doorway = document.querySelector('.doorway');
if (doorway && !calm) {
  let queued = false, opened = 0;
  const update = () => {
    queued = false;
    const r = doorway.getBoundingClientRect();
    const p = opened = Math.max(opened, Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))));
    doorway.style.setProperty('--p', p.toFixed(3));
    doorway.classList.toggle('is-open', p > .55); // the links behind the door only respond once you can see them
    if (p === 1 && !doorway.classList.contains('is-done')) {
      // keep whatever is below the door where it is on screen. The browser's own scroll anchoring would also try to,
      // unpredictably, so it's switched off for this one adjustment and the page is shifted by exactly the change.
      const root = document.documentElement, next = doorway.nextElementSibling, before = next.getBoundingClientRect().top;
      root.style.overflowAnchor = 'none';
      doorway.classList.add('is-done');
      scrollBy({ top: next.getBoundingClientRect().top - before, behavior: 'instant' });
      requestAnimationFrame(() => { root.style.overflowAnchor = ''; });
      document.dispatchEvent(new Event('door:done')); // the ribbon measures from the door
    }
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

// Home: once the door is open, its light continues as a ribbon that starts thin and steadily widens. It flows down
// past the mission heading, loops once around each feature's icon, then runs down into the green band below, turning
// that band's green on the way. It's drawn like a pencil line as you scroll (only up to the tip) and stays drawn.
// The curve is a list of cubic Béziers sampled with plain math: asking the browser for points along a long SVG path
// re-walks it every time and took seconds.
const trail = document.querySelector('.trail');
if (trail && doorway) {
  const sec = trail.parentElement, band = document.querySelector('[data-band]');
  const icons = [...sec.querySelectorAll('.story__icon')];
  const spill = doorway.querySelector('.doorway__spill'), sticky = doorway.querySelector('.doorway__sticky');
  const ribbon = trail.querySelector('.trail__ribbon');
  const grad = trail.querySelector('linearGradient'), mid = trail.querySelector('.trail__mid');
  let top = 0, left = [], right = [], dist = [0], anchors = [[0, 0]], len = 1, shown = -1, seen = 0, queued = false, width = 0;
  const draw = () => {
    queued = false;
    // the tip follows a line near the bottom of the screen; anchors turn that height into a distance along the ribbon
    const tip = innerHeight * .85 - (sec.getBoundingClientRect().top + top);
    let l = 0;
    for (let i = 1; i < anchors.length; i++) {
      const [y0, l0] = anchors[i - 1], [y1, l1] = anchors[i];
      if (tip >= y1) { l = l1; continue; }
      if (tip > y0) l = l0 + (l1 - l0) * (tip - y0) / (y1 - y0);
      break;
    }
    seen = calm ? len : Math.max(seen, l);
    let lo = 0, hi = dist.length - 1; // last sample at or before `seen`
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (dist[m] <= seen) lo = m; else hi = m - 1; }
    if (lo === shown) return;
    shown = lo;
    ribbon.setAttribute('d', lo < 1 ? '' : `M${left.slice(0, lo + 1).join(' L')} L${right.slice(0, lo + 1).reverse().join(' L')} Z`);
  };
  const layout = () => {
    const s = sec.getBoundingClientRect(), sp = spill.getBoundingClientRect(), st = sticky.getBoundingClientRect();
    const w = width = s.width, end = Math.max(40, Math.min(110, w * .08)); // width the ribbon grows to by its end
    // where the spill sits once the door scene has stopped moving
    const sx = sp.left + sp.width / 2 - s.left;
    top = doorway.getBoundingClientRect().bottom - sticky.offsetHeight + (sp.top - st.top) + sp.height * .5 - s.top;
    const k = .5523; // control-point distance for a quarter circle
    const segs = [], marks = []; // cubic segments [x0,y0,x1,y1,x2,y2,x3,y3]; marks: [height, index of segment that ends there]
    let x = sx, y = 0, lastLoop = 0;
    const to = (x1, y1, x2, y2, x3, y3) => { segs.push([x, y, x1, y1, x2, y2, x3, y3]); x = x3; y = y3; };
    icons.forEach((icon) => {
      // where the icon rests (it may still be mid-rise, so measure from its row rather than from itself)
      const row = icon.parentElement.getBoundingClientRect(), size = icon.offsetWidth;
      const cx = row.left + icon.offsetLeft + size / 2 - s.left, cy = row.top + icon.offsetTop + icon.offsetHeight / 2 - s.top - top;
      const R = size * .78 + end * .3;
      const inner = cx < w / 2 ? 1 : -1, o = -inner; // the icon's side facing the middle, and its far side
      const ex = cx + inner * R, drop = (cy - y) * .5;
      to(x, y + drop, ex, cy - drop, ex, cy);
      marks.push([cy - R, segs.length]); // reaching the loop: drawn while the tip comes down to just above the icon
      // one full turn: down the inner side, under, up the far side, over the top, back to where it joined
      to(ex, cy + R * k, cx + inner * R * k, cy + R, cx, cy + R);
      to(cx + o * R * k, cy + R, cx + o * R, cy + R * k, cx + o * R, cy);
      to(cx + o * R, cy - R * k, cx + o * R * k, cy - R, cx, cy - R);
      to(cx + inner * R * k, cy - R, ex, cy - R * k, ex, cy);
      marks.push([cy + R, segs.length]); // the loop itself is traced while the tip passes the icon
      lastLoop = cy;
    });
    // down into the band: straight into its top edge so it reads as pouring into it
    const by = band ? band.getBoundingClientRect().top - s.top - top + 2 : y + 300;
    to(x, y + (by - y) * .55, w / 2, by - (by - y) * .45, w / 2, by);
    marks.push([by - innerHeight * .1, segs.length]);
    // sample every segment about every 5px: point, direction and distance travelled so far
    const pts = [];
    dist = [];
    const segEnd = [];
    segs.forEach(([x0, y0, x1, y1, x2, y2, x3, y3], si) => {
      const rough = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2) + Math.hypot(x3 - x0, y3 - y0)) / 2;
      const steps = Math.max(4, Math.ceil(rough / 5));
      for (let j = si ? 1 : 0; j <= steps; j++) {
        const t = j / steps, u = 1 - t;
        const px = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const py = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        let dx = 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2);
        let dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
        if (!dx && !dy) { dx = x3 - x0; dy = y3 - y0; }
        const prev = pts[pts.length - 1];
        dist.push(prev ? dist[dist.length - 1] + Math.hypot(px - prev[0], py - prev[1]) : 0);
        pts.push([px, py, dx, dy]);
      }
      segEnd.push(dist[dist.length - 1]);
    });
    len = dist[dist.length - 1] || 1;
    anchors = [[0, 0], ...marks.map(([h, i]) => [h, segEnd[i - 1]])];
    // outline: offset each side by half the width, which grows steadily from 4px to `end`
    left = []; right = [];
    pts.forEach(([px, py, dx, dy], i) => {
      const m = Math.hypot(dx, dy) || 1, half = 2 + (end / 2 - 2) * Math.pow(dist[i] / len, .85);
      left.push(`${(px - dy / m * half).toFixed(1)} ${(py + dx / m * half).toFixed(1)}`);
      right.push(`${(px + dy / m * half).toFixed(1)} ${(py - dx / m * half).toFixed(1)}`);
    });
    // pale like the door's light most of the way, then into the band's green after the last loop
    grad.setAttribute('x1', 0); grad.setAttribute('y1', 0); grad.setAttribute('x2', 0); grad.setAttribute('y2', by);
    mid.setAttribute('offset', Math.min(.98, lastLoop / by).toFixed(3));
    const h = by + end;
    trail.style.top = `${top}px`;
    trail.style.height = `${h}px`;
    trail.setAttribute('viewBox', `0 0 ${w} ${h}`);
    seen = Math.min(seen, len);
    shown = -1;
    draw();
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(draw); } }, { passive: true });
  // phones resize the window whenever the address bar slides in or out; only a width change moves anything here
  addEventListener('resize', () => { if (sec.getBoundingClientRect().width !== width) layout(); });
  document.addEventListener('door:done', layout); // the door section shrinks once it's open
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

// FAQ: answers slide open and closed. <details> normally snaps, and CSS can't animate it in every browser,
// so the click is taken over: open, then grow from the closed height (or shrink, then close).
document.querySelectorAll('.faq details').forEach((d) => {
  const summary = d.querySelector('summary');
  let anim = null, want = d.open;
  summary.addEventListener('click', (e) => {
    if (calm) return;
    e.preventDefault();
    const from = d.offsetHeight; // mid-animation too, so a quick second click reverses smoothly
    anim?.cancel();
    want = !want;
    const closing = !want;
    const shut = summary.offsetHeight + parseFloat(getComputedStyle(d).borderBottomWidth);
    d.open = true;
    d.classList.toggle('is-closing', closing); // turns the arrow now rather than when the slide ends
    const to = closing ? shut : d.offsetHeight;
    d.style.overflow = 'hidden';
    anim = d.animate({ height: [`${from}px`, `${to}px`] }, { duration: 280, easing: 'cubic-bezier(.2, .7, .2, 1)', fill: 'forwards' });
    if (!closing) d.querySelector('p')?.animate({ opacity: [0, 1], transform: ['translateY(-4px)', 'none'] }, { duration: 280, easing: 'ease-out' });
    anim.onfinish = () => {
      if (closing) d.open = false;
      d.classList.remove('is-closing');
      d.style.overflow = '';
      anim.cancel(); // drop the held end height now that the real state matches it
      anim = null;
    };
  });
});

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
