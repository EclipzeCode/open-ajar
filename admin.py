"""Admin: the listing review queue, editing, users, activity, intern applications, partner inquiries, contact messages,
Community Voices and Access Grants."""
import json
from datetime import date, timedelta

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, url_for

import data
import mail
from core import (add_event, admin_required, all_, audit, current_user, events_for, expire_due, get_db, get_opp, grant_room,
                  one, run, update_opp)

bp = Blueprint('admin', __name__)

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
            expires = (date.fromisoformat(opp['deadline_date']) + timedelta(days=2)).isoformat() + 'T00:00:00+00:00'
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
    q = request.args.get('q', '')[:100].lower()
    where, args = [], []
    if status != 'all':
        where.append('status=?')
        args.append(status)
    if source:
        where.append('source=?')
        args.append(source)
    if q:
        where.append('(lower(title) LIKE ? OR lower(org) LIKE ?)')
        args += [f'%{q}%'] * 2
    sql = 'SELECT * FROM opportunities' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY updated_at DESC LIMIT 300'
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM opportunities GROUP BY status')}
    sources = all_('SELECT source, COUNT(*) n FROM opportunities' + (' WHERE status=?' if status != 'all' else '') + ' GROUP BY source',
                   (status,) if status != 'all' else ())
    return render_template('admin/queue.html', items=all_(sql, args), counts=counts, status=status, source=source,
                           sources=sources, q=q)


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
        return redirect(url_for('admin.users'))
    return render_template('admin/users.html', users=all_('SELECT * FROM users ORDER BY created_at DESC LIMIT 500'))


@bp.get('/stats')
@admin_required
def stats():
    """Numbers you can stand behind: every figure here is a straight count from the database."""
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
    return render_template('admin/stats.html', s=s, top=top[:20], weeks=weeks)


@bp.get('/activity')
@admin_required
def activity():
    reviews = all_('''SELECT e.action, e.message, e.created_at at, o.title, o.id opp_id, COALESCE(u.name, 'System') actor
                      FROM review_events e JOIN opportunities o ON o.id=e.opportunity_id LEFT JOIN users u ON u.id=e.actor_id
                      ORDER BY e.id DESC LIMIT 60''')
    audits = all_('''SELECT a.action, '' message, a.created_at at, a.target title, NULL opp_id, COALESCE(u.name, 'System') actor
                     FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 60''')
    items = sorted([dict(r) for r in reviews] + [dict(r) for r in audits], key=lambda r: r['at'], reverse=True)[:60]
    return render_template('admin/activity.html', items=items)


