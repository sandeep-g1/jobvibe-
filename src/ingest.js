// INGEST PLANE — the shared crawl. Runs once, for everyone, no matter how many
// users exist. Fetches every board and source, gates to India, de-duplicates,
// extracts JD skills/experience, and writes to the global `jobs` pool. It does
// no scoring, no per-user filtering, no report, no email — that is the match
// plane's job.
//
// Splitting this out is what makes the app scale: the expensive crawl is O(1)
// in users, and matching each user against the shared pool is cheap.
import { ADAPTERS, isUsable, availableQueryAdapters, BOARD_ADAPTERS } from './adapters/index.js';
import {
  liveCompanies, upsertJob, setLinkStatus, startIngest, finishIngest,
} from './db.js';
import { fingerprint, isNearDuplicate } from './lib/normalize.js';
import { indiaGate } from './lib/india.js';
import { extractSkills, extractExperience, extractEmploymentType } from './lib/skills.js';
import { mapLimit } from './lib/http.js';

const BOARD_IDS = new Set(Object.keys(BOARD_ADAPTERS));
const log = (m) => console.log(`  ingest · ${m}`);

/**
 * Crawl every source, refresh the shared jobs pool.
 * @param {object} opts.profile  a representative profile (its `sources` and
 *   `searchTerms`/`jobTitles` decide which adapters and query terms to run).
 * @returns {object} stats for the ingest_runs row.
 */
export async function runIngest({ profile } = {}) {
  const t0 = Date.now();
  const id = await startIngest();
  const errors = [];
  const perSource = {};
  const raw = [];

  const sources = profile?.sources || Object.keys(ADAPTERS);
  const terms = (profile?.searchTerms?.length ? profile.searchTerms : profile?.jobTitles || []).slice(0, 6);

  // Tier B — verified boards, keyless
  const boardSources = sources.filter((s) => BOARD_IDS.has(s));
  const companies = await liveCompanies(boardSources);
  log(`${companies.length} live boards`);
  await mapLimit(companies, 6, async (c) => {
    try {
      const { rows, error } = await ADAPTERS[c.ats_type].fetchJobs(c);
      if (error) errors.push(error);
      perSource[c.ats_type] = (perSource[c.ats_type] || 0) + rows.length;
      raw.push(...rows);
    } catch (err) {
      errors.push(`${c.ats_type}:${c.ats_slug} threw ${err.message}`);
    }
  });

  // Tier A — query-based sources with a key/adapter
  const ready = availableQueryAdapters(sources).filter((t) => t.ready);
  if (ready.length && terms.length) {
    const tasks = [];
    for (const { key, adapter } of ready) {
      const budget = adapter.maxTermsPerRun ?? terms.length;
      for (const term of terms.slice(0, budget)) tasks.push({ key, adapter, term });
    }
    await mapLimit(tasks, 3, async ({ key, adapter, term }) => {
      try {
        const { rows, error } = await adapter.fetchQuery({ term, location: profile?.baseCity || 'India' });
        if (error) errors.push(error);
        perSource[key] = (perSource[key] || 0) + rows.length;
        raw.push(...rows);
      } catch (err) {
        errors.push(`${key}:"${term}" threw ${err.message}`);
      }
    });
  }
  log(`${raw.length} postings fetched`);

  // Normalise + India gate
  const usable = raw.filter(isUsable);
  const indian = [];
  for (const r of usable) {
    const gate = indiaGate({
      location: r.location_raw, isRemote: r.is_remote, workplaceType: r.workplace_type,
      country: r.country, jdText: r.jd_text,
    });
    if (!gate.isIndia) continue;
    indian.push({ ...r, city: r.city || gate.city, work_mode: gate.workMode });
  }
  log(`${indian.length} India postings`);

  // Collapse duplicates within this crawl (cross-portal + reposts). Per-user
  // "already seen" filtering does NOT happen here — that is per user, in match.
  const byFp = new Map();
  for (const r of indian) {
    const fp = fingerprint({ company: r.company, title: r.title, city: r.city, sourceJobId: r.source_job_id });
    if (!byFp.has(fp)) byFp.set(fp, { ...r, fingerprint: fp });
  }
  const unique = [...byFp.values()];
  const deduped = [];
  for (const job of unique) {
    if (deduped.some((k) => isNearDuplicate(k, job))) continue;
    deduped.push(job);
  }

  // Enrich + persist to the pool
  let newJobs = 0;
  for (const j of deduped) {
    const skills = extractSkills(j.jd_text);
    const exp = extractExperience(j.jd_text);
    const { id: jobId, isNew } = await upsertJob({
      ...j,
      skills_required: skills.required,
      skills_nice: skills.nice,
      min_exp: exp.min,
      max_exp: exp.max,
      employment_type: extractEmploymentType(j.jd_text, j.employment_type_hint),
      salary_raw: j.salary_raw || null,
      location_raw: j.location_raw,
      company_id: j.company_id,
    });
    if (isNew) {
      newJobs++;
      // Sources that prove their own liveness (API-listed, not expired) start OK,
      // so match never re-probes their browser-challenged pages.
      if (j.verified_by_source) await setLinkStatus(jobId, 'OK', j.apply_url);
    }
  }

  log(`${deduped.length} unique · ${newJobs} new to the pool`);
  await finishIngest(id, {
    perSource, fetched: raw.length, afterIndia: indian.length,
    newJobs, poolSize: deduped.length, errors,
  });

  return {
    id, fetched: raw.length, afterIndia: indian.length, newJobs,
    perSource, errors, seconds: (Date.now() - t0) / 1000,
  };
}
