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
import { resolveJob, userScope, COUNTRY_NAMES } from './lib/geo.js';
import { extractSkills, extractExperience, extractEmploymentType } from './lib/skills.js';
import { mapLimit } from './lib/http.js';
import { allow, record } from './lib/quota.js';

const BOARD_IDS = new Set(Object.keys(BOARD_ADAPTERS));
const log = (m) => console.log(`  ingest · ${m}`);

/** Union of search terms across the users being served, case-insensitively de-duplicated. */
export function unionTerms(profiles, cap = 15) {
  const seen = new Set();
  const out = [];
  // Round-robin so every user gets their first titles in before anyone's 5th.
  const lists = profiles.map((p) => (p?.searchTerms?.length ? p.searchTerms : p?.jobTitles || []));
  for (let i = 0; out.length < cap && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const t = String(l[i] || '').trim();
      if (t && !seen.has(t.toLowerCase()) && out.length < cap) { seen.add(t.toLowerCase()); out.push(t); }
    }
  }
  return out;
}

/**
 * Crawl every source, refresh the shared jobs pool.
 * @param {object}   opts.profile   representative profile (fallback for sources/terms).
 * @param {object[]} opts.profiles  the users this run serves: their job titles are
 *   searched, their sources used, and only the countries their chosen
 *   locations cover are crawled.
 * @returns {object} stats for the ingest_runs row.
 */
export async function runIngest({ profile, profiles = [] } = {}) {
  const t0 = Date.now();
  const id = await startIngest();
  const errors = [];
  const perSource = {};
  const raw = [];

  const served = profiles.length ? profiles : [profile].filter(Boolean);
  const sources = [...new Set([
    ...served.flatMap((p) => p?.sources || []),
    ...(served.length ? [] : Object.keys(ADAPTERS)),
  ])];
  const terms = unionTerms(served);
  const crawl = new Set(served.flatMap((p) => [...userScope(p).crawl]));
  if (!crawl.size) crawl.add('IN');
  log(`countries: ${[...crawl].map((c) => COUNTRY_NAMES[c]).join(', ')} · ${terms.length} search terms`);

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
      // Workday searches each chosen country; the other query sources are India-only today.
      const ccs = key === 'workday' ? [...crawl] : crawl.has('IN') ? ['IN'] : [];
      for (const country of ccs) {
        for (const term of terms.slice(0, budget)) tasks.push({ key, adapter, term, country });
      }
    }
    const paused = new Set();
    await mapLimit(tasks, 3, async ({ key, adapter, term, country }) => {
      try {
        // Metered APIs keep to their monthly budget, and pause after quota/refusal errors.
        const q = await allow(key, adapter, { term, country });
        if (!q.ok) { if (!q.quiet && !paused.has(key)) { paused.add(key); log(`skipped ${q.why}`); } return; }
        const { rows, error } = await adapter.fetchQuery({ term, country, location: profile?.baseCity || 'India' });
        await record(key, adapter, { term, country, error });
        if (error) errors.push(error);
        perSource[key] = (perSource[key] || 0) + rows.length;
        raw.push(...rows);
      } catch (err) {
        errors.push(`${key}:"${term}" threw ${err.message}`);
      }
    });
  }
  log(`${raw.length} postings fetched`);

  const { afterIndia, unique: nUnique, newJobs } = await persistRows(raw, crawl);
  log(`${nUnique} unique · ${newJobs} new to the pool`);
  await finishIngest(id, {
    perSource, fetched: raw.length, afterIndia,
    newJobs, poolSize: nUnique, errors,
  });

  return {
    id, fetched: raw.length, afterIndia, newJobs,
    perSource, errors, seconds: (Date.now() - t0) / 1000,
  };
}

/**
 * Country gate, de-duplication, enrichment and storage for adapter-shaped rows.
 * Shared by the search (runIngest) and the job-alert reader. Returns counts.
 */
export async function persistRows(raw, crawl) {
  // Normalise + country gate: keep only postings in a country someone chose.
  const usable = raw.filter(isUsable);
  const indian = [];
  for (const r of usable) {
    const g = resolveJob({
      location: r.location_raw, isRemote: r.is_remote, workplaceType: r.workplace_type,
      country: r.country, jdText: r.jd_text,
    });
    if (!g.cc || !crawl.has(g.cc)) continue;
    indian.push({ ...r, cc: g.cc, city: r.city || g.city, work_mode: g.workMode });
  }
  log(`${indian.length} postings in the chosen countries`);

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

  return { afterIndia: indian.length, unique: deduped.length, newJobs };
}
