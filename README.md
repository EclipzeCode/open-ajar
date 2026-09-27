# Open Ajar

Opportunity discovery and tracking for high-school students. Node 22.5+ only: **no third-party dependencies**
(built-in `node:http`, `node:sqlite`, `node:crypto`).

```bash
npm start                 # http://127.0.0.1:4173  (development mode seeds DEMO listings into an empty database)
npm test                  # 45 tests: auth, CSRF, roles, review workflow, sync, injection, email verification + reset, Resend adapter, spreadsheet import, bulk approve
npm run create-admin -- you@example.com     # hidden password prompt; also promotes an existing account
npm run purge:demo        # delete every demo listing
npm run import:sheet      # import data/opportunities.csv (see "Importing your spreadsheet")
npm run check:links       # check every URL in the CSV still responds
npm run email:test -- you@example.com   # send a real test email via Resend
```

## Layout

```
public/            static frontend (vanilla ES modules, hash routing, strict CSP: no inline scripts or styles)
  js/components/logo.js      TEMPORARY brand mark. The only place the logo lives. Replace it (and the favicon in index.html).
server/
  index.js, config.js
  http/            router, security headers, CSRF, rate limits, static file server
  auth/            scrypt passwords, RBAC (roles → permissions)
  routes/          auth, public, me (profile/saved/tracked), submissions, admin
  services/        opportunity review state machine, importer
  validation/      strict input validation, shared taxonomy (served to the client at /api/meta)
  repo/            ALL SQL lives here (sqlite/). Swap this folder to change databases.
  providers/       how listings get in from outside (demo.js, README.md)
  scripts/         create-admin, seed-demo, import
  test/            node:test suite
```

## Data: demo now, real later

- **Everything seeded today is fictional.** Titles start with `DEMO:`, organizations are "(fictional)", there are no URLs,
  and rows carry `is_demo = 1`. The UI labels them "Demo", detail pages show a banner, and Apply is disabled.
  Production never seeds unless `SEED_DEMO=1`. Remove with `npm run purge:demo`.
- **Real listings arrive two ways, and both start as `Pending Review`:**
  1. The submission form (`#/submit`).
  2. An importer: write `server/providers/<name>.js` (Airtable, a partner API, a Postgres table…) and run
     `node server/scripts/import.js <name>`. See `server/providers/README.md`. Imports are validated, idempotent
     (keyed by `source + external_id`), and can never publish directly.
- **Swapping the database:** implement `server/repo/postgres/index.js` with the same methods as `repo/sqlite/index.js`
  (schema is in `repo/sqlite/schema.sql`; use `jsonb`/`timestamptz`/`uuid`), then select it in `repo/index.js`.
  Routes and services never touch SQL.

## Importing your spreadsheet

```bash
python3 server/scripts/xlsx-to-csv.py ~/Downloads/open_ajar_opportunities.xlsx data/opportunities.csv   # .xlsx → CSV (standard library only)
npm run check:links       # are the URLs alive? (status codes only; a person still verifies the content)
npm run import:sheet      # loads data/opportunities.csv as Pending Review (or: npm run import:sheet -- other.csv)
```

**Later exports:** spreadsheet row ids get renumbered, so convert every export after the first with a batch label
(`python3 server/scripts/xlsx-to-csv.py new.xlsx data/opportunities-b2.csv --batch b2`, then `npm run import:sheet -- data/opportunities-b2.csv`).
The importer matches rows to existing listings by **title and link, not id**, skips anything already listed, refuses a row whose id now names a
different program, and **never modifies a listing that is already live**. `npm run check:links -- --pending` checks everything awaiting review.

