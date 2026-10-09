"""Open Ajar: opportunity discovery and tracking for high-school students. Flask + SQLite.

Run locally:   flask --app app run --debug
Production:    gunicorn -w 1 --threads 8 'app:create_app()'     (see render.yaml)
"""
import csv
import getpass
import json
import hmac
import os
import threading
import time
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import click
from flask import Flask, abort, g, redirect, render_template, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash

import data
import mail
from core import add_event, connect, current_user, expire_due, insert_opp, load_user, new_id, same_program_rows, update_opp

ROOT = Path(__file__).parent


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
        EMAIL_FROM=env('EMAIL_FROM') or 'Open Ajar <onboarding@resend.dev>',
        REMINDER_DAYS=min(30, max(1, int(env('REMINDER_DAYS') or 7))),
        REMINDERS_ENABLED=env('REMINDERS_ENABLED', '1') == '1',
        CONTACT_EMAIL='openajar27116@gmail.com',
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

    @app.before_request
    def before():
        # One address for search engines and links: any other host (e.g. open-ajar.onrender.com) gets a permanent
        # redirect to the same page on APP_URL. Health checks and form posts are left alone.
        if (app.config['PRODUCTION'] and request.host != canonical_host and request.method in ('GET', 'HEAD')
                and request.path != '/healthz'):
            return redirect(app.config['APP_URL'] + request.full_path.rstrip('?'), 301)
        if not app.config.get('TESTING'):
            start_maintenance(app)
        load_user()
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
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
                                       "font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; "
                                       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        })
        if app.config['PRODUCTION']:
            resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        if current_user():
            resp.headers['Cache-Control'] = 'no-store'
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
    def error(e):
        return render_template('error.html', code=e.code, message=e.description if e.code in (400, 429) else None), e.code

    @app.context_processor
    def globals_():
        return {'user': current_user(), 'csrf_token': session.get('csrf', ''), 'D': data, 'production': app.config['PRODUCTION'],
                'dev_inbox': not app.config['PRODUCTION'] and not app.config['RESEND_API_KEY'],
                'contact_email': app.config['CONTACT_EMAIL'], 'canonical': app.config['APP_URL'] + request.path,
                'app_url': app.config['APP_URL']}

    def page_url(page):
        args = [(k, v) for k, v in request.args.items(multi=True) if k != 'page'] + [('page', page)]
        return request.path + '?' + urlencode(args)

    app.jinja_env.add_extension('jinja2.ext.do')
    app.jinja_env.tests['section_message'] = lambda m: ' ' in m[0]  # category like 'error profile'
    app.jinja_env.globals.update(deadline_info=data.deadline_info, grade_label=data.grade_label, page_url=page_url)
    app.jinja_env.filters['fromjson'] = json.loads
    app.jinja_env.filters['day'] = lambda iso: (iso or '')[:10]

    register_cli(app)
    if not app.config.get('TESTING'):
        print(f"Open Ajar ready (production={app.config['PRODUCTION']}, db={app.config['DB_PATH']}, "
              f"email={'resend' if app.config['RESEND_API_KEY'] else 'dev inbox'})", flush=True)
    return app


def init_db(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect(path)
    db.execute('PRAGMA journal_mode = WAL')
    db.executescript((ROOT / 'schema.sql').read_text())
    # Columns added after launch: CREATE TABLE IF NOT EXISTS won't add them to an existing database.
    for table, col, ddl in (('users', 'school', "TEXT NOT NULL DEFAULT ''"), ('tracked', 'found_here', 'INTEGER')):
        if col not in {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f'ALTER TABLE {table} ADD COLUMN {col} {ddl}')
    db.commit()
    db.close()


_maintenance_started = False
_maintenance_lock = threading.Lock()


def start_maintenance(app):
    """Every 10 minutes: expire listings past their expiry date and send the daily deadline reminders.
    Started on the first request, inside the process that serves requests. Starting it when the app is created
    would put the thread in gunicorn's master process, and a process forked from one with a running thread can
    deadlock (which is exactly what hung the first Render deploys)."""
    global _maintenance_started
    with _maintenance_lock:
        if _maintenance_started:
            return
        _maintenance_started = True
    # ponytail: an in-process thread assumes one gunicorn worker (render.yaml uses -w 1); the reminder pass is
    # still guarded per-day in the database, so an accidental second process would not double-send
    def loop():
        while True:
            try:
                db = connect(app.config['DB_PATH'])
                expire_due(db)
                db.execute("DELETE FROM auth_tokens WHERE used=1 OR expires_at < datetime('now','-1 day')")
                db.commit()
                mail.run_reminders(db, app.config)
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
        """Run today's deadline reminder pass now (it normally runs on its own)."""
        db = connect(app.config['DB_PATH'])
        db.execute("DELETE FROM app_meta WHERE key='reminders'")
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
        if fx.get('set', {}).get('deadline_date') and not row['expires_at']:
            from datetime import date, timedelta
            clean['expires_at'] = (date.fromisoformat(clean['deadline_date']) + timedelta(days=2)).isoformat() + 'T00:00:00+00:00'
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
        opp_id = insert_opp(db, clean, status=status, source='import:' + (r.get('group') or 'sheet'), external_id=ext,
                            verification='source' if approve else 'unreviewed', published_at=data.now_iso() if approve else None)
        add_event(opp_id, None, 'imported', status, note)
        created += 1
    db.commit()
    for p in problems:
        click.echo('  skipped ' + p)
    return f'{created} added, {updated} refreshed, {live} already live (left alone), {len(problems)} skipped'

