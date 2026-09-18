// MATCH PLANE — per user, cheap. Takes the shared jobs pool the ingest plane
// built, scores it against one user's resume, drops what they have already been
// shown, applies their filters, and produces their report and email.
//
// Runs in ~2 seconds against a warm pool, so the cost of an extra user is a
// couple of seconds, not another full crawl.
import { ADAPTERS } from './adapters/index.js';
import {
  candidateJobsForUser, insertMatch, matchesForRun, appliedSet,
  startRun, finishRun, latestIngest,
} from './db.js';
import { buildCorpus, buildSkillIDF, scoreJob, competitionSignal } from './score.js';
import { verifyJobs, STATUS } from './verify.js';
import { writeReport, buildRows } from './report.js';
import { sendDigest } from './email.js';
import { loadProfileAsync } from './lib/profile.js';

const log = (m) => console.log(`  match · ${m}`);

/**
 * Match one user against the shared pool.
 * @param {string} userId
 * @param {object} opts.email    send the digest (default true)
 * @param {object} opts.profile  preloaded profile; otherwise loaded by userId
 * @returns {object} summary
 */
export async function runMatch(userId, { email = true, profile: pre } = {}) {
  const profile = pre || await loadProfileAsync(userId);
  profile.userId = userId;
  const runId = await startRun();

  // Candidate pool: fresh, not-dead, unseen by this user.
  const poolRows = await candidateJobsForUser(userId, { days: 10 });
  if (!poolRows.length) {
    log(`${userId}: pool empty — nothing new`);
    await finishRun(runId, { reported: 0 });
    return { userId, runId, reported: 0 };
  }

  // Per-user exclusions (company + title keyword).
  const excludeCo = new Set((profile.excludeCompanies || []).map((s) => s.toLowerCase()));
  const excludeKw = (profile.excludeKeywords || []).map((s) => s.toLowerCase());
  const pool = poolRows.filter((j) => {
    if (excludeCo.has((j.company || '').toLowerCase())) return false;
    const title = (j.title || '').toLowerCase();
    return !excludeKw.some((k) => new RegExp(`(?<![a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(title));
  });

  // Score against this user's resume.
  const corpus = buildCorpus(pool.map((j) => j.jd_text || ''));
  const skillIDF = buildSkillIDF(pool.map((j) => JSON.parse(j.skills_required || '[]')));
  const scored = pool.map((job) => ({
    job,
    result: scoreJob(job, profile, corpus, skillIDF),
    comp: competitionSignal(job),
  }));

  const above = scored
    .filter((s) => s.result.score >= (profile.minScore ?? 0))
    .sort((a, b) => b.result.score - a.result.score);

  // Same cap / verify-surplus / backfill logic the single-user run used.
  const limit = profile.dailyLimit ?? 50;
  const share = Math.min(1, Math.max(0.1, Number(profile.maxSourceShare ?? 0.4)));
  const perSourceCap = Math.max(1, Math.floor(limit * share));

  const bySource = new Map();
  for (const s of above) {
    const list = bySource.get(s.job.source) || [];
    if (list.length < perSourceCap * 3) list.push(s);
    bySource.set(s.job.source, list);
  }
  const candidates = [...bySource.values()].flat()
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit * 4);

  // Verify only links not already known-good in the pool (cached across users).
  const needCheck = candidates.filter((s) => s.job.link_status !== STATUS.OK).map((s) => s.job);
  if (needCheck.length) {
    const trust = Object.fromEntries(Object.entries(ADAPTERS).map(([k, a]) => [k, a.trustLink !== false]));
    await verifyJobs(needCheck, trust);
  }

  const living = candidates.filter((s) => s.job.link_status !== STATUS.DEAD);
  const taken = new Map();
  const picked = [];
  for (const s of living) {
    if (picked.length >= limit) break;
    const n = taken.get(s.job.source) || 0;
    if (n >= perSourceCap) continue;
    taken.set(s.job.source, n + 1);
    picked.push(s);
  }
  for (const s of living) { if (picked.length >= limit) break; if (!picked.includes(s)) picked.push(s); }
  picked.sort((a, b) => b.result.score - a.result.score);

  for (const s of picked) {
    await insertMatch({
      fingerprint: s.job.fingerprint, job_id: s.job.id, run_id: runId,
      score: s.result.score, breakdown: s.result.breakdown,
      skills_matched: s.result.skills_matched, skills_missing: s.result.skills_missing,
      exp_gap: s.result.exp_gap, recommendation: s.result.recommendation,
      why_text: s.result.why_text, competition: s.comp.level, competition_reason: s.comp.reason,
    }, userId);
  }
  log(`${userId}: ${picked.length}/${limit} from ${candidates.length} candidates`);

  // Report + email. Crawl stats come from the latest ingest, for display.
  const ing = await latestIngest();
  const perSource = ing ? JSON.parse(ing.per_source || '{}') : {};
  const rows = await matchesForRun(runId);
  const applied = await appliedSet(userId);
  writeReport(rows, { profile, runId, errors: [], perSource, applied });

  const siteUrl = (process.env.SITE_URL || 'https://jobvibe-green.vercel.app').replace(/\/+$/, '');
  let digest = { sent: false, reason: 'email disabled for this run' };
  if (email) digest = await sendDigest(buildRows(rows, applied), { profile, runId, siteUrl });

  await finishRun(runId, {
    perSource,
    fetched: ing?.n_fetched || 0,
    afterIndia: ing?.n_after_india || 0,
    newJobs: ing?.n_new || 0,
    scored: scored.length,
    reported: picked.length,
    errors: [],
  });

  return { userId, runId, reported: picked.length, emailed: digest.sent, emailReason: digest.reason };
}
