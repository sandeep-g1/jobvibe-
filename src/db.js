// SQLite via node:sqlite (built into Node 22+). No dependencies.
// Schema mirrors the Postgres design in the architecture doc; UNIQUE(user_id,
// fingerprint) on job_matches is the zero-duplicate guarantee.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'shortlist.db');

let db = null;

export function getDB() {
  if (db) return db;
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id               INTEGER PRIMARY KEY,
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
      id             INTEGER PRIMARY KEY,
      started_at     TEXT NOT NULL,
      finished_at    TEXT,
      per_source     TEXT,
      n_fetched      INTEGER DEFAULT 0,
      n_after_india  INTEGER DEFAULT 0,
      n_after_dedupe INTEGER DEFAULT 0,
      n_new          INTEGER DEFAULT 0,
      n_scored       INTEGER DEFAULT 0,
      n_links_dead   INTEGER DEFAULT 0,
      n_reported     INTEGER DEFAULT 0,
      errors         TEXT,
      report_path    TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id               INTEGER PRIMARY KEY,
      fingerprint      TEXT NOT NULL UNIQUE,
      source           TEXT NOT NULL,
      source_job_id    TEXT,
      title            TEXT NOT NULL,
      company          TEXT NOT NULL,
      company_id       INTEGER REFERENCES companies(id),
      location_raw     TEXT,
      city             TEXT,
      work_mode        TEXT,
      employment_type  TEXT,
      min_exp          REAL,
      max_exp          REAL,
      salary_raw       TEXT,
      jd_text          TEXT,
      skills_required  TEXT,
      skills_nice      TEXT,
      apply_url        TEXT NOT NULL,
      final_url        TEXT,
      link_status      TEXT NOT NULL DEFAULT 'UNCHECKED',
      link_checked_at  TEXT,
      posted_at        TEXT,
      first_seen_at    TEXT NOT NULL,
      last_seen_at     TEXT NOT NULL,
      alt_links        TEXT,
      applicants       INTEGER,
      applicants_source TEXT
    );

    CREATE TABLE IF NOT EXISTS job_matches (
      id                 INTEGER PRIMARY KEY,
      user_id            TEXT NOT NULL DEFAULT 'local',
      fingerprint        TEXT NOT NULL,
      job_id             INTEGER NOT NULL REFERENCES jobs(id),
      run_id             INTEGER REFERENCES runs(id),
      score              REAL NOT NULL,
      breakdown          TEXT,
      skills_matched     TEXT,
      skills_missing     TEXT,
      exp_gap            TEXT,
      recommendation     TEXT,
      why_text           TEXT,
      competition        TEXT,
      competition_reason TEXT,
      created_at         TEXT NOT NULL,
      UNIQUE(user_id, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS applications (
      id          INTEGER PRIMARY KEY,
      user_id     TEXT NOT NULL DEFAULT 'local',
      fingerprint TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'applied',
      applied_at  TEXT,
      notes       TEXT,
      UNIQUE(user_id, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_fp        ON jobs(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_matches_run    ON job_matches(run_id);
    CREATE INDEX IF NOT EXISTS idx_matches_score  ON job_matches(score DESC);
    CREATE INDEX IF NOT EXISTS idx_companies_ats  ON companies(ats_type, board_status);
  `);
}

export const now = () => new Date().toISOString();

/* ---------------- companies ---------------- */

export function upsertCompany(c) {
  const d = getDB();
  d.prepare(
    `INSERT INTO companies (name, normalized_name, ats_type, ats_slug, board_status,
                            board_last_ok_at, last_total, last_india, checked_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ats_type, ats_slug) DO UPDATE SET
       name=excluded.name, board_status=excluded.board_status,
       board_last_ok_at=COALESCE(excluded.board_last_ok_at, companies.board_last_ok_at),
       last_total=excluded.last_total, last_india=excluded.last_india,
       checked_at=excluded.checked_at`
  ).run(
    c.name, c.normalized_name, c.ats_type, c.ats_slug, c.board_status,
    c.board_last_ok_at ?? null, c.last_total ?? 0, c.last_india ?? 0, c.checked_at ?? now()
  );
}

export function liveCompanies(sources) {
  const d = getDB();
  const rows = d.prepare(
    `SELECT * FROM companies WHERE board_status = 'live' ORDER BY last_india DESC, name`
  ).all();
  if (!sources?.length) return rows;
  const set = new Set(sources);
  return rows.filter((r) => set.has(r.ats_type));
}

/* ---------------- runs ---------------- */

export function startRun() {
  const d = getDB();
  d.prepare('INSERT INTO runs (started_at) VALUES (?)').run(now());
  return d.prepare('SELECT last_insert_rowid() AS id').get().id;
}

export function finishRun(runId, stats) {
  getDB().prepare(
    `UPDATE runs SET finished_at=?, per_source=?, n_fetched=?, n_after_india=?,
       n_after_dedupe=?, n_new=?, n_scored=?, n_links_dead=?, n_reported=?,
       errors=?, report_path=? WHERE id=?`
  ).run(
    now(), JSON.stringify(stats.perSource || {}), stats.fetched | 0, stats.afterIndia | 0,
    stats.afterDedupe | 0, stats.newJobs | 0, stats.scored | 0, stats.linksDead | 0,
    stats.reported | 0, JSON.stringify(stats.errors || []), stats.reportPath || null, runId
  );
}

/* ---------------- jobs ---------------- */

/** Returns { id, isNew }. Existing rows get last_seen_at refreshed and links merged. */
export function upsertJob(j) {
  const d = getDB();
  const existing = d.prepare('SELECT id, alt_links FROM jobs WHERE fingerprint = ?').get(j.fingerprint);

  if (existing) {
    const alt = JSON.parse(existing.alt_links || '[]');
    if (!alt.some((a) => a.url === j.apply_url)) alt.push({ source: j.source, url: j.apply_url });
    d.prepare('UPDATE jobs SET last_seen_at=?, alt_links=? WHERE id=?')
      .run(now(), JSON.stringify(alt), existing.id);
    return { id: existing.id, isNew: false };
  }

  d.prepare(
    `INSERT INTO jobs (fingerprint, source, source_job_id, title, company, company_id,
       location_raw, city, work_mode, employment_type, min_exp, max_exp, salary_raw,
       jd_text, skills_required, skills_nice, apply_url, link_status, posted_at,
       first_seen_at, last_seen_at, alt_links)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNCHECKED',?,?,?,?)`
  ).run(
    j.fingerprint, j.source, j.source_job_id ?? null, j.title, j.company, j.company_id ?? null,
    j.location_raw ?? null, j.city ?? null, j.work_mode ?? null, j.employment_type ?? null,
    j.min_exp ?? null, j.max_exp ?? null, j.salary_raw ?? null, j.jd_text ?? null,
    JSON.stringify(j.skills_required || []), JSON.stringify(j.skills_nice || []),
    j.apply_url, j.posted_at ?? null, now(), now(), JSON.stringify([{ source: j.source, url: j.apply_url }])
  );
  return { id: d.prepare('SELECT last_insert_rowid() AS id').get().id, isNew: true };
}

export function setLinkStatus(jobId, status, finalUrl) {
  getDB().prepare('UPDATE jobs SET link_status=?, final_url=?, link_checked_at=? WHERE id=?')
    .run(status, finalUrl ?? null, now(), jobId);
}

/** True when this user has already been shown this fingerprint on any previous run. */
export function alreadySeen(fingerprint, userId = 'local') {
  return !!getDB().prepare('SELECT 1 FROM job_matches WHERE user_id=? AND fingerprint=?')
    .get(userId, fingerprint);
}

export function insertMatch(m, userId = 'local') {
  getDB().prepare(
    `INSERT OR IGNORE INTO job_matches (user_id, fingerprint, job_id, run_id, score,
       breakdown, skills_matched, skills_missing, exp_gap, recommendation, why_text,
       competition, competition_reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    userId, m.fingerprint, m.job_id, m.run_id, m.score, JSON.stringify(m.breakdown || {}),
    JSON.stringify(m.skills_matched || []), JSON.stringify(m.skills_missing || []),
    m.exp_gap ?? null, m.recommendation, m.why_text, m.competition, m.competition_reason, now()
  );
}

export function matchesForRun(runId) {
  return getDB().prepare(
    `SELECT m.*, j.title, j.company, j.city, j.work_mode, j.employment_type, j.source,
            j.apply_url, j.final_url, j.link_status, j.posted_at, j.salary_raw,
            j.min_exp, j.max_exp, j.alt_links, j.applicants, j.applicants_source, j.jd_text
       FROM job_matches m JOIN jobs j ON j.id = m.job_id
      WHERE m.run_id = ? ORDER BY m.score DESC`
  ).all(runId);
}

export function allRuns() {
  return getDB().prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM job_matches m WHERE m.run_id = r.id) AS rows_now
       FROM runs r WHERE r.finished_at IS NOT NULL ORDER BY r.id DESC`
  ).all();
}

export function runById(id) {
  return getDB().prepare('SELECT * FROM runs WHERE id = ?').get(id);
}

export function dashboardStats() {
  const d = getDB();
  return {
    runs: d.prepare('SELECT COUNT(*) c FROM runs WHERE finished_at IS NOT NULL').get().c,
    jobs: d.prepare('SELECT COUNT(*) c FROM jobs').get().c,
    shown: d.prepare('SELECT COUNT(*) c FROM job_matches').get().c,
    applied: d.prepare('SELECT COUNT(*) c FROM applications').get().c,
    boards: d.prepare("SELECT COUNT(*) c FROM companies WHERE board_status='live'").get().c,
    indiaJobs: d.prepare("SELECT COALESCE(SUM(last_india),0) c FROM companies WHERE board_status='live'").get().c,
    avgScore: d.prepare('SELECT ROUND(AVG(score)) c FROM job_matches').get().c || 0,
    topScore: d.prepare('SELECT MAX(score) c FROM job_matches').get().c || 0,
    byRec: d.prepare('SELECT recommendation r, COUNT(*) c FROM job_matches GROUP BY recommendation').all(),
    bySource: d.prepare('SELECT j.source s, COUNT(*) c FROM job_matches m JOIN jobs j ON j.id=m.job_id GROUP BY j.source ORDER BY c DESC').all(),
    topCompanies: d.prepare('SELECT j.company c, COUNT(*) n FROM job_matches m JOIN jobs j ON j.id=m.job_id GROUP BY j.company ORDER BY n DESC LIMIT 8').all(),
    topMissing: d.prepare('SELECT skills_missing FROM job_matches').all(),
  };
}

export function latestRun() {
  return getDB().prepare('SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get();
}

/* ---------------- applications ---------------- */

export function toggleApplied(fingerprint, userId = 'local') {
  const d = getDB();
  const row = d.prepare('SELECT id FROM applications WHERE user_id=? AND fingerprint=?').get(userId, fingerprint);
  if (row) {
    d.prepare('DELETE FROM applications WHERE id=?').run(row.id);
    return { applied: false };
  }
  d.prepare('INSERT INTO applications (user_id, fingerprint, status, applied_at) VALUES (?,?,?,?)')
    .run(userId, fingerprint, 'applied', now());
  return { applied: true };
}

export function appliedSet(userId = 'local') {
  return getDB().prepare('SELECT fingerprint FROM applications WHERE user_id=?').all(userId)
    .map((r) => r.fingerprint);
}
