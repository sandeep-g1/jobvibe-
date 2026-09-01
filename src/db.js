// Data layer. Dialect-neutral: every function works on SQLite locally and on
// Postgres (Supabase) when DATABASE_URL is set.
//
// UNIQUE(user_id, fingerprint) on job_matches is the zero-duplicate guarantee.
import { db, insertIgnore, isPostgres, ROOT, now } from './db/driver.js';

export { ROOT, now, isPostgres };

/** Postgres returns BIGSERIAL ids as strings; normalise so callers see numbers. */
const num = (v) => (v == null ? v : Number(v));

export async function initDB() {
  return db();
}

export async function closeDB() {
  const d = await db();
  await d.close();
}

/* ---------------- companies ---------------- */

export async function upsertCompany(c) {
  const d = await db();
  await d.run(
    `INSERT INTO companies (name, normalized_name, ats_type, ats_slug, board_status,
                            board_last_ok_at, last_total, last_india, checked_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT (ats_type, ats_slug) DO UPDATE SET
       name = excluded.name,
       board_status = excluded.board_status,
       board_last_ok_at = COALESCE(excluded.board_last_ok_at, companies.board_last_ok_at),
       last_total = excluded.last_total,
       last_india = excluded.last_india,
       checked_at = excluded.checked_at`,
    [c.name, c.normalized_name, c.ats_type, c.ats_slug, c.board_status,
     c.board_last_ok_at ?? null, c.last_total ?? 0, c.last_india ?? 0, c.checked_at ?? now()]
  );
}

export async function liveCompanies(sources) {
  const d = await db();
  const rows = await d.query(
    `SELECT * FROM companies WHERE board_status = 'live' ORDER BY last_india DESC, name`
  );
  if (!sources?.length) return rows;
  const set = new Set(sources);
  return rows.filter((r) => set.has(r.ats_type));
}

/* ---------------- runs ---------------- */

export async function startRun() {
  const d = await db();
  return num(await d.insertReturningId('INSERT INTO runs (started_at) VALUES (?)', [now()]));
}

export async function finishRun(runId, stats) {
  const d = await db();
  await d.run(
    `UPDATE runs SET finished_at=?, per_source=?, n_fetched=?, n_after_india=?,
       n_after_dedupe=?, n_new=?, n_scored=?, n_links_dead=?, n_reported=?,
       errors=?, report_path=? WHERE id=?`,
    [now(), JSON.stringify(stats.perSource || {}), stats.fetched | 0, stats.afterIndia | 0,
     stats.afterDedupe | 0, stats.newJobs | 0, stats.scored | 0, stats.linksDead | 0,
     stats.reported | 0, JSON.stringify(stats.errors || []), stats.reportPath || null, runId]
  );
}

export async function allRuns() {
  const d = await db();
  const rows = await d.query(
    `SELECT r.*, (SELECT COUNT(*) FROM job_matches m WHERE m.run_id = r.id) AS rows_now
       FROM runs r WHERE r.finished_at IS NOT NULL ORDER BY r.id DESC`
  );
  return rows.map((r) => ({ ...r, id: num(r.id) }));
}

export async function runById(id) {
  const d = await db();
  const r = await d.one('SELECT * FROM runs WHERE id = ?', [id]);
  return r ? { ...r, id: num(r.id) } : null;
}

export async function latestRun() {
  const d = await db();
  const r = await d.one(
    'SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'
  );
  return r ? { ...r, id: num(r.id) } : null;
}

/* ---------------- jobs ---------------- */

/** Returns { id, isNew }. Existing rows get last_seen_at refreshed and links merged. */
export async function upsertJob(j) {
  const d = await db();
  const existing = await d.one('SELECT id, alt_links FROM jobs WHERE fingerprint = ?', [j.fingerprint]);

  if (existing) {
    const alt = JSON.parse(existing.alt_links || '[]');
    if (!alt.some((a) => a.url === j.apply_url)) alt.push({ source: j.source, url: j.apply_url });
    await d.run('UPDATE jobs SET last_seen_at=?, alt_links=? WHERE id=?',
      [now(), JSON.stringify(alt), existing.id]);
    return { id: num(existing.id), isNew: false };
  }

  const id = await d.insertReturningId(
    `INSERT INTO jobs (fingerprint, source, source_job_id, title, company, company_id,
       location_raw, city, work_mode, employment_type, min_exp, max_exp, salary_raw,
       jd_text, skills_required, skills_nice, apply_url, link_status, posted_at,
       first_seen_at, last_seen_at, alt_links)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UNCHECKED',?,?,?,?)`,
    [j.fingerprint, j.source, j.source_job_id ?? null, j.title, j.company, j.company_id ?? null,
     j.location_raw ?? null, j.city ?? null, j.work_mode ?? null, j.employment_type ?? null,
     j.min_exp ?? null, j.max_exp ?? null, j.salary_raw ?? null, j.jd_text ?? null,
     JSON.stringify(j.skills_required || []), JSON.stringify(j.skills_nice || []),
     j.apply_url, j.posted_at ?? null, now(), now(),
     JSON.stringify([{ source: j.source, url: j.apply_url }])]
  );
  return { id: num(id), isNew: true };
}