@bp.route('/messages', methods=['GET', 'POST'])
@admin_required
def messages():
    statuses = ['new', 'replied', 'closed']
    if request.method == 'POST':
        status = request.form.get('status')
        if status in statuses:
            run('UPDATE contact_messages SET status=?, admin_note=? WHERE id=?',
                (status, data.clean(request.form.get('admin_note', ''), multiline=True)[:2000], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.messages', status=request.args.get('status', '')))
    status = request.args.get('status', '')
    rows = all_('SELECT * FROM contact_messages' + (' WHERE status=?' if status in statuses else '') + ' ORDER BY created_at DESC LIMIT 300',
                (status,) if status in statuses else ())
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM contact_messages GROUP BY status')}
    return render_template('admin/messages.html', rows=rows, counts=counts, status=status, statuses=statuses)


@bp.route('/partners', methods=['GET', 'POST'])
@admin_required
def partners():
    statuses = ['new', 'contacted', 'partnered', 'declined']
    if request.method == 'POST':
        status = request.form.get('status')
        if status in statuses:
            run('UPDATE partner_inquiries SET status=?, admin_note=? WHERE id=?',
                (status, data.clean(request.form.get('admin_note', ''), multiline=True)[:2000], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.partners', status=request.args.get('status', '')))
    status = request.args.get('status', '')
    rows = all_('SELECT * FROM partner_inquiries' + (' WHERE status=?' if status in statuses else '') + ' ORDER BY created_at DESC LIMIT 300',
                (status,) if status in statuses else ())
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM partner_inquiries GROUP BY status')}
    return render_template('admin/partners.html', rows=rows, counts=counts, status=status, statuses=statuses)


@bp.route('/grants', methods=['GET', 'POST'])
@admin_required
def grants():
    if request.method == 'POST':
        g = one('SELECT * FROM access_grants WHERE id=?', (request.form.get('id', ''),))
        if not g:
            abort(404)
        ok, msg = grant_action(dict(g), request.form.get('action', ''), request.form, current_user())
        flash(msg, 'message' if ok else 'error')
        return redirect(url_for('admin.grants', status=request.args.get('status', '')) + '#g-' + g['id'])
    status = request.args.get('status', '')
    known = status in data.GRANT_STATUSES
    rows = [dict(r, approvals=json.loads(r['approvals'])) for r in
            all_('SELECT * FROM access_grants' + (' WHERE status=?' if known else '') + ' ORDER BY created_at DESC LIMIT 300', (status,) if known else ())]
    for r in rows:
        r['room'] = grant_room(r['user_id'], r['id']) if r['user_id'] else data.GRANT_CAP
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM access_grants GROUP BY status')}
    # team requests are paid from personal money and never counted with grants to other students
    totals = one("""SELECT COALESCE(SUM(CASE WHEN status='paid' AND NOT is_team THEN paid_amount END), 0) paid,
                           COALESCE(SUM(CASE WHEN status='approved' AND NOT is_team THEN approved_amount END), 0) committed,
                           COALESCE(SUM(CASE WHEN status='paid' AND is_team THEN paid_amount END), 0) team_paid FROM access_grants""")
    return render_template('admin/grants.html', rows=rows, counts=counts, status=status, totals=totals)


def grant_action(g, action, form, me):
    """Applies one admin action to an Access Grant. Returns (ok, message for the admin). Nobody can act on their own request;
    a team request needs two different admins to approve the same amount and is paid only from personal money."""
    if g['user_id'] == me['id']:
        return False, 'You can’t act on your own request. Another admin has to.'
    now, msg = data.now_iso(), data.clean(form.get('message', ''), multiline=True)[:1000]
    if action == 'note':
        run('UPDATE access_grants SET admin_note=? WHERE id=?', (data.clean(form.get('admin_note', ''), multiline=True)[:2000], g['id']))
        return True, 'Note saved.'
    if action == 'mark_team':
        if g['is_team'] or g['status'] not in ('new', 'needs_info'):
            return False, 'Only a new request or one waiting on info can be marked as a team request.'
        run("UPDATE access_grants SET is_team=1, approvals='[]', updated_at=? WHERE id=?", (now, g['id']))
        audit(me['id'], 'grant_marked_team', g['id'])
        return True, 'Marked as a team request. It now needs two approvals.'
    if action in ('needs_info', 'decline'):
        if g['status'] not in data.GRANT_OPEN:
            return False, f"This request is {data.GRANT_STATUSES[g['status']].lower()}."
        if len(msg) < 5:
            return False, 'Write a message to the student (5+ characters).'
        to = 'needs_info' if action == 'needs_info' else 'declined'
        run("UPDATE access_grants SET status=?, message=?, approvals='[]', updated_at=? WHERE id=?", (to, msg, now, g['id']))
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
        approvals = json.loads(g['approvals']) if amount == g['approved_amount'] else []  # a new amount starts approvals over
        if me['id'] in approvals:
            return False, 'You’ve already approved this. It needs a different admin.'
        approvals.append(me['id'])
        done = len(approvals) >= (2 if g['is_team'] else 1)
        run('UPDATE access_grants SET approved_amount=?, approvals=?, status=?, message=?, updated_at=? WHERE id=?',
            (amount, json.dumps(approvals), 'approved' if done else g['status'], msg or g['message'], now, g['id']))
        audit(me['id'], f'grant_approved ${amount}' + ('' if done else ' (1 of 2)'), g['id'])
        if not done:
            return True, f'Approved ${amount}. A team request needs one more admin to approve the same amount.'
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
        f.one_of('paid_from', ('donations', 'personal'), 'where the money came from')
        if f.errors:
            return False, next(iter(f.errors.values()))
        p = f.out
        if p['paid_amount'] > g['approved_amount']:
            return False, f"That’s more than the ${g['approved_amount']} approved."
        if g['is_team'] and p['paid_from'] != 'personal':
            return False, 'Team requests are paid only from the team’s personal money, never donations.'
        run("""UPDATE access_grants SET status='paid', paid_amount=?, paid_on=?, paid_method=?, paid_ref=?, paid_from=?, paid_by=?,
               updated_at=? WHERE id=?""", (p['paid_amount'], p['paid_on'], p['paid_method'], p['paid_ref'], p['paid_from'], me['id'], now, g['id']))
        audit(me['id'], f"grant_paid ${p['paid_amount']} from {p['paid_from']}", g['id'])
        _tell(g, 'Your Access Grant is paid', [
            f"We paid ${p['paid_amount']} to {g['org']} for {g['program']} on {p['paid_on']}.",
            'You don’t need to do anything else. If the program asks, let them know Open Ajar covered this fee.'])
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
    statuses = ['new', 'contacted', 'placed', 'declined']
    if request.method == 'POST':
        status = request.form.get('status')
        if status in statuses:
            run('UPDATE intern_applications SET status=?, admin_note=? WHERE id=?',
                (status, data.clean(request.form.get('admin_note', ''), multiline=True)[:2000], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.interns', status=request.args.get('status', '')))
    status = request.args.get('status', '')
    rows = all_('SELECT * FROM intern_applications' + (' WHERE status=?' if status in statuses else '') + ' ORDER BY created_at DESC LIMIT 300',
                (status,) if status in statuses else ())
    counts = {r['status']: r['n'] for r in all_('SELECT status, COUNT(*) n FROM intern_applications GROUP BY status')}
    return render_template('admin/interns.html', apps=rows, counts=counts, status=status, statuses=statuses)


@bp.route('/voices', methods=['GET', 'POST'])
@admin_required
def voices():
    if request.method == 'POST':
        if request.form.get('status') in ('pending', 'approved', 'declined'):
            run('UPDATE testimonials SET status=? WHERE id=?', (request.form['status'], request.form.get('id')))
            flash('Saved.')
        return redirect(url_for('admin.voices'))
    return render_template('admin/voices.html', quotes=all_('SELECT * FROM testimonials ORDER BY status=\'pending\' DESC, updated_at DESC'))
