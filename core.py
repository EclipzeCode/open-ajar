"""Shared helpers: database access, the signed-in user, access checks, rate limits and listing queries."""
import json
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from functools import wraps
from pathlib import Path
from urllib.parse import urlparse

from flask import abort, current_app, flash, g, redirect, request, session, url_for

import data
from data import job_category, now_iso, same_program, state_from_location

# ---------------------------------------------------------------- database


def get_db():
    if 'db' not in g:
        g.db = connect(current_app.config['DB_PATH'])
    return g.db


def connect(path):
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


def one(sql, args=()):
    return get_db().execute(sql, args).fetchone()


def all_(sql, args=()):
    return get_db().execute(sql, args).fetchall()


def run(sql, args=()):
    db = get_db()
    cur = db.execute(sql, args)
    db.commit()
    return cur


def new_id():
    return str(uuid.uuid4())


def audit(actor_id, action, target):
    run('INSERT INTO audit_log (actor_id, action, target, created_at) VALUES (?,?,?,?)', (actor_id, action, target, now_iso()))


# ---------------------------------------------------------------- users and access


def current_user():
    return g.get('user')


def load_user():
    """Runs before every request. A session is valid only while its version matches the user's (bumped to sign out everywhere)."""
    g.user = None
    uid = session.get('uid')
    if uid:
        u = one('SELECT * FROM users WHERE id=?', (uid,))
        if u and not u['disabled'] and u['session_version'] == session.get('ver'):
            g.user = u
            today = now_iso()[:10]
            if session.get('seen') != today:  # one write per user per day, for active-user stats
                run('INSERT OR IGNORE INTO user_days (user_id, day) VALUES (?,?)', (uid, today))
                session['seen'] = today
        else:
            session.clear()


def is_owner(user):
    """The owner is an admin with the email in OWNER_EMAIL."""
    return bool(user) and user['role'] == 'admin' and user['email'] == current_app.config['OWNER_EMAIL']


def sign_in(user):
    pending = session.get('pending')
    session.clear()
    session.permanent = True
    session.update(uid=user['id'], ver=user['session_version'], csrf=secrets.token_urlsafe(32))
    if pending:
        finish_pending(user, pending)


# Save or Track pressed while signed out: remembered, then done once they sign in or sign up
PENDING = {'site.toggle_save': 'save', 'site.track': 'track'}


def finish_pending(user, pending):
    opp = get_public(pending['opp'])
    if not opp:
        return
    if pending['action'] == 'save':
        save_opp(user['id'], opp['id'])
        flash(f'Saved “{opp["title"]}”. Find it any time in your tracker.')
    else:
        track_opp(user['id'], opp)
        flash(f'Tracking “{opp["title"]}”. Its requirements are now a checklist in your tracker.')


def save_opp(user_id, opp_id):
    run('INSERT OR IGNORE INTO saved (user_id, opportunity_id, created_at) VALUES (?,?,?)', (user_id, opp_id, now_iso()))


def track_opp(user_id, opp):
    checklist = json.dumps([{'text': t, 'done': False} for t in opp['requirements']])
    run('INSERT OR IGNORE INTO tracked (user_id, opportunity_id, checklist, added_at) VALUES (?,?,?,?)',
        (user_id, opp['id'], checklist, now_iso()))


def _here():
    """Where to come back to after signing in. A POST (like Save) returns to the page the button was on."""
    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
        return request.full_path.rstrip('?')
    ref = urlparse(request.referrer or '')
    return ref.path if ref.netloc == request.host else '/'


def login_required(view):
    @wraps(view)
    def wrapper(*a, **kw):
        if not current_user():
            if request.method == 'POST' and request.endpoint in PENDING:
                session['pending'] = {'action': PENDING[request.endpoint], 'opp': kw.get('opp_id')}
                flash('Sign in to finish. We’ll save it for you.')
            else:
                flash('Sign in to continue.')
            login = url_for('account.login', next=_here())
            if request.headers.get('X-Requested-With') == 'fetch':
                # a background request (a card's star): following a redirect would use up the message above
                # before the page got there, so the page goes to sign in itself
                return {'login': login}, 401
            return redirect(login)
        return view(*a, **kw)
    return wrapper


