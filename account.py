"""Accounts: sign up / in / out, email verification, password reset, the account page and the tracker."""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

import data
import mail
from core import (all_, audit, client_ip, current_user, events_for, limited, login_required, new_id, one,
                  opp_dict, run, safe_next, sign_in)

bp = Blueprint('account', __name__)
DUMMY_HASH = generate_password_hash(secrets.token_hex(8))  # checked for unknown emails so timing doesn't reveal which exist
BAD_LINK = 'That link has expired or was already used. Request a new one.'


def too_many_auth():
    return limited('auth:' + client_ip(), 15, 15 * 60)


def _sha(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(user, purpose, hours):
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(timespec='seconds')
    run('DELETE FROM auth_tokens WHERE user_id=? AND purpose=? AND used=0', (user['id'], purpose))
    run('INSERT INTO auth_tokens (id, user_id, purpose, expires_at) VALUES (?,?,?,?)', (_sha(token), user['id'], purpose, expires))
    return token


def token_user(token, purpose, spend):
    """The user id a valid token belongs to, or None. With spend=True the token is used up."""
    r = one('SELECT * FROM auth_tokens WHERE id=? AND purpose=? AND used=0 AND expires_at > ?', (_sha(token or ''), purpose, data.now_iso()))
    if r and spend:
        if run('UPDATE auth_tokens SET used=1 WHERE id=? AND used=0', (r['id'],)).rowcount != 1:
            return None
    return r['user_id'] if r else None


def send_verification(user):
    token = issue_token(user, 'verify_email', 24)
    try:
        mail.verify_email(current_app.config, user, f"{current_app.config['APP_URL']}/verify?token={token}")
    except Exception as e:  # never block sign-up on email; the account page offers a resend
        print(f'[email] verification failed: {e}')
        return False
    return True


# ---------------------------------------------------------------- sign up / in / out


@bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'GET':
        return render_template('auth/register.html', values={}, errors={})
    f = data.Form(request.form)
    f.text('name', 'Your name', min=1, max=80)
    f.email('email')
    problem = data.password_problem(request.form.get('password', ''), f.out.get('email', ''))
    if problem:
        f.errors['password'] = problem
    if not f.errors and too_many_auth():
        f.errors['_'] = 'Too many attempts. Please wait a few minutes and try again.'
    if not f.errors and one('SELECT 1 FROM users WHERE email=?', (f.out['email'],)):
        f.errors['email'] = 'That email may already be registered. Try signing in.'
    if f.errors:
        return render_template('auth/register.html', values=request.form, errors=f.errors), 422
    uid = new_id()  # self-registration is always a student; roles are only changed by admins
    run('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?,?,?,?,?)',
        (uid, f.out['email'], generate_password_hash(request.form['password']), f.out['name'], data.now_iso()))
    user = one('SELECT * FROM users WHERE id=?', (uid,))
    sign_in(user)
    send_verification(user)
    flash('Welcome to Open Ajar. We sent you an email to confirm your address.')
    return redirect(safe_next(url_for('site.browse')))


@bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        return render_template('auth/login.html', values={}, error=None)
    if too_many_auth():
        return render_template('auth/login.html', values=request.form, error='Too many attempts. Please wait a few minutes and try again.'), 429
    email = data.norm_email(request.form.get('email', ''))
    pw = request.form.get('password', '')[:128]
    user = one('SELECT * FROM users WHERE email=?', (email,)) if email else None
    ok = check_password_hash(user['password_hash'] if user else DUMMY_HASH, pw)
    if not user or not ok or user['disabled']:
        return render_template('auth/login.html', values=request.form, error='That email and password don’t match. Check them and try again.'), 401
    sign_in(user)
    return redirect(safe_next(url_for('site.browse')))


@bp.post('/logout')
def logout():
    session.clear()
    flash('You’re signed out.')
    return redirect(url_for('site.home'))


# ---------------------------------------------------------------- email verification and password reset


@bp.route('/verify', methods=['GET', 'POST'])
def verify():
    """GET shows a button; only the POST spends the token, so email scanners that pre-open links can't use it up."""
    token = request.values.get('token', '')
    if request.method == 'GET':
        return render_template('auth/verify.html', token=token)
    if too_many_auth():
        abort(429, 'Too many attempts. Please wait a few minutes and try again.')
    uid = token_user(token, 'verify_email', spend=True)
    if not uid:
        return render_template('auth/verify.html', token='', error=BAD_LINK), 400
    run('UPDATE users SET email_verified=1 WHERE id=?', (uid,))
    flash('Your email is confirmed. Thanks!')
    return redirect(url_for('account.account') if current_user() else url_for('account.login'))


@bp.post('/verify/resend')
@login_required
def resend_verification():
    u = current_user()
    if u['email_verified']:
        flash('Your email is already confirmed.')
    elif limited('verify:' + u['id'], 4, 3600):
        flash('We’ve sent several emails recently. Check your inbox and spam folder, or try again in an hour.', 'error')
    elif send_verification(u):
        flash(f"Sent. Check {u['email']} for the link.")
    else:
        flash('We couldn’t send the email just now. Please try again in a few minutes.', 'error')
    return redirect(url_for('account.account'))


@bp.route('/forgot', methods=['GET', 'POST'])
def forgot():
    """Answers the same way whether or not the address has an account."""
    if request.method == 'GET':
        return render_template('auth/forgot.html', sent=False, error=None)
    email = data.norm_email(request.form.get('email', ''))
    if not email:
        return render_template('auth/forgot.html', sent=False, error='Enter a valid email address'), 422
    if too_many_auth():
        abort(429, 'Too many attempts. Please wait a few minutes and try again.')
    user = one('SELECT * FROM users WHERE email=? AND disabled=0', (email,))
    if user and not limited('forgot:' + email, 3, 3600):
        token = issue_token(user, 'reset_password', 1)
        try:
            mail.reset_password(current_app.config, user, f"{current_app.config['APP_URL']}/reset?token={token}")
        except Exception as e:
            print(f'[email] password reset failed: {e}')
    return render_template('auth/forgot.html', sent=True, error=None)


@bp.route('/reset', methods=['GET', 'POST'])
def reset():
    token = request.values.get('token', '')
    if request.method == 'GET':
        return render_template('auth/reset.html', token=token, error=None if token_user(token, 'reset_password', False) else BAD_LINK)
    if too_many_auth():
        abort(429, 'Too many attempts. Please wait a few minutes and try again.')
    uid = token_user(token, 'reset_password', spend=False)  # look first: a weak password must not burn the link
    if not uid:
        return render_template('auth/reset.html', token='', error=BAD_LINK), 400
    user = one('SELECT * FROM users WHERE id=?', (uid,))
    problem = data.password_problem(request.form.get('password', ''), user['email'])
    if problem:
        return render_template('auth/reset.html', token=token, error=None, field_error=problem), 422
    if not token_user(token, 'reset_password', spend=True):
        return render_template('auth/reset.html', token='', error=BAD_LINK), 400
    run('UPDATE users SET password_hash=?, email_verified=1, session_version=session_version+1 WHERE id=?',
        (generate_password_hash(request.form['password']), uid))
    audit(uid, 'password_reset', 'user ' + uid)
    session.clear()
    flash('Your password is changed. Sign in with the new one.')
    return redirect(url_for('account.login'))


# ---------------------------------------------------------------- account page


@bp.get('/account')
@login_required
def account():
    u = current_user()
    subs = [opp_dict(r) for r in all_('SELECT * FROM opportunities WHERE submitted_by=? ORDER BY updated_at DESC', (u['id'],))]
    for s in subs:
        s['events'] = [e for e in events_for(s['id']) if e['message'] and e['action'] != 'imported']
    quote = one('SELECT quote, role_label, status FROM testimonials WHERE user_id=?', (u['id'],))
    quote = dict(quote) if quote else None
    counts = one('''SELECT (SELECT COUNT(*) FROM tracked WHERE user_id=:u) tracking, (SELECT COUNT(*) FROM saved WHERE user_id=:u) saved''', {'u': u['id']})
    return render_template('account.html', u=dict(u), interests=json.loads(u['interests']), submissions=subs, quote=quote,
                           counts=dict(counts, submitted=len(subs)), errors={})


def back(section, msg, ok=False):
    """Show a message inside one card of the account page and scroll back to it."""
    flash(msg, f"{'ok' if ok else 'error'} {section}")
    return redirect(url_for('account.account') + '#' + section)


@bp.post('/account/profile')
@login_required
def save_profile():
    u = current_user()
    f = data.Form(request.form)
    f.text('name', 'Name', min=1, max=80)
    f.grade()
    f.text('location', 'Location', max=120, required=False)
    if f.errors:
        return back('profile', ' '.join(f.errors.values()))
    run('UPDATE users SET name=?, grade=?, location=?, interests=?, email_reminders=? WHERE id=?',
        (f.out['name'], f.out['grade'], f.out['location'], json.dumps(f.many('interests', data.INTERESTS)),
         1 if request.form.get('email_reminders') else 0, u['id']))
    return back('profile', 'Profile saved.', ok=True)


@bp.post('/account/password')
@login_required
def change_password():
    u = current_user()
    if too_many_auth():
        abort(429, 'Too many attempts. Please wait a few minutes and try again.')
    if not check_password_hash(u['password_hash'], request.form.get('current', '')[:128]):
        return back('security', 'That isn’t your current password.')
    problem = data.password_problem(request.form.get('new', ''), u['email'])
    if problem:
        return back('security', problem)
    run('UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?', (generate_password_hash(request.form['new']), u['id']))
    audit(u['id'], 'password_changed', 'user ' + u['id'])
    sign_in(one('SELECT * FROM users WHERE id=?', (u['id'],)))  # keep this device, sign out the rest
    return back('security', 'Password changed. Other devices have been signed out.', ok=True)


@bp.post('/account/quote')
@login_required
def save_quote():
    u = current_user()
    quote = data.clean(request.form.get('quote', ''), multiline=True)
    role = data.clean(request.form.get('role_label', ''))[:80]
    if not 15 <= len(quote) <= 400:
        return back('story', 'Your quote needs 15 to 400 characters.')
    if limited('quote:' + u['id'], 12, 3600):
        return back('story', 'You’ve saved your quote a few times just now. Please try again later.')
    # each student has one quote; editing it sends it back for review
    run('''INSERT INTO testimonials (id, user_id, name, role_label, quote, status, updated_at) VALUES (?,?,?,?,?, 'pending', ?)
           ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, role_label=excluded.role_label, quote=excluded.quote,
           status='pending', updated_at=excluded.updated_at''', (new_id(), u['id'], u['name'], role, quote, data.now_iso()))
    return back('story', 'Thanks! Your quote will appear on the home page once a reviewer approves it.', ok=True)


@bp.post('/account/delete')
@login_required
def delete_account():
    """Permanently deletes the account. Listings they submitted stay up (submitted_by becomes empty)."""
    u = current_user()
    if too_many_auth():
        abort(429, 'Too many attempts. Please wait a few minutes and try again.')
    if not check_password_hash(u['password_hash'], request.form.get('password', '')[:128]):
        return back('delete', 'Enter your current password to delete your account.')
    if u['role'] == 'admin' and one("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0")['n'] <= 1:
        return back('delete', 'You are the only admin. Make someone else an admin before deleting your account.')
    audit(u['id'], 'account_deleted', u['email'])
    run('DELETE FROM users WHERE id=?', (u['id'],))
    session.clear()
    flash('Your account and everything in it has been deleted.')
    return redirect(url_for('site.home'))


# ---------------------------------------------------------------- tracker


@bp.get('/tracker')
@login_required
def tracker():
    u = current_user()
    rows = all_('''SELECT o.*, t.stage, t.notes, t.deadline own_deadline, t.checklist, t.added_at,
                          (s.user_id IS NOT NULL) is_saved, (t.user_id IS NOT NULL) is_tracked,
                          (o.status='approved' AND (o.expires_at IS NULL OR o.expires_at > ?)) available
                   FROM opportunities o
                   LEFT JOIN tracked t ON t.opportunity_id=o.id AND t.user_id=?
                   LEFT JOIN saved s ON s.opportunity_id=o.id AND s.user_id=?
                   WHERE t.user_id IS NOT NULL OR s.user_id IS NOT NULL
                   ORDER BY COALESCE(t.added_at, s.created_at) DESC''', (data.now_iso(), u['id'], u['id']))
    items = []
    for r in rows:
        o = opp_dict(r)
        o['checklist'] = json.loads(r['checklist'] or '[]')
        items.append(o)
    stage = request.args.get('stage') if request.args.get('stage') in data.STAGES else None
    tracked = [o for o in items if o['is_tracked']]
    saved = [o for o in items if o['is_saved'] and not o['is_tracked']]
    due_soon = sum(data.deadline_info(o['own_deadline'] or o['deadline_date'])[1] for o in tracked)
    return render_template('tracker.html', tracked=[o for o in tracked if not stage or o['stage'] == stage],
                           counts={s: sum(o['stage'] == s for o in tracked) for s in data.STAGES}, stage=stage,
                           total=len(tracked), due_soon=due_soon, saved=saved)


@bp.post('/tracker/<opp_id>')
@login_required
def update_tracked(opp_id):
    """One form per tracked card: stage, notes, own deadline, checklist ticks, a new checklist item, or removal."""
    u = current_user()
    t = one('SELECT * FROM tracked WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
    if not t:
        abort(404)
    form = request.form
    if form.get('action') == 'remove':
        run('DELETE FROM tracked WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
        flash('Stopped tracking. You can start again from the listing.')
        return redirect(url_for('account.tracker'))
    checklist = json.loads(t['checklist'])
    done = set(form.getlist('done'))
    for i, item in enumerate(checklist):
        item['done'] = str(i) in done
    drop = form.get('drop', '')
    if drop.isdigit() and int(drop) < len(checklist):
        checklist.pop(int(drop))
    new_item = data.clean(form.get('new_item', ''))[:200]
    if new_item and len(checklist) < 30:
        checklist.append({'text': new_item, 'done': False})
    stage = form.get('stage') if form.get('stage') in data.STAGES else t['stage']
    deadline = form.get('deadline', '') if data.parse_date(form.get('deadline', '')) else ''
    run('UPDATE tracked SET stage=?, notes=?, deadline=?, checklist=? WHERE user_id=? AND opportunity_id=?',
        (stage, data.clean(form.get('notes', ''), multiline=True)[:2000], deadline, json.dumps(checklist), u['id'], opp_id))
    if request.headers.get('X-Requested-With') == 'fetch':
        return '', 204
    return redirect(url_for('account.tracker', stage=request.args.get('stage')) + f'#t-{opp_id}')
