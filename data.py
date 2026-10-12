"""Taxonomy, validation and spreadsheet import. No Flask here, so it is easy to test and reuse from the CLI."""
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlparse

TYPES = ['Internship', 'Job', 'Research program', 'Scholarship', 'Summer program', 'Competition', 'Volunteer',
         'Job shadow', 'Mentorship', 'Academic program', 'Entrepreneurship', 'Arts & athletics']
GRADES = [9, 10, 11, 12]
COSTS = {'Free': 'Free', 'Fee': 'Has a fee', 'Varies': 'Varies', 'Award': 'Pays or awards money'}
FORMATS = ['In person', 'Online', 'Hybrid', 'Varies']
COMMITMENTS = ['One-off', 'Summer', 'School year', 'Flexible']
INTERESTS = ['STEM', 'Computer science', 'Research', 'Health & medicine', 'Business & finance', 'Arts & media',
             'Writing & humanities', 'Civics & law', 'Service', 'Leadership', 'Career exploration', 'Environment',
             'Sports & outdoors', 'Academics & college prep']
# Broad job categories, for the jobs filter and the icon art on job cards (data.job_category applies it).
# A job gets the first category whose keywords appear in its employer name; failing that, in its title (so a "Crew
# Member" at Five Below stays Retail). Order matters within each pass: grocery before food ("Fresh Foods Clerk"),
# entertainment before food (a server at Chuck E. Cheese). Keywords are lowercase, without apostrophes.
JOB_CATEGORIES = {
    'Grocery': ['winco', 'harris teeter', 'wegmans', 'publix', 'edwards food', 'super 1', 'dans foods', 'macey', 'kroger',
                'safeway', 'aldi', 'grocery', 'supermarket', 'bagger', 'courtesy clerk', 'fresh foods'],
    'Entertainment': ['chuck e. cheese', 'cinemark', 'century theatres', 'amc ', 'regal', 'theatre', 'theater', 'cinema',
                      'sky zone', 'dollywood', 'six flags', 'amusement', 'arcade', 'game room', 'bowling', 'trampoline', 'ride '],
    'Food & drink': ['mcdonald', 'chipotle', 'chick-fil-a', 'noodles', 'smoothie', 'sonic', 'raising cane', 'popeyes', 'zaxby',
                     'dairy queen', 'culver', 'wendy', 'taco bell', 'slim chicken', 'shake shack', 'potbelly', 'panera',
                     'jimmy john', 'domino', 'caribou', 'starbucks', 'dunkin', 'subway', 'buffalo wild', 'sunlife organics',
                     'wawa', 'sheetz', 'royal farms', 'restaurant', 'crew', 'kitchen', 'server', 'cook', 'barista', 'carhop',
                     'pizza', 'cafe', 'coffee', 'food'],
    'Recreation & outdoors': ['ymca', 'park', 'forest', 'conservation', 'wildlife', 'ski ', 'resort', 'lifeguard', 'pool',
                              'camp', 'sports', 'referee', 'recreation', 'jcprd', 'golf', 'outdoor'],
    'Community & public service': ['city of', 'county', 'district', 'senate', 'personnel management', 'youth employment',
                                   'summer youth', 'workforce', 'careersource', 'government', 'school', 'mayor',
                                   'youth network', 'department', 'agency', 'library', 'opportunity program', 'pathways',
                                   'township', 'custodian'],
    'Retail': ['five below', 'spirit', 'old navy', 'crocs', 'lego', 'kohl', 'journeys', 'shoe', 'autozone', 'cvs', 'target',
               'walmart', 'sales', 'store', 'retail', 'cashier', 'stock', 'merchandis', 'associate'],
}
JOB_CATEGORY_FALLBACK = 'Retail'