export async function setLinkStatus(jobId, status, finalUrl) {
  const d = await db();
  await d.run('UPDATE jobs SET link_status=?, final_url=?, link_checked_at=? WHERE id=?',
    [status, finalUrl ?? null, now(), jobId]);
}

/** Fingerprints this user has already been shown, as a Set — one query, not N. */
export async function seenFingerprints(userId = 'local') {
  const d = await db();
  const rows = await d.query('SELECT fingerprint FROM job_matches WHERE user_id = ?', [userId]);
  return new Set(rows.map((r) => r.fingerprint));
}

export async function insertMatch(m, userId = 'local') {
  const d = await db();
  await d.run(
    insertIgnore('job_matches', [
      'user_id', 'fingerprint', 'job_id', 'run_id', 'score', 'breakdown',
      'skills_matched', 'skills_missing', 'exp_gap', 'recommendation', 'why_text',
      'competition', 'competition_reason', 'created_at',
    ]),
    [userId, m.fingerprint, m.job_id, m.run_id, m.score, JSON.stringify(m.breakdown || {}),
     JSON.stringify(m.skills_matched || []), JSON.stringify(m.skills_missing || []),
     m.exp_gap ?? null, m.recommendation, m.why_text, m.competition,
     m.competition_reason, now()]
  );
}

export async function matchesForRun(runId) {
  const d = await db();
  return d.query(
    `SELECT m.*, j.title, j.company, j.city, j.work_mode, j.employment_type, j.source,
            j.apply_url, j.final_url, j.link_status, j.posted_at, j.salary_raw,
            j.min_exp, j.max_exp, j.alt_links, j.applicants, j.applicants_source
       FROM job_matches m JOIN jobs j ON j.id = m.job_id
      WHERE m.run_id = ? ORDER BY m.score DESC`,
    [runId]
  );
}

/* ---------------- applications ---------------- */

export async function toggleApplied(fingerprint, userId = 'local') {
  const d = await db();
  const row = await d.one('SELECT id FROM applications WHERE user_id=? AND fingerprint=?',
    [userId, fingerprint]);
  if (row) {
    await d.run('DELETE FROM applications WHERE id=?', [row.id]);
    return { applied: false };
  }
  await d.run('INSERT INTO applications (user_id, fingerprint, status, applied_at) VALUES (?,?,?,?)',
    [userId, fingerprint, 'applied', now()]);
  return { applied: true };
}

export async function appliedSet(userId = 'local') {
  const d = await db();
  const rows = await d.query('SELECT fingerprint FROM applications WHERE user_id=?', [userId]);
  return new Set(rows.map((r) => r.fingerprint));
}

/* ---------------- dashboard ---------------- */

export async function dashboardStats() {
  const d = await db();
  const c = async (sql, p = []) => num((await d.one(sql, p))?.c ?? 0);

  return {
    runs: await c('SELECT COUNT(*) AS c FROM runs WHERE finished_at IS NOT NULL'),
    jobs: await c('SELECT COUNT(*) AS c FROM jobs'),
    shown: await c('SELECT COUNT(*) AS c FROM job_matches'),
    applied: await c('SELECT COUNT(*) AS c FROM applications'),
    boards: await c("SELECT COUNT(*) AS c FROM companies WHERE board_status='live'"),
    indiaJobs: await c("SELECT COALESCE(SUM(last_india),0) AS c FROM companies WHERE board_status='live'"),
    avgScore: Math.round(await c('SELECT COALESCE(AVG(score),0) AS c FROM job_matches')),
    topScore: await c('SELECT COALESCE(MAX(score),0) AS c FROM job_matches'),
    byRec: await d.query('SELECT recommendation AS r, COUNT(*) AS c FROM job_matches GROUP BY recommendation'),
    bySource: await d.query(
      `SELECT j.source AS s, COUNT(*) AS c FROM job_matches m JOIN jobs j ON j.id=m.job_id
        GROUP BY j.source ORDER BY c DESC`
    ),
    topCompanies: await d.query(
      `SELECT j.company AS c, COUNT(*) AS n FROM job_matches m JOIN jobs j ON j.id=m.job_id
        GROUP BY j.company ORDER BY n DESC LIMIT 8`
    ),
    topMissing: await d.query('SELECT skills_missing FROM job_matches'),
  };
}

export async function registryHealth() {
  const d = await db();
  return {
    byAts: await d.query(
      `SELECT ats_type, COUNT(*) AS live, COALESCE(SUM(last_india),0) AS india
         FROM companies WHERE board_status='live' GROUP BY ats_type ORDER BY india DESC`
    ),
    dead: num((await d.one("SELECT COUNT(*) AS c FROM companies WHERE board_status='dead'"))?.c ?? 0),
  };
}

/* ---------------- maintenance ---------------- */

export async function clearRuns({ includeApplications = false } = {}) {
  const d = await db();
  const before = {
    jobs: num((await d.one('SELECT COUNT(*) AS c FROM jobs'))?.c ?? 0),
    matches: num((await d.one('SELECT COUNT(*) AS c FROM job_matches'))?.c ?? 0),
    runs: num((await d.one('SELECT COUNT(*) AS c FROM runs'))?.c ?? 0),
  };
  await d.run('DELETE FROM job_matches', []);
  await d.run('DELETE FROM jobs', []);
  await d.run('DELETE FROM runs', []);
  if (includeApplications) await d.run('DELETE FROM applications', []);
  return before;
}