ADMIN_ONLY = ('admin.backup', 'admin.export')  # downloads of everyone's data: admins only, even though they're GETs
MOD_WRITES = ('admin.user_notes',)  # the one change a moderator can make: their own private note (the view checks the rest)


def admin_required(view):
    """Admin pages. Moderators see them too but only look: anything that changes something (not a GET), and the data
    downloads, are for admins."""
    @wraps(view)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return redirect(url_for('account.login', next=_here()))
        if u['role'] not in data.STAFF:
            abort(403)
        if u['role'] != 'admin' and ((request.method not in ('GET', 'HEAD') and request.endpoint not in MOD_WRITES)
                                     or request.endpoint in ADMIN_ONLY):
            abort(403)
        return view(*a, **kw)
    return wrapper


def safe_next(default='/'):
    nxt = request.values.get('next') or ''
    return nxt if nxt.startswith('/') and not nxt.startswith('//') and '\\' not in nxt else default


# ---------------------------------------------------------------- rate limits

_hits = defaultdict(deque)


def limited(key, max_hits, window_seconds):
    """True when `key` has used up its allowance. In memory: fine for one server process."""
    # ponytail: per-process memory; move to the database or Redis if you ever run more than one instance
    now, q = time.monotonic(), _hits[key]
    while q and q[0] <= now - window_seconds:
        q.popleft()
    if len(_hits) > 10000:  # forget keys idle for longer than any window (an hour at most), so memory doesn't keep growing
        for k, d in list(_hits.items()):
            if k != key and (not d or d[-1] <= now - 3600):
                del _hits[k]
    if len(q) >= max_hits:
        return True
    q.append(now)
    return False


def client_ip():
    return request.remote_addr or 'unknown'  # ProxyFix makes this the real client when TRUST_PROXY=1


# ---------------------------------------------------------------- listings

JSON_FIELDS = ('requirements', 'interests', 'grades')


def opp_dict(row):
    if row is None:
        return None
    o = dict(row)
    for k in JSON_FIELDS:
        o[k] = json.loads(o[k] or '[]')
    return o


PUBLIC = "o.status = 'approved' AND (o.expires_at IS NULL OR o.expires_at > ?)"


def grant_room(user_id, exclude=None):
    """Dollars a student can still be granted this calendar year: data.GRANT_CAP minus what was approved this year."""
    used = one("""SELECT COALESCE(SUM(COALESCE(paid_amount, approved_amount)), 0) n FROM access_grants
                  WHERE user_id=? AND status IN ('approved', 'paid') AND substr(COALESCE(approved_at, created_at), 1, 4)=? AND id<>?""",
               (user_id, now_iso()[:4], exclude or ''))['n']
    return max(0, data.GRANT_CAP - used)


def get_public(opp_id):
    return opp_dict(one(f'SELECT o.* FROM opportunities o WHERE o.id=? AND {PUBLIC}', (opp_id, now_iso())))


def get_opp(opp_id):
    return opp_dict(one('SELECT * FROM opportunities WHERE id=?', (opp_id,)))


