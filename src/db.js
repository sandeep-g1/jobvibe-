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

export async function startRun(userId = 'local') {
  const d = await db();
  return num(await d.insertReturningId('INSERT INTO runs (user_id, started_at) VALUES (?,?)', [userId, now()]));
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

export async function allRuns(userId = 'local') {
  const d = await db();
  const rows = await d.query(
    `SELECT r.*, (SELECT COUNT(*) FROM job_matches m WHERE m.run_id = r.id) AS rows_now
       FROM runs r WHERE r.finished_at IS NOT NULL AND r.user_id = ? ORDER BY r.id DESC`,
    [userId]
  );
  return rows.map((r) => ({ ...r, id: num(r.id) }));
}

export async function runById(id, userId = null) {
  const d = await db();
  const r = userId
    ? await d.one('SELECT * FROM runs WHERE id = ? AND user_id = ?', [id, userId])
    : await d.one('SELECT * FROM runs WHERE id = ?', [id]);
  return r ? { ...r, id: num(r.id) } : null;
}

/**
 * Has a run already completed today, in the given timezone?
 * Lets a backup trigger exist without producing a second run and a second
 * email on the same day.
 */
export async function runCompletedToday(tzOffsetMinutes = 330) {
  const d = await db();
  const rows = await d.query(
    'SELECT started_at FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 5'
  );
  const localDay = (iso) => {
    const t = new Date(iso).getTime() + tzOffsetMinutes * 60000;
    return new Date(t).toISOString().slice(0, 10);
  };
  const today = localDay(new Date().toISOString());
  return rows.some((r) => localDay(r.started_at) === today);
}

/**
 * Is another run already in flight? A run that crashed never records
 * finished_at, so only runs started within the window count as live.
 */
export async function runInProgress(windowMinutes = 30) {
  const d = await db();
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString();
  const r = await d.one(
    'SELECT id, started_at FROM runs WHERE finished_at IS NULL AND started_at > ? ORDER BY id DESC LIMIT 1',
    [since]
  );
  return r ? { ...r, id: num(r.id) } : null;
}

export async function latestRun(userId = 'local') {
  const d = await db();
  const r = await d.one(
    'SELECT * FROM runs WHERE finished_at IS NOT NULL AND user_id = ? ORDER BY id DESC LIMIT 1',
    [userId]
  );
  return r ? { ...r, id: num(r.id) } : null;
}

/* ---------------- ingest runs ---------------- */

export async function startIngest() {
  const d = await db();
  return num(await d.insertReturningId('INSERT INTO ingest_runs (started_at) VALUES (?)', [now()]));
}

export async function finishIngest(id, s) {
  const d = await db();
  await d.run(
    `UPDATE ingest_runs SET finished_at=?, per_source=?, n_fetched=?, n_after_india=?,
       n_new=?, pool_size=?, errors=? WHERE id=?`,
    [now(), JSON.stringify(s.perSource || {}), s.fetched | 0, s.afterIndia | 0,
     s.newJobs | 0, s.poolSize | 0, JSON.stringify(s.errors || []), id]
  );
}

export async function latestIngest() {
  const d = await db();
  const r = await d.one('SELECT * FROM ingest_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1');
  return r ? { ...r, id: num(r.id) } : null;
}

/* ---------------- resumes ---------------- */

export async function saveResume({ userId, filename, kind, contentB64, parsed }) {
  const d = await db();
  // One default resume per user: demote existing, insert the new as default.
  await d.run('UPDATE resumes SET is_default = 0 WHERE user_id = ?', [userId]);
  const id = await d.insertReturningId(
    `INSERT INTO resumes (user_id, filename, kind, content_b64, parsed_json, is_default, created_at)
     VALUES (?,?,?,?,?,1,?)`,
    [userId, filename ?? null, kind ?? null, contentB64 ?? null, JSON.stringify(parsed || {}), now()]
  );
  return num(id);
}

export async function defaultResume(userId) {
  const d = await db();
  const r = await d.one(
    'SELECT * FROM resumes WHERE user_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1', [userId]
  );
  return r ? { ...r, id: num(r.id) } : null;
}

export async function resumeMeta(userId) {
  const d = await db();
  const r = await d.one(
    'SELECT id, filename, kind, created_at FROM resumes WHERE user_id = ? AND is_default = 1 ORDER BY id DESC LIMIT 1',
    [userId]
  );
  return r ? { ...r, id: num(r.id) } : null;
}

/* ---------------- auth: users & sessions ---------------- */

export async function createUserRow({ id, email, passwordHash, displayName }) {
  const d = await db();
  await d.run(
    `INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?,?,?,?,?)`,
    [id, email, passwordHash, displayName ?? null, now()]
  );
}

export async function userByEmail(email) {
  const d = await db();
  return d.one('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
}

export async function userById(id) {
  const d = await db();
  return d.one('SELECT id, email, display_name, is_admin, created_at FROM users WHERE id = ?', [id]);
}

export async function touchLogin(id) {
  const d = await db();
  await d.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), id]);
}

export async function userCount() {
  const d = await db();
  return num((await d.one('SELECT COUNT(*) AS c FROM users')).c);
}

export async function createSession({ token, userId, expiresAt }) {
  const d = await db();
  await d.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    [token, userId, now(), expiresAt]);
}

export async function sessionUser(token) {
  const d = await db();
  const row = await d.one(
    `SELECT u.id, u.email, u.display_name, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`,
    [token, now()]
  );
  return row || null;
}

export async function deleteSession(token) {
  const d = await db();
  await d.run('DELETE FROM sessions WHERE token = ?', [token]);
}

/* ---------------- profiles: multi-user ---------------- */

