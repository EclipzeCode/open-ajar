-- Open Ajar schema (SQLite dialect). A PostgreSQL adapter would use the same tables:
-- swap TEXT ids for uuid, TEXT JSON columns for jsonb, TEXT timestamps for timestamptz.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','organization','counselor','admin')),
  display_name  TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0,
  email_verified_at TEXT,
  email_reminders INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  grade      INTEGER,
  interests  TEXT NOT NULL DEFAULT '[]',
  location   TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- id is the SHA-256 of the session token; the raw token exists only in the user's cookie.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS opportunities (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  org_name        TEXT NOT NULL,
  type            TEXT NOT NULL,
  summary         TEXT NOT NULL,
  eligibility     TEXT NOT NULL DEFAULT '',
  requirements    TEXT NOT NULL DEFAULT '[]',
  interests       TEXT NOT NULL DEFAULT '[]',
  grades          TEXT NOT NULL DEFAULT '[]',
  cost            TEXT NOT NULL,
  cost_note       TEXT NOT NULL DEFAULT '',
  format          TEXT NOT NULL,
  location        TEXT NOT NULL DEFAULT '',
  state           TEXT,
  commitment      TEXT NOT NULL,
  commitment_note TEXT NOT NULL DEFAULT '',
  deadline_date   TEXT,
  deadline_note   TEXT NOT NULL DEFAULT '',
  url             TEXT,
  verification    TEXT NOT NULL DEFAULT 'unreviewed' CHECK (verification IN ('unreviewed','source','verified','demo')),
  status          TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','changes_requested','approved','rejected','expired')),
  is_demo         INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'submission',      -- 'submission' | 'demo' | 'import:<provider>'
  external_id     TEXT,                                    -- id in the upstream system, for idempotent imports
  submitted_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_email   TEXT,
  relationship    TEXT,
  reviewer_message TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  published_at    TEXT,
  expires_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opp_submitter ON opportunities(submitted_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opp_external ON opportunities(source, external_id) WHERE external_id IS NOT NULL;

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
  added_at       TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  reminded_at    TEXT,
  reminded_for   TEXT,
  PRIMARY KEY (user_id, opportunity_id)
);

-- Every review decision, visible to the submitter (message) and to admins.
CREATE TABLE IF NOT EXISTS review_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  message        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_opp ON review_events(opportunity_id);

-- Security-relevant actions outside opportunity review (role changes, disabling accounts).
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

-- Single-use, expiring tokens for email verification and password reset. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, purpose);

-- Small key/value store for scheduler bookkeeping (e.g. last reminder run date).
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Students applying to join Open Ajar's intern pool. Reviewed by admins, then placed with partner companies.
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
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intern_status ON intern_applications(status);

-- Community Voices: short quotes submitted by signed-in students, shown after a reviewer approves them.
CREATE TABLE IF NOT EXISTS testimonials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  role_label  TEXT NOT NULL DEFAULT '',
  quote       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  is_demo     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_testimonial_status ON testimonials(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_testimonial_user ON testimonials(user_id) WHERE user_id IS NOT NULL;
