// Workday career sites — the hiring system behind most large employers and
// global capability centres (Accenture, State Street, JLL, TaskUs, Hitachi…).
// These are the ops / support / services roles the startup ATS boards miss.
//
// Keyless: each site's public career page calls these same JSON endpoints, and
// the sites' robots.txt allows the career-site paths. The registry of sites and
// their per-country facet ids comes from `node src/seed-workday.js`
// (data/workday.json).
//
// Search is per term: Accenture alone lists ~36k India jobs, so pulling whole
// boards is pointless. For each term we search every site that has jobs in the
// country, keep the top hits, and fetch details for those only.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db/driver.js';
import { mapLimit, htmlToText, sleep } from '../lib/http.js';

export const id = 'workday';
export const label = 'Workday (large employers)';
export const kind = 'query';
export const trustLink = true;
export const maxTermsPerRun = 12;

const PER_SITE = 5;          // list hits kept per site per term
const DETAIL_CAP = 80;       // detail calls per term (across all sites)
const CONCURRENCY = 6;
const MAX_AGE_DAYS = 60;     // Workday leaves old reqs up; skip the stale ones

export function configured() { return existsSync(join(ROOT, 'data', 'workday.json')); }

let _sites = null;
export function sites() {
  if (!_sites) {
    try { _sites = JSON.parse(readFileSync(join(ROOT, 'data', 'workday.json'), 'utf8')); } catch { _sites = []; }
  }
  return _sites;
}

const base = (s) => `https://${s.tenant}.${s.wd}.myworkdayjobs.com/wday/cxs/${s.tenant}/${s.site}`;

/** "jll" → "JLL", "statestreet" → "Statestreet"; short ids are usually acronyms. */
export function companyName(s) {
  if (s.name) return s.name;
  const t = s.tenant.replace(/[-_]+/g, ' ');
  return t.length <= 4 ? t.toUpperCase() : t.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function post(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'JobVibe/1.0' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 429) { await sleep(3000); return null; }
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function getJ(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'JobVibe/1.0' }, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** "Posted 3 Days Ago" / "Posted Today" / "Posted 30+ Days Ago" → days (30+ → 31). */
export function postedDays(text = '') {
  const t = String(text).toLowerCase();
  if (/today/.test(t)) return 0;
  if (/yesterday/.test(t)) return 1;
  const m = t.match(/(\d+)\+?\s*day/);
  return m ? Number(m[1]) + (/\+/.test(t) ? 1 : 0) : null;
}

const STOP = new Set(['and', 'of', 'the', 'for', 'in', 'a', 'to', 'senior', 'sr', 'junior', 'jr', 'lead', 'i', 'ii', 'iii']);
const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP.has(w));

/** Share of the search term's words that appear in the title (0..1). */
export function titleOverlap(term, title) {
  const tw = words(term);
  if (!tw.length) return 0;
  const set = new Set(words(title));
  return tw.filter((w) => set.has(w)).length / tw.length;
}

/**
 * @param {string} term     job title / keywords
 * @param {string} country  ISO code (IN, AE, DE, IE, NL, AU, US, GB)
 */
export async function fetchQuery({ term, country = 'IN' }) {
  const targets = sites().filter((s) => s.countries?.[country]);
  if (!targets.length) return { rows: [], error: null };

  // 1. Search every site for the term, scoped to the country.
  const hits = [];
  await mapLimit(targets, CONCURRENCY, async (s) => {
    const f = s.countries[country];
    const data = await post(`${base(s)}/jobs`, {
      appliedFacets: f.facet && f.id ? { [f.facet]: [f.id] } : {},
      limit: 20, offset: 0, searchText: term,
    });
    for (const p of (data?.jobPostings || []).slice(0, PER_SITE)) {
      const age = postedDays(p.postedOn);
      if (age != null && age > MAX_AGE_DAYS) continue;
      if (p.externalPath) hits.push({ s, p, age: age ?? 99, rel: titleOverlap(term, p.title) });
    }
  });

  // 2. Details for the most relevant hits (title overlap with the term first,
  //    then freshness) — Workday's own search is loose, so this matters.
  hits.sort((a, b) => b.rel - a.rel || a.age - b.age);
  const picked = hits.slice(0, DETAIL_CAP);
  const details = await mapLimit(picked, CONCURRENCY, ({ s, p }) => getJ(`${base(s)}${p.externalPath}`));

  const rows = [];
  picked.forEach(({ s, p }, i) => {
    const info = details[i]?.jobPostingInfo;
    if (!info || !info.externalUrl || info.canApply === false) return;
    if (info.startDate && Date.now() - new Date(info.startDate).getTime() > MAX_AGE_DAYS * 86400000) return;
    rows.push({
      source: id,
      source_job_id: `${s.tenant}:${info.jobReqId || info.id || p.bulletFields?.[0] || p.externalPath}`,
      title: (info.title || p.title || '').trim(),
      company: companyName(s),
      location_raw: info.location || p.locationsText || '',
      country: info.country?.descriptor || '',
      apply_url: info.externalUrl, // provider-supplied
      jd_text: htmlToText(info.jobDescription || ''),
      posted_at: info.startDate ? new Date(info.startDate).toISOString() : null,
      employment_type_hint: info.timeType || '',
      is_remote: /remote/i.test(`${info.location} ${info.remoteType || ''}`),
      workplace_type: info.remoteType || '',
      verified_by_source: true, // listed live by the employer's own system today
    });
  });
  return { rows, error: null };
}
