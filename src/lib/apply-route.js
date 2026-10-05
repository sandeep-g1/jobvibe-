// Where can the agent apply for a job by itself?
//
//   1. The job's own link, if it's an application system we can fill
//      (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee).
//   2. Otherwise (Himalayas, Cutshort, aggregators): the same role at the same
//      employer elsewhere in our job pool, on one of those systems.
//   3. Otherwise: a live look-up of the employer's public job board on those
//      systems (public APIs only).
//   4. Otherwise: manual — the user applies (labelled ✋).
//
// Results are cached on jobs.apply_route for a week.
import { db } from '../db/driver.js';

export const AUTO_ATS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee'];
const CACHE_DAYS = 7;

const HOSTS = {
  greenhouse: /(^|\.)greenhouse\.io$/, lever: /(^|\.)lever\.co$/, ashby: /(^|\.)ashbyhq\.com$/,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/, workable: /(^|\.)workable\.com$/, recruitee: /(^|\.)recruitee\.com$/,
};
export function atsOfUrl(url) {
  try { const h = new URL(url).hostname; return Object.entries(HOSTS).find(([, re]) => re.test(h))?.[0] || null; } catch { return null; }
}

const SUFFIX = /\b(pvt|private|ltd|limited|inc|llc|corp|corporation|co|company|technologies|technology|tech|solutions|systems|consulting|services|group|labs|software|india|global)\b\.?/g;
export const normCompany = (c) => String(c || '').toLowerCase().replace(/\(.*?\)/g, '').replace(SUFFIX, '').replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(['and', 'the', 'for', 'of', 'in', 'with', 'to', 'a', 'an', 'at', 'remote', 'india', 'hybrid', 'onsite', 'bengaluru', 'bangalore', 'mumbai', 'pune', 'hyderabad', 'chennai', 'delhi', 'face', 'interview', 'm', 'f', 'd']);
const words = (t) => new Set(String(t || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP.has(w)));
/** How alike two job titles are (0..1), both directions, so "Senior X" ≈ "X" but "X" ≠ "Y Lead". */
export function titleSimilarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return (2 * i) / (A.size + B.size);
}
const MIN_TITLE = 0.75;

function slugs(company) {
  const base = normCompany(company);
  const full = String(company || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  return [...new Set([base.replace(/\s+/g, ''), base.replace(/\s+/g, '-'), full.replace(/\s+/g, ''), full.replace(/\s+/g, '-')])]
    .filter((s) => s.length >= 3);
}

const get = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'JobVibe/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

// Public job-board APIs: list a company's open jobs as { title, url }.
const BOARDS = {
  // absolute_url is often the employer's own careers page wrapping the form; use the canonical form.
  greenhouse: async (s) => (await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs
    ?.map((j) => ({ title: j.title, url: `https://job-boards.greenhouse.io/${s}/jobs/${j.id}` })),
  lever: async (s) => { const j = await get(`https://api.lever.co/v0/postings/${s}?mode=json`); return Array.isArray(j) ? j.map((x) => ({ title: x.text, url: x.hostedUrl })) : null; },
  ashby: async (s) => (await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.map((j) => ({ title: j.title, url: j.jobUrl })),
  workable: async (s) => (await get(`https://apply.workable.com/api/v1/widget/accounts/${s}`))?.jobs?.map((j) => ({ title: j.title, url: j.url })),
  recruitee: async (s) => (await get(`https://${s}.recruitee.com/api/offers/`))?.offers?.map((o) => ({ title: o.title, url: o.careers_url })),
  smartrecruiters: async (s) => (await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`))?.content
    ?.map((p) => ({ title: p.name, url: `https://jobs.smartrecruiters.com/${s}/${p.id}` })),
};

/** Live look-up of the employer's own board. */
export async function discoverOnBoards(company, title) {
  let best = null;
  for (const s of slugs(company)) {
    for (const [ats, list] of Object.entries(BOARDS)) {
      const jobs = await list(s);
      if (!jobs?.length) continue;
      for (const j of jobs) {
        const sim = titleSimilarity(title, j.title);
        if (sim >= MIN_TITLE && (!best || sim > best.sim)) best = { ats, url: j.url, title: j.title, sim };
      }
    }
    if (best) break; // found the employer under this slug
  }
  return best;
}

/** Same role at the same employer on a supported board, already in our pool. */
async function findInPool(job) {
  const d = await db();
  const co = normCompany(job.company);
  if (co.length < 3) return null;
  const cands = await d.query(
    `SELECT j.title, j.company, j.apply_url, j.final_url, j.source, j.source_job_id, c.ats_slug FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.source IN ('greenhouse','lever','ashby','smartrecruiters') AND j.link_status != 'DEAD' AND j.last_seen_at > ?
        AND LOWER(j.company) LIKE ?`,
    [new Date(Date.now() - 30 * 86400000).toISOString(), `%${co.split(' ')[0]}%`]);
  let best = null;
  for (const c of cands) {
    if (normCompany(c.company) !== co) continue;
    const sim = titleSimilarity(job.title, c.title);
    const url = c.source === 'greenhouse' && c.ats_slug && c.source_job_id
      ? `https://job-boards.greenhouse.io/${c.ats_slug}/jobs/${c.source_job_id}` : c.final_url || c.apply_url;
    if (sim >= MIN_TITLE && (!best || sim > best.sim)) best = { ats: c.source, url, title: c.title, sim };
  }
  return best;
}

/**
 * @param {object} job { id, source, title, company, apply_url, final_url, apply_route }
 * @param {object} opts { live: allow live board look-ups (default true) }
 * @returns {Promise<{ route:'auto'|'manual', ats?:string, url?:string, via?:string, reason?:string }>}
 */
export async function resolveApplyRoute(job, { live = true } = {}) {
  if (job.apply_route) {
    try {
      const c = JSON.parse(job.apply_route);
      if (c.at && Date.now() - new Date(c.at).getTime() < CACHE_DAYS * 86400000 && (c.route === 'auto' || c.live || !live)) return c;
    } catch { /* recompute */ }
  }
  const own = job.final_url || job.apply_url;
  const ownAts = atsOfUrl(own);
  let out;
  if (AUTO_ATS.includes(job.source) || ownAts) {
    out = { route: 'auto', ats: ownAts || job.source, url: own, via: 'job link' };
  } else {
    const pooled = await findInPool(job);
    if (pooled) out = { route: 'auto', ats: pooled.ats, url: pooled.url, via: `same role on ${pooled.ats}` };
    else if (live) {
      const found = await discoverOnBoards(job.company, job.title);
      out = found
        ? { route: 'auto', ats: found.ats, url: found.url, via: `employer's ${found.ats} board` }
        : { route: 'manual', reason: job.source === 'workday' ? 'Workday needs an account per employer' : `no application form the agent can fill (${job.source})` };
      out.live = true;
    } else {
      out = { route: 'manual', reason: 'not checked yet' };
    }
  }
  out.at = new Date().toISOString();
  if (job.id) {
    const d = await db();
    await d.run('UPDATE jobs SET apply_route = ? WHERE id = ?', [JSON.stringify(out), job.id]);
  }
  return out;
}