Then sign in as an admin, open **Review**, filter by origin, spot-check, tick the listings you've verified and use **Approve selected**.
Google Sheets works too: File → Download → CSV, save it as `data/opportunities.csv`, and re-run the import (it updates existing rows by `id`
and never changes a listing's status). The tab a row came from is kept ("Import" vs "Recheck"), and each imported listing's history records
the sheet's `checked_on` date and any adjustments (unmapped tags dropped, blank cost set to "Varies"). `data/held-back.csv` lists rows
that were deliberately not imported, with the reason.

## Review workflow

`pending_review → approved | rejected | changes_requested`, and `approved → expired` (manual, or automatically after the
deadline). Reject and Request changes require a message the submitter sees. Submitters revise from `#/account` and resubmit.
Every decision is recorded in `review_events`. Only `approved`, non-expired listings are ever returned by the public API.

## Deadline reminders

A daily pass emails each student a short digest of upcoming deadlines for the opportunities they are tracking.
It runs inside the server's maintenance tick and is idempotent: at most one email per person per day, and each
(opportunity, deadline) is reminded only once (changing a deadline re-arms it). Only verified, opted-in users with
an early-stage tracked item (Interested or Preparing) whose deadline falls within `REMINDER_DAYS` (default 7) are
emailed. Students turn it off on their account page. Tune with `REMINDER_DAYS` and `REMINDERS_ENABLED` (see .env.example).

## Email (Resend)

Verification and password-reset emails go through `server/services/email/`. Nothing else in the app knows which provider is used:
routes call `accountEmails`, which calls `mailer.send(...)`. To swap providers, add a file exporting `{ name, send }` (see the contract at the top of
`resend.js`) and one `case` in `email/index.js`.

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Enables real sending via Resend. Keep it in the environment only, never in code or git. |
| `EMAIL_FROM` | Sender, e.g. `Open Ajar <hello@yourdomain.org>`. Must be on a domain you've verified in Resend. The default `onboarding@resend.dev` only delivers to your own Resend account email, so it's for first tests only. |
| `APP_URL` | Public address used in email links (`https://yourdomain.org`). Required in production. |

Without `RESEND_API_KEY`, the **console** provider records emails in memory and shows them at `#/dev/inbox` (development only; the server refuses to start
in production with it, and the inbox route disappears once a real provider is configured).

- Verification: sent at sign-up; link is single-use and lasts 24 hours. Unverified accounts can browse, save and track; **submitting requires a confirmed email**.
- Password reset: link is single-use and lasts 1 hour. A weak new password doesn't burn the link. Success signs out every device.
- Tokens are random, stored only as SHA-256 hashes, purpose-bound (a reset token can't verify an email), and travel in the URL fragment, which browsers don't send to servers. The page removes it from the address bar immediately.
- "Forgot password" answers identically whether or not the address has an account, doesn't wait on email sending (so timing doesn't leak either), and is limited to 3 emails per address per hour.
- A failing provider never blocks sign-up; the account page offers a resend, and failures are logged without message contents or keys.

## Accounts and roles

Roles: `student`, `organization`, `counselor`, `admin`. **Self-registration always creates a student**; the server ignores any
role in the request. Admins change roles at `#/admin/users` (changing a role or disabling an account signs that person out
everywhere; the last admin can't be removed; nobody can demote themselves). Routes check *permissions* via `can(user, perm)`,
never role names, so the future organization and counselor portals only need new permissions in `auth/rbac.js`.

## Security notes

- Passwords: scrypt (N=16384) with per-user salt; 10-char minimum, common-password check; constant-time comparison; a dummy
  hash is verified for unknown emails so login timing doesn't reveal which emails exist.
- Sessions: 256-bit random token in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production); only its SHA-256 is stored.
  New token at every sign-in; password change signs out other devices.
- CSRF: `Origin` must match, `Sec-Fetch-Site` must be same-origin, JSON content-type required, and every write needs the
  per-session `X-CSRF-Token`.
- CSP `default-src 'self'` (fonts from Google Fonts only), `frame-ancestors 'none'`, `nosniff`, HSTS in production.
- All SQL is parameterized; all output is inserted as text nodes; only `http(s)` URLs are accepted.
- Rate limits (per IP): global, writes, and auth attempts. Submissions are also limited per user. In-memory: use a shared store
  if you run more than one instance.

## Deploying to a real URL

The app is packaged for [Render](https://render.com), which gives a `https://<your-app>.onrender.com` address with no domain purchase.
`Dockerfile` and `render.yaml` (a Render Blueprint) are included.

1. Push this folder to a GitHub repo.
2. In Render: **New > Blueprint**, pick the repo. It reads `render.yaml` and creates the web service plus a 1 GB disk at `/data`.
   The disk needs the **Starter** plan (~$7/mo). On the free plan there is no disk, so the SQLite database (accounts, listings)
   is wiped on every deploy and restart, and the app sleeps after 15 min idle.
3. When prompted, fill in the secret env vars:
   - `APP_URL` = `https://<your-app>.onrender.com` (the exact URL Render shows you; used in email links)
   - `RESEND_API_KEY` = a key from https://resend.com/api-keys (required: the app refuses to start in production without one)
   - `EMAIL_FROM` = `Open Ajar <hello@yourdomain>` once you verify a domain in Resend (leave blank until then; the default
     sender only emails your own Resend address)
4. Deploy. Every push to the repo's default branch redeploys.
5. Create your admin account: service page > **Shell** tab, then run `node server/scripts/create-admin.js you@example.com`.

Your listings and accounts live on the disk, so they survive deploys. To load listings, open the **Shell** tab and run
`node server/scripts/import.js sheet <file>` (CSVs under `data/` are excluded from the image by `.dockerignore`, so upload
the file first, e.g. via `curl` from a URL, or remove that line from `.dockerignore`).

**A real domain (optional):** buy one from any registrar (~$12/yr), add it under the service's **Settings > Custom Domains**,
point DNS as shown, and set `APP_URL=https://yourdomain.org`.

## Before going live

- Put it behind HTTPS (reverse proxy) with `NODE_ENV=production` and `TRUST_PROXY=1`. Cookies become `Secure` automatically.
- Create your admin with `npm run create-admin`; there is no default account.
- Back up `var/openajar.db` (or move to Postgres). It contains password hashes and contact emails.
- Set `RESEND_API_KEY`, `EMAIL_FROM` (a verified domain), and `APP_URL`; send yourself a reset email before launch.
- Not built yet: the organization and counselor portals, and a shared rate-limit store.