def job_category(org, title):
    """The JOB_CATEGORIES category for a job: employer name first, then title. Stored on the listing (core.opp_values),
    and recomputed for every listing at startup, so editing the keywords above takes effect on the next deploy."""
    for text in (org, title):
        text = (text or '').lower().replace("'", '').replace('’', '')
        for cat, keywords in JOB_CATEGORIES.items():
            if any(k in text for k in keywords):
                return cat
    return JOB_CATEGORY_FALLBACK

CONTACT_TOPICS = ['A question', 'A listing', 'My account', 'Partnering with us', 'Something else']
GRANT_CAP = 250  # dollars per student per calendar year, approved or paid
GRANT_COVERS = ['Application fee', 'Program fee or tuition', 'Test or exam fee', 'Materials or travel', 'Something else']
GRANT_ACCEPTED = {'accepted': 'Yes, I’ve been accepted', 'applied': 'Not yet: I’ve applied', 'not_applied': 'Not yet: I haven’t applied'}
GRANT_ASKED = {'yes': 'Yes, I’ve asked', 'no': 'Not yet', 'none': 'They don’t offer any'}
GRANT_STATUSES = {'new': 'Submitted', 'needs_info': 'Needs info', 'approved': 'Approved', 'paid': 'Paid',
                  'declined': 'Declined', 'withdrawn': 'Withdrawn'}
GRANT_OPEN = ('new', 'needs_info', 'approved')  # a student can have one of these at a time
STAGES = ['Interested', 'Preparing', 'Applied', 'Interview', 'Accepted', 'Completed']
WON_STAGES = ('Accepted', 'Completed')  # when the tracker asks whether they found it on OpenAjar
TO_APPLY = ('Interested', 'Preparing')  # not applied yet: only these get deadline reminders and count as "due soon"
VERIFICATION = {'unreviewed': 'Unreviewed', 'source': 'Source-linked', 'verified': 'Verified'}
RELATIONSHIPS = {'organization_rep': 'I represent the organization', 'counselor_teacher': 'I’m a counselor or teacher',
                 'student_or_parent': 'I’m a student or parent', 'other': 'Something else'}
STATUSES = {'pending_review': 'Pending review', 'changes_requested': 'Changes requested', 'approved': 'Approved',
            'rejected': 'Rejected', 'expired': 'Expired'}
ROLES = ['student', 'organization', 'counselor', 'admin']

STATES = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California', 'CO': 'Colorado',
    'CT': 'Connecticut', 'DE': 'Delaware', 'DC': 'Washington, D.C.', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
    'ME': 'Maine', 'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
    'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota',
    'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
}
_NON_STATE = re.compile(r'\b(online|remote|nationwide|virtual|anywhere|varies|multiple|various|united states|u\.s\.|usa)\b', re.I)


def state_from_location(loc):
    """2-letter state code for a free-text location, or None when it isn't one US state."""
    loc = (loc or '').strip()
    if not loc:
        return None
    if re.search(r'washington,?\s*d\.?c\.?|,\s*dc\b|\bdistrict of columbia\b', loc, re.I):
        return 'DC'
    for pattern in (r'[,\s]([A-Za-z]{2})\)?\.?\s*$', r',\s*([A-Za-z]{2})\b'):
        m = re.search(pattern, loc)
        if m and m.group(1).upper() in STATES:
            return m.group(1).upper()
    if _NON_STATE.search(loc):
        return None
    for code, name in STATES.items():
        if code not in ('WA', 'DC') and re.search(r'\b' + re.escape(name) + r'\b', loc, re.I):
            return code
    return 'WA' if re.search(r'\bwashington\b', loc, re.I) else None


# ---------------------------------------------------------------- validation helpers

_CTRL = re.compile(r'[\x00-\x1f\x7f]')
_CTRL_MULTI = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
EMAIL = re.compile(r'^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$')


def clean(s, multiline=False):
    return (_CTRL_MULTI if multiline else _CTRL).sub('', str(s or '')).strip()


def norm_email(s):
    s = clean(s).lower()
    return s if len(s) <= 320 and EMAIL.match(s) else None


