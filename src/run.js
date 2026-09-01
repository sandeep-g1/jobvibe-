// The nightly run — §05 of the architecture, stages 01..10 in order.
// Every stage reports its count so a thin report is explainable, not suspicious.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, isUsable, availableQueryAdapters } from './adapters/index.js';
import {
  getDB, ROOT, startRun, finishRun, liveCompanies, upsertJob,
  alreadySeen, insertMatch, matchesForRun,
} from './db.js';
import { BOARD_ADAPTERS } from './adapters/index.js';
const BOARD_IDS = new Set(Object.keys(BOARD_ADAPTERS));
import { fingerprint, isNearDuplicate } from './lib/normalize.js';
import { indiaGate } from './lib/india.js';
import { extractSkills, extractExperience, extractEmploymentType } from './lib/skills.js';
import { buildCorpus, buildSkillIDF, scoreJob, competitionSignal } from './score.js';
import { verifyJobs, STATUS } from './verify.js';
import { writeReport } from './report.js';
import { mapLimit } from './lib/http.js';

const stage = (n, label) => console.log(`\n[${String(n).padStart(2, '0')}] ${label}`);
const info = (msg) => console.log(`     ${msg}`);

async function main() {
  const t0 = Date.now();
  getDB();
  const profile = JSON.parse(readFileSync(join(ROOT, 'profile.json'), 'utf8'));
  const runId = startRun();
  const errors = [];
  const perSource = {};

  console.log(`\nShortlist India — run #${runId}`);
  console.log(`Profile: ${profile.name} · ${profile.totalExpYears}y · ${profile.baseCity}`);

  /* ---- 01 fan out ---- */
  stage(1, 'Fan out across verified boards');
  const boardSources = (profile.sources || []).filter((s) => BOARD_IDS.has(s));
  const companies = liveCompanies(boardSources);
  info(`${companies.length} live boards in registry`);

  const raw = [];

  // Tier B — per company, keyless
  await mapLimit(companies, 6, async (c) => {
    const adapter = ADAPTERS[c.ats_type];
    try {
      const { rows, error } = await adapter.fetchJobs(c);
      if (error) errors.push(error);
      perSource[c.ats_type] = (perSource[c.ats_type] || 0) + rows.length;
      raw.push(...rows);
    } catch (err) {
      errors.push(`${c.ats_type}:${c.ats_slug} threw ${err.message}`);
    }
  });

  // Tier A — per search term, needs a free key. Skipped cleanly when absent.
  const tierA = availableQueryAdapters(profile.sources);
  const notReady = tierA.filter((t) => !t.ready);
  const ready = tierA.filter((t) => t.ready);

  if (notReady.length) {
    info(`Tier A idle (no key): ${notReady.map((t) => t.key).join(', ')}`);
  }

  if (ready.length) {
    const terms = (profile.searchTerms?.length ? profile.searchTerms : profile.jobTitles).slice(0, 6);
    const where = profile.baseCity || 'India';
    const tasks = [];
    for (const { key, adapter } of ready) {
      for (const term of terms) tasks.push({ key, adapter, term });
    }
    await mapLimit(tasks, 3, async ({ key, adapter, term }) => {
      try {
        const { rows, error } = await adapter.fetchQuery({ term, location: where });
        if (error) errors.push(error);
        perSource[key] = (perSource[key] || 0) + rows.length;
        raw.push(...rows);
      } catch (err) {
        errors.push(`${key}:"${term}" threw ${err.message}`);
      }
    });
    info(`Tier A active: ${ready.map((t) => t.key).join(', ')} across ${terms.length} search terms`);
  }

  info(`${raw.length} postings fetched`);
  for (const [s, n] of Object.entries(perSource)) info(`  ${s.padEnd(17)} ${n}`);

  /* ---- 02 normalise + 03 india gate ---- */
  stage(2, 'Normalise and apply the India gate');
  const usable = raw.filter(isUsable);
  const droppedNoUrl = raw.length - usable.length;
  if (droppedNoUrl) info(`${droppedNoUrl} dropped: no provider apply URL`);

  const indian = [];
  for (const r of usable) {
    const gate = indiaGate({
      location: r.location_raw,
      isRemote: r.is_remote,
      workplaceType: r.workplace_type,
      country: r.country,
      jdText: r.jd_text,
    });
    if (!gate.isIndia) continue;
    indian.push({ ...r, city: gate.city, work_mode: gate.workMode });
  }
  info(`${indian.length} India postings (${usable.length - indian.length} non-India dropped)`);

  /* ---- exclusions ---- */
  const excludeCo = new Set((profile.excludeCompanies || []).map((s) => s.toLowerCase()));
  const excludeKw = (profile.excludeKeywords || []).map((s) => s.toLowerCase());
  // Exclude keywords match the TITLE with word boundaries. Scanning the whole JD
  // dropped 292 real jobs on the first run, because plenty of JDs merely mention
  // an internship programme in passing.
  const kept = indian.filter((r) => {
    if (excludeCo.has(r.company.toLowerCase())) return false;
    const title = r.title.toLowerCase();
    return !excludeKw.some((k) => new RegExp(`(?<![a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(title));
  });
  if (kept.length !== indian.length) info(`${indian.length - kept.length} dropped by your exclude rules`);

  /* ---- 04 fingerprint + dedupe ---- */
  stage(4, 'Fingerprint and de-duplicate');
  const byFp = new Map();
  for (const r of kept) {
    const fp = fingerprint({
      company: r.company, title: r.title, city: r.city, sourceJobId: r.source_job_id,
    });
    if (byFp.has(fp)) continue; // same job from two boards in one run
    byFp.set(fp, { ...r, fingerprint: fp });
  }
  const unique = [...byFp.values()];
  info(`${unique.length} unique after in-run collapse`);

  // near-duplicate (repost) detection within this run
  let nearDupes = 0;
  const final = [];
  for (const job of unique) {
    if (final.some((k) => isNearDuplicate(k, job))) { nearDupes++; continue; }
    final.push(job);
  }
  if (nearDupes) info(`${nearDupes} near-duplicate reposts merged`);

  const fresh = final.filter((j) => !alreadySeen(j.fingerprint, profile.userId));
  info(`${fresh.length} NEW · ${final.length - fresh.length} already shown on a previous run`);

  /* ---- 05 enrich ---- */
  stage(5, 'Extract skills and experience from each JD');
  const enriched = fresh.map((j) => {
    const skills = extractSkills(j.jd_text);
    const exp = extractExperience(j.jd_text);
    return {
      ...j,
      skills_required: skills.required,
      skills_nice: skills.nice,
      min_exp: exp.min,
      max_exp: exp.max,
      employment_type: extractEmploymentType(j.jd_text, j.employment_type_hint),
      salary_raw: j.salary_raw || null,
    };
  });
  const withJD = enriched.filter((j) => (j.jd_text || '').length > 200).length;
  info(`${withJD}/${enriched.length} have substantial JD text`);

  /* ---- 09a persist jobs ---- */
  const stored = [];
  for (const j of enriched) {
    const { id } = upsertJob({ ...j, location_raw: j.location_raw, company_id: j.company_id });
    stored.push({ ...j, id });
  }

  /* ---- 07 score ---- */
  stage(7, 'Score against your resume');
  const corpus = buildCorpus(stored.map((j) => j.jd_text || ''));
  const skillIDF = buildSkillIDF(stored.map((j) => j.skills_required || []));
  const scored = stored.map((j) => {
    const row = {
      ...j,
      skills_required: JSON.stringify(j.skills_required),
      skills_nice: JSON.stringify(j.skills_nice),
      alt_links: JSON.stringify([{ source: j.source, url: j.apply_url }]),
    };
    return { job: j, result: scoreJob(row, profile, corpus, skillIDF), comp: competitionSignal(row) };
  });

  const above = scored.filter((s) => s.result.score >= (profile.minScore ?? 0));
  info(`${above.length}/${scored.length} at or above your floor of ${profile.minScore}`);

  above.sort((a, b) => b.result.score - a.result.score);
  const limited = above.slice(0, profile.dailyLimit ?? 50);

  /* ---- 08 verify links ---- */
  stage(8, 'Verify every apply link');
  const trustBySource = Object.fromEntries(
    Object.entries(ADAPTERS).map(([k, a]) => [k, a.trustLink !== false])
  );
  const counts = await verifyJobs(
    limited.map((s) => s.job), trustBySource,
    { onProgress: (d, t) => process.stdout.write(`\r     checking ${d}/${t}...`) }
  );
  process.stdout.write('\r'.padEnd(40) + '\r');
  info(`${counts.ok} OK · ${counts.unverified} unverified · ${counts.dead} dead (excluded)`);

  const alive = limited.filter((s) => s.job.link_status !== STATUS.DEAD);

  /* ---- 09b persist matches ---- */
  stage(9, 'Persist matches');
  for (const s of alive) {
    insertMatch({
      fingerprint: s.job.fingerprint,
      job_id: s.job.id,
      run_id: runId,
      score: s.result.score,
      breakdown: s.result.breakdown,
      skills_matched: s.result.skills_matched,
      skills_missing: s.result.skills_missing,
      exp_gap: s.result.exp_gap,
      recommendation: s.result.recommendation,
      why_text: s.result.why_text,
      competition: s.comp.level,
      competition_reason: s.comp.reason,
    }, profile.userId);
  }
  info(`${alive.length} rows written`);

  /* ---- 10 render ---- */
  stage(10, 'Render report');
  const rows = matchesForRun(runId);
  const reportPath = writeReport(rows, { profile, runId, errors, perSource });
  info(reportPath);

  finishRun(runId, {
    perSource,
    fetched: raw.length,
    afterIndia: indian.length,
    afterDedupe: final.length,
    newJobs: fresh.length,
    scored: scored.length,
    linksDead: counts.dead,
    reported: rows.length,
    errors,
    reportPath,
  });

  const apply = rows.filter((r) => r.recommendation === 'apply').length;
  const consider = rows.filter((r) => r.recommendation === 'consider').length;
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`  ${rows.length} jobs in today's report — ${apply} apply, ${consider} consider`);
  console.log(`  ${errors.length} source warnings · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\n  Open it:   npm run serve`);
  console.log(`${'─'.repeat(58)}\n`);
}

main().catch((e) => {
  console.error('\nrun failed:', e);
  process.exit(1);
});