/** All stored profiles, parsed. Each: { userId, data, updatedAt }. */
export async function allProfiles() {
  const d = await db();
  const rows = await d.query('SELECT user_id, data, updated_at FROM profiles');
  const out = [];
  for (const r of rows) {
    try { out.push({ userId: r.user_id, data: JSON.parse(r.data), updatedAt: r.updated_at }); }
    catch { /* skip corrupt */ }
  }
  return out;
}

/** Users whose daily schedule is on. scheduleActive defaults to false. */
export async function activeProfiles() {
  return (await allProfiles()).filter((p) => p.data && p.data.scheduleActive === true);
}

/**
 * Candidate jobs for one user: in the shared pool, link not known-dead, seen
 * recently, and not already shown to this user. This is the per-user match input.
 */
export async function candidateJobsForUser(userId, { days = 10, limit = 1500 } = {}) {
  const d = await db();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return d.query(
    `SELECT j.id, j.fingerprint, j.source, j.source_job_id, j.title, j.company, j.city,
            j.work_mode, j.employment_type, j.min_exp, j.max_exp, j.salary_raw, j.jd_text,
            j.skills_required, j.skills_nice, j.apply_url, j.final_url, j.link_status,
            j.posted_at, j.alt_links
       FROM jobs j
       LEFT JOIN job_matches m ON m.job_id = j.id AND m.user_id = ?
      WHERE m.id IS NULL
        AND j.link_status != 'DEAD'
        AND j.last_seen_at > ?
      ORDER BY j.first_seen_at DESC
      LIMIT ?`,
    [userId, since, limit]
  );
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

/* ---------------- secrets ---------------- */

export async function listSecretNames() {
  const d = await db();
  const rows = await d.query('SELECT name FROM secrets ORDER BY name');
  return rows.map((r) => r.name);
}

export async function getSecretRow(name) {
  const d = await db();
  return d.one('SELECT name, value, updated_at FROM secrets WHERE name = ?', [name]);
}

export async function saveSecretRow(name, encrypted) {
  const d = await db();
  await d.run(
    `INSERT INTO secrets (name, value, updated_at) VALUES (?,?,?)
     ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [name, encrypted, now()]
  );
}

export async function deleteSecretRow(name) {
  const d = await db();
  await d.run('DELETE FROM secrets WHERE name = ?', [name]);
}

/* ---------------- email ---------------- */

export async function logDigest({ runId, to, cc, providerId, error, n }) {
  try {
    const d = await db();
    await d.run(
      `INSERT INTO email_digests (run_id, recipients, cc, provider_id, error, n_jobs, sent_at)
       VALUES (?,?,?,?,?,?,?)`,
      [runId, JSON.stringify(to || []), JSON.stringify(cc || []),
       providerId ?? null, error ?? null, n | 0, now()]
    );
  } catch (err) {
    console.warn(`could not log the digest (${err.message})`);
  }
}

export async function recentDigests(limit = 10) {
  const d = await db();
  return d.query('SELECT * FROM email_digests ORDER BY id DESC LIMIT ?', [limit]);
}

/* ---------------- profile ---------------- */

export async function getProfileRow(userId = 'local') {
  const d = await db();
  const r = await d.one('SELECT data, updated_at FROM profiles WHERE user_id = ?', [userId]);
  if (!r) return null;
  try {
    return { data: JSON.parse(r.data), updatedAt: r.updated_at };
  } catch {
    return null;
  }
}

export async function saveProfileRow(profile, userId = 'local') {
  const d = await db();
  const json = JSON.stringify(profile);
  await d.run(
    `INSERT INTO profiles (user_id, data, updated_at) VALUES (?,?,?)
     ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [userId, json, now()]
  );
  return true;
}

/* ---------------- dashboard ---------------- */

export async function dashboardStats(userId = 'local') {
  const d = await db();
  const c = async (sql, p = []) => num((await d.one(sql, p))?.c ?? 0);
  const U = [userId];

  return {
    runs: await c('SELECT COUNT(*) AS c FROM runs WHERE finished_at IS NOT NULL AND user_id = ?', U),
    jobs: await c('SELECT COUNT(*) AS c FROM jobs'),
    shown: await c('SELECT COUNT(*) AS c FROM job_matches WHERE user_id = ?', U),
    applied: await c('SELECT COUNT(*) AS c FROM applications WHERE user_id = ?', U),
    boards: await c("SELECT COUNT(*) AS c FROM companies WHERE board_status='live'"),
    indiaJobs: await c("SELECT COALESCE(SUM(last_india),0) AS c FROM companies WHERE board_status='live'"),
    avgScore: Math.round(await c('SELECT COALESCE(AVG(score),0) AS c FROM job_matches WHERE user_id = ?', U)),
    topScore: await c('SELECT COALESCE(MAX(score),0) AS c FROM job_matches WHERE user_id = ?', U),
    byRec: await d.query('SELECT recommendation AS r, COUNT(*) AS c FROM job_matches WHERE user_id = ? GROUP BY recommendation', U),
    bySource: await d.query(
      `SELECT j.source AS s, COUNT(*) AS c FROM job_matches m JOIN jobs j ON j.id=m.job_id
        WHERE m.user_id = ? GROUP BY j.source ORDER BY c DESC`, U
    ),
    topCompanies: await d.query(
      `SELECT j.company AS c, COUNT(*) AS n FROM job_matches m JOIN jobs j ON j.id=m.job_id
        WHERE m.user_id = ? GROUP BY j.company ORDER BY n DESC LIMIT 8`, U
    ),
    topMissing: await d.query('SELECT skills_missing FROM job_matches WHERE user_id = ?', U),
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
