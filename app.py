"""OpenAjar: opportunity discovery and tracking for high-school students. Flask + SQLite.

Run locally:   flask --app app run --debug
Production:    gunicorn -w 1 --threads 8 'app:create_app()'     (see render.yaml)
"""
import base64
import csv
import getpass
import hashlib
import hmac
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import click
from flask import Flask, abort, g, redirect, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash

import data
import mail
from core import add_event, connect, current_user, expire_due, insert_opp, is_owner, load_user, new_id, partner_img, same_program_rows, update_opp

ROOT = Path(__file__).parent
# Runs in <head> before the first paint, so animated sections start in their animated layout instead of jumping when
# app.js arrives. If app.js hasn't loaded 4 s later, it's undone so nothing stays hidden. Allowed by the CSP via its hash.
JS_FLAG = ("document.documentElement.classList.add('js');"
           "setTimeout(function(){if(!window.appReady)document.documentElement.classList.remove('js')},4000);")
PRIVATE_PATHS = ('/account', '/tracker', '/admin', '/access-grants', '/verify', '/reset', '/confirm-email', '/unsubscribe')
JS_FLAG_HASH = base64.b64encode(hashlib.sha256(JS_FLAG.encode()).digest()).decode()


def load_dotenv():
    """Reads KEY=VALUE lines from .env (git-ignored) for local development. Real environment variables win."""
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            k, sep, v = line.partition('=')
            if sep and not k.strip().startswith('#'):
                os.environ.setdefault(k.strip(), v.strip().strip('"\''))


