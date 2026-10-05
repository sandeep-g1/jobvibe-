// MATCH PLANE — per user, cheap. Takes the shared jobs pool the ingest plane
// built, scores it against one user's resume, drops what they have already been
// shown, applies their filters, and produces their report and email.
//
// Runs in ~2 seconds against a warm pool, so the cost of an extra user is a
// couple of seconds, not another full crawl.
import { ADAPTERS } from './adapters/index.js';
import {
  candidateJobsForUser, insertMatch, matchesForRun, appliedSet,
  startRun, finishRun, latestIngest, defaultResume, topMatchesForRun,
} from './db.js';
import { buildCorpus, buildSkillIDF, scoreJob, competitionSignal } from './score.js';
import { verifyJobs, STATUS } from './verify.js';
import { writeReport, buildRows } from './report.js';
import { sendDigest } from './email.js';
import { loadProfileAsync, missingProfile } from './lib/profile.js';
import { userScope, inScope } from './lib/geo.js';
import { aiRerank } from './lib/rerank.js';
import { resolveApplyRoute, AUTO_ATS, atsOfUrl } from './lib/apply-route.js';

// How many strong jobs the user must apply to themselves may join the auto-apply ones.
const MANUAL_EXTRA = 3;

/** Can the agent apply on its own? (job's own system, or a route already resolved) — no network. */
function quickAuto(job) {
  if (AUTO_ATS.includes(job.source) || AUTO_ATS.includes(atsOfUrl(job.final_url || job.apply_url))) return true;
  try { return JSON.parse(job.apply_route || '{}').route === 'auto'; } catch { return false; }
}
import { telegramConfigured, sendDigest as sendTelegram } from './lib/telegram.js';
import { extractText } from './lib/resume.js';

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
  // Score against the whole CV, not the short autofill summary.
  if (!profile.cvText) {
    try {
      const cv = await defaultResume(userId);
      if (cv?.content_b64) {
        const t = await extractText(Buffer.from(cv.content_b64, 'base64'), cv.filename || '', '');
        if (t.ok) profile.cvText = t.text;
      }
    } catch { /* fall back to resumeText */ }
  }
  // An incomplete profile can only produce junk: no run, no report, no email.
  const missing = missingProfile(profile, !!(profile.cvText || profile.resumeText));
  if (missing.length) {
    log(`${userId}: skipped, profile incomplete (missing ${missing.join(', ')})`);
    return { userId, runId: null, reported: 0, emailed: false, emailReason: `profile incomplete: ${missing.join(', ')}` };
  }
  const runId = await startRun(userId);

  // Candidate pool: fresh, not-dead, unseen by this user, inside the locations
  // they chose (cities only, unless they picked a whole country or "All countries").
  const scope = userScope(profile);
  const poolRows = (await candidateJobsForUser(userId, { days: 10, countries: scope.all ? null : [...scope.crawl] }))
    .filter((j) => inScope(j, scope));
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

  // AI recruiter pass over the strongest keyword candidates. When it works,
  // only jobs it actually read can reach the report.
  // Prefer jobs the agent can apply to itself: give them most of the AI's reading budget,
  // so they aren't crowded out by aggregator listings it can only hand back.
  const byKeyword = scored.slice().sort((a, b) => b.result.score - a.result.score);
  byKeyword.forEach((s) => { s.auto = quickAuto(s.job); });
  const forAi = [...byKeyword.filter((s) => s.auto).slice(0, 45), ...byKeyword.filter((s) => !s.auto).slice(0, 15)];
  const ai = await aiRerank(profile, forAi);
  log(`${userId}: AI judged ${ai.judged}${ai.ok ? '' : ` (keyword-only: ${ai.error || 'off'})`}`);
  const above = scored
    .filter((s) => !ai.ok || s.aiJudged)
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

  // Strong aggregator jobs (Himalayas, Cutshort…): look for the same role on the employer's own form.
  let upgrades = 0;
  for (const s of living.filter((x) => !x.auto && x.result.score >= 70).slice(0, 12)) {
    const r = await resolveApplyRoute(s.job);
    if (r.route === 'auto') { s.auto = true; upgrades++; }
  }
  if (upgrades) log(`${userId}: ${upgrades} aggregator job(s) routed to the employer's own form`);

  // Auto-apply jobs first (source cap applies), then at most a few strong ones the user applies to.
  const taken = new Map();
  const autos = [];
  for (const s of living.filter((x) => x.auto)) {
    if (autos.length >= limit) break;
    const n = taken.get(s.job.source) || 0;
    if (n >= perSourceCap) continue;
    taken.set(s.job.source, n + 1);
    autos.push(s);
  }
  for (const s of living.filter((x) => x.auto)) { if (autos.length >= limit) break; if (!autos.includes(s)) autos.push(s); }
  const manual = living.filter((x) => !x.auto && x.result.score >= 75).slice(0, Math.min(MANUAL_EXTRA, Math.max(0, limit - autos.length)));
  const picked = [...autos, ...manual];
  // Remember the route on the job so Telegram and the report can label ⚡ / ✋ without another look-up.
  for (const s of picked) if (!s.job.apply_route) s.job.apply_route = JSON.stringify(await resolveApplyRoute(s.job, { live: false }));
  log(`${userId}: ${autos.length} auto-apply, ${manual.length} for you to apply`);

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

  const siteUrl = (process.env.SITE_URL || 'https://jobvibe.evergreenskill.com').replace(/\/+$/, '');
  let digest = { sent: false, reason: 'email disabled for this run' };
  if (email) digest = await sendDigest(buildRows(rows, applied), { profile, runId, siteUrl });

  // Telegram: top matches with one-tap Approve / Skip.
  if (email && profile.telegram?.chatId && telegramConfigured()) {
    const tgOut = await sendTelegram(profile.telegram.chatId, await topMatchesForRun(runId, 5), { total: picked.length, runId });
    log(`${userId}: telegram ${tgOut.sent} sent${tgOut.error ? ` (${tgOut.error})` : ''}`);
  }

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
