// Storage driver. SQLite locally by default; Postgres (Supabase) when
// DATABASE_URL is set. Both expose the same async interface so nothing above
// this file knows or cares which is in use.
//
// Queries are written once using `?` placeholders and SQLite-ish SQL; the
// Postgres driver translates placeholders to $1..$n. Where the dialects
// genuinely differ (auto-increment, INSERT OR IGNORE) the schema and the few
// affected statements are branched explicitly.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), '..');

/** Minimal .env loader — avoids a dependency and keeps secrets out of the repo. */
function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v.replace(/^﻿/, '');
  }
}
loadEnv();

/**
 * Environment values arrive from many places — .env files, CI, Vercel's
 * dashboard, a shell pipe — and any of them can prepend a UTF-8 BOM or leave
 * stray whitespace. A BOM in front of a connection string makes `new URL()`
 * throw and sends the driver looking for a nonsense host, so clean on read.
 */
export function cleanEnv(v) {
  return String(v ?? '').replace(/^﻿/, '').replace(/^\s+|\s+$/g, '');
}

export const DATABASE_URL = cleanEnv(process.env.DATABASE_URL);
export const isPostgres = !!DATABASE_URL;

let impl = null;

async function init() {
  if (impl) return impl;
  impl = isPostgres ? await initPostgres() : await initSqlite();
  await impl.migrate();
  return impl;
}

/* ------------------------------------------------------------------ */
/*  SQLite                                                             */
/* ------------------------------------------------------------------ */

