"""Admin: the listing review queue, editing, users, activity, intern applications, partner inquiries, contact messages,
Community Voices and Access Grants."""
import os
import sqlite3
import tempfile
from datetime import date, timedelta

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, send_file, url_for

import data
import mail
from core import (add_event, admin_required, all_, audit, current_user, events_for, expire_due, get_db, get_opp, grant_room,
                  is_owner, one, run, update_opp)

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
    return '(' + ' OR '.join(f'lower({c}) LIKE ?' for c in cols) + ')', [f'%{q}%'] * len(cols)

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
    return None


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
                db = get_db()
                update_opp(db, opp_id, clean)
                db.commit()
                add_event(opp_id, current_user()['id'], 'edited', opp['status'])
                flash('Changes saved.')
                return redirect(url_for('admin.review', opp_id=opp_id))
            values = {**request.form.to_dict(), 'grades': [int(g) for g in request.form.getlist('grades') if g.isdigit()],
                      'interests': request.form.getlist('interests')}
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
    cond, args = searched(('name', 'email', 'school'))
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
    """One person: their account, intern applications (matched by email), Access Grant requests, listings they
    submitted and what they track. Opens in a pop-up on the Users page; on its own it's a normal page."""
    u = one('SELECT * FROM users WHERE id=?', (uid,))
    if not u:
        abort(404)
    return render_template('admin/user.html', u=u,
        apps=all_('SELECT * FROM intern_applications WHERE lower(email)=? ORDER BY created_at DESC', (u['email'].lower(),)),
        grants=all_('SELECT * FROM access_grants WHERE user_id=? ORDER BY created_at DESC', (uid,)),
        listings=all_('SELECT id, title, status, created_at FROM opportunities WHERE submitted_by=? ORDER BY created_at DESC', (uid,)),
        counts=one('''SELECT (SELECT COUNT(*) FROM tracked WHERE user_id=:u) tracked, (SELECT COUNT(*) FROM saved WHERE user_id=:u) saved,
                      (SELECT COUNT(*) FROM user_days WHERE user_id=:u) days, (SELECT MAX(day) FROM user_days WHERE user_id=:u) last_seen''', {'u': uid}),
        quote=one('SELECT quote, status FROM testimonials WHERE user_id=?', (uid,)))


@bp.route('/stats', methods=['GET', 'POST'])
@admin_required
def stats():
    """Straight counts from the database. The owner can add a hand adjustment to a headline number (for things the site
    can't see, like a placement arranged offline); it's shown next to the real count and recorded in Activity."""
    if request.method == 'POST':
        me, key = current_user(), request.form.get('key', '')
        value = request.form.get('adjust', '').strip().replace('+', '')
        if not is_owner(me):
            abort(403)
        if key not in STAT_KEYS or not value.lstrip('-').isdigit() or abs(int(value)) > 100000:
            flash('Enter a whole number, like 3 or -2.', 'error')
        else:
            old = stat_adjustments().get(key, 0)
            run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                ('stat_adj:' + key, int(value)))
            audit(me['id'], f'stat_adjusted {key} {old:+d} to {int(value):+d}', key)
            flash('Adjustment saved.')
        return redirect(url_for('admin.stats') + '#' + key)
    today = date.fromisoformat(data.now_iso()[:10])  # UTC, the same clock user_days and created_at use
    ago = lambda days: (today - timedelta(days=days)).isoformat()
    n = lambda sql, args=(): one(sql, args)['n']
    won = tuple(data.WON_STAGES)
    q = ','.join('?' * len(won))
    s = {
        'members': n('SELECT COUNT(*) n FROM users WHERE disabled=0'),
        'verified': n('SELECT COUNT(*) n FROM users WHERE disabled=0 AND email_verified=1'),
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
        'live_jobs': n("SELECT COUNT(*) n FROM opportunities WHERE status='approved' AND type='Job'"),
        'reviewed': n('SELECT COUNT(DISTINCT opportunity_id) n FROM review_events'),
        'checked': n("SELECT COUNT(*) n FROM opportunities WHERE verification='verified'"),
        'removed': n("SELECT COUNT(*) n FROM opportunities WHERE status IN ('rejected','expired')"),
    }
    # Schools: typed freely, so group case- and space-insensitively and show the most common spelling
    schools = {}
    for r in all_("SELECT school FROM users WHERE disabled=0 AND school <> ''"):
        key = ' '.join(r['school'].lower().split())
        names = schools.setdefault(key, {})
        names[r['school']] = names.get(r['school'], 0) + 1
    top = sorted(((max(v, key=v.get), sum(v.values())) for v in schools.values()), key=lambda x: -x[1])
    s['schools'] = len(schools)
    s['with_school'] = sum(c for _, c in top)
    # Last 8 weeks, newest first
    weeks = []
    for i in range(8):
        end, start = today - timedelta(days=7 * i), today - timedelta(days=7 * (i + 1))
        weeks.append({'start': start + timedelta(days=1), 'end': end,
                      'signups': n('SELECT COUNT(*) n FROM users WHERE substr(created_at,1,10) > ? AND substr(created_at,1,10) <= ?', (start.isoformat(), end.isoformat())),
                      'active': n('SELECT COUNT(DISTINCT user_id) n FROM user_days WHERE day > ? AND day <= ?', (start.isoformat(), end.isoformat()))})
    return render_template('admin/stats.html', s=s, adj=stat_adjustments(), top=top[:20], weeks=weeks)


