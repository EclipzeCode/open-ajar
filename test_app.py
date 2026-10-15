"""End-to-end checks of the main flows. Run: python -m unittest"""
import io
import json
import re
import tempfile
import unittest
from pathlib import Path

from werkzeug.security import generate_password_hash

import core
import mail
from app import create_app, import_rows
from core import connect

PW = 'correct horse battery'
LISTING = {'title': 'River Ecology Summer Lab', 'org': 'Green River Institute', 'type': 'Research program',
           'summary': 'Six weeks of field research on river health with working scientists.',
           'eligibility': 'Rising juniors and seniors.', 'requirements': 'Short essay\nTeacher recommendation',
           'grades': ['11', '12'], 'interests': ['STEM', 'Environment'], 'cost': 'Free', 'format': 'In person',
           'location': 'Portland, OR', 'commitment': 'Summer', 'deadline_date': '', 'url': 'https://example.org/lab',
           'relationship': 'counselor_teacher', 'contact_email': 'teacher@example.org'}


GRANT = {'program': 'River Ecology Summer Lab', 'org': 'Green River Institute', 'covers': 'Program fee or tuition', 'total_cost': '400',
         'amount': '200', 'accepted': 'accepted', 'asked_program': 'yes', 'parent_email': 'parent@example.org', 'consent': '1',
         'reason': 'I want to study river health this summer, but the fee is more than my family can cover right now.'}


