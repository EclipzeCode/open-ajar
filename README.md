# OpenAjar

Opportunity discovery and tracking for high-school students. **Flask + SQLite + plain HTML/CSS/JS.** No build step.

## Run it locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/flask --app app import-csv --approve data/opportunities.csv data/opportunities-b2.csv data/opportunities-b3-filled.csv data/jobs-clean.csv data/jobs3-clean.csv
.venv/bin/flask --app app create-admin you@example.com
.venv/bin/flask --app app run --debug --port 5050
```

Open http://127.0.0.1:5050. Without a `RESEND_API_KEY`, emails aren't sent; they show up at `/dev/inbox` instead.

Tests: `.venv/bin/python -m unittest`

## Where things are

| File | What it does |
| --- | --- |
| `app.py` | Creates the app: settings, security headers, CSRF check, the 10-minute maintenance timer, and the `flask` commands |
| `site_pages.py` | Public pages: home, browse, listing detail, save/track, submit, intern application, About/Team/Support/legal |
| `account.py` | Sign up/in/out, email confirmation, password reset, account page, tracker |
| `admin.py` | Review queue, editing, approve/reject/request changes, users, activity, intern applications, community quotes |
| `core.py` | Database helpers, the signed-in user, rate limits, listing search |
| `data.py` | Categories (types, interests, states…), form validation, spreadsheet import mapping |
| `mail.py` | Sending through Resend, the three email templates, daily deadline reminders |
| `schema.sql` | The database tables |
| `templates/` | One HTML file per page. Support figures are edited right in `support.html` |
| `static/` | `style.css`, `app.js` (small extras; every page works without it), images |

## Commands

```bash
flask --app app create-admin you@example.com          # make (or promote) an admin; there is no default admin
flask --app app import-csv data/new.csv                # add spreadsheet rows to the review queue
flask --app app import-csv --approve data/new.csv      # ...or publish them straight away
flask --app app send-reminders                         # run today's deadline-reminder emails now
python3 xlsx-to-csv.py ~/Downloads/sheet.xlsx data/new.csv --batch b4   # convert an Excel export first
```

The importer never changes a listing that's already live, skips rows that describe a program already listed (same title and
organization at the same location, or the same link with a near-identical title), and reports invalid rows instead of saving them.

## How listings work

Every listing starts as **Pending review**. Admins approve, reject, or ask for changes (rejecting and asking for changes need a note,
which the submitter sees on their account page and can respond to by revising). Approved listings with a deadline hide themselves two
days after it. Submitting needs a confirmed email.

## Deploying on Render

`render.yaml` sets everything up: a Python web service with a 1 GB disk at `/data` for the database (Starter plan, about $7/month).

1. Render → **New → Blueprint** → pick this repo.
2. Fill in `APP_URL` (`https://<name>.onrender.com`) and `RESEND_API_KEY`. `EMAIL_FROM` can stay blank until you verify a domain in Resend.
3. After the first deploy, open the service's **Shell** tab and run:
   ```bash
   flask --app app create-admin you@example.com
   flask --app app import-csv --approve data/opportunities.csv data/opportunities-b2.csv data/opportunities-b3-filled.csv data/jobs-clean.csv data/jobs3-clean.csv
   ```

Leave out `--approve` if you'd rather check the listings in the review queue before they go live.

## Security notes

- Passwords are hashed (scrypt via Werkzeug). Login checks a dummy hash for unknown emails so timing doesn't reveal who has an account.
- The login cookie is signed, HttpOnly, SameSite=Lax and Secure in production. Changing your password, resetting it, or an admin changing
  your role signs you out on every device.
- Every form carries a CSRF token. Security headers include a strict Content-Security-Policy (no inline scripts).
- Email links are single-use, expire (24h verify, 1h reset), and are stored only as SHA-256 hashes. Opening a link doesn't use it up;
  pressing the button on the page does, so email scanners can't spend it.
- Rate limits on sign-in, sign-up, password reset, submissions and intern applications. Sign-in limits are generous per network
  address (a whole school can share one) and tight per account. They're in memory, which is why Render runs one worker.
- Emails sent while a page loads go out on a background thread, so pages don't wait on Resend and "forgot password" answers
  just as fast for any address.
