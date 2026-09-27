/**
 * Spreadsheet provider: reads a CSV exported from Google Sheets (File → Download → CSV) or produced by
 * server/scripts/xlsx-to-csv.py, and turns each row into a listing.
 *
 *   node server/scripts/import.js sheet [path/to/file.csv]      (default: data/opportunities.csv)
 *
 * Expected columns (extra columns are ignored):
 *   id, title, organization, type, summary, eligibility, requirements (;-separated), grades (;-separated),
 *   interests (;-separated free tags), cost, cost_note, format, location, commitment, commitment_note,
 *   deadline_date (YYYY-MM-DD), deadline_note, official_url, apply_url (optional), checked_on, group (optional), batch (optional)
 *
 * Nothing is invented: a blank cost becomes "Varies" (the sheet didn't state one), free tags are mapped to the site's
 * filter categories via TAG_MAP (unmapped tags are reported and dropped), and the application link is apply_url when
 * present, otherwise official_url. Every row is imported as Pending Review by the importer, never published.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { parseCsv } from '../services/csv.js';

export const name = 'sheet';

const TAG_MAP = {
  'STEM': ['STEM'], 'Science': ['STEM'], 'Math': ['STEM'], 'Engineering': ['STEM'], 'Physics': ['STEM'], 'Chemistry': ['STEM'], 'Biology': ['STEM'],
  'Aerospace': ['STEM'], 'Space': ['STEM'], 'Robotics': ['STEM'], 'Architecture': ['STEM'], 'Earth science': ['STEM', 'Environment'], 'Logic': ['STEM'],
  'Innovation': ['STEM', 'Business & finance'], 'Making': ['STEM'], 'Natural history': ['STEM', 'Environment'], 'Citizen science': ['STEM', 'Research'],
  'Marine biology': ['STEM', 'Environment'],
  'AI': ['Computer science'], 'Coding': ['Computer science'], 'Computer Science': ['Computer science'], 'Cybersecurity': ['Computer science'], 'Technology': ['Computer science'],
  'Research': ['Research'], 'Biomedical research': ['Research', 'Health & medicine'],
  'Medicine': ['Health & medicine'], 'Health': ['Health & medicine'], 'Health care': ['Health & medicine'], 'First aid': ['Health & medicine'], 'Lifesaving': ['Health & medicine', 'Sports & outdoors'],
  'Business': ['Business & finance'], 'Finance': ['Business & finance'], 'Investing': ['Business & finance'], 'Economics': ['Business & finance'], 'Entrepreneurship': ['Business & finance'],
  'Management': ['Business & finance'], 'Marketing': ['Business & finance'], 'Hospitality': ['Business & finance', 'Career exploration'],
  'Arts': ['Arts & media'], 'Creative': ['Arts & media'], 'Dance': ['Arts & media'], 'Film': ['Arts & media'], 'Music': ['Arts & media'], 'Museums': ['Arts & media'],
  'Theatre': ['Arts & media'], 'Video': ['Arts & media'], 'Media': ['Arts & media'], 'Culture': ['Arts & media', 'Writing & humanities'],
  'Writing': ['Writing & humanities'], 'Creative writing': ['Writing & humanities'], 'Journalism': ['Writing & humanities'], 'History': ['Writing & humanities'],
  'Humanities': ['Writing & humanities'], 'Language': ['Writing & humanities'], 'Languages': ['Writing & humanities'], 'Linguistics': ['Writing & humanities'],
  'Literature': ['Writing & humanities'], 'Poetry': ['Writing & humanities'], 'Social Sciences': ['Writing & humanities'],
  'Civics': ['Civics & law'], 'Government': ['Civics & law'], 'Law': ['Civics & law'], 'Politics': ['Civics & law'], 'Public service': ['Civics & law', 'Service'],
  'Global affairs': ['Civics & law'], 'International affairs': ['Civics & law'], 'Defense': ['Civics & law'], 'Debate': ['Civics & law', 'Leadership'],
  'Community service': ['Service'], 'Community': ['Service'], 'Disaster relief': ['Service'], 'Hunger relief': ['Service'], 'Housing': ['Service'],
  'Disability inclusion': ['Service'], 'Libraries': ['Service'],
  'Leadership': ['Leadership'], 'Public speaking': ['Leadership'], 'Communication': ['Leadership'],
  'Career exploration': ['Career exploration'], 'Career readiness': ['Career exploration'], 'Career training': ['Career exploration'], 'Construction': ['Career exploration'],
  'Trades': ['Career exploration'], 'Workforce': ['Career exploration'], 'Workforce readiness': ['Career exploration'], 'Work experience': ['Career exploration'],
  'Environment': ['Environment'], 'Conservation': ['Environment'], 'Fisheries': ['Environment'], 'Outdoors': ['Environment', 'Sports & outdoors'],
  'Aquatics': ['Sports & outdoors'], 'Athletics': ['Sports & outdoors'], 'Sports': ['Sports & outdoors'],
  'Customer service': ['Career exploration'], 'Retail': ['Career exploration'], 'Food service': ['Career exploration'], 'Entertainment': ['Career exploration'],
  'Events': ['Career exploration'], 'Sports/Recreation': ['Sports & outdoors', 'Career exploration'], 'Childcare': ['Service', 'Career exploration'],
  'Recreation': ['Sports & outdoors'], 'Pets': ['Career exploration'], 'Animal care': ['Career exploration'], 'Warehouse': ['Career exploration'],
  'Grocery': ['Career exploration'], 'Restaurant': ['Career exploration'], 'Camp': ['Career exploration'], 'Tutoring': ['Academics & college prep', 'Service'],
  'Lifeguarding': ['Sports & outdoors', 'Health & medicine'], 'Sales': ['Business & finance', 'Career exploration'],
  'Academics': ['Academics & college prep'], 'College access': ['Academics & college prep'], 'College credit': ['Academics & college prep'],
  'College prep': ['Academics & college prep'], 'College readiness': ['Academics & college prep'], 'Education': ['Academics & college prep', 'Service'],
  'Critical thinking': ['Academics & college prep'],
};

const list = (s) => (s || '').split(';').map((x) => x.trim()).filter(Boolean);

export async function* fetch({ file } = {}) {
  const csvPath = path.resolve(file || process.env.IMPORT_FILE || path.join(config.root, 'data', 'opportunities.csv'));
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  for (const r of rows) {
    const tags = list(r.interests);
    const interests = [...new Set(tags.flatMap((t) => TAG_MAP[t] || []))];
    const unmapped = tags.filter((t) => !TAG_MAP[t]);
    const notes = [];
    if (unmapped.length) notes.push(`unmapped interest tags dropped: ${unmapped.join(', ')}`);
    if (!r.cost) notes.push('cost was blank in the sheet, set to "Varies"');
    yield {
      // Spreadsheet row numbers are reassigned between exports, so a batch label (added by xlsx-to-csv.py --batch) namespaces them.
      externalId: r.batch ? `${r.batch}:${r.id}` : r.id,
      group: r.group || undefined,
      title: r.title, org: r.organization, type: r.type, summary: r.summary, eligibility: r.eligibility,
      requirements: list(r.requirements), grades: list(r.grades).map(Number), interests,
      // A job is paid work, so never label one Free/Varies (which read as "unpaid"); the note keeps any wage caveat.
      cost: (r.type === 'Job' && ['Free', 'Varies', ''].includes(r.cost)) ? 'Award' : (r.cost || 'Varies'), costNote: r.cost_note, format: r.format, location: r.location,
      commitment: r.commitment, commitmentNote: r.commitment_note,
      deadlineDate: r.deadline_date || null, deadlineNote: r.deadline_note,
      url: r.apply_url || r.official_url,
      importNote: `Imported from spreadsheet${r.group ? ` (${r.group} tab)` : ''}${r.checked_on ? `; sheet says checked ${r.checked_on}` : ''}. Official page: ${r.official_url}${notes.length ? `. Notes: ${notes.join('; ')}` : ''}`,
    };
  }
}
