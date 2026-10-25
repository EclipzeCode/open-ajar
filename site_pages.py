"""Public pages: home, browsing, listing detail, submitting, intern applications and the static content pages."""
import json
import re
from html import escape
from urllib.parse import urlencode, urlsplit

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, send_from_directory, url_for

import data
import mail
from core import (PUBLIC, add_event, all_, audit, client_ip, current_user, facets, get_db, get_opp, get_public, grant_room,
                  insert_opp, limited, login_required, new_id, now_iso, one, run, safe_next, save_opp, search_public, track_opp,
                  support_numbers, update_opp, uploads_dir)

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
    return render_template('home.html', featured=items, total=total, jobs=jobs, states=states, voices=voices, saved=_saved_ids(),
                           grants_paid=grants_paid())


def grants_paid():
    """Access Grants actually paid so far: dollars and students. Shown publicly only once there's at least one."""
    return one("SELECT COALESCE(SUM(paid_amount), 0) dollars, COUNT(DISTINCT email) students FROM access_grants WHERE status='paid'")


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
    chips = _chips(f)
    items, total = search_public(f, PAGE, (page - 1) * PAGE)
    pages = max(1, -(-total // PAGE))
    if page > pages:  # an old link past the last page: show the last page, not "nothing matches"
        page = pages
        items, total = search_public(f, PAGE, (page - 1) * PAGE)
    if request.headers.get('X-Requested-With') == 'fetch':  # the home page's interest tabs only need three cards
        return render_template('_explore.html', items=items[:3], total=total, saved=_saved_ids()), {'Vary': 'X-Requested-With'}
    active = sum(len(f[k]) for k in ('type', 'cost', 'format', 'commitment', 'interest', 'category')) + bool(f['grade']) + bool(f['state']) + bool(f['saved_by'])
    return render_template('browse.html', sector=sector, copy=SECTORS[sector], f=f, items=items, total=total, page=page,
                           pages=pages, facets=facets(f), all_opts=facets({'sector': sector}), active=active, saved=_saved_ids(),
                           chips=chips, fixes=_fixes(f, chips) if not total else []), {'Vary': 'X-Requested-With'}


def _fixes(f, chips):
    """When nothing matches: each active filter that, taken off on its own, would give results, most results first."""
    out = []
    for label, url, key, value in chips:
        g = {**f, key: [v for v in f[key] if v != value] if isinstance(f[key], list) else ('' if key == 'q' else None)}
        n = search_public(g, limit=0)[1]
        if n:
            out.append((label, url, n))
    return sorted(out, key=lambda x: -x[2])


def _chips(f):
    """(label, link that removes just that filter, filter key, value) for each active filter."""
    def without(key, value):
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'page' and not (k == key and v == str(value))]
        return request.path + ('?' + urlencode(args) if args else '')
    chips = []
    if f['saved_by']:
        chips.append(('Saved', without('saved', '1'), 'saved_by', None))
    if f['q']:
        chips.append((f'“{f["q"]}”', without('q', f['q']), 'q', None))
    if f['grade']:
        chips.append((f'Grade {f["grade"]}', without('grade', f['grade']), 'grade', None))
    if f['state']:
        chips.append((data.STATES[f['state']], without('state', request.args.get('state')), 'state', None))
    for key in ('type', 'cost', 'format', 'commitment', 'interest', 'category'):
        for v in f[key]:
            chips.append((data.COSTS[v] if key == 'cost' else v, without(key, v), key, v))
    return chips


def _saved_ids():
    u = current_user()
    return {r['opportunity_id'] for r in all_('SELECT opportunity_id FROM saved WHERE user_id=?', (u['id'],))} if u else set()


@bp.get('/o/<opp_id>')
def detail(opp_id):
    opp = get_public(opp_id)
    if not opp:
        return render_template('error.html', code=404, message='That opportunity isn’t available. It may have closed or been removed.'), 404
    u, saved = current_user(), _saved_ids()
    tracked = u and one('SELECT stage FROM tracked WHERE user_id=? AND opportunity_id=?', (u['id'], opp_id))
    return render_template('detail.html', o=opp, saved=opp_id in saved, saved_ids=saved, tracked=tracked, similar=_similar(opp),
                           job_posting=_job_posting(opp), back=_back(opp))


def _back(opp):
    """'Back to opportunities' returns to the search and filters they came from, when they came from a list here."""
    ref = urlsplit(request.referrer or '')
    if ref.netloc == request.host and ref.path in ('/opportunities', '/jobs'):
        return ref.path + ('?' + ref.query if ref.query else '')
    return url_for('site.jobs' if opp['type'] == 'Job' else 'site.browse')


def _job_posting(o):
    """Google's JobPosting data for a teen job, so it can appear in Google's job search. Only what the listing states:
    no pay or hours, and the city only when the location is plainly "City, ST"."""
    if o['type'] != 'Job':
        return None
    desc = ''.join(f'<p>{escape(t)}</p>' for t in (o['summary'], o['eligibility']) if t)
    if o['requirements']:
        desc += '<ul>' + ''.join(f'<li>{escape(r)}</li>' for r in o['requirements']) + '</ul>'
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': o['title'], 'description': desc,
           'datePosted': (o['published_at'] or o['created_at'])[:10], 'directApply': False,
           'hiringOrganization': {'@type': 'Organization', 'name': o['org']}}
    if o['deadline_date']:
        job['validThrough'] = o['deadline_date']
    if o['format'] == 'Online':
        job.update(jobLocationType='TELECOMMUTE', applicantLocationRequirements={'@type': 'Country', 'name': 'USA'})
    else:
        address = {'@type': 'PostalAddress', 'addressCountry': 'US'}
        if o['state']:
            address['addressRegion'] = o['state']
            city = re.fullmatch(r'\s*([^,]+?),\s*[A-Za-z]{2}\.?\s*', o['location'] or '')
            if city:
                address['addressLocality'] = city.group(1)
        job['jobLocation'] = {'@type': 'Place', 'address': address}
    return job


