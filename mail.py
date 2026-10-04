"""Email: sending (Resend, or an in-memory outbox in development), the three templates, and deadline reminders."""
import json
import urllib.request
from datetime import date
from html import escape

from data import parse_date

OUTBOX = []  # development only: shown at /dev/inbox when no RESEND_API_KEY is set


def send(config, to, subject, html, text):
    if not config['RESEND_API_KEY']:
        OUTBOX.insert(0, {'to': to, 'subject': subject, 'text': text})
        del OUTBOX[50:]
        return
    req = urllib.request.Request(
        'https://api.resend.com/emails', method='POST',
        data=json.dumps({'from': config['EMAIL_FROM'], 'to': [to], 'subject': subject, 'html': html, 'text': text}).encode(),
        headers={'Authorization': f"Bearer {config['RESEND_API_KEY']}", 'Content-Type': 'application/json',
                 'User-Agent': 'open-ajar'})
    with urllib.request.urlopen(req, timeout=10) as r:
        if r.status >= 300:
            raise RuntimeError(f'Resend answered {r.status}')


def _layout(heading, paragraphs, button, link, footer, extra_html='', extra_text=''):
    ps = ''.join(f'<p style="font-size:16px;line-height:1.55;margin:0 0 16px">{escape(p)}</p>' for p in paragraphs)
    html = f'''<!doctype html><html lang="en"><body style="margin:0;background:#FAF7F2;color:#1C1B18;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:20px;font-weight:700;margin:0 0 24px">Open Ajar</p>
<h1 style="font-size:26px;line-height:1.2;margin:0 0 16px">{escape(heading)}</h1>{ps}{extra_html}
<p style="margin:24px 0"><a href="{escape(link)}" style="background:#1F5C4A;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:600;display:inline-block">{escape(button)}</a></p>
<p style="font-size:14px;color:#6B675E;margin:0 0 8px">Or paste this link into your browser:<br><span style="word-break:break-all">{escape(link)}</span></p>
<p style="font-size:14px;color:#6B675E;margin:24px 0 0">{escape(footer)}</p></div></body></html>'''
    text = f"{heading}\n\n" + '\n\n'.join(paragraphs) + f"\n{extra_text}\n{button}: {link}\n\n{footer}\n\nOpen Ajar"
    return html, text


def _first(name):
    return (name or '').split()[0] if (name or '').split() else 'there'


def verify_email(config, user, link):
    send(config, user['email'], 'Confirm your email for Open Ajar', *_layout(
        f"Welcome, {_first(user['name'])}.",
        ['Confirm your email address to finish setting up your Open Ajar account. You’ll need this before you can submit an opportunity.',
         'This link works once and expires in 24 hours.'],
        'Confirm my email', link, 'If you didn’t create an Open Ajar account, you can ignore this email.'))


def reset_password(config, user, link):
    send(config, user['email'], 'Reset your Open Ajar password', *_layout(
        'Reset your password',
        [f"Hi {_first(user['name'])}, we got a request to reset the password for your Open Ajar account.",
         'This link works once and expires in 1 hour. After you choose a new password, you’ll be signed out everywhere.'],
        'Choose a new password', link, 'If you didn’t ask for this, ignore this email. Your password won’t change.'))


def _when(days):
    return 'due today' if days == 0 else 'due tomorrow' if days == 1 else f'due in {days} days'


def deadline_digest(config, email, name, items):
    one = len(items) == 1
    subject = f"Reminder: {items[0]['title']} is {_when(items[0]['days'])}" if one else f'You have {len(items)} deadlines coming up'
    li = ''.join(f'''<li style="margin:0 0 10px"><a href="{escape(config['APP_URL'])}/o/{escape(it['id'])}" style="color:#1C1B18;font-weight:600">{escape(it['title'])}</a><br>
<span style="color:#6B675E;font-size:14px">{escape(_when(it['days']).capitalize())} · {escape(it['deadline'])}</span></li>''' for it in items)
    text = '\n'.join(f"- {it['title']} ({_when(it['days'])}, {it['deadline']})" for it in items)
    send(config, email, subject, *_layout(
        f"{_first(name)}, {'a deadline is' if one else f'{len(items)} deadlines are'} coming up.",
        ['These are opportunities you’re tracking on Open Ajar. Confirm the exact deadline on the official page before you rely on it.'],
        'Open your tracker', config['APP_URL'] + '/tracker',
        'You get these because you’re tracking these opportunities. Turn reminders off any time on your account page.',
        f'<ul style="padding-left:18px;margin:0 0 20px">{li}</ul>', text + '\n'))


def run_reminders(db, config, today=None):
    """Emails each student one digest of upcoming deadlines. Runs at most once a day; each deadline is reminded once."""
    today = today or date.today()
    if not config['REMINDERS_ENABLED'] or db.execute("SELECT 1 FROM app_meta WHERE key='reminders' AND value=?", (today.isoformat(),)).fetchone():
        return 0
    db.execute("INSERT INTO app_meta (key,value) VALUES ('reminders',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (today.isoformat(),))
    db.commit()
    rows = db.execute('''SELECT t.user_id, t.opportunity_id, t.deadline own, t.reminded_for, o.title, o.deadline_date, u.email, u.name
        FROM tracked t JOIN opportunities o ON o.id = t.opportunity_id AND o.status = 'approved' JOIN users u ON u.id = t.user_id
        WHERE u.disabled = 0 AND u.email_verified = 1 AND u.email_reminders = 1 AND t.stage IN ('Interested','Preparing')''').fetchall()
    by_user = {}
    for r in rows:
        deadline = (r['own'] or r['deadline_date'] or '')[:10]
        d = parse_date(deadline)
        if not d or r['reminded_for'] == deadline or not 0 <= (d - today).days <= config['REMINDER_DAYS']:
            continue
        by_user.setdefault(r['user_id'], (r['email'], r['name'], []))[2].append(
            {'id': r['opportunity_id'], 'title': r['title'], 'deadline': deadline, 'days': (d - today).days})
    sent = 0
    for user_id, (email, name, items) in by_user.items():
        items.sort(key=lambda it: it['days'])
        try:
            deadline_digest(config, email, name, items)
        except Exception as e:  # one bad address must not stop the rest
            print(f'[reminders] failed to email {email}: {e}')
            continue
        db.executemany('UPDATE tracked SET reminded_for=? WHERE user_id=? AND opportunity_id=?',
                       [(it['deadline'], user_id, it['id']) for it in items])
        db.commit()
        sent += 1
    return sent
