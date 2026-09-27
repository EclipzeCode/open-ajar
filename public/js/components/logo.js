/**
 * TEMPORARY BRAND MARK. This whole file is the only place the logo lives.
 * To ship the real identity, replace `brandMark()` (and `BRAND_NAME` if it changes); the header and footer call it and nothing else.
 * The favicon in index.html is separate and should be swapped at the same time.
 */
export const BRAND_NAME = 'Open Ajar';

export function brandMark({ size = 26 } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'wordmark__mark');
  // A door frame, a slice of light, and a leaf swung slightly open.
  svg.innerHTML = `
    <rect x="3" y="2" width="26" height="28" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="8" y="6" width="16" height="24" fill="var(--light)"/>
    <path d="M8 6l10 2.4v21.6L8 30z" fill="var(--paper)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`;
  return svg;
}
