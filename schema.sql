-- Open Ajar schema (SQLite). Lists (grades, interests, requirements, checklist) are stored as JSON text.

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','organization','counselor','admin')),
  name             TEXT NOT NULL,
  disabled         INTEGER NOT NULL DEFAULT 0,
  email_verified   INTEGER NOT NULL DEFAULT 0,
  email_reminders  INTEGER NOT NULL DEFAULT 1,
  session_version  INTEGER NOT NULL DEFAULT 1,  -- bump to sign the user out everywhere
  grade            INTEGER,
  interests        TEXT NOT NULL DEFAULT '[]',
  location         TEXT NOT NULL DEFAULT '',
  school           TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  org              TEXT NOT NULL,
  type             TEXT NOT NULL,
  summary          TEXT NOT NULL,
  eligibility      TEXT NOT NULL DEFAULT '',
  requirements     TEXT NOT NULL DEFAULT '[]',
  interests        TEXT NOT NULL DEFAULT '[]',
  grades           TEXT NOT NULL DEFAULT '[]',
  cost             TEXT NOT NULL,
  cost_note        TEXT NOT NULL DEFAULT '',
  format           TEXT NOT NULL,
  location         TEXT NOT NULL DEFAULT '',
  state            TEXT,
  commitment       TEXT NOT NULL,
  commitment_note  TEXT NOT NULL DEFAULT '',
  deadline_date    TEXT,
  deadline_note    TEXT NOT NULL DEFAULT '',
  url              TEXT,
  verification     TEXT NOT NULL DEFAULT 'unreviewed' CHECK (verification IN ('unreviewed','source','verified')),
  status           TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','changes_requested','approved','rejected','expired')),
  source           TEXT NOT NULL DEFAULT 'submission',   -- 'submission' | 'import:<group>'
  external_id      TEXT,                                 -- row id from an imported spreadsheet
  submitted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_email    TEXT,
  relationship     TEXT,
  reviewer_message TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  published_at     TEXT,
  expires_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opp_submitter ON opportunities(submitted_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_external ON opportunities(external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS saved (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS tracked (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL DEFAULT 'Interested',
  notes          TEXT NOT NULL DEFAULT '',
  deadline       TEXT NOT NULL DEFAULT '',
  checklist      TEXT NOT NULL DEFAULT '[]',
  reminded_for   TEXT,                -- the deadline we last emailed about, so each deadline is reminded once
  found_here     INTEGER,             -- once Accepted: did they find it on Open Ajar? 1 yes, 0 no, NULL not asked yet
  added_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, opportunity_id)
);

-- Every review decision on a listing. Messages are shown to the submitter.
CREATE TABLE IF NOT EXISTS review_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  to_status      TEXT,
  message        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_opp ON review_events(opportunity_id);

-- Account actions outside listing review (role changes, password resets, deletions).
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Single-use email verification / password reset tokens. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intern_applications (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT NOT NULL,
  grade        INTEGER,
  school       TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  interests    TEXT NOT NULL DEFAULT '[]',
  skills       TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT '',
  statement    TEXT NOT NULL DEFAULT '',
  link         TEXT,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','placed','declined')),
  admin_note   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- Businesses asking to host an intern, from the Partner with us form. Admins work them under Admin > Partner inquiries.
CREATE TABLE IF NOT EXISTS partner_inquiries (
  id           TEXT PRIMARY KEY,
  business     TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','partnered','declined')),
  admin_note   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

-- Messages from the Contact form in the footer. Admins read and answer them under Admin > Messages.
CREATE TABLE IF NOT EXISTS contact_messages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  topic       TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','closed')),
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- Community Voices: one quote per student, shown after an admin approves it.
CREATE TABLE IF NOT EXISTS testimonials (
  id         TEXT PRIMARY KEY,
  user_id    TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  role_label TEXT NOT NULL DEFAULT '',
  quote      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  updated_at TEXT NOT NULL
);

-- One row per user per day they used the site while signed in, for active-user stats.
CREATE TABLE IF NOT EXISTS user_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
);