async function initSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  const db = new DatabaseSync(join(ROOT, 'data', 'shortlist.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  return {
    kind: 'sqlite',
    async query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async one(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    /** Insert and return the new id. */
    async insertReturningId(sql, params = []) {
      db.prepare(sql).run(...params);
      return db.prepare('SELECT last_insert_rowid() AS id').get().id;
    },
    async exec(sql) {
      db.exec(sql);
    },
    async migrate() {
      db.exec(SCHEMA_SQLITE);
      // Best-effort column adds for pre-existing tables (SQLite has no
      // ADD COLUMN IF NOT EXISTS, so a duplicate throws and is ignored).
      for (const stmt of MIGRATIONS) { try { db.exec(stmt); } catch { /* already applied */ } }
    },
    async close() {
      db.close();
    },
  };
}

// node:sqlite is imported lazily (Node 22+ only), so the Postgres path still
// works on runtimes that lack it.

/* ------------------------------------------------------------------ */
/*  Postgres                                                           */
/* ------------------------------------------------------------------ */

async function initPostgres() {
  const pg = await import('pg');
  const { Pool } = pg.default ?? pg;

  const pool = new Pool({
    connectionString: DATABASE_URL,
    // Supabase requires TLS; its pooler presents a cert this client won't
    // chain-verify, which is standard for managed Postgres connections.
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });

  /** `?` -> `$1..$n` */
  const tr = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  return {
    kind: 'postgres',
    async query(sql, params = []) {
      const r = await pool.query(tr(sql), params);
      return r.rows;
    },
    async one(sql, params = []) {
      const r = await pool.query(tr(sql), params);
      return r.rows[0] ?? null;
    },
    async run(sql, params = []) {
      await pool.query(tr(sql), params);
    },
    async insertReturningId(sql, params = []) {
      const r = await pool.query(`${tr(sql)} RETURNING id`, params);
      return r.rows[0].id;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async migrate() {
      await pool.query(SCHEMA_POSTGRES);
      for (const stmt of MIGRATIONS) {
        try { await pool.query(stmt.replace(/ADD COLUMN /i, 'ADD COLUMN IF NOT EXISTS ')); }
        catch { /* already applied */ }
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const TABLES = (pk, json) => `
  CREATE TABLE IF NOT EXISTS companies (
    id               ${pk},
    name             TEXT NOT NULL,
    normalized_name  TEXT NOT NULL,
    ats_type         TEXT NOT NULL,
    ats_slug         TEXT NOT NULL,
    board_status     TEXT NOT NULL DEFAULT 'unknown',
    board_last_ok_at TEXT,
    last_total       INTEGER DEFAULT 0,
    last_india       INTEGER DEFAULT 0,
    checked_at       TEXT,
    UNIQUE(ats_type, ats_slug)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id             ${pk},
    user_id        TEXT NOT NULL DEFAULT 'local',
    started_at     TEXT NOT NULL,
    finished_at    TEXT,
    per_source     ${json},
    n_fetched      INTEGER DEFAULT 0,
    n_after_india  INTEGER DEFAULT 0,
    n_after_dedupe INTEGER DEFAULT 0,
    n_new          INTEGER DEFAULT 0,
    n_scored       INTEGER DEFAULT 0,
    n_links_dead   INTEGER DEFAULT 0,
    n_reported     INTEGER DEFAULT 0,
    errors         ${json},
    report_path    TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id                ${pk},
    fingerprint       TEXT NOT NULL UNIQUE,
    source            TEXT NOT NULL,
    source_job_id     TEXT,
    title             TEXT NOT NULL,
    company           TEXT NOT NULL,
    company_id        INTEGER,
    location_raw      TEXT,
    city              TEXT,
    work_mode         TEXT,
    employment_type   TEXT,
    min_exp           REAL,
    max_exp           REAL,
    salary_raw        TEXT,
    jd_text           TEXT,
    skills_required   ${json},
    skills_nice       ${json},
    apply_url         TEXT NOT NULL,
    final_url         TEXT,
    link_status       TEXT NOT NULL DEFAULT 'UNCHECKED',
    link_checked_at   TEXT,
    posted_at         TEXT,
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    alt_links         ${json},
    applicants        INTEGER,
    applicants_source TEXT
  );

  CREATE TABLE IF NOT EXISTS job_matches (
    id                 ${pk},
    user_id            TEXT NOT NULL DEFAULT 'local',
    fingerprint        TEXT NOT NULL,
    job_id             INTEGER NOT NULL,
    run_id             INTEGER,
    score              REAL NOT NULL,
    breakdown          ${json},
    skills_matched     ${json},
    skills_missing     ${json},
    exp_gap            TEXT,
    recommendation     TEXT,
    why_text           TEXT,
    competition        TEXT,
    competition_reason TEXT,
    created_at         TEXT NOT NULL,
    UNIQUE(user_id, fingerprint)
  );

  CREATE TABLE IF NOT EXISTS resumes (
    id          ${pk},
    user_id     TEXT NOT NULL,
    filename    TEXT,
    kind        TEXT,
    content_b64 TEXT,
    parsed_json ${json},
    is_default  INTEGER DEFAULT 1,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT,
    is_admin      INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS ingest_runs (
    id            ${pk},
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    per_source    ${json},
    n_fetched     INTEGER DEFAULT 0,
    n_after_india INTEGER DEFAULT 0,
    n_new         INTEGER DEFAULT 0,
    pool_size     INTEGER DEFAULT 0,
    errors        ${json}
  );

  CREATE TABLE IF NOT EXISTS secrets (
    id         ${pk},
    name       TEXT NOT NULL UNIQUE,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_digests (
    id          ${pk},
    run_id      INTEGER,
    recipients  ${json},
    cc          ${json},
    provider_id TEXT,
    error       TEXT,
    n_jobs      INTEGER DEFAULT 0,
    sent_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id         ${pk},
    user_id    TEXT NOT NULL UNIQUE,
    data       ${json},
    updated_at TEXT NOT NULL
  );

  -- Jobs a user approved, as the apply worker works through them.
  -- status: queued | running | needs_user | captcha | submitted | failed | skipped | dry_run
  CREATE TABLE IF NOT EXISTS apply_queue (
    id          ${pk},
    user_id     TEXT NOT NULL,
    match_id    INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    attempts    INTEGER NOT NULL DEFAULT 0,
    reason      TEXT,
    detail      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, fingerprint)
  );

  -- Job-related emails found in a user's job-hunt inbox.
  -- category: received | rejection | interview | assessment | info_request | offer | other
  -- reply_status: none | drafted | approved | sent | dismissed | failed
  CREATE TABLE IF NOT EXISTS inbox_events (
    id           ${pk},
    user_id      TEXT NOT NULL,
    uid          TEXT NOT NULL,
    queue_id     INTEGER,
    company      TEXT,
    from_addr    TEXT,
    subject      TEXT,
    category     TEXT NOT NULL,
    summary      TEXT,
    draft_reply  TEXT,
    reply_status TEXT NOT NULL DEFAULT 'none',
    message_id   TEXT,
    received_at  TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE(user_id, uid)
  );

  -- Follow-ups the agent writes when a recruiter thread goes quiet (worker/followups.js).
  -- status: drafted | approved | sent | dismissed | failed
  CREATE TABLE IF NOT EXISTS followups (
    id            ${pk},
    user_id       TEXT NOT NULL,
    event_id      INTEGER NOT NULL,
    queue_id      INTEGER,
    to_addr       TEXT NOT NULL,
    subject       TEXT,
    in_reply_to   TEXT,
    body          TEXT NOT NULL,
    n             INTEGER NOT NULL,
    auto          INTEGER,
    status        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    sent_at       TEXT
  );

  -- Metered job APIs (JSearch…): calls this month, pauses after quota/refusal
  -- errors, and when each term was last searched (src/lib/quota.js).
  CREATE TABLE IF NOT EXISTS api_usage (
    adapter       TEXT PRIMARY KEY,
    period        TEXT NOT NULL,
    calls         INTEGER NOT NULL DEFAULT 0,
    blocked_until TEXT,
    last_error    TEXT,
    recent        TEXT,
    updated_at    TEXT NOT NULL
  );

  -- How reputed an employer is (src/lib/premium.js), rated once per company name.
  CREATE TABLE IF NOT EXISTS company_ratings (
    name          TEXT PRIMARY KEY,
    tier          INTEGER,
    pay           TEXT,
    staffing      INTEGER,
    note          TEXT,
    rated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id          ${pk},
    user_id     TEXT NOT NULL DEFAULT 'local',
    fingerprint TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'applied',
    applied_at  TEXT,
    notes       TEXT,
    UNIQUE(user_id, fingerprint)
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_fp       ON jobs(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_matches_run   ON job_matches(run_id);
  CREATE INDEX IF NOT EXISTS idx_matches_score ON job_matches(score DESC);
  CREATE INDEX IF NOT EXISTS idx_companies_ats ON companies(ats_type, board_status);
`;

const SCHEMA_SQLITE = TABLES('INTEGER PRIMARY KEY', 'TEXT');
const SCHEMA_POSTGRES = TABLES('BIGSERIAL PRIMARY KEY', 'TEXT');

// Idempotent column adds for tables that predate a new column.
const MIGRATIONS = [
  "ALTER TABLE runs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'",
  // Multi-country: ISO code of the job's country. Rows from before are India.
  "ALTER TABLE jobs ADD COLUMN country TEXT NOT NULL DEFAULT 'IN'",
  // Approve/skip from Telegram (or the report): what the apply agent acts on.
  'ALTER TABLE job_matches ADD COLUMN decision TEXT',
  'ALTER TABLE job_matches ADD COLUMN decided_at TEXT',
  // Where the agent can apply for this job (JSON from lib/apply-route.js), cached.
  'ALTER TABLE jobs ADD COLUMN apply_route TEXT',
  // The CV actually used for each application (tailored), for the Applications page.
  'ALTER TABLE apply_queue ADD COLUMN cv_name TEXT',
  'ALTER TABLE apply_queue ADD COLUMN cv_b64 TEXT',
  // The employer posting an application goes to (ats:board:id), so one posting is applied to once.
  'ALTER TABLE apply_queue ADD COLUMN dest_key TEXT',
  // The CV tailored for a match when its card is sent, with its ATS keyword scores, so the
  // card shows the score of the exact CV the agent will send.
  'ALTER TABLE job_matches ADD COLUMN ats_before INTEGER',
  'ALTER TABLE job_matches ADD COLUMN ats_after INTEGER',
  'ALTER TABLE job_matches ADD COLUMN tailor_added TEXT',
  'ALTER TABLE job_matches ADD COLUMN tailored_cv_b64 TEXT',
  // Recruiter replies: what the email asked for, whether the reply went out on its own,
  // whether the CV goes with it, and when it was sent.
  'ALTER TABLE inbox_events ADD COLUMN asks TEXT',
  'ALTER TABLE inbox_events ADD COLUMN auto_reply INTEGER',
  'ALTER TABLE inbox_events ADD COLUMN attach_cv INTEGER',
  'ALTER TABLE inbox_events ADD COLUMN sent_at TEXT',
];

/* ------------------------------------------------------------------ */

export async function db() {
  return init();
}

/** `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` differ between dialects. */
export function insertIgnore(table, cols) {
  const ph = cols.map(() => '?').join(',');
  return isPostgres
    ? `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT DO NOTHING`
    : `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${ph})`;
}

export const now = () => new Date().toISOString();