def create_app(test_config=None):
    load_dotenv()
    env = os.environ.get
    production = env('FLASK_ENV') == 'production' or env('RENDER') == 'true'
    app = Flask(__name__)
    app.config.update(
        PRODUCTION=production,
        SECRET_KEY=env('SECRET_KEY') or ('' if production else 'dev-only-not-secret'),
        DB_PATH=env('DB_PATH') or str(ROOT / 'var' / 'openajar.db'),
        APP_URL=(env('APP_URL') or 'http://127.0.0.1:5050').rstrip('/'),
        RESEND_API_KEY=env('RESEND_API_KEY', ''),
        EMAIL_FROM=env('EMAIL_FROM') or 'OpenAjar <onboarding@resend.dev>',
        REMINDER_DAYS=min(30, max(1, int(env('REMINDER_DAYS') or 7))),
        REMINDERS_ENABLED=env('REMINDERS_ENABLED', '1') == '1',
        CONTACT_EMAIL='openajar27116@gmail.com',
        # The owner: an admin whom other admins can't demote or disable, and the only one who can adjust Stats numbers
        OWNER_EMAIL=(env('OWNER_EMAIL') or 'madishetty.vrishank2008@gmail.com').lower(),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=production,
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if app.config['PRODUCTION']:
        missing = [k for k in ('SECRET_KEY', 'RESEND_API_KEY') if not app.config[k]]
        if missing or not app.config['APP_URL'].startswith('https://'):
            raise RuntimeError(f"Production needs SECRET_KEY, RESEND_API_KEY and an https:// APP_URL (missing: {', '.join(missing) or 'APP_URL'})")
    if env('TRUST_PROXY') == '1':
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    init_db(app.config['DB_PATH'])

    from account import bp as account_bp
    from admin import bp as admin_bp
    from site_pages import bp as site_bp
    app.register_blueprint(site_bp)
    app.register_blueprint(account_bp)
    app.register_blueprint(admin_bp, url_prefix='/admin')

    canonical_host = urlsplit(app.config['APP_URL']).netloc

    # Static files: links carry the file's modified time (?v=...), so browsers can keep them for a year and still get
    # a fresh copy whenever a deploy changes the file. Files linked without it (images in CSS) are revalidated as before.
    @app.url_defaults
    def static_version(endpoint, values):
        if endpoint == 'static' and 'filename' in values:
            try:
                values['v'] = int(os.stat(os.path.join(app.static_folder, values['filename'])).st_mtime)
            except OSError:
                pass

    app.get_send_file_max_age = lambda filename: 31536000 if request.args.get('v') else None

    @app.before_request
    def before():
        # One address for search engines and links: any other host (e.g. open-ajar.onrender.com) gets a permanent
        # redirect to the same page on APP_URL. Health checks and form posts are left alone.
        if (app.config['PRODUCTION'] and request.host != canonical_host and request.method in ('GET', 'HEAD')
                and request.path != '/healthz'):
            return redirect(app.config['APP_URL'] + request.full_path.rstrip('?'), 301)
        if request.endpoint == 'static':  # files: no database lookup, and no session cookie in the response
            return
        if not app.config.get('TESTING'):
            start_maintenance(app)
        load_user()
        if request.endpoint == 'admin.partner_profile':
            request.max_content_length = 5 * 1024 * 1024  # a partner photo; every other form stays at 64 KB
        # one-click unsubscribe from an email client: the signed link proves who it is, and there's no page or token
        if request.method == 'POST' and request.endpoint == 'account.unsubscribe' and request.form.get('List-Unsubscribe') == 'One-Click':
            return
        if request.method == 'POST':
            sent = request.form.get('csrf') or request.headers.get('X-CSRF-Token') or ''
            if not sent or not hmac.compare_digest(sent, session.get('csrf', '')):
                abort(400, 'Your session expired. Go back, refresh the page and try again.')
        elif 'csrf' not in session:
            session['csrf'] = os.urandom(24).hex()

    @app.after_request
    def headers(resp):
        resp.headers.update({
            'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Content-Security-Policy': f"default-src 'self'; script-src 'self' 'sha256-{JS_FLAG_HASH}'; style-src 'self'; "
                                       "font-src 'self'; img-src 'self' data:; object-src 'none'; "
                                       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        })
        if app.config['PRODUCTION']:
            resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        # Private pages are never stored. Other pages a signed-in person sees are re-checked rather than banned from
        # the cache, so Back returns to the page as it was (scroll position, open filters) instead of reloading it.
        if request.path.startswith(PRIVATE_PATHS):
            resp.headers['Cache-Control'] = 'no-store'
        elif current_user():
            resp.headers['Cache-Control'] = 'private, no-cache'
        return resp

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop('db', None)
        if db is not None:
            db.close()

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(429)
    @app.errorhandler(500)
    def error(e):
        message = e.description if e.code in (400, 429) else None
        if e.code == 413:
            message = ('That photo is too big to upload (the limit is 5 MB). Go back and choose a smaller one.'
                       if request.endpoint == 'admin.partner_profile' else 'That was more than this form can take. Go back and shorten it.')
        return render_template('error.html', code=e.code, message=message), e.code

    @app.context_processor
    def globals_():
        u = current_user()
        return {'user': u, 'can_edit': bool(u) and u['role'] == 'admin', 'csrf_token': session.get('csrf', ''), 'D': data, 'production': app.config['PRODUCTION'],
                'dev_inbox': not app.config['PRODUCTION'] and not app.config['RESEND_API_KEY'],
                'contact_email': app.config['CONTACT_EMAIL'], 'canonical': app.config['APP_URL'] + request.path,
                'app_url': app.config['APP_URL'], 'js_flag': JS_FLAG}

    def page_url(page):
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'page'] + [('page', page)]
        return request.path + '?' + urlencode(args)

    app.jinja_env.add_extension('jinja2.ext.do')
    app.jinja_env.tests['section_message'] = lambda m: ' ' in m[0]  # category like 'error profile'
    app.jinja_env.globals.update(deadline_info=data.deadline_info, grade_label=data.grade_label, page_url=page_url, is_owner=is_owner,
                                  partner_img=partner_img)
    app.jinja_env.filters['fromjson'] = json.loads
    app.jinja_env.filters['day'] = lambda iso: (iso or '')[:10]
    app.jinja_env.filters['nice_date'] = data.nice_date

    register_cli(app)
    if not app.config.get('TESTING'):
        print(f"OpenAjar ready (production={app.config['PRODUCTION']}, db={app.config['DB_PATH']}, "
              f"email={'resend' if app.config['RESEND_API_KEY'] else 'dev inbox'})", flush=True)
    return app