# the headline numbers on Stats the owner may adjust by hand
STAT_KEYS = ('won_here', 'won', 'placed', 'members', 'engaged', 'active30', 'schools', 'tracked', 'saved', 'reminded',
             'live', 'reviewed', 'removed')


def stat_adjustments():
    return {r['key'][9:]: int(r['value']) for r in all_("SELECT key, value FROM app_meta WHERE key LIKE 'stat_adj:%'") if int(r['value'])}


@bp.context_processor
def tab_badges():
    """How many things are waiting on each admin tab, for the number badges in the admin menu."""
    if not current_user() or current_user()['role'] != 'admin':
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
    'database_backup_downloaded': 'Downloaded a database backup',
}


@bp.route('/messages', methods=['GET', 'POST'])
@admin_required
def messages():
    return _inbox('contact_messages', ['new', 'replied', 'closed'], 'admin/messages.html', ('name', 'email', 'topic', 'message'))


@bp.route('/partners', methods=['GET', 'POST'])
@admin_required
def partners():
    return _inbox('partner_inquiries', ['new', 'contacted', 'partnered', 'declined'], 'admin/partners.html',
                  ('business', 'contact_name', 'email', 'location'))


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
    return render_template('admin/grants.html', rows=rows, pg=pg, counts=counts, status=status, totals=totals, q=request.args.get('q', ''))


def grant_action(g, action, form, me):
    """Applies one admin action to an Access Grant. Returns (ok, message for the admin). Nobody can act on their own request."""
    if g['user_id'] == me['id']:
        return False, 'You can’t act on your own request. Another admin has to.'
    now, msg = data.now_iso(), data.clean(form.get('message', ''), multiline=True)[:1000]
    if action == 'note':
        run('UPDATE access_grants SET admin_note=? WHERE id=?', (data.clean(form.get('admin_note', ''), multiline=True)[:2000], g['id']))
        return True, 'Note saved.'
    if action in ('needs_info', 'decline'):
        if g['status'] not in data.GRANT_OPEN:
            return False, f"This request is {data.GRANT_STATUSES[g['status']].lower()}."
        if len(msg) < 5:
            return False, 'Write a message to the student (5+ characters).'
        to = 'needs_info' if action == 'needs_info' else 'declined'
        run('UPDATE access_grants SET status=?, message=?, updated_at=? WHERE id=?', (to, msg, now, g['id']))
        audit(me['id'], f'grant_{to}', g['id'])
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
            (amount, me['id'], now, msg or g['message'], now, g['id']))
        audit(me['id'], f'grant_approved ${amount}', g['id'])
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
        _tell(g, 'Your Access Grant is paid', [
            f"We paid ${p['paid_amount']} to {g['org']} for {g['program']} on {p['paid_on']}.",
            'You don’t need to do anything else. If the program asks, let them know OpenAjar covered this fee.'])
        return True, 'Payment recorded. The student has been told.'
    return False, 'Unknown action.'


def _tell(g, heading, paragraphs):
    try:
        mail.grant_update(current_app.config, g, heading, paragraphs)
    except Exception as e:  # the decision is saved; the student also sees it on the Access Grants page
        print(f'[email] access grant update failed: {e}')


@bp.route('/interns', methods=['GET', 'POST'])
@admin_required
def interns():
    return _inbox('intern_applications', ['new', 'contacted', 'placed', 'declined'], 'admin/interns.html',
                  ('full_name', 'email', 'school', 'location'))


def _inbox(table, statuses, template, cols):
    """The simple admin inboxes: set a row's status and private note; list them newest first by status and search."""
    if request.method == 'POST':
        status = request.form.get('status')
        if status in statuses:
            run(f'UPDATE {table} SET status=?, admin_note=? WHERE id=?',
                (status, data.clean(request.form.get('admin_note', ''), multiline=True)[:2000], request.form.get('id')))
            flash('Saved.')
        return redirect(request.full_path)  # back to the same tab, search and page
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
    return render_template(template, rows=rows, pg=pg, counts=counts, status=status, statuses=statuses, q=request.args.get('q', ''))


@bp.route('/voices', methods=['GET', 'POST'])
@admin_required
def voices():
    if request.method == 'POST':
        if request.form.get('status') in ('pending', 'approved', 'declined'):
            run('UPDATE testimonials SET status=? WHERE id=?', (request.form['status'], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.voices'))
    return render_template('admin/voices.html', quotes=all_('SELECT * FROM testimonials ORDER BY status=\'pending\' DESC, updated_at DESC'))
