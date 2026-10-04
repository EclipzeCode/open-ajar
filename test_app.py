"""End-to-end checks of the main flows. Run: python -m unittest"""
import re
import tempfile
import unittest
from pathlib import Path

from werkzeug.security import generate_password_hash

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


class Flows(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app({'TESTING': True, 'DB_PATH': str(Path(self.tmp.name) / 't.db')})
        self.c = self.app.test_client()
        mail.OUTBOX.clear()

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

    def make_admin(self):
        db = connect(self.app.config['DB_PATH'])
        db.execute("INSERT INTO users (id,email,password_hash,role,name,email_verified,created_at) VALUES ('admin1','admin@example.org',?,'admin','Ada',1,'2026-01-01')",
                   (generate_password_hash(PW),))
        db.commit()
        admin = self.app.test_client()
        self.post('/login', {'email': 'admin@example.org', 'password': PW}, admin)
        return admin

    def test_nav_links_go_to_the_right_pages(self):
        page = self.c.get('/').data
        self.assertIn(b'href="/opportunities"', page)
        self.assertIn(b'href="/jobs"', page)

    def test_placeholder_testimonials_never_reach_the_live_site(self):
        live = create_app({'TESTING': True, 'PRODUCTION': True, 'SECRET_KEY': 'x', 'RESEND_API_KEY': 'x',
                           'APP_URL': 'https://example.org', 'DB_PATH': self.app.config['DB_PATH']})
        page = live.test_client().get('/').data
        self.assertIn(b'Vanessa Gunuwan', page)
        self.assertNotIn(b'Testimonial goes here', page)

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
