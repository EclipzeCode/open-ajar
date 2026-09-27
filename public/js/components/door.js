import { prefersReducedMotion } from '../dom.js';

/**
 * The hero door opens on load, then eases a little wider as the pointer moves
 * and as you scroll away. Only a CSS custom property is written, inside one rAF,
 * so it stays cheap. Reduced motion gets a fixed, partly open door.
 */
export function initDoor(el, ctx) {
  if (prefersReducedMotion()) { el.style.setProperty('--open', 18); return; }

  const BASE = 20, SCROLL_RANGE = 16, POINTER_RANGE = 5;
  let pointer = 0, scrollT = 0, raf = 0, visible = true;

  const paint = () => {
    raf = 0;
    el.style.setProperty('--open', (BASE + scrollT * SCROLL_RANGE + pointer * POINTER_RANGE).toFixed(2));
  };
  const queue = () => { if (!raf && visible) raf = requestAnimationFrame(paint); };

  const onScroll = () => { scrollT = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.8))); queue(); };
  const onMove = (e) => { pointer = e.clientX / window.innerWidth; queue(); };

  // Start closed, then swing open once the page has settled.
  el.style.setProperty('--open', 0);
  const start = setTimeout(paint, 350);

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 });
  io.observe(el);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  ctx.onCleanup(() => {
    clearTimeout(start); cancelAnimationFrame(raf); io.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pointermove', onMove);
  });
}
