"""Public pages: home, browsing, listing detail, submitting, intern applications and the static content pages."""
import json
from urllib.parse import urlencode

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, url_for

import data
import mail
from core import (add_event, all_, client_ip, current_user, facets, get_db, get_opp, get_public, insert_opp,
                  limited, login_required, new_id, one, run, safe_next, search_public, update_opp)

bp = Blueprint('site', __name__)
PAGE = 24  # divides evenly into 1, 2, 3 or 4 columns, so full pages never leave a ragged last row


@bp.get('/healthz')
def healthz():
    one('SELECT 1')
    return 'ok'


@bp.get('/')
def home():
    items, total = search_public({'sector': 'opportunities'}, limit=3)
    jobs = search_public({'sector': 'jobs'}, limit=1)[1]
    states = len(facets()['state'])
    voices = all_("SELECT name, role_label, quote FROM testimonials WHERE status='approved' ORDER BY updated_at DESC LIMIT 6")
    return render_template('home.html', featured=items, total=total, jobs=jobs, states=states, voices=voices)


SECTORS = {
    'opportunities': dict(title='Discover opportunities', h1='Find what’s within reach.',
                          sub='Internships, programs, scholarships, competitions and more. Search, then narrow by grade, state, cost and commitment.'),
    'jobs': dict(title='Teen jobs', h1='Teen jobs, across the country.',
                 sub='Paid, part-time work for high-school students. Narrow by category, state, grade and commitment.'),
}


@bp.get('/opportunities')
def browse():
    return _browse('opportunities')


@bp.get('/jobs')
def jobs():
    return _browse('jobs')


