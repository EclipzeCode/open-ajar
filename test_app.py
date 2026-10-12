"""End-to-end checks of the main flows. Run: python -m unittest"""
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
        self.app = create_app({'TESTING': True, 'DB_PATH': str(Path(self.tmp.name) / 't.db')})
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
        self.assertEqual(nav(self.c), ['Opportunities', 'Apply', 'Access Grants', 'About', 'Sign in'])
        self.assertEqual(nav(self.make_admin()), ['Opportunities', 'Apply', 'Access Grants', 'About', 'Admin', 'Profile'])
        self.register()
        self.assertEqual(nav(self.c), ['Opportunities', 'Apply', 'Access Grants', 'About', 'Profile'])

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
        for name in ('Moon Tea', 'Ryujin', 'One Dollar Zone of Cedar Knolls', 'Coders Over Borders', 'Creator Colosseum', 'Partner Portal'):
            self.assertIn(name, page)
        self.assertEqual(page.count('partner__quote'), 6)  # every partner has sent a real quote
        self.assertNotIn('“”', page)

    def test_a_crash_shows_the_friendly_error_page(self):
        self.app.config['PROPAGATE_EXCEPTIONS'] = False
        self.app.view_functions['site.about'] = lambda: 1 / 0
        r = self.c.get('/about')
        self.assertEqual(r.status_code, 500)
        self.assertIn(b'Something broke on our end', r.data)

    def test_writes_need_the_csrf_token(self):
        self.assertEqual(self.c.post('/register', data={'name': 'x', 'email': 'a@b.co', 'password': PW}).status_code, 400)

    def test_submit_review_publish_track(self):
        self.register()
        # unverified students can't submit
        self.assertIn(b'Confirm your email first', self.c.get('/submit').data)
        token = re.search(r'token=([\w-]+)', mail.OUTBOX[0]['text']).group(1)
        self.c.get(f'/verify?token={token}')  # just opening the link must not spend it
        self.post('/verify', {'token': token})
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
        self.post('/admin/grants', {'id': gid, 'action': 'paid', 'paid_amount': '150', 'paid_on': '2026-10-12', 'paid_method': 'Card'}, admin)
        g = self.grant(gid)
        self.assertEqual((g['status'], g['paid_amount'], g['paid_by']), ('paid', 150, 'admin1'))
        self.assertIn(b'We paid $150', self.c.get('/access-grants').data)
        self.assertEqual(self.post('/access-grants', GRANT).status_code, 422)  # only $100 of the yearly cap is left

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

    def test_admins_can_download_a_backup(self):
        self.register()
        self.assertEqual(self.c.get('/admin/backup').status_code, 403)
        r = self.make_admin().get('/admin/backup')
        self.assertTrue(r.data.startswith(b'SQLite format 3'))
        self.assertIn('attachment', r.headers['Content-Disposition'])
        r.close()

    def test_students_cant_reach_admin(self):
        self.register()
        self.assertEqual(self.c.get('/admin/').status_code, 403)

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

    def test_saved_filter_shows_only_your_saved_listings(self):
        base = {'organization': 'Org', 'summary': 'A program for high-school students to try.', 'eligibility': 'Any high schooler',
                'grades': '9', 'format': 'Online', 'location': 'Online', 'commitment': 'Summer', 'type': 'Competition', 'cost': 'Free'}
        with self.app.app_context():
            import_rows([{**base, 'id': '1', 'title': 'Kept Comp'}, {**base, 'id': '2', 'title': 'Other Comp'}], approve=True)
        self.assertNotIn('name="saved"', self.c.get('/opportunities').get_data(as_text=True))  # signed out: no toggle
        self.register()
        kept = connect(self.app.config['DB_PATH']).execute("SELECT id FROM opportunities WHERE title='Kept Comp'").fetchone()['id']
        self.post(f'/o/{kept}/save')
        page = self.c.get('/opportunities?saved=1').get_data(as_text=True)
        self.assertIn('1 result', page)
        self.assertIn('Kept Comp', page)
        self.assertNotIn('Other Comp', page)
        self.assertIn('2 results', self.c.get('/opportunities').get_data(as_text=True))

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
        n = lambda label: re.search(r'stat__n">([\d,]+)</div><p>' + label, page).group(1)
        self.assertEqual(n('acceptances found on OpenAjar'), '1')
        self.assertEqual(n('engaged members'), '1')
        self.assertEqual(n('active in the last 30 days'), '2')  # Sam and the admin
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
        db.execute("DELETE FROM app_meta")
        self.assertEqual(mail.run_reminders(db, self.app.config), 0)  # same deadline is never reminded twice
        self.assertIn('Essay Prize', mail.OUTBOX[0]['text'])
        del admin


if __name__ == '__main__':
    unittest.main()