class Flows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING': True, 'DB_PATH': str(Path(self.tmp.name) / 't.db'), 'OWNER_EMAIL': 'owner@example.org'})
        self.c = self.app.test_client()
        mail.OUTBOX.clear()
        core._hits.clear()  # the sign-in rate limit is per process; don't let one test's logins count against the next

    def tearDown(self):
        self.tmp.cleanup()

    def csrf(self, client=None):
        (client or self.c).get('/login')
        with (client or self.c).session_transaction() as s:
            return s['csrf']

    def post(self, path, data=None, client=None, **kw):
        client = client or self.c
        return client.post(path, data={**(data or {}), 'csrf': self.csrf(client)}, **kw)

    def register(self, email='sam@example.org', client=None):
        return self.post('/register', {'name': 'Sam Rivera', 'email': email, 'password': PW}, client)

    def make_admin(self, email='admin@example.org', uid='admin1'):
        db = connect(self.app.config['DB_PATH'])
        db.execute("INSERT INTO users (id,email,password_hash,role,name,email_verified,created_at) VALUES (?,?,?,'admin','Ada',1,'2026-01-01')",
                   (uid, email, generate_password_hash(PW)))
        db.commit()
        admin = self.app.test_client()
        self.post('/login', {'email': email, 'password': PW}, admin)
        return admin

    def grant(self, gid):
        return connect(self.app.config['DB_PATH']).execute('SELECT * FROM access_grants WHERE id=?', (gid,)).fetchone()

    def test_nav_links_go_to_the_right_pages(self):
        page = self.c.get('/').data
        self.assertIn(b'href="/opportunities"', page)
        self.assertIn(b'href="/jobs"', page)
        nav = lambda client: re.findall(r'>([^<>]+)</a>', client.get('/about').get_data(as_text=True).split('id="nav"')[1].split('</nav>')[0])
        self.assertEqual(nav(self.c), ['Opportunities', 'Intern with us', 'Access Grants', 'About', 'Sign in'])
        self.assertEqual(nav(self.make_admin()), ['Opportunities', 'Intern with us', 'Access Grants', 'About', 'Admin', 'Profile'])
        self.register()
        self.assertEqual(nav(self.c), ['Opportunities', 'Intern with us', 'Access Grants', 'About', 'Profile'])

    def test_home_title_and_icons(self):
        home = self.c.get('/').get_data(as_text=True)
        self.assertIn('<title>OpenAjar: free internships, programs and scholarships for high school students</title>', home)
        self.assertIn('content="OpenAjar: free internships, programs and scholarships for high school students"', home)  # og:title
        self.assertIn('<title>About · OpenAjar</title>', self.c.get('/about').get_data(as_text=True))  # other pages unchanged
        for icon in ('favicon.svg', 'favicon.png', 'apple-touch-icon.png'):
            self.assertIn(f'/static/{icon}?v=', home)
        r = self.c.get('/favicon.ico')
        self.assertEqual((r.status_code, r.mimetype), (200, 'image/png'))
        r.close()

    def test_static_files_are_versioned_and_cached(self):
        css = re.search(r'href="(/static/style\.css\?v=\d+)"', self.c.get('/').get_data(as_text=True)).group(1)
        self.assertIn('max-age=31536000', self.c.get(css).headers['Cache-Control'])
        self.assertNotIn('max-age=31536000', self.c.get('/static/style.css').headers.get('Cache-Control', ''))

    def test_placeholder_testimonials_never_reach_the_live_site(self):
        live = create_app({'TESTING': True, 'PRODUCTION': True, 'SECRET_KEY': 'x', 'RESEND_API_KEY': 'x',
                           'APP_URL': 'https://example.org', 'DB_PATH': self.app.config['DB_PATH']})
        page = live.test_client().get('/', base_url='https://example.org').data
        self.assertIn(b'Vanessa Gunawan', page)
        self.assertNotIn(b'Testimonial goes here', page)

    def test_one_address_for_search_engines(self):
        live = create_app({'TESTING': True, 'PRODUCTION': True, 'SECRET_KEY': 'x', 'RESEND_API_KEY': 'x',
                           'APP_URL': 'https://www.example.org', 'DB_PATH': self.app.config['DB_PATH']})
        c = live.test_client()
        r = c.get('/jobs?category=Retail', base_url='https://old.onrender.com')
        self.assertEqual((r.status_code, r.location), (301, 'https://www.example.org/jobs?category=Retail'))
        self.assertEqual(c.get('/healthz', base_url='https://old.onrender.com').status_code, 200)
        page = c.get('/about', base_url='https://www.example.org').get_data(as_text=True)
        self.assertIn('<link rel="canonical" href="https://www.example.org/about">', page)
        robots = c.get('/robots.txt', base_url='https://www.example.org').get_data(as_text=True)
        self.assertIn('Sitemap: https://www.example.org/sitemap.xml', robots)
        with self.app.app_context():
            import_rows([{'id': 's1', 'title': 'Coding Club', 'organization': 'Girls Who Code', 'type': 'Academic program',
                          'summary': 'Free clubs for students to explore coding after school.', 'eligibility': 'Grades 9 to 12',
                          'grades': '9', 'cost': 'Free', 'format': 'Online', 'location': 'Online', 'commitment': 'School year'}], approve=True)
        xml = c.get('/sitemap.xml', base_url='https://www.example.org').get_data(as_text=True)
        self.assertIn('<loc>https://www.example.org/jobs</loc>', xml)
        self.assertEqual(xml.count('<loc>https://www.example.org/o/'), 1)
        self.assertNotIn('/team', xml)
        self.assertEqual(self.c.get('/team').headers['Location'], '/about')  # removed page; old links land on About

    def test_about_lists_partners_without_placeholder_quotes(self):
        page = self.c.get('/about').get_data(as_text=True)
        for name in ('Moon Tea', 'Strategic Training Endeavors', 'Ryujin', 'One Dollar Zone of Cedar Knolls', 'Coders Over Borders',
                     'Creator Colosseum', 'Partner Portal'):
            self.assertIn(name, page)
        self.assertEqual(page.count('partner__quote'), 5)  # every partner has sent a real quote
        self.assertLess(page.index('Strategic Training Endeavors'), page.index('Creator Colosseum'))
        supporters = page.split('id="supporters-h"')[1]
        self.assertIn('Ryujin', supporters)
        self.assertIn('One Dollar Zone of Cedar Knolls', supporters)
        self.assertEqual(supporters.count('<figure class="quote">'), 2)  # the repeats are hidden from screen readers
        self.assertNotIn('“”', page)

    def test_a_crash_shows_the_friendly_error_page(self):
        self.app.config['PROPAGATE_EXCEPTIONS'] = False
        self.app.view_functions['site.about'] = lambda: 1 / 0
        r = self.c.get('/about')
        self.assertEqual(r.status_code, 500)
        self.assertIn(b'Something broke on our end', r.data)

    def test_private_pages_are_never_cached(self):
        self.register()
        self.assertEqual(self.c.get('/account').headers['Cache-Control'], 'no-store')
        self.assertEqual(self.c.get('/opportunities').headers['Cache-Control'], 'private, no-cache')  # Back keeps your place

    def test_writes_need_the_csrf_token(self):
        self.assertEqual(self.c.post('/register', data={'name': 'x', 'email': 'a@b.co', 'password': PW}).status_code, 400)

    def test_submit_review_publish_track(self):
        self.register()
        # unverified students can't submit
        self.assertIn(b'Confirm your email first', self.c.get('/submit').data)
        token = re.search(r'token=([\w-]+)', mail.OUTBOX[0]['text']).group(1)
        self.c.get(f'/verify?token={token}')  # just opening the link must not spend it
        self.c.head(f'/verify?token={token}')  # nor must an email scanner checking the link
        self.assertEqual(self.post('/verify', {'token': token}).status_code, 302)  # the real click still works
        self.assertEqual(self.post('/verify', {'token': token}).status_code, 400)  # single use

        self.assertEqual(self.post('/submit', LISTING).status_code, 200)
        self.assertNotIn(b'River Ecology', self.c.get('/opportunities').data)  # pending review is not public

        admin = self.make_admin()
        opp_id = connect(self.app.config['DB_PATH']).execute('SELECT id FROM opportunities').fetchone()['id']
        self.assertIn(b'Explain your decision', self.post(f'/admin/o/{opp_id}', {'action': 'reject'}, admin, follow_redirects=True).data)
        self.post(f'/admin/o/{opp_id}', {'action': 'request_changes', 'message': 'Please add the deadline.'}, admin)
        self.assertIn(b'Please add the deadline.', self.c.get('/account').data)
        self.assertEqual(self.post(f'/submit/{opp_id}', {**LISTING, 'deadline_date': '2099-01-01'}).status_code, 422)  # too far away
        self.post(f'/submit/{opp_id}', LISTING)
        self.post(f'/admin/o/{opp_id}', {'action': 'approve'}, admin)

        page = self.c.get('/opportunities?q=river&grade=11&state=OR&interest=STEM').data
        self.assertIn(b'River Ecology', page)
        self.assertNotIn(b'River Ecology', self.c.get('/opportunities?grade=9').data)
        self.assertNotIn(b'River Ecology', self.c.get('/jobs').data)

        self.post(f'/o/{opp_id}/track')
        tracker = self.c.get('/tracker').data
        self.assertIn(b'Teacher recommendation', tracker)  # requirements became the checklist
        self.post(f'/tracker/{opp_id}', {'stage': 'Applied', 'done': ['0'], 'new_item': 'Ask for transcript', 'notes': 'Sent!'})
        tracker = self.c.get('/tracker?stage=Applied').data
        self.assertIn(b'Ask for transcript', tracker)
        self.assertIn(b'Sent!', tracker)

    def test_access_grant_is_reviewed_then_paid_to_the_program(self):
        self.assertIn(b'Sign in to ask', self.c.get('/access-grants').data)
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute("UPDATE users SET email_verified=1")
        db.commit()
        self.assertEqual(self.post('/access-grants', {**GRANT, 'amount': '300', 'total_cost': '400'}).status_code, 422)  # over the $250 cap
        self.assertEqual(self.post('/access-grants', {**GRANT, 'amount': '500'}).status_code, 422)  # more than it costs
        self.assertEqual(self.post('/access-grants', {**GRANT, 'consent': ''}).status_code, 422)
        mail.OUTBOX.clear()
        self.post('/access-grants', GRANT)
        self.assertIn('Access Grant request', mail.OUTBOX[0]['subject'])  # the team is told
        self.assertIn(b'You have a request open', self.c.get('/access-grants').data)  # one at a time
        gid = db.execute('SELECT id FROM access_grants').fetchone()['id']

        admin = self.make_admin()
        self.post(f'/access-grants/{gid}/withdraw', client=admin)  # not theirs: nothing happens
        self.post('/admin/grants', {'id': gid, 'action': 'needs_info'}, admin)  # a message is required
        self.assertEqual(self.grant(gid)['status'], 'new')
        mail.OUTBOX.clear()
        self.post('/admin/grants', {'id': gid, 'action': 'needs_info', 'message': 'Please send your acceptance letter.'}, admin)
        self.assertEqual({m['to'] for m in mail.OUTBOX}, {'sam@example.org', 'parent@example.org'})  # student and parent
        self.assertIn(b'Please send your acceptance letter.', self.c.get('/access-grants').data)
        self.post('/admin/grants', {'id': gid, 'action': 'approve', 'approved_amount': '250'}, admin)  # more than asked for
        self.assertEqual(self.grant(gid)['status'], 'needs_info')
        self.post('/admin/grants', {'id': gid, 'action': 'approve', 'approved_amount': '150'}, admin)
        self.assertEqual(self.grant(gid)['status'], 'approved')
        self.assertNotIn(b'Please send your acceptance letter.', self.c.get('/access-grants').data)  # the old ask is gone
        self.post('/admin/grants', {'id': gid, 'action': 'paid', 'paid_amount': '150', 'paid_on': '2026-10-12', 'paid_method': 'Card'}, admin)
        g = self.grant(gid)
        self.assertEqual((g['status'], g['paid_amount'], g['paid_by']), ('paid', 150, 'admin1'))
        self.assertIn(b'We paid $150', self.c.get('/access-grants').data)
        self.assertIn(b'$150</strong> paid to programs for', self.c.get('/').data)  # the public total, once one is paid
        self.assertEqual(self.post('/access-grants', GRANT).status_code, 422)  # only $100 of the yearly cap is left

    def test_interns_follow_their_application_and_admins_accept_and_message_them(self):
        app_form = {'full_name': 'Sam Rivera', 'email': 'sam@example.org', 'statement': 'I want to learn how a small business runs.'}
        self.post('/apply', app_form)  # sent before having an account
        self.assertEqual({m['to']: m['subject'] for m in mail.OUTBOX}, {  # the team is told, and the student gets a receipt
            self.app.config['CONTACT_EMAIL']: 'Internship application: Sam Rivera', 'sam@example.org': 'We got your OpenAjar internship application'})
        self.register()
        self.assertNotIn('Intern with OpenAjar', self.c.get('/account').get_data(as_text=True))  # email not confirmed yet
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        self.assertIn('See it on your profile', self.post('/apply', app_form).get_data(as_text=True))
        aid = db.execute('SELECT id FROM intern_applications ORDER BY created_at LIMIT 1').fetchone()['id']
        admin = self.make_admin()

        mail.OUTBOX.clear()
        self.post('/admin/interns', {'id': aid, 'status': 'new', 'admin_note': 'Strong fit', 'quick': 'accepted',
                                     'message': 'Welcome aboard! We’ll set up a call this week.', 'notify': '1'}, admin)
        row = db.execute('SELECT status, admin_note FROM intern_applications WHERE id=?', (aid,)).fetchone()
        self.assertEqual((row['status'], row['admin_note']), ('accepted', 'Strong fit'))
        self.assertEqual(mail.OUTBOX[0]['to'], 'sam@example.org')
        self.assertIn('is now: Accepted', mail.OUTBOX[0]['text'])
        self.assertIn('Welcome aboard!', mail.OUTBOX[0]['text'])
        profile = self.c.get('/account').get_data(as_text=True)
        self.assertIn('Welcome aboard!', profile)
        self.assertIn('class="progress__step is-current" aria-current="step"><span>Accepted', profile)
        self.assertNotIn('Strong fit', profile)  # the private note stays private

        mail.OUTBOX.clear()
        self.post('/admin/interns', {'id': aid, 'status': 'placed'}, admin)  # "email them" unticked, no message
        self.assertEqual(mail.OUTBOX, [])
        self.assertIn('Placed with a business', self.c.get('/account').get_data(as_text=True))  # still shows on the profile
        page = admin.get('/admin/interns').get_data(as_text=True)
        self.assertIn('Welcome aboard!', page)  # admins see what was sent
        self.assertEqual(self.c.get('/admin/interns').status_code, 403)

    def test_interns_are_declined_or_placed_and_always_told(self):
        db = connect(self.app.config['DB_PATH'])
        form = {'full_name': 'Sam Rivera', 'email': 'sam@example.org', 'statement': 'I want to learn how a small business runs.'}
        self.post('/apply', form)
        self.post('/apply', {**form, 'full_name': 'Kim Diaz', 'email': 'kim@example.org'})
        sam, kim = (db.execute('SELECT id FROM intern_applications WHERE email=?', (e,)).fetchone()['id'] for e in ('sam@example.org', 'kim@example.org'))
        admin = self.make_admin()
        self.assertIn('value="declined"', admin.get('/admin/interns').get_data(as_text=True))  # a Decline button
        mail.OUTBOX.clear()
        self.post('/admin/interns', {'id': kim, 'status': 'new', 'quick': 'declined'}, admin)  # "email them" unticked
        self.assertEqual([m['to'] for m in mail.OUTBOX], ['kim@example.org'])  # a decision is always emailed
        self.assertIn('Not selected', mail.OUTBOX[0]['text'])

        placement = {'id': sam, 'action': 'placement', 'placement_business': 'Moon Tea', 'placement_start': '2026-11-02',
                     'placement_hours': '10 hours a week', 'placement_supervisor': 'Lee Chen, lee@example.org'}
        self.post('/admin/interns', placement, admin)  # not accepted yet: nothing saved
        self.assertEqual(db.execute('SELECT placement_business FROM intern_applications WHERE id=?', (sam,)).fetchone()[0], '')
        mail.OUTBOX.clear()
        self.post('/admin/interns', {'id': sam, 'status': 'new', 'quick': 'accepted'}, admin)
        self.assertEqual([m['to'] for m in mail.OUTBOX], ['sam@example.org'])
        self.post('/admin/interns', placement, admin)
        self.post('/admin/interns', {**placement, 'placement_hours': '12 hours a week'}, admin)  # edited later
        self.register()
        db.execute("UPDATE users SET email_verified=1 WHERE email='sam@example.org'")
        db.commit()
        profile = self.c.get('/account').get_data(as_text=True)
        for text in ('Moon Tea', 'Nov 2, 2026', '12 hours a week', 'Lee Chen'):
            self.assertIn(text, profile)

    def test_nicknames_admin_notes_and_private_notes(self):
        owner, admin = self.make_admin('owner@example.org', 'owner'), self.make_admin()
        self.register()
        db = connect(self.app.config['DB_PATH'])
        uid = db.execute("SELECT id FROM users WHERE email='sam@example.org'").fetchone()['id']
        self.post(f'/admin/users/{uid}/notes', {'nickname': 'Sammy', 'staff_note': 'Met at the career fair', 'private_note': 'Follow up in May'}, admin)
        self.post(f'/admin/users/{uid}/notes', {'nickname': 'Sammy', 'staff_note': 'Met at the career fair', 'private_note': 'Owner thoughts'}, owner)
        mine, theirs = (c.get(f'/admin/users/{uid}').get_data(as_text=True) for c in (admin, owner))
        for page in (mine, theirs):
            self.assertIn('Sammy', page)
            self.assertIn('Met at the career fair', page)  # every admin sees the admin note
        self.assertIn('Follow up in May', mine)
        self.assertNotIn('Follow up in May', theirs)  # a private note is only for whoever wrote it
        self.assertNotIn('Owner thoughts', mine)
        self.assertIn('Sammy', admin.get('/admin/users?q=sammy').get_data(as_text=True))  # nicknames are searchable
        self.assertNotIn('Sammy', self.c.get('/account').get_data(as_text=True))  # never shown to the person

        self.post('/admin/users', {'id': uid, 'role': 'moderator'}, admin)
        self.post('/login', {'email': 'sam@example.org', 'password': PW})
        self.post(f'/admin/users/{uid}/notes', {'nickname': 'Changed', 'staff_note': 'x', 'private_note': 'Moderator note'})
        row = db.execute('SELECT nickname FROM users WHERE id=?', (uid,)).fetchone()
        self.assertEqual(row['nickname'], 'Sammy')  # moderators keep their own private note, change nothing else
        self.assertEqual(db.execute('SELECT note FROM user_notes WHERE author_id=?', (uid,)).fetchone()['note'], 'Moderator note')
        self.post('/admin/users/owner/notes', {'nickname': 'Boss', 'staff_note': '', 'private_note': ''}, admin)
        self.assertEqual(db.execute("SELECT nickname FROM users WHERE id='owner'").fetchone()['nickname'], '')  # only the owner

    def test_owner_makes_users_partners_and_edits_the_about_page(self):
        owner, admin = self.make_admin('owner@example.org', 'owner'), self.make_admin()
        self.register('shop@example.org')
        db = connect(self.app.config['DB_PATH'])
        uid = db.execute("SELECT id FROM users WHERE email='shop@example.org'").fetchone()['id']
        self.assertEqual(self.post(f'/admin/users/{uid}/make-partner', client=admin).status_code, 403)  # the owner's job
        self.assertEqual(admin.get('/admin/partner-profiles/new').status_code, 403)
        self.assertEqual(admin.get('/admin/partner-profiles').status_code, 200)  # everyone on staff can look
        r = self.post(f'/admin/users/{uid}/make-partner', client=owner)
        p = db.execute('SELECT * FROM partner_profiles WHERE user_id=?', (uid,)).fetchone()
        self.assertEqual((db.execute('SELECT role FROM users WHERE id=?', (uid,)).fetchone()['role'], p['shown']), ('partner', 0))
        self.assertIn(f"/admin/partner-profiles/{p['id']}", r.headers['Location'])
        self.assertNotIn('Sam Rivera', self.c.get('/about').get_data(as_text=True))  # hidden until shown

        png = b'\x89PNG\r\n\x1a\n' + b'\0' * 64
        form = {'name': 'Rivera Bakery', 'tier': 'supporter', 'position': '5', 'shown': '1', 'url': 'https://bakery.example.org',
                'quote': 'Hosting a student this fall was a great experience for our whole team.', 'address': '1 Main St, Warren, NJ'}
        self.post(f"/admin/partner-profiles/{p['id']}", {**form, 'photo': (io.BytesIO(b'not an image'), 'x.png')}, owner,
                  content_type='multipart/form-data')
        self.assertEqual(db.execute('SELECT name FROM partner_profiles WHERE id=?', (p['id'],)).fetchone()['name'], 'Sam Rivera')
        self.post(f"/admin/partner-profiles/{p['id']}", {**form, 'photo': (io.BytesIO(png), 'logo.png')}, owner, content_type='multipart/form-data')
        img = db.execute('SELECT img FROM partner_profiles WHERE id=?', (p['id'],)).fetchone()['img']
        about = self.c.get('/about').get_data(as_text=True)
        self.assertIn('Rivera Bakery', about.split('id="supporters-h"')[1])
        self.assertIn(f'/media/{img}', about)
        self.assertEqual(self.c.get(f'/media/{img}').data, png)
        self.assertEqual(self.c.get('/media/../app.py').status_code, 404)

        moon = db.execute("SELECT id FROM partner_profiles WHERE name='Moon Tea'").fetchone()['id']
        self.post(f'/admin/partner-profiles/{moon}', {'action': 'delete'}, owner)
        self.assertNotIn('Moon Tea', self.c.get('/about').get_data(as_text=True))
        self.post(f"/admin/partner-profiles/{p['id']}", {'action': 'delete'}, owner)
        self.assertEqual(self.c.get(f'/media/{img}').status_code, 404)  # its photo went with it

    def test_applicants_reply_from_their_profile(self):
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        self.post('/apply', {'full_name': 'Sam Rivera', 'email': 'sam@example.org', 'statement': 'I want to learn how a small business runs.'})
        self.post('/submit', LISTING)
        aid = db.execute('SELECT id FROM intern_applications').fetchone()['id']
        oid = db.execute('SELECT id FROM opportunities').fetchone()['id']
        mail.OUTBOX.clear()
        r = self.post(f'/account/applications/intern/{aid}', {'message': 'I’m free after 3 pm on weekdays.'})
        self.assertTrue(r.headers['Location'].endswith(f'#app-intern-{aid}'))
        self.post(f'/account/applications/listing/{oid}', {'message': 'The deadline is March 1.'})
        self.assertEqual([m['to'] for m in mail.OUTBOX], [self.app.config['CONTACT_EMAIL']] * 2)  # the team hears about each
        self.assertIn('Sam Rivera replied about their internship application', mail.OUTBOX[1]['subject'])
        profile = self.c.get('/account').get_data(as_text=True)
        self.assertEqual(profile.count('class="thread__item is-mine"'), 2)
        self.assertIn('I’m free after 3 pm on weekdays.', profile)
        admin = self.make_admin()
        self.assertIn('Reply from Sam Rivera', admin.get('/admin/interns').get_data(as_text=True))
        self.assertIn('The deadline is March 1.', admin.get(f'/admin/o/{oid}').get_data(as_text=True))
        # nobody can write on someone else's application, and an empty message isn't sent
        other = self.app.test_client()
        self.register('lee@example.org', other)
        self.assertEqual(self.post(f'/account/applications/intern/{aid}', {'message': 'Hi'}, other).status_code, 404)
        self.post(f'/account/applications/intern/{aid}', {'message': ' '})
        self.assertEqual(db.execute('SELECT COUNT(*) n FROM application_updates').fetchone()['n'], 1)
        users = admin.get('/admin/users').get_data(as_text=True)
        self.assertIn('vbadge--yes', users)  # Sam: verified
        self.assertIn('vbadge--no', users)  # Lee: not yet
        self.assertIn('Verify manually', users)

    def test_moderators_see_everything_but_change_nothing(self):
        admin = self.make_admin()
        self.register('mo@example.org')
        db = connect(self.app.config['DB_PATH'])
        mid = db.execute("SELECT id FROM users WHERE email='mo@example.org'").fetchone()['id']
        self.post('/admin/users', {'id': mid, 'role': 'moderator'}, admin)  # an admin makes them a moderator
        self.assertEqual(db.execute('SELECT role FROM users WHERE id=?', (mid,)).fetchone()['role'], 'moderator')
        self.post('/login', {'email': 'mo@example.org', 'password': PW})  # changing a role signs them out
        self.post('/contact', {'name': 'Jordan Lee', 'email': 'jordan@example.org', 'topic': 'A question', 'message': 'Do you have summer programs in Ohio?'})
        cid = db.execute('SELECT id FROM contact_messages').fetchone()['id']
        for path in ('/admin/stats', '/admin/', '/admin/interns', '/admin/partners', '/admin/messages', '/admin/grants',
                     '/admin/voices', '/admin/users', '/admin/activity'):
            page = self.c.get(path)
            self.assertEqual(page.status_code, 200, path)
            self.assertIn('View only.', page.get_data(as_text=True))
        self.assertNotIn('Reply to Jordan', self.c.get('/admin/messages').get_data(as_text=True))  # no forms to change things
        self.assertIn('Admin', self.c.get('/about').get_data(as_text=True))  # the navbar link
        self.assertEqual(self.post('/admin/messages', {'id': cid, 'status': 'closed'}).status_code, 403)
        self.assertEqual(self.post('/admin/users', {'id': mid, 'role': 'admin'}).status_code, 403)
        self.assertEqual(self.c.get('/admin/backup').status_code, 403)  # everyone's data stays with admins
        self.assertEqual(self.c.get('/admin/export').status_code, 403)
        self.assertEqual(db.execute('SELECT status FROM contact_messages').fetchone()['status'], 'new')

    def test_admins_answer_contact_messages_and_the_sender_can_reply(self):
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        self.post('/contact', {'name': 'Sam Rivera', 'email': 'sam@example.org', 'topic': 'A listing', 'message': 'The NIH deadline looks out of date.'})
        cid = db.execute('SELECT id FROM contact_messages').fetchone()['id']
        admin = self.make_admin()
        mail.OUTBOX.clear()
        self.post('/admin/messages', {'id': cid, 'status': 'new', 'message': 'Thanks! Fixed it.', 'notify': '1'}, admin)
        self.assertEqual(db.execute('SELECT status FROM contact_messages').fetchone()['status'], 'replied')  # answering marks it answered
        self.assertEqual(mail.OUTBOX[0]['to'], 'sam@example.org')
        self.assertIn('Thanks! Fixed it.', mail.OUTBOX[0]['text'])
        profile = self.c.get('/account').get_data(as_text=True)
        self.assertIn('The NIH deadline looks out of date.', profile)  # their message starts the conversation
        self.assertIn('Thanks! Fixed it.', profile)
        self.post(f'/account/applications/contact/{cid}', {'message': 'Great, thank you!'})
        self.assertEqual(db.execute('SELECT status FROM contact_messages').fetchone()['status'], 'new')  # back in the team's pile
        self.assertIn('Reply from Sam Rivera', admin.get('/admin/messages').get_data(as_text=True))

    def test_older_databases_are_upgraded_without_losing_anything(self):
        from app import init_db
        old = Path(self.tmp.name) / 'old.db'
        schema = (Path(__file__).parent / 'schema.sql').read_text()
        db = connect(str(old))  # the tables as they were before moderators and contact replies
        db.executescript(schema.replace("'partner','moderator',", '').replace(",'contact'", ''))
        db.execute("INSERT INTO users (id, email, password_hash, name, created_at) VALUES ('u1', 'a@example.org', 'x', 'A', '2026-01-01')")
        db.execute("INSERT INTO opportunities (id, title, org, type, summary, cost, format, commitment, created_at, updated_at) "
                   "VALUES ('o1', 'T', 'O', 'Job', 'S', 'Free', 'Online', 'Summer', '2026-01-01', '2026-01-01')")
        db.execute("INSERT INTO saved (user_id, opportunity_id, created_at) VALUES ('u1', 'o1', '2026-01-01')")
        db.commit()
        db.close()
        init_db(str(old))
        init_db(str(old))  # safe to run again
        db = connect(str(old))
        db.execute("UPDATE users SET role='moderator' WHERE id='u1'")
        db.execute("UPDATE users SET role='partner' WHERE id='u1'")
        self.assertEqual(db.execute('SELECT COUNT(*) n FROM saved').fetchone()['n'], 1)  # rebuilding users didn't cascade
        db.execute("DELETE FROM users WHERE id='u1'")
        self.assertEqual(db.execute('SELECT COUNT(*) n FROM saved').fetchone()['n'], 0)  # and references still work
        db.close()

    def test_partners_grants_and_listing_submitters_get_updates_too(self):
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        admin = self.make_admin()
        # a business owner with an account
        self.post('/partner', {'business': 'Rosa’s Bakery', 'contact_name': 'Sam Rivera', 'email': 'sam@example.org',
                               'message': 'We could use help at the counter on weekends.'})
        pid = db.execute('SELECT id FROM partner_inquiries').fetchone()['id']
        mail.OUTBOX.clear()
        self.post('/admin/partners', {'id': pid, 'quick': 'partnered', 'notify': '1'}, admin)
        self.assertIn('is now: Partnered', mail.OUTBOX[0]['text'])
        # an Access Grant: a message without changing the status reaches the student and parent
        self.post('/access-grants', GRANT)
        gid = db.execute('SELECT id FROM access_grants').fetchone()['id']
        mail.OUTBOX.clear()
        self.post('/admin/grants', {'id': gid, 'action': 'message', 'message': 'We’re checking with the program.'}, admin)
        self.assertEqual({m['to'] for m in mail.OUTBOX}, {'sam@example.org', 'parent@example.org'})
        self.assertEqual(self.grant(gid)['status'], 'new')
        # a listing: a note on its own, then a decision, both emailed
        self.post('/submit', LISTING)
        oid = db.execute('SELECT id FROM opportunities').fetchone()['id']
        mail.OUTBOX.clear()
        self.post(f'/admin/o/{oid}', {'action': 'message', 'message': 'Looking into the dates now.'}, admin)
        self.post(f'/admin/o/{oid}', {'action': 'request_changes', 'message': 'Please add the deadline.'}, admin)
        self.assertEqual([m['to'] for m in mail.OUTBOX], ['sam@example.org', 'sam@example.org'])
        self.assertIn('is now: Changes requested', mail.OUTBOX[0]['text'])  # newest first
        profile = self.c.get('/account').get_data(as_text=True)
        for text in ('Hosting an intern at Rosa’s Bakery', 'We’re checking with the program.', 'Looking into the dates now.',
                     'Please add the deadline.', 'Revise and resend'):
            self.assertIn(text, profile)
        self.assertIn('Updated an applicant', admin.get('/admin/activity').get_data(as_text=True))

    def test_nobody_handles_their_own_access_grant(self):
        asker, other = self.make_admin(), self.make_admin('b@example.org', 'admin2')
        self.post('/access-grants', GRANT, client=asker)  # admins ask the same way as any student
        gid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM access_grants').fetchone()['id']
        approve = {'id': gid, 'action': 'approve', 'approved_amount': '200'}
        self.post('/admin/grants', approve, asker)
        self.assertEqual(self.grant(gid)['status'], 'new')
        self.post('/admin/grants', approve, other)
        self.assertEqual((self.grant(gid)['status'], self.grant(gid)['approved_by']), ('approved', 'admin2'))

    def test_deleting_an_account_removes_its_quote_from_the_home_page(self):
        self.register()
        self.post('/account/quote', {'quote': 'OpenAjar helped me find my first research program.', 'role_label': 'HS Student'})
        admin = self.make_admin()
        qid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM testimonials').fetchone()['id']
        self.post('/admin/voices', {'id': qid, 'status': 'approved'}, admin)
        self.assertIn(b'my first research program', self.c.get('/').data)
        self.post('/account/delete', {'password': PW})
        self.assertNotIn(b'my first research program', self.c.get('/').data)

    def test_partner_inquiry_is_saved_emailed_and_listed_for_admins(self):
        form = {'business': 'Rosa’s Bakery', 'contact_name': 'Rosa Diaz', 'email': 'rosa@example.org', 'location': 'Austin, TX',
                'message': 'We could use help at the counter and with our social media on weekends.'}
        self.assertEqual(self.post('/partner', {**form, 'message': 'short'}).status_code, 422)
        r = self.post('/partner', form)
        self.assertIn('We’ll be in touch', r.get_data(as_text=True))
        self.assertEqual(mail.OUTBOX[0]['to'], self.app.config['CONTACT_EMAIL'])
        self.assertIn('Rosa’s Bakery', mail.OUTBOX[0]['subject'])
        self.assertIn('Rosa’s Bakery', self.make_admin().get('/admin/partners').get_data(as_text=True))
        self.assertIn('href="/partner"', self.c.get('/').get_data(as_text=True))

    def test_contact_message_is_saved_emailed_and_listed_for_admins(self):
        form = {'name': 'Jordan Lee', 'email': 'jordan@example.org', 'topic': 'A listing',
                'message': 'The deadline on the NIH summer program looks out of date.'}
        self.assertEqual(self.post('/contact', {**form, 'topic': 'Not a topic'}).status_code, 422)
        self.assertIn('Your message is in', self.post('/contact', form).get_data(as_text=True))
        self.assertEqual(mail.OUTBOX[0]['to'], self.app.config['CONTACT_EMAIL'])
        self.assertIn('Jordan Lee', mail.OUTBOX[0]['subject'])
        self.assertIn('NIH summer program', self.make_admin().get('/admin/messages').get_data(as_text=True))
        self.assertIn('href="/contact"', self.c.get('/').get_data(as_text=True))

    def test_data_export_is_readable_csvs_without_passwords(self):
        import io, zipfile
        self.register()
        r = self.make_admin().get('/admin/export')
        z = zipfile.ZipFile(io.BytesIO(r.data))
        self.assertIn('members.csv', z.namelist())
        self.assertIn('summary.csv', z.namelist())
        members = z.read('members.csv').decode('utf-8-sig')
        self.assertTrue(members.startswith('Name,Email,Role'))
        self.assertRegex(members, r'Sam Rivera,sam@example.org,student,.*,No,Yes,No,,,\d{4}-\d{2}-\d{2} \d{2}:\d{2}')
        self.assertNotIn('scrypt', ''.join(z.read(n).decode('utf-8-sig') for n in z.namelist()))  # no password hashes

    def test_admins_can_download_a_backup(self):
        self.register()
        self.assertEqual(self.c.get('/admin/backup').status_code, 403)
        r = self.make_admin().get('/admin/backup')
        self.assertTrue(r.data.startswith(b'SQLite format 3'))
        self.assertIn('attachment', r.headers['Content-Disposition'])
        r.close()

    def test_admin_lists_page_and_search_instead_of_stopping_at_a_limit(self):
        db = connect(self.app.config['DB_PATH'])
        db.executemany("INSERT INTO partner_inquiries (id, business, contact_name, email, message, created_at) VALUES (?,?,?,?,?,?)",
                       [(f'p{i}', f'Shop {i}', 'Owner', f'o{i}@example.org', 'We could use a hand.', f'2026-01-01T00:00:{i % 60:02d}')
                        for i in range(130)] + [('rosa', 'Rosa’s Bakery', 'Rosa', 'rosa@example.org', 'Counter help.', '2026-02-01')])
        db.commit()
        admin = self.make_admin()
        page = admin.get('/admin/partners').get_data(as_text=True)
        self.assertIn('131 in all · page 1 of 2', page)
        self.assertIn('Shop', admin.get('/admin/partners?page=2').get_data(as_text=True))
        found = admin.get('/admin/partners?q=rosa').get_data(as_text=True)
        self.assertIn('Rosa’s Bakery', found)
        self.assertIn('1 in all', found)
        r = self.post('/admin/partners?q=rosa', {'id': 'rosa', 'status': 'contacted', 'admin_note': 'Called her.'}, admin)
        self.assertEqual(r.headers['Location'], '/admin/partners?q=rosa#a-rosa')  # back to the same search and row
        self.assertEqual(db.execute("SELECT status FROM partner_inquiries WHERE id='rosa'").fetchone()['status'], 'contacted')

    def test_only_the_owner_adjusts_stats_and_other_admins_cant_touch_the_owner(self):
        owner, other = self.make_admin('owner@example.org', 'owner1'), self.make_admin()
        db = connect(self.app.config['DB_PATH'])
        r = self.post('/admin/users', {'id': 'owner1', 'role': 'student'}, other, follow_redirects=True)
        self.assertIn('Only the owner can change'.encode(), r.data)
        self.assertEqual(db.execute("SELECT role FROM users WHERE id='owner1'").fetchone()['role'], 'admin')
        self.assertEqual(self.post('/admin/stats', {'key': 'placed', 'adjust': '+3'}, other).status_code, 403)
        self.assertNotIn(b'name="adjust"', other.get('/admin/stats').data)  # no adjust controls for other admins
        self.post('/admin/stats', {'key': 'placed', 'adjust': '+3'}, owner)
        page = other.get('/admin/stats').get_data(as_text=True)
        self.assertIn('+3 by hand</span> · database count 0', page)  # always shown next to the real count
        self.assertIn('Adjusted a stat by hand', other.get('/admin/activity?kind=stat_adjusted').get_data(as_text=True))

    def test_admins_confirm_emails_filter_users_and_see_a_persons_applications(self):
        self.register()
        admin = self.make_admin()
        db = connect(self.app.config['DB_PATH'])
        sam = db.execute("SELECT id FROM users WHERE email='sam@example.org'").fetchone()['id']
        self.post('/apply', {'full_name': 'Sam Rivera', 'email': 'SAM@example.org', 'statement': 'I want to learn how a small business runs.'})
        self.assertIn(b'Sam Rivera', admin.get('/admin/users?status=unconfirmed&role=student').data)
        self.assertNotIn(b'Sam Rivera', admin.get('/admin/users?role=admin').data)
        self.assertNotIn(b'Sam Rivera', admin.get('/admin/users?joined_to=2000-01-01').data)
        self.post('/admin/users', {'id': sam, 'action': 'verify'}, admin)
        self.assertEqual(db.execute('SELECT email_verified FROM users WHERE id=?', (sam,)).fetchone()['email_verified'], 1)
        detail = admin.get(f'/admin/users/{sam}').get_data(as_text=True)
        self.assertIn('how a small business runs', detail)  # their intern application, matched by email
        self.assertIn('Intern applications <span class="muted">(1)</span>', detail)
        self.assertIn('<span class="tabs__n" aria-label="1 waiting">1</span>', detail)  # the new application on its tab
        self.assertIn('Confirmed a user’s email by hand', admin.get('/admin/activity?who=ada&kind=email_confirmed_by_admin').get_data(as_text=True))
        self.assertIn('Nothing matches', admin.get('/admin/activity?who=nobody').get_data(as_text=True))

    def test_students_cant_reach_admin(self):
        self.register()
        self.assertEqual(self.c.get('/admin/').status_code, 403)

    def test_a_whole_class_can_sign_up_from_one_school_network_but_one_password_cant_be_guessed(self):
        for i in range(30):  # one school address; the old shared limit stopped this at 15
            self.assertEqual(self.register(f's{i}@school.org', self.app.test_client()).status_code, 302)
        bad = [self.post('/login', {'email': 's0@school.org', 'password': 'wrong guess ' + str(i)}).status_code for i in range(11)]
        self.assertEqual(bad, [401] * 10 + [429])

    def test_home_has_a_real_search_box(self):
        page = self.c.get('/').get_data(as_text=True)
        self.assertRegex(page, r'<form class="typer[^"]*" action="/opportunities" method="get" role="search"')
        self.assertIn('name="q"', page.split('role="search"')[1].split('</form>')[0])

    def test_password_reset_signs_out_everywhere(self):
        self.register()
        other = self.app.test_client()
        self.post('/login', {'email': 'sam@example.org', 'password': PW}, other)
        self.assertEqual(other.get('/tracker').status_code, 200)
        self.post('/forgot', {'email': 'sam@example.org'})
        self.assertIn(b'If an account exists', self.post('/forgot', {'email': 'nobody@example.org'}).data)  # same answer either way
        token = re.search(r'reset\?token=([\w-]+)', mail.OUTBOX[0]['text']).group(1)
        self.assertEqual(self.post('/reset', {'token': token, 'password': 'short'}).status_code, 422)  # weak password keeps the link alive
        self.post('/reset', {'token': token, 'password': 'a brand new passphrase'})
        self.assertEqual(other.get('/tracker').status_code, 302)
        self.assertEqual(self.post('/login', {'email': 'sam@example.org', 'password': 'a brand new passphrase'}).status_code, 302)

    def test_import_is_pending_and_skips_duplicates(self):
        row = {'id': 'row-1', 'title': 'Coding Club', 'organization': 'Girls Who Code', 'type': 'Academic program',
               'summary': 'Free clubs for students to explore coding after school.', 'eligibility': 'Grades 9 to 12',
               'requirements': 'Join a club', 'grades': '9;10;11;12', 'interests': 'Coding;Unknown tag', 'cost': 'Free',
               'format': 'In person', 'location': 'Nationwide', 'commitment': 'School year', 'official_url': 'https://girlswhocode.com'}
        with self.app.app_context():
            self.assertTrue(import_rows([row, {**row, 'id': 'row-2'}], batch='b1').startswith('1 added'))
        db = connect(self.app.config['DB_PATH'])
        o = db.execute('SELECT * FROM opportunities').fetchone()
        self.assertEqual(o['status'], 'pending_review')
        self.assertEqual(o['interests'], '["Computer science"]')

    def test_filter_counts_follow_other_filters(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer'}
        rows = [{**base, 'id': '1', 'title': 'Free Comp', 'type': 'Competition', 'cost': 'Free'},
                {**base, 'id': '2', 'title': 'Paid Comp', 'type': 'Competition', 'cost': 'Fee'},
                {**base, 'id': '3', 'title': 'Free Camp', 'type': 'Summer program', 'cost': 'Free'}]
        with self.app.app_context():
            import_rows(rows, approve=True)
            from core import facets
            f = facets({'sector': 'opportunities', 'cost': ['Free'], 'type': ['Competition']})
        self.assertEqual(f['type'], {'Competition': 1, 'Summer program': 1})  # counts apply cost, not their own pick
        self.assertEqual(f['cost'], {'Free': 1, 'Fee': 1})
        page = self.c.get('/opportunities?cost=Free').get_data(as_text=True)
        self.assertIn('2 results', page)
        empty = self.c.get('/opportunities?cost=Fee&type=Summer+program&q=comp').get_data(as_text=True)
        self.assertIn('0 results', empty)
        self.assertIn('Without Summer program', empty)  # the one filter whose removal gives results

    def test_saved_filter_shows_only_your_saved_listings(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': '1', 'title': 'Kept Comp'}, {**base, 'id': '2', 'title': 'Other Comp'}], approve=True)
        self.assertNotIn('name="saved"', self.c.get('/opportunities').get_data(as_text=True))  # signed out: no toggle
        self.register()
        kept = connect(self.app.config['DB_PATH']).execute("SELECT id FROM opportunities WHERE title='Kept Comp'").fetchone()['id']
        self.assertEqual(self.post(f'/o/{kept}/save', headers={'X-Requested-With': 'fetch'}).json, {'saved': True})  # the card's star
        page = self.c.get('/opportunities?saved=1').get_data(as_text=True)
        self.assertIn('1 result', page)
        self.assertIn('Kept Comp', page)
        self.assertNotIn('Other Comp', page)
        self.assertIn('2 results', self.c.get('/opportunities').get_data(as_text=True))

    def test_save_pressed_while_signed_out_happens_after_signing_in(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': '1', 'title': 'Kept Comp'}], approve=True)
        db = connect(self.app.config['DB_PATH'])
        oid = db.execute('SELECT id FROM opportunities').fetchone()['id']
        r = self.post(f'/o/{oid}/save', headers={'Referer': f'http://localhost/o/{oid}'})
        self.assertIn('/login', r.headers['Location'])
        self.register()  # signing up counts too
        self.assertTrue(db.execute('SELECT 1 FROM saved WHERE opportunity_id=?', (oid,)).fetchone())

    def test_card_star_signed_out_goes_to_sign_in_with_its_message(self):
        with self.app.app_context():
            import_rows([{'id': '1', 'title': 'Kept Comp', 'organization': 'Org', 'summary': 'A program for high-school students to try.',
                          'eligibility': 'Any high schooler', 'grades': '9', 'format': 'Online', 'location': 'Online',
                          'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}], approve=True)
        oid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM opportunities').fetchone()['id']
        r = self.post(f'/o/{oid}/save', headers={'X-Requested-With': 'fetch', 'Referer': 'http://localhost/opportunities'})
        self.assertEqual(r.status_code, 401)  # not a redirect: following one in the background would eat the message
        self.assertIn('/login?next=/opportunities', r.json['login'])
        self.assertIn('We’ll save it for you', self.c.get(r.json['login']).get_data(as_text=True))

    def test_job_pages_carry_google_job_data_and_the_sitemap_lists_every_public_page(self):
        with self.app.app_context():
            import_rows([{'id': 'j1', 'title': 'Cashier', 'organization': 'Five Below', 'type': 'Job', 'summary': 'Ring up customers after school.',
                          'eligibility': 'At least 16', 'grades': '11;12', 'cost': 'Award', 'format': 'In person',
                          'location': 'Austin, TX', 'commitment': 'Flexible'}], approve=True)
        oid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM opportunities').fetchone()['id']
        page = self.c.get(f'/o/{oid}').get_data(as_text=True)
        job = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page).group(1))
        self.assertEqual((job['@type'], job['hiringOrganization']['name']), ('JobPosting', 'Five Below'))
        self.assertEqual(job['jobLocation']['address'], {'@type': 'PostalAddress', 'addressCountry': 'US', 'addressRegion': 'TX',
                                                         'addressLocality': 'Austin'})
        sitemap = self.c.get('/sitemap.xml').get_data(as_text=True)
        for path in ('/access-grants', '/partner', '/contact', f'/o/{oid}'):
            self.assertIn(f'{path}</loc>', sitemap)

    def test_tracked_deadlines_download_as_a_calendar(self):
        from datetime import date, timedelta
        due = (date.today() + timedelta(days=30)).isoformat()
        base = {'organization': 'Org, Inc', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': '1', 'title': 'Robotics Challenge; National Round With A Very Long Name That Needs Folding', 'deadline_date': due}], approve=True)
        oid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM opportunities').fetchone()['id']
        self.register()
        self.post(f'/o/{oid}/track')
        r = self.c.get('/tracker.ics')
        ics = r.get_data(as_text=True)
        self.assertIn('text/calendar', r.headers['Content-Type'])
        self.assertIn('DTSTART;VALUE=DATE:' + due.replace('-', ''), ics)
        self.assertIn('Robotics Challenge\\; National', ics)  # escaped for the calendar format
        self.assertTrue(all(len(line.encode()) <= 75 for line in ics.split('\r\n')))

    def test_closed_listings_stop_showing(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': '1', 'title': 'Closed Comp', 'deadline_date': '2026-01-05'},
                         {**base, 'id': '2', 'title': 'Old Comp', 'deadline_date': '2026-01-06'}], approve=True)
        db = connect(self.app.config['DB_PATH'])
        self.assertTrue(db.execute("SELECT expires_at FROM opportunities WHERE title='Closed Comp'").fetchone()['expires_at'])
        db.execute("UPDATE opportunities SET expires_at=NULL WHERE title='Old Comp'")  # live from before expiries were set on import
        db.commit()
        from core import expire_due
        expire_due(db)
        page = self.c.get('/opportunities').get_data(as_text=True)
        self.assertNotIn('Closed Comp', page)
        self.assertNotIn('Old Comp', page)

    def test_browsing_edges(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': str(i), 'title': f'Comp number {i}'} for i in range(30)], approve=True)
        page = self.c.get('/opportunities?page=99').get_data(as_text=True)  # past the last page: the last page
        self.assertNotIn('Nothing matches', page)
        self.assertIn('aria-current="page">2</span>', page)
        cards = self.c.get('/opportunities', headers={'X-Requested-With': 'fetch'}).get_data(as_text=True)  # the home tabs
        self.assertEqual(cards.count('class="card"'), 3)
        self.assertIn('30 results', cards)
        oid = connect(self.app.config['DB_PATH']).execute('SELECT id FROM opportunities LIMIT 1').fetchone()['id']
        back = self.c.get(f'/o/{oid}', headers={'Referer': 'http://localhost/opportunities?cost=Free&q=comp'}).get_data(as_text=True)
        self.assertIn('href="/opportunities?cost=Free&amp;q=comp">← Back', back)  # back to their search
        self.assertIn('href="/opportunities">← Back', self.c.get(f'/o/{oid}', headers={'Referer': 'https://evil.example/'}).get_data(as_text=True))
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute("UPDATE opportunities SET status='rejected' WHERE id=?", (oid,))
        db.commit()
        r = self.post(f'/o/{oid}/save', headers={'X-Requested-With': 'fetch'})  # the card star on a listing that just closed
        self.assertEqual(r.status_code, 404)
        self.assertIn('has closed', self.post(f'/o/{oid}/save', follow_redirects=True).get_data(as_text=True))

    def test_past_dates_and_names_stay_sensible(self):
        self.register()
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        self.assertIn('already passed', self.post('/submit', {**LISTING, 'deadline_date': '2020-01-01'}).get_data(as_text=True))
        self.assertIn('That date has passed', self.post('/access-grants', {**GRANT, 'due_date': '2020-01-01'}).get_data(as_text=True))
        self.assertEqual(self.post('/register', {'name': 'Sam', 'email': 'sam@example.org', 'password': PW}).status_code, 422)
        self.post('/account/quote', {'quote': 'OpenAjar helped me find my summer program.'})
        self.post('/account/profile', {'name': 'Sam R.'})
        self.assertEqual(db.execute('SELECT name FROM testimonials').fetchone()['name'], 'Sam R.')

    def test_editing_a_deadline_moves_an_untouched_expiry(self):
        admin = self.make_admin()
        with self.app.app_context():
            import_rows([{**{k: v for k, v in LISTING.items() if k not in ('grades', 'interests', 'requirements')},
                          'organization': LISTING['org'], 'grades': '11', 'id': '1', 'deadline_date': '2027-03-01'}], approve=True)
        db = connect(self.app.config['DB_PATH'])
        o = core.opp_dict(db.execute('SELECT * FROM opportunities').fetchone())
        form = {**LISTING, 'action': 'edit', 'verification': o['verification'], 'expires_at': o['expires_at'][:10]}
        expiry = lambda: db.execute('SELECT expires_at FROM opportunities').fetchone()['expires_at'][:10]
        self.assertEqual(expiry(), '2027-03-03')
        self.post(f"/admin/o/{o['id']}", {**form, 'deadline_date': '2027-05-01'}, admin)  # expiry field left as it was
        self.assertEqual(expiry(), '2027-05-03')
        self.post(f"/admin/o/{o['id']}", {**form, 'deadline_date': '2027-06-01', 'expires_at': '2027-07-01'}, admin)
        self.assertEqual(expiry(), '2027-07-01')  # an expiry set by hand is kept

    def test_jobs_get_a_category_and_can_be_filtered_by_it(self):
        base = {'summary': 'A part-time job for high-school students.', 'eligibility': 'At least 16', 'grades': '11;12',
                'type': 'Job', 'cost': 'Award', 'format': 'In person', 'location': 'Austin, TX', 'commitment': 'Flexible'}
        rows = [{**base, 'id': 'j1', 'title': 'Crew Member', 'organization': 'Five Below Inc'},  # employer beats the title
                {**base, 'id': 'j2', 'title': 'Fresh Foods Clerk', 'organization': 'WinCo Foods'},
                {**base, 'id': 'j3', 'title': 'Server', 'organization': "Chuck E. Cheese"},
                {**base, 'id': 'j4', 'title': 'Crew Member', 'organization': "McDonald's"}]
        with self.app.app_context():
            import_rows(rows, approve=True)
            from core import search_public
            got = {o['org']: o['job_category'] for o in search_public({'sector': 'jobs'})[0]}
        self.assertEqual(got, {'Five Below Inc': 'Retail', 'WinCo Foods': 'Grocery', 'Chuck E. Cheese': 'Entertainment',
                               "McDonald's": 'Food & drink'})
        page = self.c.get('/jobs?category=Food+%26+drink').get_data(as_text=True)
        self.assertIn('1 result', page)
        self.assertIn('card__art--food-drink', page)

    def test_outcome_and_reach_stats(self):
        self.post('/register', {'name': 'Sam Rivera', 'email': 'sam@example.org', 'password': PW, 'school': 'Lincoln High'})
        admin = self.make_admin()
        with self.app.app_context():
            import_rows([{'id': '1', 'title': 'Essay Prize', 'organization': 'Org', 'type': 'Competition',
                          'summary': 'An essay competition for high-school writers.', 'eligibility': 'Any high schooler',
                          'grades': '9;10', 'cost': 'Award', 'format': 'Online', 'location': 'Online', 'commitment': 'One-off'}], approve=True)
        db = connect(self.app.config['DB_PATH'])
        opp_id = db.execute('SELECT id FROM opportunities').fetchone()['id']
        self.post(f'/o/{opp_id}/track')
        self.post(f'/tracker/{opp_id}', {'stage': 'Accepted'}, headers={'X-Requested-With': 'fetch'})
        self.assertIn('Did you find this opportunity on OpenAjar?', self.c.get('/tracker').get_data(as_text=True))
        self.post(f'/tracker/{opp_id}', {'stage': 'Accepted', 'found': '1'})
        self.assertNotIn('Did you find this opportunity on OpenAjar?', self.c.get('/tracker').get_data(as_text=True))
        page = admin.get('/admin/stats').get_data(as_text=True)
        self.assertIn('Lincoln High', page)
        n = lambda label: re.search(r'<th scope="row">' + re.escape(label) + r'</th>\s*<td class="more__n">([\d,]+)<', page).group(1)
        self.assertEqual(n('Acceptances found on OpenAjar'), '1')
        self.assertEqual(n('Engaged (saved or tracked a listing)'), '1')
        self.assertEqual(n('Active in the last 30 days'), '2')  # Sam and the admin
        self.assertIn('Found on OpenAjar: 1 of 1', page)  # the donut slice
        self.assertIn('Accepted: 1', page)  # the stage bars
        self.assertEqual(self.c.get('/admin/stats').status_code, 403)

    def test_reminders_send_once(self):
        from datetime import date, timedelta
        self.register()
        admin = self.make_admin()
        with self.app.app_context():
            import_rows([{'id': '1', 'title': 'Essay Prize', 'organization': 'Org', 'type': 'Competition',
                          'summary': 'An essay competition for high-school writers.', 'eligibility': 'Any high schooler',
                          'grades': '9;10', 'cost': 'Award', 'format': 'Online', 'location': 'Online', 'commitment': 'One-off',
                          'deadline_date': (date.today() + timedelta(days=3)).isoformat()}], approve=True)
        db = connect(self.app.config['DB_PATH'])
        db.execute('UPDATE users SET email_verified=1')
        db.commit()
        opp_id = db.execute('SELECT id FROM opportunities').fetchone()['id']
        self.post(f'/o/{opp_id}/track')
        mail.OUTBOX.clear()
        self.assertEqual(mail.run_reminders(db, self.app.config), 1)
        self.assertEqual(mail.run_reminders(db, self.app.config), 0)  # runs every 10 minutes: nothing goes twice
        self.assertIn('Essay Prize', mail.OUTBOX[0]['text'])
        day_before = date.today() + timedelta(days=2)
        self.assertEqual(mail.run_reminders(db, self.app.config, today=day_before), 1)  # a last reminder the day before
        self.assertIn('due tomorrow', mail.OUTBOX[0]['text'])
        self.assertEqual(mail.run_reminders(db, self.app.config, today=day_before + timedelta(days=1)), 0)  # and no more
        del admin

    def test_due_soon_only_counts_what_you_still_have_to_apply_to(self):
        from datetime import date, timedelta
        self.register()
        with self.app.app_context():
            import_rows([{'id': str(i), 'title': f'Prize {i}', 'organization': 'Org', 'type': 'Competition',
                          'summary': 'An essay competition for high-school writers.', 'eligibility': 'Any high schooler',
                          'grades': '9;10', 'cost': 'Award', 'format': 'Online', 'location': 'Online', 'commitment': 'One-off',
                          'deadline_date': (date.today() + timedelta(days=3)).isoformat()} for i in (1, 2)], approve=True)
        db = connect(self.app.config['DB_PATH'])
        ids = [r['id'] for r in db.execute('SELECT id FROM opportunities ORDER BY title')]
        for oid in ids:
            self.post(f'/o/{oid}/track')
        r = self.post(f'/tracker/{ids[1]}', {'stage': 'Accepted'}, headers={'X-Requested-With': 'fetch'})
        self.assertEqual(r.json['due_soon'], 1)


if __name__ == '__main__':
    unittest.main()
