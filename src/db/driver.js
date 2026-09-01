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
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

export const DATABASE_URL = process.env.DATABASE_URL || '';
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
