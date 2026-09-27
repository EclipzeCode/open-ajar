/** US states + DC. Used to derive a filterable state from a listing's free-text location. */
export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'Washington, D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATES).map(([c, n]) => [n.toLowerCase(), c]));
// "Washington" the state vs "Washington, D.C." — handle DC explicitly below.
const CODES = new Set(Object.keys(STATES));
const NON_STATE = /\b(online|remote|nationwide|virtual|anywhere|varies|multiple|various|united states|u\.s\.|usa)\b/i;

/** Returns a 2-letter state code (or 'DC'), or null when the location has no single US state. */
export function stateFromLocation(location) {
  if (!location || typeof location !== 'string') return null;
  const loc = location.trim();
  if (!loc) return null;
  if (/washington,?\s*d\.?c\.?|,\s*dc\b|\bdistrict of columbia\b/i.test(loc)) return 'DC';
  // Trailing ", ST" or " ST" abbreviation (most City, ST cases).
  const m = loc.match(/[,\s]([A-Za-z]{2})\)?\.?\s*$/);
  if (m && CODES.has(m[1].toUpperCase())) return m[1].toUpperCase();
  // Any ", ST" inside the string.
  const m2 = loc.match(/,\s*([A-Za-z]{2})\b/);
  if (m2 && CODES.has(m2[1].toUpperCase())) return m2[1].toUpperCase();
  if (NON_STATE.test(loc)) return null;
  // Full state name appears in the text.
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (name === 'washington' || name === 'washington, d.c.') continue; // ambiguous / handled above
    if (new RegExp('\\b' + name.replace(/[.]/g, '\\.') + '\\b', 'i').test(loc)) return code;
  }
  if (/\bwashington\b/i.test(loc)) return 'WA';
  return null;
}
