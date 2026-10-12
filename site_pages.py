"""Public pages: home, browsing, listing detail, submitting, intern applications and the static content pages."""
import json
from html import escape
from urllib.parse import urlencode

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, url_for

import data
import mail
from core import (PUBLIC, add_event, all_, audit, client_ip, current_user, facets, get_db, get_opp, get_public, grant_room,
                  insert_opp, limited, login_required, new_id, now_iso, one, run, safe_next, save_opp, search_public, track_opp,
                  update_opp)

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
    states = one(f'SELECT COUNT(DISTINCT o.state) n FROM opportunities o WHERE {PUBLIC} AND o.state IS NOT NULL', (now_iso(),))['n']
    # user_id IS NULL means the account was deleted before quotes were removed with it: never show those
    voices = all_("SELECT name, role_label, quote FROM testimonials WHERE status='approved' AND user_id IS NOT NULL ORDER BY updated_at DESC LIMIT 6")
    return render_template('home.html', featured=items, total=total, jobs=jobs, states=states, voices=voices, saved=_saved_ids())


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
        'saved_by': current_user()['id'] if a.get('saved') == '1' and current_user() else None,
    }
    page = max(1, min(500, a.get('page', 1, type=int) or 1))
    items, total = search_public(f, PAGE, (page - 1) * PAGE)
    active = sum(len(f[k]) for k in ('type', 'cost', 'format', 'commitment', 'interest', 'category')) + bool(f['grade']) + bool(f['state']) + bool(f['saved_by'])
    return render_template('browse.html', sector=sector, copy=SECTORS[sector], f=f, items=items, total=total, page=page,
                           pages=max(1, -(-total // PAGE)), facets=facets(f), all_opts=facets({'sector': sector}), active=active, saved=_saved_ids(),
                           chips=_chips(f))


def _chips(f):
    """(label, link that removes just that filter) for each active filter."""
    def without(key, value):
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'page' and not (k == key and v == str(value))]
        return request.path + ('?' + urlencode(args) if args else '')
    chips = []
    if f['saved_by']:
        chips.append(('Saved', without('saved', '1')))
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
    quiet = request.headers.get('X-Requested-With') == 'fetch'  # the star on a card: no page reload, no message
    if one('SELECT 1 FROM saved WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id)):
        run('DELETE FROM saved WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
        if quiet:
            return {'saved': False}
        flash('Removed from your saved list.')
    elif get_public(opp_id):
        save_opp(u['id'], opp_id)
        if quiet:
            return {'saved': True}
        flash('Saved. Find it any time in your tracker.')
    return redirect(safe_next(url_for('site.detail', opp_id=opp_id)))


@bp.post('/o/<opp_id>/track')
@login_required
def track(opp_id):
    u, opp = current_user(), get_public(opp_id)
    if not opp:
        abort(404)
    track_opp(u['id'], opp)
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


@bp.route('/partner', methods=['GET', 'POST'])
def partner():
    """Businesses offering to host an intern. Saved first, then the team is emailed, so nothing is lost if email fails."""
    if request.method == 'GET':
        return render_template('partner.html', values={}, errors={})
    f = data.Form(request.form)
    f.text('business', 'Business name', min=2, max=160)
    f.text('contact_name', 'Your name', min=2, max=120)
    f.email('email')
    f.text('phone', 'Phone', max=40, required=False)
    f.text('location', 'City or area', max=160, required=False)
    f.text('message', 'What an intern could help with', min=10, max=2000, multiline=True)
    if not f.errors and limited('partner:' + client_ip(), 8, 3600):
        f.errors['_'] = 'You’ve sent a few inquiries recently. Please try again later.'
    if f.errors:
        return render_template('partner.html', values=request.form.to_dict(), errors=f.errors), 422
    inq = {**f.out, 'id': new_id(), 'created_at': data.now_iso()}
    run('INSERT INTO partner_inquiries (id, business, contact_name, email, phone, location, message, created_at) VALUES (?,?,?,?,?,?,?,?)',
        tuple(inq[k] for k in ('id', 'business', 'contact_name', 'email', 'phone', 'location', 'message', 'created_at')))
    try:
        mail.partner_inquiry(current_app.config, inq)
    except Exception as e:  # it's saved; the team still sees it in admin
        print(f'[email] partner inquiry notice failed: {e}')
    return render_template('partner_sent.html')


@bp.route('/contact', methods=['GET', 'POST'])
def contact():
    """The footer's Contact form. Saved first, then forwarded to the team, so nothing is lost if email fails."""
    if request.method == 'GET':
        u = current_user()
        return render_template('contact.html', values={'name': u['name'], 'email': u['email']} if u else {}, errors={})
    f = data.Form(request.form)
    f.text('name', 'Your name', min=2, max=120)
    f.email('email')
    f.one_of('topic', data.CONTACT_TOPICS, 'a topic')
    f.text('message', 'Message', min=10, max=4000, multiline=True)
    if not f.errors and limited('contact:' + client_ip(), 6, 3600):
        f.errors['_'] = 'You’ve sent a few messages recently. Please try again later.'
    if f.errors:
        return render_template('contact.html', values=request.form.to_dict(), errors=f.errors), 422
    msg = {**f.out, 'id': new_id(), 'created_at': data.now_iso()}
    run('INSERT INTO contact_messages (id, name, email, topic, message, created_at) VALUES (?,?,?,?,?,?)',
        tuple(msg[k] for k in ('id', 'name', 'email', 'topic', 'message', 'created_at')))
    try:
        mail.contact_message(current_app.config, msg)
    except Exception as e:  # it's saved; the team still sees it in admin
        print(f'[email] contact message notice failed: {e}')
    return render_template('contact_sent.html')


# ---------------------------------------------------------------- Access Grants


@bp.route('/access-grants', methods=['GET', 'POST'])
def grants():
    """Students ask OpenAjar to cover a program fee. Anyone can read the page; the form needs a confirmed account,
    no other open request, and room left under the yearly cap. Saved first, then the team is emailed."""
    u = current_user()
    mine = [dict(r) for r in all_('SELECT * FROM access_grants WHERE user_id=? ORDER BY created_at DESC', (u['id'],))] if u else []
    pending = next((g for g in mine if g['status'] in data.GRANT_OPEN), None)
    room = grant_room(u['id']) if u else data.GRANT_CAP
    can_apply = bool(u and u['email_verified'] and not pending and room)
    page = dict(mine=mine, pending=pending, room=room, can_apply=can_apply)
    if request.method == 'GET':
        opp = get_public(request.args.get('opp', '')) if request.args.get('opp') else None
        values = {'program': opp['title'], 'org': opp['org'], 'url': opp['url'] or '', 'opportunity_id': opp['id']} if opp else {}
        return render_template('grants.html', values=values, errors={}, **page)
    if not can_apply:
        return redirect(url_for('site.grants'))
    f = data.Form(request.form)
    f.text('program', 'The program’s name', min=2, max=160)
    f.text('org', 'Who runs it', min=2, max=160)
    f.url('url')
    f.one_of('covers', data.GRANT_COVERS, 'what the fee covers')
    f.dollars('total_cost', 'The total cost')
    f.dollars('amount', 'How much you’re asking for')
    f.date('due_date')
    f.one_of('accepted', data.GRANT_ACCEPTED, 'whether you’ve been accepted')
    f.one_of('asked_program', data.GRANT_ASKED, 'whether you’ve asked the program')
    f.text('reason', 'Why you’re asking', min=40, max=2000, multiline=True)
    f.email('parent_email', 'Enter a parent or guardian’s email')
    o = f.out
    if 'amount' in o and 'total_cost' in o and o['amount'] > o['total_cost']:
        f.errors['amount'] = 'Ask for no more than the total cost'
    elif 'amount' in o and o['amount'] > room:
        f.errors['amount'] = f'You can ask for up to ${room} this year'
    if not request.form.get('consent'):
        f.errors['consent'] = 'Confirm that your parent or guardian knows you’re asking'
    if not f.errors and limited(f"grant:{u['id']}", 5, 3600):
        f.errors['_'] = 'You’ve sent a few requests recently. Please try again later.'
    if f.errors:
        return render_template('grants.html', values=request.form.to_dict(), errors=f.errors, **page), 422
    opp = get_public(request.form.get('opportunity_id', '')) if request.form.get('opportunity_id') else None
    now = data.now_iso()
    g = {**o, 'id': new_id(), 'user_id': u['id'], 'name': u['name'], 'email': u['email'], 'opportunity_id': opp['id'] if opp else None,
         'created_at': now, 'updated_at': now}
    cols = ('id', 'user_id', 'name', 'email', 'parent_email', 'opportunity_id', 'program', 'org', 'url', 'covers', 'total_cost', 'amount',
            'due_date', 'accepted', 'asked_program', 'reason', 'created_at', 'updated_at')
    run(f"INSERT INTO access_grants ({', '.join(cols)}) VALUES ({','.join('?' * len(cols))})", tuple(g[k] for k in cols))
    try:
        mail.grant_request(current_app.config, g)
    except Exception as e:  # it's saved; the team still sees it in admin
        print(f'[email] access grant notice failed: {e}')
    flash('Request sent. We’ll email you and your parent or guardian when there’s a decision.')
    return redirect(url_for('site.grants'))


@bp.post('/access-grants/<gid>/withdraw')
@login_required
def withdraw_grant(gid):
    u = current_user()
    if run(f"UPDATE access_grants SET status='withdrawn', updated_at=? WHERE id=? AND user_id=? AND status IN {data.GRANT_OPEN}",
           (data.now_iso(), gid, u['id'])).rowcount:
        audit(u['id'], 'grant_withdrawn', gid)
        flash('Request withdrawn.')
    return redirect(url_for('site.grants'))


# ---------------------------------------------------------------- content pages


@bp.get('/about')
def about():
    return render_template('about.html')


@bp.get('/team')
def team():  # the team page was removed; old links land on About
    return redirect(url_for('site.about'), 301)


@bp.get('/support')
def support():
    return render_template('support.html')


@bp.get('/privacy')
def privacy():
    return render_template('privacy.html')


@bp.get('/terms')
def terms():
    return render_template('terms.html')


@bp.get('/robots.txt')
def robots():
    lines = ['User-agent: *', *(f'Disallow: {p}' for p in ('/admin', '/account', '/tracker', '/verify', '/reset', '/dev/')),
             f"Sitemap: {current_app.config['APP_URL']}/sitemap.xml"]
    return '\n'.join(lines) + '\n', {'Content-Type': 'text/plain; charset=utf-8'}


@bp.get('/sitemap.xml')
def sitemap():
    """The public pages plus every live listing, for search engines."""
    base = current_app.config['APP_URL']
    pages = [(url_for(e), None) for e in ('site.home', 'site.browse', 'site.jobs', 'site.apply', 'site.about',
                                          'site.support', 'site.privacy', 'site.terms')]
    pages += [(url_for('site.detail', opp_id=r['id']), (r['updated_at'] or '')[:10])
              for r in all_(f'SELECT o.id, o.updated_at FROM opportunities o WHERE {PUBLIC} ORDER BY o.published_at DESC', (now_iso(),))]
    urls = ''.join(f'<url><loc>{escape(base + path)}</loc>{f"<lastmod>{d}</lastmod>" if d else ""}</url>' for path, d in pages)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return xml, {'Content-Type': 'application/xml; charset=utf-8'}


@bp.get('/dev/inbox')
def dev_inbox():
    if current_app.config['PRODUCTION'] or current_app.config['RESEND_API_KEY']:
        abort(404)
    return render_template('dev_inbox.html', emails=mail.OUTBOX)

