"""Admin: the listing review queue, editing, users, activity, intern applications, partner inquiries, contact messages,
Community Voices and Access Grants."""
import csv
import io
import json
import os
import re
import sqlite3
import tempfile
import zipfile
from datetime import date, timedelta
from urllib.parse import urlsplit

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, send_file, url_for

import data
import mail
from core import (add_event, admin_required, all_, audit, current_user, events_for, expire_due, get_db, get_opp, grant_room,
                  is_owner, new_id, one, run, save_upload, update_opp, uploads_dir, _like)

bp = Blueprint('admin', __name__)
PER_PAGE = 100


def paged(sql, args=()):
    """One page (?page=N) of an admin list plus its total, so no list quietly stops at a limit."""
    total = one(f'SELECT COUNT(*) n FROM ({sql})', args)['n']
    pages = max(1, -(-total // PER_PAGE))
    page = min(pages, max(1, request.args.get('page', 1, type=int)))
    return all_(f'{sql} LIMIT ? OFFSET ?', (*args, PER_PAGE, (page - 1) * PER_PAGE)), {'page': page, 'pages': pages, 'total': total}


def searched(cols):
    """(SQL condition, args) matching ?q= in any of cols, or (None, []) without a search."""
    q = request.args.get('q', '')[:100].strip().lower()
    if not q:
        return None, []
    return '(' + ' OR '.join(f"lower({c}) LIKE ? ESCAPE '\\'" for c in cols) + ')', [_like(q)] * len(cols)

# action -> (statuses it can start from, resulting status, needs a message for the submitter)
TRANSITIONS = {
    'approve': (('pending_review', 'changes_requested', 'expired'), 'approved', False),
    'request_changes': (('pending_review', 'approved'), 'changes_requested', True),
    'reject': (('pending_review', 'changes_requested', 'expired', 'approved'), 'rejected', True),
    'expire': (('approved',), 'expired', False),
    'reopen': (('rejected', 'expired'), 'pending_review', False),
}


def decide(opp, action, message=''):
    """Moves a listing through the review state machine. Returns an error message, or None on success."""
    if action not in TRANSITIONS:
        return 'Unknown action'
    allowed, to, needs_message = TRANSITIONS[action]
    if opp['status'] not in allowed:
        return f"You can’t {action.replace('_', ' ')} a listing that is {data.STATUSES[opp['status']].lower()}."
    message = data.clean(message, multiline=True)[:1000]
    if needs_message and len(message) < 5:
        return 'Explain your decision so the submitter knows what to do next (5+ characters).'
    extra = {'status': to, 'reviewer_message': message if needs_message else ''}
    if action == 'approve':
        expires = opp['expires_at']
        if not expires and opp['deadline_date']:  # a dated listing hides itself shortly after its deadline
            expires = data.expiry_for(opp['deadline_date'])
        if expires and expires <= data.now_iso():
            return 'This listing’s expiry date has already passed. Edit the expiry or deadline before approving.'
        extra.update(expires_at=expires, published_at=opp['published_at'] or data.now_iso())
        if opp['verification'] == 'unreviewed':
            extra['verification'] = 'source'
    db = get_db()
    update_opp(db, opp['id'], {}, **extra)
    db.commit()
    add_event(opp['id'], current_user()['id'], action, to, message)
    if action in ('approve', 'request_changes', 'reject'):
        tell_submitter(opp, data.STATUSES[to], message)
    return None


def tell_submitter(opp, status=None, message=''):
    """Emails the person who submitted a listing about a decision or a message (imported listings have nobody to tell)."""
    who = one('SELECT name, email FROM users WHERE id=?', (opp['submitted_by'],)) if opp['submitted_by'] else None
    to = who['email'] if who else opp['contact_email']
    if opp['source'] == 'submission' and to:
        mail.later('listing update', mail.application_update, current_app.config, to, who['name'] if who else '', 'listing',
                   opp['title'], status, message)


@bp.get('/')
@admin_required
def queue():
    expire_due(get_db())
    status = request.args.get('status', 'pending_review')
    status = status if status in data.STATUSES or status == 'all' else 'pending_review'
    source = request.args.get('source', '')
    where, args = [], []
    if status != 'all':
        where.append('status=?')
        args.append(status)
    if source:
        where.append('source=?')
        args.append(source)
    cond, cargs = searched(('title', 'org'))
    if cond:
        where.append(cond)
        args += cargs
    items, pg = paged('SELECT * FROM opportunities' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY updated_at DESC', args)
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM opportunities GROUP BY status')}
    sources = all_('SELECT source, COUNT(*) n FROM opportunities' + (' WHERE status=?' if status != 'all' else '') + ' GROUP BY source',
                   (status,) if status != 'all' else ())
    return render_template('admin/queue.html', items=items, pg=pg, counts=counts, status=status, source=source,
                           sources=sources, q=request.args.get('q', ''))


@bp.post('/bulk-approve')
@admin_required
def bulk_approve():
    ids = request.form.getlist('ids')[:300]
    ok, failed = 0, []
    for opp_id in ids:
        opp = get_opp(opp_id)
        err = decide(opp, 'approve') if opp else 'not found'
        if err:
            failed.append(f"{opp['title'] if opp else opp_id}: {err}")
        else:
            ok += 1
    audit(current_user()['id'], 'bulk_approve', f'{ok} listings')
    flash(f'Approved {ok}.' + (f' {len(failed)} couldn’t be approved: ' + '; '.join(failed[:5]) if failed else ''))
    return redirect(request.referrer or url_for('admin.queue'))


@bp.route('/o/<opp_id>', methods=['GET', 'POST'])
@admin_required
def review(opp_id):
    opp = get_opp(opp_id)
    if not opp:
        abort(404)
    errors, values = {}, None
    if request.method == 'POST':
        if request.form.get('action') == 'edit':
            clean, errors = data.validate_opportunity(request.form, admin=True)
            if not errors:
                data.follow_deadline(opp, clean)
                db = get_db()
                update_opp(db, opp_id, clean)
                db.commit()
                add_event(opp_id, current_user()['id'], 'edited', opp['status'])
                flash('Changes saved.')
                return redirect(url_for('admin.review', opp_id=opp_id))
            values = {**request.form.to_dict(), 'grades': [int(g) for g in request.form.getlist('grades') if g.isdigit()],
                      'interests': request.form.getlist('interests')}
        elif request.form.get('action') == 'message':  # an update for the submitter, without changing the status
            message = data.clean(request.form.get('message', ''), multiline=True)[:1000]
            if len(message) < 5:
                flash('Write the update first (5+ characters).', 'error')
            else:
                add_event(opp_id, current_user()['id'], 'message', opp['status'], message)
                tell_submitter(opp, message=message)
                flash('Update sent to the submitter.')
            return redirect(url_for('admin.review', opp_id=opp_id))
        else:
            err = decide(opp, request.form.get('action', ''), request.form.get('message', ''))
            flash(err, 'error') if err else flash('Done.')
            return redirect(url_for('admin.review', opp_id=opp_id))
    submitter = one('SELECT name, email FROM users WHERE id=?', (opp['submitted_by'],)) if opp['submitted_by'] else None
    actions = [a for a, (allowed, _, _) in TRANSITIONS.items() if opp['status'] in allowed]
    values = values or dict(opp, requirements='\n'.join(opp['requirements']), expires_at=(opp['expires_at'] or '')[:10])
    return render_template('admin/review.html', o=opp, values=values, errors=errors, events=events_for(opp_id),
                           submitter=submitter, actions=actions, transitions=TRANSITIONS)


@bp.route('/users', methods=['GET', 'POST'])
@admin_required
def users():
    me = current_user()
    if request.method == 'POST':
        target = one('SELECT * FROM users WHERE id=?', (request.form.get('id', ''),))
        if not target:
            abort(404)
        if is_owner(target) and not is_owner(me):
            flash('Only the owner can change the owner’s account.', 'error')
        elif request.form.get('action') == 'verify':
            if not target['email_verified']:
                run('UPDATE users SET email_verified=1 WHERE id=?', (target['id'],))
                audit(me['id'], 'email_confirmed_by_admin', target['email'])
                flash(f"Confirmed {target['email']}.")
        else:
            role = request.form.get('role') if request.form.get('role') in data.ROLES else target['role']
            disabled = 1 if request.form.get('disabled') else 0
            loses_admin = target['role'] == 'admin' and (role != 'admin' or disabled)
            admins = one("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0")['n']
            if target['id'] == me['id'] and loses_admin:
                flash('You can’t demote or disable your own account.', 'error')
            elif loses_admin and admins <= 1:
                flash('That would leave no active admin.', 'error')
            elif (role, disabled) != (target['role'], target['disabled']):
                # changing a role or disabling signs that person out everywhere, so new permissions apply immediately
                run('UPDATE users SET role=?, disabled=?, session_version=session_version+1 WHERE id=?', (role, disabled, target['id']))
                audit(me['id'], f"user_updated role={role} disabled={disabled}", target['email'])
                flash(f"Updated {target['email']}.")
        return redirect(request.full_path)
    a = request.args
    f = {'q': a.get('q', ''), 'role': a.get('role') if a.get('role') in data.ROLES else '',
         'status': a.get('status') if a.get('status') in USER_STATUSES else '',
         'joined_from': a.get('joined_from') if data.parse_date(a.get('joined_from', '')) else '',
         'joined_to': a.get('joined_to') if data.parse_date(a.get('joined_to', '')) else ''}
    cond, args = searched(('name', 'nickname', 'email', 'school'))
    where = [cond] if cond else []
    if f['role']:
        where.append('role=?')
        args.append(f['role'])
    if f['status']:
        where.append(USER_STATUSES[f['status']][1])
    if f['joined_from']:
        where.append('substr(created_at, 1, 10) >= ?')
        args.append(f['joined_from'])
    if f['joined_to']:
        where.append('substr(created_at, 1, 10) <= ?')
        args.append(f['joined_to'])
    users, pg = paged('SELECT * FROM users' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY created_at DESC', args)
    return render_template('admin/users.html', users=users, pg=pg, f=f, statuses=USER_STATUSES,
                           filtered=any(f.values()))


USER_STATUSES = {'active': ('Active', 'disabled=0'), 'disabled': ('Disabled', 'disabled=1'),
                 'unconfirmed': ('Email not confirmed', 'email_verified=0')}


@bp.get('/users/<uid>')
@admin_required
def user_detail(uid):
    """One person: their account, intern applications, partner inquiries and messages (matched by email), Access Grant
    requests, listings they submitted and what they track. Opens in a pop-up on the Users page; on its own it's a normal page."""
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        abort(404)
    return render_template('admin/user.html', u=u,
        apps=all_('SELECT * FROM intern_applications WHERE lower(email)=? ORDER BY created_at DESC', (u['email'].lower(),)),
        partners=all_('SELECT * FROM partner_inquiries WHERE lower(email)=? ORDER BY created_at DESC', (u['email'].lower(),)),
        messages=all_('SELECT * FROM contact_messages WHERE lower(email)=? ORDER BY created_at DESC', (u['email'].lower(),)),
        grants=all_('SELECT * FROM access_grants WHERE user_id=? ORDER BY created_at DESC', (uid,)),
        listings=all_('SELECT id, title, status, created_at FROM opportunities WHERE submitted_by=? ORDER BY created_at DESC', (uid,)),
        counts=one('''SELECT (SELECT COUNT(*) FROM tracked WHERE user_id=:u) tracked, (SELECT COUNT(*) FROM saved WHERE user_id=:u) saved,
                      (SELECT COUNT(*) FROM user_days WHERE user_id=:u) days, (SELECT MAX(day) FROM user_days WHERE user_id=:u) last_seen''', {'u': uid}),
        quote=one('SELECT quote, status FROM testimonials WHERE user_id=?', (uid,)),
        my_note=(one('SELECT note FROM user_notes WHERE user_id=? AND author_id=?', (uid, current_user()['id'])) or {'note': ''})['note'],
        profile=one('SELECT id, name, shown FROM partner_profiles WHERE user_id=?', (uid,)))


def _back(default):
    """The admin page the form was on (the Users list keeps its filters), or `default`."""
    ref = urlsplit(request.referrer or '')
    return ref.path + ('?' + ref.query if ref.query else '') if ref.netloc == request.host and ref.path.startswith('/admin') else default


@bp.post('/users/<uid>/notes')
@admin_required
def user_notes(uid):
    """A person's nickname and admin note (admins set them; every admin and moderator sees them) and the private note of
    whoever is saving (moderators can save theirs too; nobody else ever sees it)."""
    me, u = current_user(), one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        abort(404)
    note = data.clean(request.form.get('private_note', ''), multiline=True)[:2000]
    if note:
        run('''INSERT INTO user_notes (user_id, author_id, note, updated_at) VALUES (?,?,?,?)
               ON CONFLICT(user_id, author_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at''', (uid, me['id'], note, data.now_iso()))
    else:
        run('DELETE FROM user_notes WHERE user_id=? AND author_id=?', (uid, me['id']))
    if me['role'] == 'admin' and 'nickname' in request.form:
        nickname = data.clean(request.form.get('nickname', ''))[:60]
        staff_note = data.clean(request.form.get('staff_note', ''), multiline=True)[:2000]
        if (nickname, staff_note) != (u['nickname'], u['staff_note']):
            if is_owner(u) and not is_owner(me):
                flash('Only the owner can change the owner’s nickname or admin note. Your private note was saved.', 'error')
                return redirect(_back(url_for('admin.user_detail', uid=uid)))
            run('UPDATE users SET nickname=?, staff_note=? WHERE id=?', (nickname, staff_note, uid))
            audit(me['id'], 'user_notes_updated', u['email'])
    flash(f"Notes saved for {u['name']}.")
    return redirect(_back(url_for('admin.user_detail', uid=uid)))


@bp.post('/users/<uid>/make-partner')
@admin_required
def make_partner(uid):
    """Owner only: gives the person the partner role and a partner profile (hidden until the owner fills it in and shows it)."""
    me, u = current_user(), one('SELECT * FROM users WHERE id=?', (uid,))
    if not is_owner(me):
        abort(403)
    if not u:
        abort(404)
    if u['role'] in data.STAFF:
        flash('Admins and moderators can’t be made partners: it would remove their access. Change their role first.', 'error')
        return redirect(_back(url_for('admin.users')))
    if u['role'] != 'partner':  # a new role signs them out everywhere, like any role change
        run("UPDATE users SET role='partner', session_version=session_version+1 WHERE id=?", (uid,))
        audit(me['id'], 'user_updated role=partner disabled=' + str(u['disabled']), u['email'])
    profile = one('SELECT id FROM partner_profiles WHERE user_id=?', (uid,))
    if not profile:
        pid = new_id()
        run('INSERT INTO partner_profiles (id, name, user_id, position, updated_at) VALUES (?,?,?,(SELECT COALESCE(MAX(position), 0) + 10 FROM partner_profiles),?)',
            (pid, u['name'], uid, data.now_iso()))
        audit(me['id'], 'partner_profile_created', u['name'])
        flash(f"{u['name']} is now a partner. Fill in their profile below; it shows on the About page once you tick “Show”.")
        return redirect(url_for('admin.partner_profile', pid=pid))
    flash(f"{u['name']} is now a partner.")
    return redirect(url_for('admin.partner_profile', pid=profile['id']))


@bp.get('/partner-profiles')
@admin_required
def partner_profiles():
    """The About page's partners and supporters, in page order. Only the owner edits them."""
    return render_template('admin/partner_profiles.html', profiles=all_('''SELECT p.*, u.email user_email FROM partner_profiles p
        LEFT JOIN users u ON u.id = p.user_id ORDER BY p.tier, p.position, p.name'''))


@bp.route('/partner-profiles/new', methods=['GET', 'POST'])
@bp.route('/partner-profiles/<pid>', methods=['GET', 'POST'])
@admin_required
def partner_profile(pid=None):
    me = current_user()
    if not is_owner(me):
        abort(403)
    p = one('SELECT * FROM partner_profiles WHERE id=?', (pid,)) if pid else None
    if pid and not p:
        abort(404)
    if request.method != 'POST':
        return render_template('admin/partner_profile.html', p=dict(p) if p else {'tier': 'partner', 'position': next_position()}, errors={},
                               linked=one('SELECT name, email FROM users WHERE id=?', (p['user_id'],)) if p and p['user_id'] else None)
    if request.form.get('action') == 'delete' and p:
        run('DELETE FROM partner_profiles WHERE id=?', (pid,))
        _drop_upload(p['img'])
        audit(me['id'], 'partner_profile_deleted', p['name'])
        flash(f"Removed {p['name']} from the About page.")
        return redirect(url_for('admin.partner_profiles'))
    f = data.Form(request.form)
    f.text('name', 'Name', min=2, max=120)
    f.one_of('tier', ('partner', 'supporter'), 'where it shows')
    f.text('quote', 'Quote', max=600, required=False, multiline=True)
    f.text('quote_by', 'Who said it', max=120, required=False)
    f.text('quote_role', 'Their role', max=120, required=False)
    f.url('url')
    f.text('link_text', 'Link text', max=60, required=False)
    f.text('address', 'Address', max=200, required=False)
    f.text('about', 'Description', max=200, required=False)
    pos = request.form.get('position', '')
    if not pos.isdigit() or int(pos) > 100000:
        f.errors['position'] = 'Enter a whole number, like 10'
    o = {**f.out, 'url': f.out.get('url') or '', 'position': int(pos) if pos.isdigit() else 0,
         **{k: 1 if request.form.get(k) else 0 for k in ('shown', 'wide', 'big', 'logo')}}
    photo = request.files.get('photo')
    if photo and photo.filename:
        name = save_upload(photo)
        if name:
            o.update(img=name, width=None, height=None)
        else:
            f.errors['photo'] = 'Upload a PNG, JPEG or WebP image'
    elif request.form.get('remove_photo'):
        o.update(img='', width=None, height=None)
    if f.errors:
        if o.get('img', '').startswith('up-') and (not p or o['img'] != p['img']):
            _drop_upload(o['img'])  # the rest of the form didn't save, so neither does its photo
        return render_template('admin/partner_profile.html', p={**(dict(p) if p else {}), **request.form.to_dict(), **{k: o[k] for k in ('shown', 'wide', 'big', 'logo')}},
                               errors=f.errors, linked=None), 422
    o['updated_at'] = data.now_iso()
    if p:
        run(f"UPDATE partner_profiles SET {', '.join(k + '=?' for k in o)} WHERE id=?", (*o.values(), pid))
        if 'img' in o and o['img'] != p['img']:
            _drop_upload(p['img'])
    else:
        pid = o['id'] = new_id()
        run(f"INSERT INTO partner_profiles ({','.join(o)}) VALUES ({','.join('?' * len(o))})", tuple(o.values()))
    audit(me['id'], 'partner_profile_saved', o['name'])
    flash(f"Saved {o['name']}." + ('' if o['shown'] else ' It’s hidden from the About page until you tick “Show”.'))
    return redirect(url_for('admin.partner_profile', pid=pid))


def next_position():
    return one('SELECT COALESCE(MAX(position), 0) + 10 n FROM partner_profiles')['n']


def _drop_upload(name):
    """Deletes an uploaded photo nothing uses any more (the original six in static/ are left alone)."""
    if name and name.startswith('up-'):
        (uploads_dir() / name).unlink(missing_ok=True)


@bp.route('/stats', methods=['GET', 'POST'])
@admin_required
def stats():
    """The overview: headline numbers, a few charts, and every other count in one table. Straight counts from the
    database; the owner can add a hand adjustment to a number (for things the site can't see, like a placement arranged
    offline), which is always shown next to the real count and recorded in Activity."""
    if request.method == 'POST':
        me, key = current_user(), request.form.get('key', '')
        value = request.form.get('adjust', '').strip().replace('+', '')
        if not is_owner(me):
            abort(403)
        if key not in STAT_LABELS or not value.lstrip('-').isdigit() or abs(int(value)) > 100000:
            flash('Enter a whole number, like 3 or -2.', 'error')
        else:
            old = stat_adjustments().get(key, 0)
            run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                ('stat_adj:' + key, int(value)))
            audit(me['id'], f'stat_adjusted {key} {old:+d} to {int(value):+d}', key)
            flash('Adjustment saved.')
        return redirect(url_for('admin.stats') + '#more')
    s, adj = _stat_numbers(), stat_adjustments()
    today = date.fromisoformat(data.now_iso()[:10])
    n = lambda sql, args=(): one(sql, args)['n']
    weeks = []  # the last 12 weeks, oldest first
    for i in reversed(range(12)):
        end, start = today - timedelta(days=7 * i), today - timedelta(days=7 * (i + 1))
        weeks.append({'label': (start + timedelta(days=1)).strftime('%b %-d'),
                      'signups': n('SELECT COUNT(*) n FROM users WHERE substr(created_at,1,10) > ? AND substr(created_at,1,10) <= ?', (start.isoformat(), end.isoformat())),
                      'active': n('SELECT COUNT(DISTINCT user_id) n FROM user_days WHERE day > ? AND day <= ?', (start.isoformat(), end.isoformat()))})
    stage_n = {r['stage']: r['n'] for r in all_('SELECT stage, COUNT(*) n FROM tracked GROUP BY stage')}
    return render_template('admin/stats.html', s=s, adj=adj, weeks=weeks, labels=STAT_LABELS, nice=_nice_top,
        stages=[(st, stage_n.get(st, 0)) for st in data.STAGES],
        found=[('Found on OpenAjar', s['won_here']), ('Found elsewhere', s['won_elsewhere']),
               ('Not answered yet', s['won'] - s['won_here'] - s['won_elsewhere'])],
        types=_top_and_other([(('Teen jobs' if r['type'] == 'Job' else r['type']), r['n']) for r in
               all_("SELECT type, COUNT(*) n FROM opportunities WHERE status='approved' GROUP BY type ORDER BY n DESC")]))


def _top_and_other(items, keep=7):
    """The biggest few, with the rest added up as Other, so a chart stays short."""
    return items if len(items) <= keep + 1 else items[:keep] + [('Other', sum(n for _, n in items[keep:]))]


def _stat_numbers():
    """Every count on Stats and in the export's summary, straight from the database."""
    today = date.fromisoformat(data.now_iso()[:10])  # UTC, the same clock user_days and created_at use
    ago = lambda days: (today - timedelta(days=days)).isoformat()
    n = lambda sql, args=(): one(sql, args)['n']
    won = tuple(data.WON_STAGES)
    q = ','.join('?' * len(won))
    s = {
        'members': n('SELECT COUNT(*) n FROM users WHERE disabled=0'),
        'verified': n('SELECT COUNT(*) n FROM users WHERE disabled=0 AND email_verified=1'),
        'joined7': n('SELECT COUNT(*) n FROM users WHERE substr(created_at,1,10) > ?', (ago(7),)),
        'engaged': n("""SELECT COUNT(*) n FROM users u WHERE disabled=0 AND (EXISTS (SELECT 1 FROM saved WHERE user_id=u.id)
                        OR EXISTS (SELECT 1 FROM tracked WHERE user_id=u.id))"""),
        'active7': n('SELECT COUNT(DISTINCT user_id) n FROM user_days WHERE day > ?', (ago(7),)),
        'active30': n('SELECT COUNT(DISTINCT user_id) n FROM user_days WHERE day > ?', (ago(30),)),
        'tracked': n('SELECT COUNT(*) n FROM tracked'),
        'saved': n('SELECT COUNT(*) n FROM saved'),
        'reminded': n('SELECT COUNT(*) n FROM tracked WHERE reminded_for IS NOT NULL'),
        'won': n(f'SELECT COUNT(*) n FROM tracked WHERE stage IN ({q})', won),
        'won_here': n(f'SELECT COUNT(*) n FROM tracked WHERE stage IN ({q}) AND found_here=1', won),
        'won_elsewhere': n(f'SELECT COUNT(*) n FROM tracked WHERE stage IN ({q}) AND found_here=0', won),
        'won_students': n(f'SELECT COUNT(DISTINCT user_id) n FROM tracked WHERE stage IN ({q}) AND found_here=1', won),
        'placed': n("SELECT COUNT(*) n FROM intern_applications WHERE status='placed'"),
        'intern_apps': n('SELECT COUNT(*) n FROM intern_applications'),
        'live': n("SELECT COUNT(*) n FROM opportunities WHERE status='approved'"),
        'reviewed': n('SELECT COUNT(DISTINCT opportunity_id) n FROM review_events'),
        'checked': n("SELECT COUNT(*) n FROM opportunities WHERE verification='verified'"),
        'removed': n("SELECT COUNT(*) n FROM opportunities WHERE status IN ('rejected','expired')"),
        'grants_paid': n("SELECT COALESCE(SUM(paid_amount), 0) n FROM access_grants WHERE status='paid'"),
    }
    # Schools: typed freely, so group case- and space-insensitively and show the most common spelling
    schools = {}
    for r in all_("SELECT school FROM users WHERE disabled=0 AND school <> ''"):
        names = schools.setdefault(' '.join(r['school'].lower().split()), {})
        names[r['school']] = names.get(r['school'], 0) + 1
    s['top_schools'] = sorted(((max(v, key=v.get), sum(v.values())) for v in schools.values()), key=lambda x: -x[1])[:8]
    s['schools'] = len(schools)
    return s


def _nice_top(v):
    """A round top for a chart axis at or above v whose half is whole too: 2, 4, 6, 10, 20, 40, 60, 100... (37 -> 40)."""
    step = 1
    while True:
        for m in (2, 4, 6, 10):
            if v <= m * step:
                return m * step
        step *= 10


# the numbers on Stats (and in the export's summary) the owner may adjust by hand, in the order they're listed
STAT_LABELS = {
    'members': 'Members', 'active30': 'Active in the last 30 days', 'engaged': 'Engaged (saved or tracked a listing)',
    'schools': 'Schools', 'won_here': 'Acceptances found on OpenAjar', 'won': 'Acceptances tracked in total',
    'placed': 'Students placed as interns', 'tracked': 'Applications tracked', 'saved': 'Listings saved',
    'reminded': 'Deadline reminders sent', 'live': 'Live listings', 'reviewed': 'Listings reviewed by the team',
    'removed': 'Listings removed as outdated', 'grants_paid': 'Access Grants paid ($)',
}


def stat_adjustments():
    return {r['key'][9:]: int(r['value']) for r in all_("SELECT key, value FROM app_meta WHERE key LIKE 'stat_adj:%'") if int(r['value'])}


@bp.context_processor
def tab_badges():
    """How many things are waiting on each admin tab, for the number badges in the admin menu."""
    if not current_user() or current_user()['role'] not in data.STAFF:
        return {}
    return {'badges': dict(one('''SELECT
        (SELECT COUNT(*) FROM opportunities WHERE status='pending_review') listings,
        (SELECT COUNT(*) FROM intern_applications WHERE status='new') interns,
        (SELECT COUNT(*) FROM contact_messages WHERE status='new') messages,
        (SELECT COUNT(*) FROM partner_inquiries WHERE status='new') partners,
        (SELECT COUNT(*) FROM access_grants WHERE status='new') grants,
        (SELECT COUNT(*) FROM testimonials WHERE status='pending') voices'''))}


@bp.get('/backup')
@admin_required
def backup():
    """A consistent copy of the whole database to keep somewhere safe. It holds everyone's data (password hashes too),
    so store it privately."""
    tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    tmp.close()
    out = sqlite3.connect(tmp.name)
    get_db().backup(out)  # safe while the site is being used, unlike copying the file
    out.close()
    audit(current_user()['id'], 'database_backup_downloaded', 'database')
    resp = send_file(tmp.name, as_attachment=True, download_name=f"openajar-{data.now_iso()[:10]}.db", mimetype='application/octet-stream')
    resp.call_on_close(lambda: os.remove(tmp.name))
    return resp


@bp.get('/export')
@admin_required
def export():
    """Everything people can read in a spreadsheet: a zip with one CSV per area, readable headers, emails and titles
    instead of internal ids, and plain dates. Password hashes and sign-in tokens are left out."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, sql in EXPORTS.items():
            cur = get_db().execute(sql)
            out = io.StringIO()
            w = csv.writer(out)
            w.writerow([c[0] for c in cur.description])
            w.writerows([_cell(v) for v in row] for row in cur)
            z.writestr(f'{name}.csv', '﻿' + out.getvalue())  # the BOM tells Excel it's UTF-8
        s, adj = _stat_numbers(), stat_adjustments()
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(['Number', 'Database count', 'Added by hand', 'Shown on Stats'])
        w.writerows([label, s[k], adj.get(k, 0), s[k] + adj.get(k, 0)] for k, label in STAT_LABELS.items())
        z.writestr('summary.csv', '﻿' + out.getvalue())
    audit(current_user()['id'], 'data_exported', 'all data (CSV)')
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"openajar-data-{data.now_iso()[:10]}.zip", mimetype='application/zip')


def _cell(v):
    """A database value as people read it: dates without the T and seconds, lists one after another."""
    if isinstance(v, str) and ISO_TIME.match(v):
        return v[:10] + ' ' + v[11:16]
    if isinstance(v, str) and v.startswith('['):
        try:
            items = json.loads(v)
        except ValueError:
            return v
        return '; '.join(('✓ ' if i.get('done') else '') + i.get('text', '') if isinstance(i, dict) else str(i) for i in items)
    return '' if v is None else v


ISO_TIME = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
YES = lambda col: f"CASE WHEN {col} THEN 'Yes' ELSE 'No' END"
EXPORTS = {  # file name -> query with readable column names
    'members': f'''SELECT name "Name", email "Email", role "Role", school "School", grade "Grade", location "Location",
        interests "Interests", {YES('email_verified')} "Email confirmed", {YES('email_reminders')} "Reminder emails",
        {YES('disabled')} "Disabled", nickname "Nickname", staff_note "Admin note", created_at "Joined" FROM users ORDER BY created_at''',
    'listings': '''SELECT title "Title", org "Organization", type "Type", status "Status", verification "Checked", cost "Cost",
        cost_note "Cost note", format "Format", location "Location", state "State", commitment "Commitment", grades "Grades",
        interests "Interests", deadline_date "Deadline", deadline_note "Deadline note", url "Link", summary "Summary",
        eligibility "Eligibility", requirements "Requirements", source "Source", published_at "Published", expires_at "Expires",
        updated_at "Last updated" FROM opportunities ORDER BY title''',
    'tracker': '''SELECT u.email "Student", o.title "Listing", t.stage "Stage", t.deadline "Own deadline", t.checklist "Checklist",
        t.notes "Notes", CASE t.found_here WHEN 1 THEN 'Yes' WHEN 0 THEN 'No' END "Found on OpenAjar", t.added_at "Added"
        FROM tracked t JOIN users u ON u.id=t.user_id JOIN opportunities o ON o.id=t.opportunity_id ORDER BY t.added_at''',
    'saved': '''SELECT u.email "Student", o.title "Listing", s.created_at "Saved" FROM saved s JOIN users u ON u.id=s.user_id
        JOIN opportunities o ON o.id=s.opportunity_id ORDER BY s.created_at''',
    'intern-applications': '''SELECT full_name "Name", email "Email", grade "Grade", school "School", location "Location",
        interests "Interests", skills "Skills", availability "Availability", statement "Why they want to intern", link "Link",
        status "Status", admin_note "Private note", placement_business "Placed with", placement_start "Starts",
        placement_hours "Hours", placement_supervisor "Supervisor", created_at "Applied" FROM intern_applications ORDER BY created_at''',
    'partner-inquiries': '''SELECT business "Business", contact_name "Contact", email "Email", phone "Phone", location "Location",
        message "Message", status "Status", admin_note "Private note", created_at "Sent" FROM partner_inquiries ORDER BY created_at''',
    'messages': '''SELECT name "Name", email "Email", topic "Topic", message "Message", status "Status", admin_note "Private note",
        created_at "Sent" FROM contact_messages ORDER BY created_at''',
    'partner-profiles': '''SELECT name "Name", tier "Shown as", CASE WHEN shown THEN 'Yes' ELSE 'No' END "On the About page",
        position "Order", quote "Quote", url "Website", address "Address", about "Description" FROM partner_profiles ORDER BY tier, position''',
    'quotes': '''SELECT name "Name", role_label "Role", quote "Quote", status "Status", updated_at "Updated" FROM testimonials
        ORDER BY updated_at''',
    'access-grants': '''SELECT name "Student", email "Email", parent_email "Parent or guardian", program "Program", org "Organization",
        url "Link", covers "Fee for", total_cost "Total cost ($)", amount "Asked for ($)", due_date "Due", accepted "Accepted",
        asked_program "Asked the program for aid", reason "Why", status "Status", approved_amount "Approved ($)",
        approved_at "Approved", paid_amount "Paid ($)", paid_on "Paid on", paid_method "Paid by", paid_ref "Reference",
        admin_note "Private note", created_at "Sent" FROM access_grants ORDER BY created_at''',
    'application-updates': '''SELECT a.created_at "When", a.kind "Kind",
        COALESCE((SELECT email FROM intern_applications WHERE id=a.item_id), (SELECT email FROM partner_inquiries WHERE id=a.item_id),
                 (SELECT email FROM access_grants WHERE id=a.item_id), (SELECT email FROM contact_messages WHERE id=a.item_id)) "Applicant", COALESCE(u.email, 'System') "From",
        a.status "New status", a.message "Message" FROM application_updates a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at''',
    'activity': '''SELECT at "When", actor "Who", action "Action", title "About", message "Note" FROM (
        SELECT e.created_at at, COALESCE(u.email, 'System') actor, e.action, o.title, e.message FROM review_events e
        JOIN opportunities o ON o.id=e.opportunity_id LEFT JOIN users u ON u.id=e.actor_id
        UNION ALL SELECT a.created_at, COALESCE(u.email, 'System'), a.action, a.target, '' FROM audit_log a
        LEFT JOIN users u ON u.id=a.actor_id) ORDER BY at DESC''',
}


@bp.get('/activity')
@admin_required
def activity():
    """Everything admins and the system did: listing reviews and account actions, newest first, searchable by who,
    when and what. An action's kind is its first word (e.g. user_updated for a role change)."""
    every = '''SELECT e.action, e.message, e.created_at at, o.title title, o.id opp_id, COALESCE(u.name, 'System') actor, u.email actor_email
               FROM review_events e JOIN opportunities o ON o.id=e.opportunity_id LEFT JOIN users u ON u.id=e.actor_id
               UNION ALL
               SELECT a.action, '', a.created_at, a.target, NULL, COALESCE(u.name, 'System'), u.email
               FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id'''
    kind = "substr(action, 1, instr(action || ' ', ' ') - 1)"
    a = request.args
    f = {'who': a.get('who', '')[:100].strip(), 'kind': a.get('kind', '')[:60],
         'from': a.get('from') if data.parse_date(a.get('from', '')) else '',
         'to': a.get('to') if data.parse_date(a.get('to', '')) else ''}
    where, args = [], []
    if f['who']:
        where.append('(lower(actor) LIKE ? OR lower(actor_email) LIKE ?)')
        args += [f"%{f['who'].lower()}%"] * 2
    if f['kind']:
        where.append(f'{kind} = ?')
        args.append(f['kind'])
    if f['from']:
        where.append('substr(at, 1, 10) >= ?')
        args.append(f['from'])
    if f['to']:
        where.append('substr(at, 1, 10) <= ?')
        args.append(f['to'])
    items, pg = paged(f'SELECT * FROM ({every})' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY at DESC', args)
    kinds = [r['k'] for r in all_(f'SELECT DISTINCT {kind} k FROM ({every}) ORDER BY k')]
    return render_template('admin/activity.html', items=items, pg=pg, f=f, kinds=kinds, names=ACTION_NAMES, filtered=any(f.values()))


# readable names for the kinds of action in Activity; anything else shows as its kind with spaces
ACTION_NAMES = {
    'user_updated': 'Changed a user’s role or access', 'email_confirmed_by_admin': 'Confirmed a user’s email by hand',
    'account_deleted': 'Deleted their account', 'password_changed': 'Changed their password', 'password_reset': 'Reset their password',
    'approve': 'Approved a listing', 'reject': 'Rejected a listing', 'request_changes': 'Asked for listing changes',
    'expire': 'Expired a listing', 'reopen': 'Reopened a listing', 'edited': 'Edited a listing', 'submitted': 'Submitted a listing',
    'resubmitted': 'Resubmitted a listing', 'imported': 'Imported a listing', 'bulk_approve': 'Bulk-approved listings',
    'grant_approved': 'Approved an Access Grant', 'grant_needs_info': 'Asked about an Access Grant',
    'grant_declined': 'Declined an Access Grant', 'grant_paid': 'Recorded an Access Grant payment',
    'grant_withdrawn': 'Withdrew an Access Grant request', 'stat_adjusted': 'Adjusted a stat by hand',
    'database_backup_downloaded': 'Downloaded a database backup', 'application_update': 'Updated an applicant',
    'message': 'Sent a listing submitter an update', 'reply': 'Replied about their listing',
    'placement_updated': 'Saved an intern’s placement', 'user_notes_updated': 'Changed a user’s nickname or admin note',
    'partner_profile_created': 'Made a user a partner', 'partner_profile_saved': 'Saved a partner profile',
    'partner_profile_deleted': 'Deleted a partner profile',
}


@bp.route('/messages', methods=['GET', 'POST'])
@admin_required
def messages():
    return _inbox('contact_messages', list(data.CONTACT_STATUSES), 'admin/messages.html', ('name', 'email', 'topic', 'message'),
                  kind='contact')


@bp.route('/partners', methods=['GET', 'POST'])
@admin_required
def partners():
    return _inbox('partner_inquiries', list(data.PARTNER_STATUSES), 'admin/partners.html',
                  ('business', 'contact_name', 'email', 'location'), kind='partner')


@bp.route('/grants', methods=['GET', 'POST'])
@admin_required
def grants():
    if request.method == 'POST':
        g = one('SELECT * FROM access_grants WHERE id=?', (request.form.get('id', ''),))
        if not g:
            abort(404)
        ok, msg = grant_action(dict(g), request.form.get('action', ''), request.form, current_user())
        flash(msg, 'message' if ok else 'error')
        return redirect(request.full_path + '#g-' + g['id'])
    status = request.args.get('status', '')
    where, args = (['status=?'], [status]) if status in data.GRANT_STATUSES else ([], [])
    cond, cargs = searched(('name', 'email', 'program', 'org'))
    if cond:
        where.append(cond)
        args += cargs
    rows, pg = paged('SELECT * FROM access_grants' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY created_at DESC', args)
    rows = [dict(r) for r in rows]
    for r in rows:
        r['room'] = grant_room(r['user_id'], r['id']) if r['user_id'] else data.GRANT_CAP
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM access_grants GROUP BY status')}
    totals = one("""SELECT COALESCE(SUM(CASE WHEN status='paid' THEN paid_amount END), 0) paid,
                           COALESCE(SUM(CASE WHEN status='approved' THEN approved_amount END), 0) committed FROM access_grants""")
    return render_template('admin/grants.html', rows=rows, pg=pg, counts=counts, status=status, totals=totals, q=request.args.get('q', ''),
                           updates=updates_for('grant', [r['id'] for r in rows]))


def grant_action(g, action, form, me):
    """Applies one admin action to an Access Grant. Returns (ok, message for the admin). Nobody can act on their own request."""
    if g['user_id'] == me['id']:
        return False, 'You can’t act on your own request. Another admin has to.'
    now, msg = data.now_iso(), data.clean(form.get('message', ''), multiline=True)[:1000]
    if action == 'note':
        run('UPDATE access_grants SET admin_note=? WHERE id=?', (data.clean(form.get('admin_note', ''), multiline=True)[:2000], g['id']))
        return True, 'Note saved.'
    if action == 'message':
        if len(msg) < 5:
            return False, 'Write the update first (5+ characters).'
        run('UPDATE access_grants SET message=?, updated_at=? WHERE id=?', (msg, now, g['id']))
        record_update('grant', g['id'], None, msg)
        _tell(g, 'An update on your Access Grant request', [msg])
        return True, 'Update sent to the student.'
    if action in ('needs_info', 'decline'):
        if g['status'] not in data.GRANT_OPEN:
            return False, f"This request is {data.GRANT_STATUSES[g['status']].lower()}."
        if len(msg) < 5:
            return False, 'Write a message to the student (5+ characters).'
        to = 'needs_info' if action == 'needs_info' else 'declined'
        run('UPDATE access_grants SET status=?, message=?, updated_at=? WHERE id=?', (to, msg, now, g['id']))
        audit(me['id'], f'grant_{to}', g['id'])
        record_update('grant', g['id'], to, msg)
        if to == 'needs_info':
            _tell(g, 'We need a little more information', [msg, 'Reply to this email with what we asked for.'])
        else:
            _tell(g, 'About your Access Grant request', [msg])
        return True, 'Sent to the student.'
    if action == 'approve':
        if g['status'] not in ('new', 'needs_info'):
            return False, 'Only a new request or one waiting on info can be approved.'
        f = data.Form(form)
        f.dollars('approved_amount', 'The amount to approve')
        if f.errors:
            return False, f.errors['approved_amount']
        amount = f.out['approved_amount']
        room = grant_room(g['user_id'], g['id']) if g['user_id'] else data.GRANT_CAP
        if amount > g['amount']:
            return False, f"That’s more than the ${g['amount']} they asked for."
        if amount > room:
            return False, f'That’s over the ${data.GRANT_CAP} yearly cap for this student (${room} left).'
        run("UPDATE access_grants SET approved_amount=?, approved_by=?, approved_at=?, status='approved', message=?, updated_at=? WHERE id=?",
            (amount, me['id'], now, msg, now, g['id']))  # an earlier "needs info" note no longer applies
        audit(me['id'], f'grant_approved ${amount}', g['id'])
        record_update('grant', g['id'], 'approved', msg or f'Approved for ${amount}.')
        _tell(g, 'Your Access Grant is approved', [
            f"We’ll cover ${amount} toward the {g['covers'].lower()} for {g['program']}.", *([msg] if msg else []),
            'We pay the program directly, never you. We may ask for your acceptance letter or invoice first, '
            'and we’ll email you once it’s paid.'])
        return True, f'Approved ${amount}. The student has been told.'
    if action == 'paid':
        if g['status'] != 'approved':
            return False, 'Only an approved request can be marked paid.'
        f = data.Form(form)
        f.dollars('paid_amount', 'The amount paid')
        f.date('paid_on', required=True)
        f.text('paid_method', 'How it was paid', min=2, max=80)
        f.text('paid_ref', 'Reference', max=120, required=False)
        if f.errors:
            return False, next(iter(f.errors.values()))
        p = f.out
        if p['paid_amount'] > g['approved_amount']:
            return False, f"That’s more than the ${g['approved_amount']} approved."
        run("""UPDATE access_grants SET status='paid', paid_amount=?, paid_on=?, paid_method=?, paid_ref=?, paid_by=?,
               updated_at=? WHERE id=?""", (p['paid_amount'], p['paid_on'], p['paid_method'], p['paid_ref'], me['id'], now, g['id']))
        audit(me['id'], f"grant_paid ${p['paid_amount']}", g['id'])
        record_update('grant', g['id'], 'paid', f"We paid ${p['paid_amount']} to {g['org']} on {data.nice_date(p['paid_on'])}.")
        _tell(g, 'Your Access Grant is paid', [
            f"We paid ${p['paid_amount']} to {g['org']} for {g['program']} on {p['paid_on']}.",
            'You don’t need to do anything else. If the program asks, let them know OpenAjar covered this fee.'])
        return True, 'Payment recorded. The student has been told.'
    return False, 'Unknown action.'


def _tell(g, heading, paragraphs):
    # the decision is saved; the student also sees it on the Access Grants page
    mail.later('access grant update', mail.grant_update, current_app.config, g, heading, paragraphs)


@bp.route('/interns', methods=['GET', 'POST'])
@admin_required
def interns():
    if request.method == 'POST' and request.form.get('action') == 'placement':
        return save_placement()
    return _inbox('intern_applications', list(data.INTERN_STATUSES), 'admin/interns.html',
                  ('full_name', 'email', 'school', 'location'), kind='intern')


def save_placement():
    """Where an accepted intern is placed: business, start date, hours and supervisor. Shown on their profile; not emailed."""
    row = one('SELECT * FROM intern_applications WHERE id=?', (request.form.get('id', ''),))
    if not row:
        abort(404)
    back = redirect(request.full_path + f"#a-{row['id']}")
    if row['status'] not in data.PLACED:
        flash('Accept the application before adding where they’re placed.', 'error')
        return back
    f = data.Form(request.form)
    f.text('placement_business', 'Business', max=160, required=False)
    f.date('placement_start')
    f.text('placement_hours', 'Hours', max=160, required=False)
    f.text('placement_supervisor', 'Supervisor', max=200, required=False)
    if f.errors:
        flash(' '.join(f.errors.values()), 'error')
        return back
    o = f.out
    run('UPDATE intern_applications SET placement_business=?, placement_start=?, placement_hours=?, placement_supervisor=? WHERE id=?',
        (o['placement_business'], o['placement_start'], o['placement_hours'], o['placement_supervisor'], row['id']))
    audit(current_user()['id'], 'placement_updated', row['id'])
    flash(f"Placement saved. {row['full_name'].split()[0]} sees it on their profile.")
    return back


def record_update(kind, item_id, status=None, message=''):
    """Saves what the team told an applicant (shown on their profile) and logs it in Activity."""
    run('INSERT INTO application_updates (kind, item_id, actor_id, status, message, created_at) VALUES (?,?,?,?,?,?)',
        (kind, item_id, current_user()['id'], status, message, data.now_iso()))
    audit(current_user()['id'], f"application_update {kind}" + (f' {status}' if status else '') + (' with a message' if message else ''), item_id)


def updates_for(kind, ids):
    """item id -> its updates, newest first, with who sent each."""
    if not ids:
        return {}
    out = {}
    for r in all_(f'''SELECT a.*, COALESCE(u.name, 'System') actor FROM application_updates a LEFT JOIN users u ON u.id = a.actor_id
                      WHERE a.kind=? AND a.item_id IN ({','.join('?' * len(ids))}) ORDER BY a.id DESC''', (kind, *ids)):
        out.setdefault(r['item_id'], []).append(r)
    return out


def _inbox(table, statuses, template, cols, kind=None):
    """The admin inboxes: list rows newest first by status and search; save a row's status and private note. For an
    application (kind), a status change or a message is also saved as an update and emailed to the applicant."""
    if request.method == 'POST':
        row = one(f'SELECT * FROM {table} WHERE id=?', (request.form.get('id', ''),))
        status = request.form.get('quick') or request.form.get('status')  # quick: a one-click button such as Accept
        if row and status in statuses:
            message = data.clean(request.form.get('message', ''), multiline=True)[:1000] if kind else ''
            if kind == 'contact' and message and status == 'new':
                status = 'replied'  # answering a message marks it answered
            run(f'UPDATE {table} SET status=?, admin_note=? WHERE id=?',
                (status, data.clean(request.form.get('admin_note', row['admin_note']), multiline=True)[:2000], row['id']))
            changed = status != row['status']
            if kind and (changed or message):
                label = data.APPLICATION_KINDS[kind]['statuses'][status] if changed else None
                record_update(kind, row['id'], status if changed else None, message)
                decided = changed and status in data.DECISIONS.get(kind, ())  # accepted or declined: they're always told
                if message or request.form.get('notify') or decided:
                    name, title = {'intern': lambda: (row['full_name'], 'OpenAjar internships'),
                                   'partner': lambda: (row['contact_name'], f"hosting an intern at {row['business']}"),
                                   'contact': lambda: (row['name'], row['topic'])}[kind]()
                    mail.later(f'{kind} update', mail.application_update, current_app.config, row['email'], name, kind, title, label, message)
                    flash(f"Saved and emailed {row['email']}.")
                else:
                    flash('Saved. They weren’t emailed.')
            else:
                flash('Saved.')
        return redirect(request.full_path + (f"#a-{row['id']}" if row else ''))  # back to the same tab, search, page and row
    status = request.args.get('status', '')
    where, args = [], []
    if status in statuses:
        where.append('status=?')
        args.append(status)
    cond, cargs = searched(cols)
    if cond:
        where.append(cond)
        args += cargs
    rows, pg = paged(f'SELECT * FROM {table}' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY created_at DESC', args)
    counts = {r['status']: r['n'] for r in all_(f'SELECT status, COUNT(*) n FROM {table} GROUP BY status')}
    return render_template(template, rows=rows, pg=pg, counts=counts, status=status, statuses=statuses, q=request.args.get('q', ''),
                           updates=updates_for(kind, [r['id'] for r in rows]) if kind else {},
                           labels=data.APPLICATION_KINDS[kind]['statuses'] if kind else {s: s.capitalize() for s in statuses})


@bp.route('/voices', methods=['GET', 'POST'])
@admin_required
def voices():
    if request.method == 'POST':
        if request.form.get('status') in ('pending', 'approved', 'declined'):
            run('UPDATE testimonials SET status=? WHERE id=?', (request.form['status'], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.voices'))
    return render_template('admin/voices.html', quotes=all_('SELECT * FROM testimonials ORDER BY status=\'pending\' DESC, updated_at DESC'))