def _like(s):
    return '%' + s.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def _filters(f, skip=None):
    """SQL WHERE clause and params for filter dict f, leaving out filter `skip` (so a facet can count its own options)."""
    where, params = [PUBLIC], [now_iso()]
    tokens = f.get('q', '').lower().split()[:8]
    for t in tokens:
        cols = ('o.title', 'o.org', 'o.summary', 'o.type', 'o.location', 'o.interests')
        where.append('(' + ' OR '.join(f"lower({c}) LIKE ? ESCAPE '\\'" for c in cols) + ')')
        params += [_like(t)] * len(cols)
    for key, col in (('type', 'o.type'), ('cost', 'o.cost'), ('format', 'o.format'), ('commitment', 'o.commitment')):
        if f.get(key) and key != skip:
            where.append(f"{col} IN ({','.join('?' * len(f[key]))})")
            params += f[key]
    if f.get('category') and skip != 'category':
        where.append(f"o.job_category IN ({','.join('?' * len(f['category']))})")
        params += f['category']
    if f.get('interest') and skip != 'interest':
        where.append(f"EXISTS (SELECT 1 FROM json_each(o.interests) i WHERE i.value IN ({','.join('?' * len(f['interest']))}))")
        params += f['interest']
    if f.get('grade') and skip != 'grade':
        where.append('EXISTS (SELECT 1 FROM json_each(o.grades) g WHERE g.value = ?)')
        params.append(f['grade'])
    if f.get('state') and skip != 'state':
        where.append('o.state = ?')
        params.append(f['state'])
    if f.get('saved_by'):
        where.append('EXISTS (SELECT 1 FROM saved s WHERE s.opportunity_id = o.id AND s.user_id = ?)')
        params.append(f['saved_by'])
    where.append(SECTOR_SQL.get(f.get('sector'), '1'))
    return ' AND '.join(where), params, tokens


def search_public(f, limit=20, offset=0):
    """f: dict with q, grade, state, sort, sector, and lists type/cost/format/commitment/interest/category. Returns (rows, total)."""
    w, params, tokens = _filters(f)
    order, order_params = 'o.published_at DESC', []
    if f.get('sort') == 'deadline':
        order = '(o.deadline_date IS NULL OR o.deadline_date < ?), o.deadline_date, o.title'
        order_params.append(data.today().isoformat())  # students' today (US Eastern), like "Due today"
    elif f.get('sort') == 'title':
        order = 'lower(o.title)'
    elif tokens:
        order = "(lower(o.title) LIKE ? ESCAPE '\\') DESC, " + order
        order_params.append(_like(tokens[0]))
    total = one(f'SELECT COUNT(*) n FROM opportunities o WHERE {w}', params)['n']
    rows = all_(f'SELECT o.* FROM opportunities o WHERE {w} ORDER BY {order} LIMIT ? OFFSET ?', params + order_params + [limit, offset])
    return [opp_dict(r) for r in rows], total


SECTOR_SQL = {'jobs': "o.type = 'Job'", 'opportunities': "o.type <> 'Job'"}


def facets(f=None):
    """Live-listing counts per filter value. Each filter's counts apply every other active filter in f (search, sector,
    the other pills) but not its own, so they say how many results you'd get by picking that option."""
    f = f or {}

    def count(key, col, is_list=False):
        w, p, _ = _filters(f, skip=key)
        src = f'opportunities o, json_each(o.{col}) j' if is_list else 'opportunities o'
        v = 'j.value' if is_list else 'o.' + col
        return {r['v']: r['n'] for r in all_(f"SELECT {v} v, COUNT(*) n FROM {src} WHERE {w} GROUP BY v", p)}
    return {'type': count('type', 'type'), 'cost': count('cost', 'cost'), 'format': count('format', 'format'),
            'commitment': count('commitment', 'commitment'), 'interest': count('interest', 'interests', True),
            'grade': count('grade', 'grades', True), 'state': {k: v for k, v in count('state', 'state').items() if k},
            'category': count('category', 'job_category') if f.get('sector') == 'jobs' else {}}


def expire_due(db):
    # a live listing with a deadline but no expiry (imported straight to live before that was set) gets the usual one
    for r in db.execute("SELECT id, deadline_date FROM opportunities WHERE status='approved' AND expires_at IS NULL AND deadline_date IS NOT NULL").fetchall():
        db.execute('UPDATE opportunities SET expires_at=? WHERE id=?', (data.expiry_for(r['deadline_date']), r['id']))
    db.execute("UPDATE opportunities SET status='expired', updated_at=? WHERE status='approved' AND expires_at IS NOT NULL AND expires_at <= ?",
               (now_iso(), now_iso()))
    db.commit()