def parse_date(s):
    try:
        return date.fromisoformat(s) if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s or '') else None
    except ValueError:
        return None


def parse_url(s):
    s = clean(s)
    try:
        u = urlparse(s)
    except ValueError:
        return None
    if u.scheme not in ('http', 'https') or not u.netloc or '@' in u.netloc or len(s) > 500:
        return None
    return s


class Form:
    """Collects cleaned values and per-field error messages from a form (anything with .get / .getlist)."""

    def __init__(self, src):
        self.src, self.out, self.errors = src, {}, {}

    def text(self, key, label, min=0, max=200, required=True, multiline=False):
        v = clean(self.src.get(key, ''), multiline)
        if not v:
            if required:
                self.errors[key] = f'Enter {label.lower()}'
            else:
                self.out[key] = ''
        elif len(v) < min:
            self.errors[key] = f'{label} needs at least {min} characters'
        elif len(v) > max:
            self.errors[key] = f'{label} must be {max} characters or fewer'
        else:
            self.out[key] = v

    def one_of(self, key, choices, label):
        v = self.src.get(key, '')
        if v in choices:
            self.out[key] = v
        else:
            self.errors[key] = f'Choose {label}'

    def many(self, key, choices):
        return [v for v in dict.fromkeys(self.src.getlist(key)) if v in choices]

    def grade(self, key='grade'):
        v = self.src.get(key, '')
        if v in ('', None):
            self.out[key] = None
        elif v.isdigit() and int(v) in GRADES:
            self.out[key] = int(v)
        else:
            self.errors[key] = 'Choose a grade from 9 to 12'

    def url(self, key):
        v = clean(self.src.get(key, ''))
        if not v:
            self.out[key] = None
        elif parse_url(v):
            self.out[key] = v
        else:
            self.errors[key] = 'Enter a full link starting with https://'

    def dollars(self, key, label, max=100000):
        """Whole dollars, rounded up: "$1,250.50" -> 1251."""
        v = clean(self.src.get(key, '')).replace('$', '').replace(',', '')
        if not re.fullmatch(r'\d{1,7}(\.\d{1,2})?', v) or not 0 < float(v) <= max:
            self.errors[key] = f'Enter {label.lower()} in dollars, like 75'
        else:
            self.out[key] = -int(-float(v) // 1)

    def date(self, key, required=False):
        v = clean(self.src.get(key, ''))
        if not v and not required:
            self.out[key] = None
        elif parse_date(v):
            self.out[key] = v
        else:
            self.errors[key] = 'Choose a date'

    def email(self, key, message='Enter a valid email address'):
        v = norm_email(self.src.get(key, ''))
        if v:
            self.out[key] = v
        else:
            self.errors[key] = message


def validate_opportunity(src, admin=False):
    """Listing fields from the submit form, the admin editor or a spreadsheet row. Returns (data, errors)."""
    f = Form(src)
    f.text('title', 'Title', min=3, max=140)
    f.text('org', 'Organization', min=2, max=140)
    f.one_of('type', TYPES, 'a type')
    f.text('summary', 'Summary', min=20, max=600, multiline=True)
    f.text('eligibility', 'Eligibility', min=10, max=600, multiline=True)
    f.one_of('cost', COSTS, 'a cost')
    f.text('cost_note', 'Cost note', required=False)
    f.one_of('format', FORMATS, 'a format')
    f.text('location', 'Location', min=2, max=200)
    f.one_of('commitment', COMMITMENTS, 'a commitment')
    f.text('commitment_note', 'Commitment detail', required=False)
    f.text('deadline_note', 'Deadline note', required=False)

    reqs = [clean(r) for r in str(src.get('requirements', '')).split('\n')]
    reqs = [r for r in reqs if r]
    if len(reqs) > 12:
        f.errors['requirements'] = 'List up to 12 requirements'
    elif any(len(r) > 300 for r in reqs):
        f.errors['requirements'] = 'Keep each requirement under 300 characters'
    else:
        f.out['requirements'] = reqs

    grades = sorted({int(g) for g in src.getlist('grades') if str(g).isdigit() and int(g) in GRADES})
    if grades:
        f.out['grades'] = grades
    else:
        f.errors['grades'] = 'Choose at least one grade'
    f.out['interests'] = f.many('interests', INTERESTS)

    d = src.get('deadline_date') or ''
    if not d:
        f.out['deadline_date'] = None
    elif not parse_date(d):
        f.errors['deadline_date'] = 'Use a valid date'
    elif parse_date(d) > today() + timedelta(days=3 * 365):
        f.errors['deadline_date'] = 'That date is too far away'
    else:
        f.out['deadline_date'] = d
    f.url('url')

    if admin:
        f.one_of('verification', VERIFICATION, 'a verification level')
        e = src.get('expires_at') or ''
        if not e:
            f.out['expires_at'] = None
        elif parse_date(e):
            f.out['expires_at'] = e + 'T00:00:00+00:00'
        else:
            f.errors['expires_at'] = 'Use a valid date'
    else:
        f.one_of('relationship', RELATIONSHIPS, 'how you’re connected')
        f.email('contact_email', 'Enter an email a reviewer can reach')
    return f.out, f.errors


def password_problem(pw, email=''):
    if not pw:
        return 'Enter a password'
    if len(pw) < 10:
        return 'Use at least 10 characters'
    if len(pw) > 128:
        return 'Use 128 characters or fewer'
    if pw.lower() in {'password', 'password1', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'openajar123'}:
        return 'That password is too common'
    if len(set(pw)) < 4:
        return 'Use a less repetitive password'
    local = email.split('@')[0].lower()
    if len(local) > 3 and local in pw.lower():
        return 'Don’t include your email name in your password'
    return None


# ---------------------------------------------------------------- display helpers (used by templates)

try:
    STUDENT_TZ = ZoneInfo('America/New_York')
except ZoneInfoNotFoundError:  # a machine without time zone data
    STUDENT_TZ = timezone.utc


def today():
    """Today for students: US Eastern time, so "Due today" and reminders turn over at midnight there, not in UTC."""
    return datetime.now(STUDENT_TZ).date()


def expiry_for(deadline):
    """When a listing with this YYYY-MM-DD deadline hides itself: two days later, so it has passed in every US time zone."""
    return (date.fromisoformat(deadline) + timedelta(days=2)).isoformat() + 'T00:00:00+00:00'


def deadline_info(deadline, note=''):
    """(text, soon) for a YYYY-MM-DD deadline."""
    d = parse_date((deadline or '')[:10])
    if not d:
        return (note or 'Rolling or not stated'), False
    days = (d - today()).days
    when = d.strftime('%b %-d, %Y')
    if days < 0:
        return f'Closed {when}', False
    if days == 0:
        return f'Due today ({when})', True
    if days <= 14:
        return f'{when} · {days} day{"s" if days != 1 else ""} left', True
    return when, False


def grade_label(grades):
    grades = sorted(grades or [])
    if not grades:
        return 'Not stated'
    if grades == GRADES:
        return 'Grades 9–12'
    if len(grades) > 1 and grades == list(range(grades[0], grades[-1] + 1)):
        return f'Grades {grades[0]}–{grades[-1]}'
    return 'Grade ' + ', '.join(map(str, grades)) if len(grades) == 1 else 'Grades ' + ', '.join(map(str, grades))


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


# ---------------------------------------------------------------- spreadsheet import

# The sheet's free-text interest tags mapped to the site's filter categories. Unmapped tags are dropped and reported.
TAG_MAP = {
    'STEM': ['STEM'], 'Science': ['STEM'], 'Math': ['STEM'], 'Engineering': ['STEM'], 'Physics': ['STEM'], 'Chemistry': ['STEM'],
    'Biology': ['STEM'], 'Aerospace': ['STEM'], 'Space': ['STEM'], 'Robotics': ['STEM'], 'Architecture': ['STEM'],
    'Earth science': ['STEM', 'Environment'], 'Logic': ['STEM'], 'Innovation': ['STEM', 'Business & finance'], 'Making': ['STEM'],
    'Natural history': ['STEM', 'Environment'], 'Citizen science': ['STEM', 'Research'], 'Marine biology': ['STEM', 'Environment'],
    'AI': ['Computer science'], 'Coding': ['Computer science'], 'Computer Science': ['Computer science'],
    'Cybersecurity': ['Computer science'], 'Technology': ['Computer science'],
    'Research': ['Research'], 'Biomedical research': ['Research', 'Health & medicine'],
    'Medicine': ['Health & medicine'], 'Health': ['Health & medicine'], 'Health care': ['Health & medicine'],
    'First aid': ['Health & medicine'], 'Lifesaving': ['Health & medicine', 'Sports & outdoors'],
    'Business': ['Business & finance'], 'Finance': ['Business & finance'], 'Investing': ['Business & finance'],
    'Economics': ['Business & finance'], 'Entrepreneurship': ['Business & finance'], 'Management': ['Business & finance'],
    'Marketing': ['Business & finance'], 'Hospitality': ['Business & finance', 'Career exploration'],
    'Arts': ['Arts & media'], 'Creative': ['Arts & media'], 'Dance': ['Arts & media'], 'Film': ['Arts & media'],
    'Music': ['Arts & media'], 'Museums': ['Arts & media'], 'Theatre': ['Arts & media'], 'Video': ['Arts & media'],
    'Media': ['Arts & media'], 'Culture': ['Arts & media', 'Writing & humanities'],
    'Writing': ['Writing & humanities'], 'Creative writing': ['Writing & humanities'], 'Journalism': ['Writing & humanities'],
    'History': ['Writing & humanities'], 'Humanities': ['Writing & humanities'], 'Language': ['Writing & humanities'],
    'Languages': ['Writing & humanities'], 'Linguistics': ['Writing & humanities'], 'Literature': ['Writing & humanities'],
    'Poetry': ['Writing & humanities'], 'Social Sciences': ['Writing & humanities'],
    'Civics': ['Civics & law'], 'Government': ['Civics & law'], 'Law': ['Civics & law'], 'Politics': ['Civics & law'],
    'Public service': ['Civics & law', 'Service'], 'Global affairs': ['Civics & law'], 'International affairs': ['Civics & law'],
    'Defense': ['Civics & law'], 'Debate': ['Civics & law', 'Leadership'],
    'Community service': ['Service'], 'Community': ['Service'], 'Disaster relief': ['Service'], 'Hunger relief': ['Service'],
    'Housing': ['Service'], 'Disability inclusion': ['Service'], 'Libraries': ['Service'],
    'Leadership': ['Leadership'], 'Public speaking': ['Leadership'], 'Communication': ['Leadership'],
    'Career exploration': ['Career exploration'], 'Career readiness': ['Career exploration'], 'Career training': ['Career exploration'],
    'Construction': ['Career exploration'], 'Trades': ['Career exploration'], 'Workforce': ['Career exploration'],
    'Workforce readiness': ['Career exploration'], 'Work experience': ['Career exploration'],
    'Environment': ['Environment'], 'Conservation': ['Environment'], 'Fisheries': ['Environment'],
    'Outdoors': ['Environment', 'Sports & outdoors'], 'Aquatics': ['Sports & outdoors'], 'Athletics': ['Sports & outdoors'],
    'Sports': ['Sports & outdoors'], 'Customer service': ['Career exploration'], 'Retail': ['Career exploration'],
    'Food service': ['Career exploration'], 'Entertainment': ['Career exploration'], 'Events': ['Career exploration'],
    'Sports/Recreation': ['Sports & outdoors', 'Career exploration'], 'Childcare': ['Service', 'Career exploration'],
    'Recreation': ['Sports & outdoors'], 'Pets': ['Career exploration'], 'Animal care': ['Career exploration'],
    'Warehouse': ['Career exploration'], 'Grocery': ['Career exploration'], 'Restaurant': ['Career exploration'],
    'Camp': ['Career exploration'], 'Tutoring': ['Academics & college prep', 'Service'],
    'Lifeguarding': ['Sports & outdoors', 'Health & medicine'], 'Sales': ['Business & finance', 'Career exploration'],
    'Academics': ['Academics & college prep'], 'College access': ['Academics & college prep'],
    'College credit': ['Academics & college prep'], 'College prep': ['Academics & college prep'],
    'College readiness': ['Academics & college prep'], 'Education': ['Academics & college prep', 'Service'],
    'Critical thinking': ['Academics & college prep'],
}


class Row(dict):
    """A CSV row that quacks like a form, so spreadsheet rows go through the same validation as the submit form."""

    def getlist(self, key):
        return self.get('_' + key, [])


def sheet_row(r):
    """Turns one spreadsheet row into a validatable Row plus an import note."""
    split = lambda s: [x.strip() for x in (s or '').split(';') if x.strip()]
    tags = split(r.get('interests'))
    interests = list(dict.fromkeys(i for t in tags for i in TAG_MAP.get(t, [])))
    cost = r.get('cost') or 'Varies'
    if r.get('type') == 'Job' and cost in ('Free', 'Varies'):
        cost = 'Award'  # a job is paid work; never label it as free or unpaid
    row = Row(title=r.get('title'), org=r.get('organization'), type=r.get('type'), summary=r.get('summary'),
              eligibility=r.get('eligibility'), requirements='\n'.join(split(r.get('requirements'))), cost=cost,
              cost_note=r.get('cost_note'), format=r.get('format'), location=r.get('location'),
              commitment=r.get('commitment'), commitment_note=r.get('commitment_note'),
              deadline_date=r.get('deadline_date'), deadline_note=r.get('deadline_note'),
              url=r.get('apply_url') or r.get('official_url'), _grades=split(r.get('grades')), _interests=interests)
    notes = []
    unmapped = [t for t in tags if t not in TAG_MAP]
    if unmapped:
        notes.append('unmapped interest tags dropped: ' + ', '.join(unmapped))
    if not r.get('cost'):
        notes.append('cost was blank in the sheet, set to "Varies"')
    note = 'Imported from spreadsheet'
    if r.get('checked_on'):
        note += f"; sheet says checked {r['checked_on']}"
    if r.get('official_url'):
        note += f". Official page: {r['official_url']}"
    if notes:
        note += '. Notes: ' + '; '.join(notes)
    return row, note


def _norm(s):
    s = re.sub(r'[^a-z0-9 ]', '', (s or '').lower().replace('&', ' and '))
    return re.sub(r'\s+', ' ', s).strip()


def same_program(a_title, a_org, b_title, b_org, a_url=None, b_url=None, a_loc='', b_loc=''):
    """Exact title (and org, when both have one), or the same link with a near-identical title.
    Different locations are different listings (a Chipotle crew job in Austin is not the one in Denver)."""
    if _norm(a_loc) and _norm(b_loc) and _norm(a_loc) != _norm(b_loc):
        return False
    if _norm(a_title) == _norm(b_title) and (not _norm(a_org) or not _norm(b_org) or _norm(a_org) == _norm(b_org)):
        return True
    if a_url and a_url == b_url:
        x, y = set(_norm(a_title).split()), set(_norm(b_title).split())
        if x and y and (len(x & y) / len(x | y) >= 0.75 or (min(len(x), len(y)) >= 3 and len(x & y) / min(len(x), len(y)) >= 0.9)):
            return True
    return False
