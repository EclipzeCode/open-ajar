"""Admin: the listing review queue, editing, users, activity, intern applications and Community Voices."""
from datetime import date, timedelta

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for

import data
from core import (add_event, admin_required, all_, audit, current_user, events_for, expire_due, get_db, get_opp, one,
                  run, update_opp)

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