def _similar(opp):
    """Up to three other live listings like this one: same type and sharing an interest (for jobs, in the same state)."""
    f = {'sector': 'jobs' if opp['type'] == 'Job' else 'opportunities', 'type': [opp['type']]}
    if opp['type'] == 'Job':
        f['state'] = opp['state']
    elif opp['interests']:
        f['interest'] = opp['interests']
    return [o for o in search_public(f, limit=4)[0] if o['id'] != opp['id']][:3]


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
    elif quiet:
        return {'saved': False}, 404  # closed since the page loaded: the star posts the form instead, which says so
    else:
        flash('That listing has closed, so it can’t be saved.', 'error')
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

    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
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
    u = current_user()
    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
        values = {'full_name': u['name'], 'email': u['email'], 'school': u['school'], 'location': u['location'],
                  'grade': u['grade'], 'interests': json.loads(u['interests'])} if u else {}
        return render_template('apply.html', values=values, errors={})
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
    mail.later('intern application notice', mail.intern_application, current_app.config, o)  # saved already; admin shows it
    mail.later('intern application receipt', mail.intern_received, current_app.config, o)
    # they can follow it on their profile once signed in with this email, confirmed
    return render_template('applied.html', email=o['email'], linked=bool(u and u['email_verified'] and u['email'] == o['email']))


@bp.route('/partner', methods=['GET', 'POST'])
def partner():
    """Businesses offering to host an intern. Saved first, then the team is emailed, so nothing is lost if email fails."""
    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
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
    mail.later('partner inquiry notice', mail.partner_inquiry, current_app.config, inq)  # saved already; admin shows it
    return render_template('partner_sent.html')


@bp.route('/contact', methods=['GET', 'POST'])
def contact():
    """The footer's Contact form. Saved first, then forwarded to the team, so nothing is lost if email fails."""
    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
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
    mail.later('contact message notice', mail.contact_message, current_app.config, msg)  # saved already; admin shows it
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
    if request.method != 'POST':  # GET, or HEAD from link scanners: never act on it
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
    if o.get('due_date') and data.parse_date(o['due_date']) < data.today():
        f.errors['due_date'] = 'That date has passed. If the fee is still owed, leave this blank and explain below'
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
    mail.later('access grant notice', mail.grant_request, current_app.config, g)  # saved already; admin shows it
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
    rows = all_('SELECT * FROM partner_profiles WHERE shown=1 ORDER BY position, name')
    return render_template('about.html', partners=[p for p in rows if p['tier'] == 'partner'],
                           supporters=[p for p in rows if p['tier'] == 'supporter'])


@bp.get('/media/<name>')
def media(name):
    """Uploaded partner photos. Names are random and never reused, so browsers keep them for a year."""
    if not re.fullmatch(r'up-[0-9a-f]{16}\.(png|jpg|webp)', name):
        abort(404)
    return send_from_directory(uploads_dir(), name, max_age=31536000)


@bp.get('/team')
def team():  # the team page was removed; old links land on About
    return redirect(url_for('site.about'), 301)


@bp.get('/support')
def support():
    return render_template('support.html', grants_paid=grants_paid(), money=support_numbers())


@bp.get('/privacy')
def privacy():
    return render_template('privacy.html')


@bp.get('/terms')
def terms():
    return render_template('terms.html')


@bp.get('/favicon.ico')
def favicon():  # browsers and search engines ask for this address whatever the page links to
    return current_app.send_static_file('favicon.png')


@bp.get('/robots.txt')
def robots():
    lines = ['User-agent: *', *(f'Disallow: {p}' for p in ('/admin', '/account', '/tracker', '/verify', '/reset', '/confirm-email', '/unsubscribe', '/dev/')),
             f"Sitemap: {current_app.config['APP_URL']}/sitemap.xml"]
    return '\n'.join(lines) + '\n', {'Content-Type': 'text/plain; charset=utf-8'}


@bp.get('/sitemap.xml')
def sitemap():
    """The public pages plus every live listing, for search engines."""
    base = current_app.config['APP_URL']
    pages = [(url_for(e), None) for e in ('site.home', 'site.browse', 'site.jobs', 'site.apply', 'site.grants', 'site.partner',
                                          'site.about', 'site.support', 'site.contact', 'site.privacy', 'site.terms')]
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

