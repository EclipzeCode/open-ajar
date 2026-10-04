"""Shared helpers: database access, the signed-in user, access checks, rate limits and listing queries."""
import json
import secrets
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from functools import wraps
from urllib.parse import urlparse

from flask import abort, current_app, flash, g, redirect, request, session, url_for

from data import now_iso, same_program, state_from_location

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
        else:
            session.clear()


def sign_in(user):
    session.clear()
    session.permanent = True
    session.update(uid=user['id'], ver=user['session_version'], csrf=secrets.token_urlsafe(32))


def _here():
    """Where to come back to after signing in. A POST (like Save) returns to the page the button was on."""
    if request.method == 'GET':
        return request.full_path.rstrip('?')
    ref = urlparse(request.referrer or '')
    return ref.path if ref.netloc == request.host else '/'


def login_required(view):
    @wraps(view)
    def wrapper(*a, **kw):
        if not current_user():
            flash('Sign in to continue.')
            return redirect(url_for('account.login', next=_here()))
        return view(*a, **kw)
    return wrapper


def admin_required(view):
    @wraps(view)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return redirect(url_for('account.login', next=_here()))
        if u['role'] != 'admin':
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


def get_public(opp_id):
    return opp_dict(one(f'SELECT o.* FROM opportunities o WHERE o.id=? AND {PUBLIC}', (opp_id, now_iso())))


def get_opp(opp_id):
    return opp_dict(one('SELECT * FROM opportunities WHERE id=?', (opp_id,)))


def _like(s):
    return '%' + s.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def search_public(f, limit=20, offset=0):
    """f: dict with q, grade, state, sort, sector, and lists type/cost/format/commitment/interest. Returns (rows, total)."""
    where, params = [PUBLIC], [now_iso()]
    tokens = f.get('q', '').lower().split()[:8]
    for t in tokens:
        cols = ('o.title', 'o.org', 'o.summary', 'o.type', 'o.location', 'o.interests')
        where.append('(' + ' OR '.join(f"lower({c}) LIKE ? ESCAPE '\\'" for c in cols) + ')')
        params += [_like(t)] * len(cols)
    for key, col in (('type', 'o.type'), ('cost', 'o.cost'), ('format', 'o.format'), ('commitment', 'o.commitment')):
        if f.get(key):
            where.append(f"{col} IN ({','.join('?' * len(f[key]))})")
            params += f[key]
    if f.get('interest'):
        where.append(f"EXISTS (SELECT 1 FROM json_each(o.interests) i WHERE i.value IN ({','.join('?' * len(f['interest']))}))")
        params += f['interest']
    if f.get('grade'):
        where.append('EXISTS (SELECT 1 FROM json_each(o.grades) g WHERE g.value = ?)')
        params.append(f['grade'])
    if f.get('state'):
        where.append('o.state = ?')
        params.append(f['state'])
    where.append(SECTOR_SQL.get(f.get('sector'), '1'))

    order, order_params = 'o.published_at DESC', []
    if f.get('sort') == 'deadline':
        order = '(o.deadline_date IS NULL OR o.deadline_date < date()), o.deadline_date, o.title'
    elif f.get('sort') == 'title':
        order = 'lower(o.title)'
    elif tokens:
        order = "(lower(o.title) LIKE ? ESCAPE '\\') DESC, " + order
        order_params.append(_like(tokens[0]))
    w = ' AND '.join(where)
    total = one(f'SELECT COUNT(*) n FROM opportunities o WHERE {w}', params)['n']
    rows = all_(f'SELECT o.* FROM opportunities o WHERE {w} ORDER BY {order} LIMIT ? OFFSET ?', params + order_params + [limit, offset])
    return [opp_dict(r) for r in rows], total


SECTOR_SQL = {'jobs': "o.type = 'Job'", 'opportunities': "o.type <> 'Job'"}


def facets(sector=None):
    """Counts per filter value among live listings, for the filter sidebar."""
    w = PUBLIC + ' AND ' + SECTOR_SQL.get(sector, '1')
    t = (now_iso(),)
    scalar = lambda col: {r['v']: r['n'] for r in all_(f'SELECT o.{col} v, COUNT(*) n FROM opportunities o WHERE {w} GROUP BY v', t)}
    arr = lambda col: {r['v']: r['n'] for r in all_(f'SELECT j.value v, COUNT(*) n FROM opportunities o, json_each(o.{col}) j WHERE {w} GROUP BY v', t)}
    return {'type': scalar('type'), 'cost': scalar('cost'), 'format': scalar('format'), 'commitment': scalar('commitment'),
            'interest': arr('interests'), 'grade': arr('grades'),
            'state': {k: v for k, v in scalar('state').items() if k}}


def expire_due(db):
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