def _browse(sector):
    a = request.args
    grade = a.get('grade', '')
    f = {
        'q': a.get('q', '')[:100], 'sector': sector,
        'grade': int(grade) if grade.isdigit() and int(grade) in data.GRADES else None,
        'state': a.get('state', '').upper() if a.get('state', '').upper() in data.STATES else None,
        'sort': a.get('sort') if a.get('sort') in ('deadline', 'title') else 'featured',
        'type': [v for v in a.getlist('type') if v in data.TYPES],
        'cost': [v for v in a.getlist('cost') if v in data.COSTS],
        'format': [v for v in a.getlist('format') if v in data.FORMATS],
        'commitment': [v for v in a.getlist('commitment') if v in data.COMMITMENTS],
        'interest': [v for v in a.getlist('interest') if v in data.INTERESTS],
        'category': [v for v in a.getlist('category') if v in data.JOB_CATEGORIES] if sector == 'jobs' else [],
    }
    page = max(1, min(500, a.get('page', 1, type=int) or 1))
    items, total = search_public(f, PAGE, (page - 1) * PAGE)
    active = sum(len(f[k]) for k in ('type', 'cost', 'format', 'commitment', 'interest', 'category')) + bool(f['grade']) + bool(f['state'])
    return render_template('browse.html', sector=sector, copy=SECTORS[sector], f=f, items=items, total=total, page=page,
                           pages=max(1, -(-total // PAGE)), facets=facets(f), all_opts=facets({'sector': sector}), active=active, saved=_saved_ids(),
                           chips=_chips(f))


def _chips(f):
    """(label, link that removes just that filter) for each active filter."""
    def without(key, value):
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'page' and not (k == key and v == str(value))]
        return request.path + ('?' + urlencode(args) if args else '')
    chips = []
    if f['q']:
        chips.append((f'“{f["q"]}”', without('q', f['q'])))
    if f['grade']:
        chips.append((f'Grade {f["grade"]}', without('grade', f['grade'])))
    if f['state']:
        chips.append((data.STATES[f['state']], without('state', request.args.get('state'))))
    for key in ('type', 'cost', 'format', 'commitment', 'interest', 'category'):
        for v in f[key]:
            chips.append((data.COSTS[v] if key == 'cost' else v, without(key, v)))
    return chips


def _saved_ids():
    u = current_user()
    return {r['opportunity_id'] for r in all_('SELECT opportunity_id FROM saved WHERE user_id=?', (u['id'],))} if u else set()


@bp.get('/o/<opp_id>')
def detail(opp_id):
    opp = get_public(opp_id)
    if not opp:
        return render_template('error.html', code=404, message='That opportunity isn’t available. It may have closed or been removed.'), 404
    u = current_user()
    tracked = u and one('SELECT stage FROM tracked WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
    return render_template('detail.html', o=opp, saved=opp_id in _saved_ids(), tracked=tracked)


@bp.post('/o/<opp_id>/save')
@login_required
def toggle_save(opp_id):
    u = current_user()
    if one('SELECT 1 FROM saved WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id)):
        run('DELETE FROM saved WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
        flash('Removed from your saved list.')
    elif get_public(opp_id):
        run('INSERT INTO saved (user_id, opportunity_id, created_at) VALUES (?,?,?)', (u['id'], opp_id, data.now_iso()))
        flash('Saved. Find it any time in your tracker.')
    return redirect(safe_next(url_for('site.detail', opp_id=opp_id)))


@bp.post('/o/<opp_id>/track')
@login_required
def track(opp_id):
    u, opp = current_user(), get_public(opp_id)
    if not opp:
        abort(404)
    checklist = json.dumps([{'text': t, 'done': False} for t in opp['requirements']])
    run('INSERT OR IGNORE INTO tracked (user_id, opportunity_id, checklist, added_at) VALUES (?,?,?,?)',
        (u['id'], opp_id, checklist, data.now_iso()))
    flash(f'Tracking “{opp["title"]}”. Its requirements are now a checklist in your tracker.')
    return redirect(safe_next(url_for('site.detail', opp_id=opp_id)))


# ---------------------------------------------------------------- submitting a listing


@bp.route('/submit', methods=['GET', 'POST'])
@bp.route('/submit/<opp_id>', methods=['GET', 'POST'])
@login_required
def submit(opp_id=None):
    u = current_user()
    existing = None
    if opp_id:  # revising a submission after "changes requested"
        existing = get_opp(opp_id)
        if not existing or existing['submitted_by'] != u['id']:
            abort(404)
        if existing['status'] != 'changes_requested':
            flash('You can only edit a submission after a reviewer asks for changes.', 'error')
            return redirect(url_for('account.account'))
    if not u['email_verified']:
        return render_template('submit.html', unverified=True, values={}, errors={})

    if request.method == 'GET':
        values = dict(existing or {}, requirements='\n'.join((existing or {}).get('requirements', [])))
        return render_template('submit.html', values=values, errors={}, existing=existing)

    clean, errors = data.validate_opportunity(request.form)
    if not errors and limited(f"submit:{u['id']}", 10, 3600):
        errors['_'] = 'You’ve submitted several opportunities in the last hour. Please try again later.'
    if errors:
        values = {**request.form.to_dict(), 'grades': [int(g) for g in request.form.getlist('grades') if g.isdigit()],
                  'interests': request.form.getlist('interests')}
        return render_template('submit.html', values=values, errors=errors, existing=existing), 422
    db = get_db()
    if existing:
        update_opp(db, opp_id, clean, status='pending_review', reviewer_message='')
        db.commit()
        add_event(opp_id, u['id'], 'resubmitted', 'pending_review')
    else:
        opp_id = insert_opp(db, clean, status='pending_review', source='submission', submitted_by=u['id'])
        db.commit()
        add_event(opp_id, u['id'], 'submitted', 'pending_review')
    return render_template('submitted.html', title=clean['title'])


# ---------------------------------------------------------------- intern applications


@bp.route('/apply', methods=['GET', 'POST'])
def apply():
    if request.method == 'GET':
        return render_template('apply.html', values={}, errors={})
    f = data.Form(request.form)
    f.text('full_name', 'Your name', min=2, max=120)
    f.email('email')
    f.grade()
    f.text('school', 'Your school', max=160, required=False)
    f.text('location', 'Your city or area', max=160, required=False)
    f.text('skills', 'Skills or experience', max=1000, required=False, multiline=True)
    f.text('availability', 'Availability', max=300, required=False)
    f.text('statement', 'Why you want to intern', min=10, max=2000, multiline=True)
    f.url('link')
    if not f.errors and limited('apply:' + client_ip(), 8, 3600):
        f.errors['_'] = 'You’ve submitted a few applications recently. Please try again later.'
    if f.errors:
        return render_template('apply.html', values={**request.form.to_dict(), 'interests': request.form.getlist('interests')},
                               errors=f.errors), 422
    o = f.out
    run('''INSERT INTO intern_applications (id, full_name, email, grade, school, location, interests, skills, availability, statement, link, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
        (new_id(), o['full_name'], o['email'], o['grade'], o['school'], o['location'], json.dumps(f.many('interests', data.INTERESTS)),
         o['skills'], o['availability'], o['statement'], o['link'], data.now_iso()))
    return render_template('applied.html')


# ---------------------------------------------------------------- content pages


@bp.get('/about')
def about():
    return render_template('about.html')


@bp.get('/team')
def team():
    return render_template('team.html')


@bp.get('/support')
def support():
    return render_template('support.html')


@bp.get('/privacy')
def privacy():
    return render_template('privacy.html')


@bp.get('/terms')
def terms():
    return render_template('terms.html')


@bp.get('/dev/inbox')
def dev_inbox():
    if current_app.config['PRODUCTION'] or current_app.config['RESEND_API_KEY']:
        abort(404)
    return render_template('dev_inbox.html', emails=mail.OUTBOX)