def add_event(opp_id, actor_id, action, to_status=None, message=''):
    run('INSERT INTO review_events (opportunity_id, actor_id, action, to_status, message, created_at) VALUES (?,?,?,?,?,?)',
        (opp_id, actor_id, action, to_status, message, now_iso()))


def events_for(opp_id):
    return all_('''SELECT e.*, COALESCE(u.name, 'System') actor FROM review_events e LEFT JOIN users u ON u.id = e.actor_id
                   WHERE e.opportunity_id=? ORDER BY e.id''', (opp_id,))


OPP_COLUMNS = ('title', 'org', 'type', 'summary', 'eligibility', 'requirements', 'interests', 'grades', 'cost', 'cost_note',
               'format', 'location', 'commitment', 'commitment_note', 'deadline_date', 'deadline_note', 'url',
               'verification', 'expires_at', 'contact_email', 'relationship')


def opp_values(data):
    """Column -> value for the fields present in validated data (lists become JSON, location also sets state)."""
    vals = {k: (json.dumps(v) if k in JSON_FIELDS else v) for k, v in data.items() if k in OPP_COLUMNS}
    if 'location' in data:
        vals['state'] = state_from_location(data['location'])
    if 'type' in data:  # validated listings carry type, org and title together
        vals['job_category'] = job_category(data['org'], data['title']) if data['type'] == 'Job' else None
    return vals


def insert_opp(db, data, **extra):
    vals = {**opp_values(data), **extra, 'id': extra.get('id') or new_id(), 'created_at': now_iso(), 'updated_at': now_iso()}
    db.execute(f"INSERT INTO opportunities ({','.join(vals)}) VALUES ({','.join('?' * len(vals))})", list(vals.values()))
    return vals['id']


def update_opp(db, opp_id, data, **extra):
    vals = {**opp_values(data), **extra, 'updated_at': now_iso()}
    db.execute(f"UPDATE opportunities SET {', '.join(k + '=?' for k in vals)} WHERE id=?", [*vals.values(), opp_id])


def same_program_rows(db, data):
    """An existing listing that describes the same program as `data`, if any."""
    for r in db.execute('SELECT id, title, org, url, location FROM opportunities'):
        if same_program(r['title'], r['org'], data['title'], data['org'], r['url'], data.get('url'), r['location'], data.get('location')):
            return r
    return None


# ---------------------------------------------------------------- uploaded images (partner photos)

UPLOAD_TYPES = {b'\x89PNG': 'png', b'\xff\xd8\xff': 'jpg', b'RIFF': 'webp'}  # first bytes -> extension


def uploads_dir():
    """Next to the database (on Render that's the persistent disk), so uploads survive deploys. Not in the database backup."""
    return Path(current_app.config['DB_PATH']).parent / 'uploads'


def save_upload(file):
    """Saves an uploaded PNG, JPEG or WebP under a random name. Returns the name, or None if it isn't one of those."""
    head = file.stream.read(12)
    ext = next((e for magic, e in UPLOAD_TYPES.items() if head.startswith(magic)), None)
    if not ext or (ext == 'webp' and head[8:12] != b'WEBP'):
        return None
    name = f'up-{secrets.token_hex(8)}.{ext}'
    uploads_dir().mkdir(parents=True, exist_ok=True)
    file.stream.seek(0)
    file.save(uploads_dir() / name)
    return name


def partner_img(name):
    """Where a partner's image is served: uploads from the uploads folder, the original six from static/img/partners/."""
    if name.startswith('up-'):
        return url_for('site.media', name=name)
    return url_for('static', filename='img/partners/' + name)
