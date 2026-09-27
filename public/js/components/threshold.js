/**
 * Architectural line drawing: a run of doorways receding toward a lit room.
 * Pure SVG, no raster assets, so it's tiny, sharp at any size, and themes with currentColor.
 */
export function thresholdArt({ frames = 6 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 400, H = 500, floor = 452;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'threshold');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const vp = { x: 236, y: 250 };                    // vanishing point, just right of centre
  const rects = [];
  for (let i = 0; i < frames; i++) {
    const s = Math.pow(0.66, i);
    const w = 300 * s, h = 430 * s;
    const cx = W / 2 + (vp.x - W / 2) * (1 - s), bottom = floor + (vp.y - floor) * (1 - s);
    rects.push({ x: cx - w / 2, y: bottom - h, w, h, i });
  }

  const parts = [];
  const first = rects[0], last = rects[rects.length - 1];
  // Floor and lintel lines converge on the vanishing point.
  parts.push(`<line class="t-line" x1="${first.x}" y1="${first.y + first.h}" x2="${last.x}" y2="${last.y + last.h}"/>`);
  parts.push(`<line class="t-line" x1="${first.x + first.w}" y1="${first.y + first.h}" x2="${last.x + last.w}" y2="${last.y + last.h}"/>`);
  parts.push(`<line class="t-line" x1="${first.x}" y1="${first.y}" x2="${last.x}" y2="${last.y}"/>`);
  parts.push(`<line class="t-line" x1="${first.x + first.w}" y1="${first.y}" x2="${last.x + last.w}" y2="${last.y}"/>`);
  for (const r of rects) {
    parts.push(`<rect class="t-frame" x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}"/>`);
  }
  parts.push(`<rect class="t-light" x="${(last.x + 1).toFixed(1)}" y="${(last.y + 1).toFixed(1)}" width="${(last.w - 2).toFixed(1)}" height="${(last.h - 2).toFixed(1)}"/>`);
  svg.innerHTML = parts.join('');
  return svg;
}