def init_db(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    db.execute('PRAGMA journal_mode = WAL')
    db.executescript((ROOT / 'schema.sql').read_text())
    # Columns added after launch: CREATE TABLE IF NOT EXISTS won't add them to an existing database.
    for table, col, ddl in (('users', 'school', "TEXT NOT NULL DEFAULT ''"), ('tracked', 'found_here', 'INTEGER'),
                            ('access_grants', 'approved_at', 'TEXT'), ('opportunities', 'job_category', 'TEXT'),
                            ('users', 'nickname', "TEXT NOT NULL DEFAULT ''"), ('users', 'staff_note', "TEXT NOT NULL DEFAULT ''"),
                            ('intern_applications', 'placement_business', "TEXT NOT NULL DEFAULT ''"),
                            ('intern_applications', 'placement_start', 'TEXT'),
                            ('intern_applications', 'placement_hours', "TEXT NOT NULL DEFAULT ''"),
                            ('intern_applications', 'placement_supervisor', "TEXT NOT NULL DEFAULT ''"),
                            ('users', 'pending_email', "TEXT NOT NULL DEFAULT ''"), ('users', 'digest_week', "TEXT NOT NULL DEFAULT ''"),
                            ('contact_messages', 'dismissed', 'INTEGER NOT NULL DEFAULT 0')):
        if col not in {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {col} {ddl}')
    # Values added to a CHECK constraint after launch (the text that shows the table is up to date)
    for table, needed in (('intern_applications', "'accepted'"), ('application_updates', "'contact'"), ('users', "'partner'"), ('auth_tokens', "'change_email'")):
        rebuild_table(db, table, needed)
    # The About page's partners: seeded once, then the owner edits them in admin (a flag, so deleting them all doesn't reseed)
    if not db.execute("SELECT 1 FROM app_meta WHERE key='partners_seeded'").fetchone():
        for i, p in enumerate(data.PARTNER_SEED):
            vals = {'tier': 'partner', **p, 'id': new_id(), 'shown': 1, 'position': (i + 1) * 10, 'updated_at': data.now_iso()}
            db.execute(f"INSERT INTO partner_profiles ({','.join(vals)}) VALUES ({','.join('?' * len(vals))})", list(vals.values()))
        db.execute("INSERT INTO app_meta (key, value) VALUES ('partners_seeded', '1')")
    # Job categories are stored so filtering is fast; recomputing them here picks up edits to data.JOB_CATEGORIES.
    db.executemany('UPDATE opportunities SET job_category=? WHERE id=?',
                   [(data.job_category(r['org'], r['title']) if r['type'] == 'Job' else None, r['id'])
                    for r in db.execute('SELECT id, type, org, title FROM opportunities')])
    db.commit()
    db.close()


def rebuild_table(db, table, needed):
    """Recreates `table` from schema.sql when its definition lacks `needed`, since SQLite can't change a CHECK constraint
    in place. SQLite's copy-and-swap: with foreign keys off, so dropping the old table doesn't cascade (users!) and other
    tables' references end up pointing at the new one."""
    if needed in db.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()['sql']:
        return
    schema = (ROOT / 'schema.sql').read_text()
    create = re.search(rf'CREATE TABLE IF NOT EXISTS {table} \(.*?\n\);', schema, re.S).group(0)
    cols = ', '.join(r['name'] for r in db.execute(f'PRAGMA table_info({table})'))
    broken = {tuple(r) for r in db.execute('PRAGMA foreign_key_check')}  # rows already pointing nowhere don't count
    db.commit()
    db.execute('PRAGMA foreign_keys = OFF')
    db.execute('BEGIN')  # all or nothing
    db.execute(f'DROP TABLE IF EXISTS {table}_new')  # left by a run that died halfway
    db.execute(create.replace(f'IF NOT EXISTS {table} (', f'{table}_new (', 1))
    db.execute(f'INSERT INTO {table}_new ({cols}) SELECT {cols} FROM {table}')
    db.execute(f'DROP TABLE {table}')
    db.execute(f'ALTER TABLE {table}_new RENAME TO {table}')
    if {tuple(r) for r in db.execute('PRAGMA foreign_key_check')} - broken:
        db.rollback()
        raise RuntimeError(f'Rebuilding {table} would break references to it; nothing was changed')
    db.commit()
    db.execute('PRAGMA foreign_keys = ON')
    db.executescript(schema)  # its indexes went with the old table


_maintenance_started = False
_maintenance_lock = threading.Lock()


def start_maintenance(app):
    """Every 10 minutes: expire listings past their expiry date and, from 8 am US Eastern, send deadline reminders.
    Started on the first request, inside the process that serves requests. Starting it when the app is created
    would put the thread in gunicorn's master process, and a process forked from one with a running thread can
    deadlock (which is exactly what hung the first Render deploys)."""
    global _maintenance_started
    with _maintenance_lock:
        if _maintenance_started:
            return
        _maintenance_started = True
    # ponytail: an in-process thread assumes one gunicorn worker (render.yaml uses -w 1); two processes running the
    # reminder pass at the same moment could both send the same reminder
    def loop():
        while True:
            try:
                db = connect(app.config['DB_PATH'])
                try:
                    expire_due(db)
                    db.execute("DELETE FROM auth_tokens WHERE used=1 OR expires_at < datetime('now','-1 day')")
                    db.commit()
                    if datetime.now(data.STUDENT_TZ).hour >= 8:  # in the morning, not at midnight
                        mail.run_reminders(db, app.config)
                        mail.run_digests(db, app.config)
                finally:
                    db.close()
            except Exception as e:
                print(f'[maintenance] {e}')
            time.sleep(600)
    threading.Thread(target=loop, daemon=True).start()


# ---------------------------------------------------------------- command line


def register_cli(app):
    @app.cli.command('create-admin')
    @click.argument('email')
    def create_admin(email):
        """Create an admin account, or promote an existing one."""
        email = data.norm_email(email)
        if not email:
            raise click.UsageError('Give a valid email address')
        db = connect(app.config['DB_PATH'])
        u = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
        if u:
            db.execute("UPDATE users SET role='admin', disabled=0, email_verified=1, session_version=session_version+1 WHERE id=?", (u['id'],))
            click.echo(f'{email} is now an admin.')
        else:
            name = click.prompt('Display name', default='Admin')
            pw = getpass.getpass('Password (10+ characters): ')
            problem = data.password_problem(pw, email)
            if problem:
                raise click.ClickException(problem)
            db.execute("INSERT INTO users (id,email,password_hash,role,name,email_verified,created_at) VALUES (?,?,?,'admin',?,1,?)",
                       (new_id(), email, generate_password_hash(pw), name, data.now_iso()))
            click.echo(f'Admin created: {email}')
        db.commit()

    @app.cli.command('import-csv')
    @click.argument('files', nargs=-1, type=click.Path(exists=True, dir_okay=False))
    @click.option('--approve', is_flag=True, help='Publish new rows immediately instead of leaving them for review.')
    def import_csv(files, approve):
        """Import listings from spreadsheet CSVs. New rows wait in the review queue unless --approve is given."""
        with app.app_context():
            for path in files:
                click.echo(f'{path}: ' + import_rows(list(csv.DictReader(open(path, encoding='utf-8-sig'))), approve, Path(path).stem))

    @app.cli.command('apply-corrections')
    @click.argument('path', type=click.Path(exists=True, dir_okay=False))
    def apply_corrections(path):
        """Apply researched fixes to listings (see data/corrections.json). Safe to run more than once."""
        with app.app_context():
            click.echo(apply_correction_file(json.load(open(path, encoding='utf-8'))))

    @app.cli.command('send-reminders')
    def send_reminders():
        """Run the deadline reminder pass now (it normally runs on its own every 10 minutes from 8 am Eastern)."""
        db = connect(app.config['DB_PATH'])
        click.echo(f'Sent {mail.run_reminders(db, app.config)} digest(s).')


def apply_correction_file(fixes):
    """Each fix: {external_id, title (as a safety check), set: {field: value}} or {..., unpublish: reason}.
    Edits go through the same validation as the admin editor; a fix that doesn't validate is reported, not saved."""
    from werkzeug.datastructures import MultiDict
    from core import get_db, opp_dict
    db = get_db()
    changed = unpublished = 0
    problems = []
    for fx in fixes:
        row = opp_dict(db.execute('SELECT * FROM opportunities WHERE external_id=?', (fx['external_id'],)).fetchone())
        if not row or row['title'] not in (fx['title'], fx.get('set', {}).get('title')):  # new title = already renamed
            problems.append(f"{fx['external_id']}: not found or title differs")
            continue
        if fx.get('unpublish'):
            if row['status'] == 'approved':
                db.execute("UPDATE opportunities SET status='rejected', reviewer_message=?, updated_at=? WHERE id=?",
                           (fx['unpublish'], data.now_iso(), row['id']))
                add_event(row['id'], None, 'reject', 'rejected', 'Research pass: ' + fx['unpublish'])
                unpublished += 1
            continue
        if all(row.get(k) == v for k, v in fx.get('set', {}).items()) and (not fx.get('verified') or row['verification'] == 'verified'):
            continue  # already applied
        merged = {**row, **fx.get('set', {})}
        form = MultiDict([(k, v) for k, v in merged.items() if k not in ('grades', 'interests', 'requirements') and v is not None])
        form.setlist('grades', [str(g) for g in merged['grades']])
        form.setlist('interests', merged['interests'])
        form['requirements'] = '\n'.join(merged['requirements'])
        form['expires_at'] = (row['expires_at'] or '')[:10]
        clean, errors = data.validate_opportunity(form, admin=True)
        if errors:
            problems.append(f"{fx['external_id']} ({row['title']}): {errors}")
            continue
        data.follow_deadline(row, clean)
        update_opp(db, row['id'], clean)
        if fx.get('verified'):
            db.execute("UPDATE opportunities SET verification='verified' WHERE id=?", (row['id'],))
        add_event(row['id'], None, 'edited', row['status'], 'Research pass: ' + fx.get('note', 'details checked against the official page'))
        changed += 1
    db.commit()
    for p in problems:
        click.echo('  problem ' + p)
    return f'{changed} updated, {unpublished} unpublished, {len(problems)} problems'


def import_rows(rows, approve=False, batch=''):
    """Adds spreadsheet rows. Never touches a live listing, skips duplicates and invalid rows, and reports all of it."""
    from core import get_db
    db = get_db()
    created = updated = live = 0
    problems = []
    for r in rows:
        ext = f"{r.get('batch') or batch}:{r.get('id')}"
        row, note = data.sheet_row(r)
        row['verification'] = 'unreviewed'
        clean, errors = data.validate_opportunity(row, admin=True)
        if errors:
            problems.append(f"{r.get('id')} invalid: {', '.join(f'{k}: {v}' for k, v in errors.items())}")
            continue
        known = db.execute('SELECT * FROM opportunities WHERE external_id=?', (ext,)).fetchone()
        if known:
            if known['status'] == 'approved':
                live += 1
            else:
                update_opp(db, known['id'], clean)
                updated += 1
            continue
        dup = same_program_rows(db, clean)
        if dup:
            problems.append(f"{r.get('id')} duplicate of “{dup['title']}”")
            continue
        status = 'approved' if approve else 'pending_review'
        if approve and clean['deadline_date'] and not clean.get('expires_at'):  # same as approving it by hand
            clean['expires_at'] = data.expiry_for(clean['deadline_date'])
        opp_id = insert_opp(db, clean, status=status, source='import:' + (r.get('group') or 'sheet'), external_id=ext,
                            verification='source' if approve else 'unreviewed', published_at=data.now_iso() if approve else None)
        add_event(opp_id, None, 'imported', status, note)
        created += 1
    db.commit()
    for p in problems:
        click.echo('  skipped ' + p)
    return f'{created} added, {updated} refreshed, {live} already live (left alone), {len(problems)} skipped'

