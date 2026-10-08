// Where can the agent apply for a job by itself?
//
//   1. The job's own link, if it's an application system we can fill
//      (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee).
//   2. Otherwise (Himalayas, Cutshort, aggregators): the same posting at the same
//      employer elsewhere in our job pool, on one of those systems.
//   3. Otherwise: a live look-up of the employer's public job board on those
//      systems (public APIs only).
//   "Same posting" means the exact title and a location the user can take; if
//   none fits, or several do, the user applies (we never guess between them).
//   4. Otherwise: manual — the user applies (labelled ✋).
//
// Results are cached on jobs.apply_route for a week.
import { db } from '../db/driver.js';
import { resolveJob, COUNTRY_WORDS } from './geo.js';
import * as kekaAdapter from '../adapters/keka.js';

// SmartRecruiters is not here: its application form sits behind DataDome bot
// protection, which blocks automated browsers. We don't work around bot checks,
// so SmartRecruiters jobs are "you apply".
// Workday: one candidate account per employer, created by the agent on the user's job-hunt email.
export const AUTO_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'workday'];
const BOT_PROTECTED = new Set(['smartrecruiters', 'zohorecruit', 'keka']);
// Why each one can't be applied to automatically (shown to the user).
const BLOCK_REASON = { smartrecruiters: 'blocks automated applications (bot protection)', zohorecruit: 'its application form has a CAPTCHA', keka: 'its application form has a CAPTCHA' };
const CACHE_DAYS = 7;
const ROUTE_V = 4; // v2: exact posting + location (v1 matched titles loosely); v3: Workday is auto; v4: Keka, Zoho Recruit

const HOSTS = {
  greenhouse: /(^|\.)greenhouse\.io$/, lever: /(^|\.)lever\.co$/, ashby: /(^|\.)ashbyhq\.com$/,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/, workable: /(^|\.)workable\.com$/, recruitee: /(^|\.)recruitee\.com$/,
  workday: /(^|\.)myworkdayjobs\.com$/,
  keka: /(^|\.)keka\.com$/, zohorecruit: /(^|\.)zohorecruit\.(in|com)$/,
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

// Exact posting: the same title once places, work-mode tags and gender tags are set
// aside ("Data Engineer (Remote, India)" = "Data Engineer - Bengaluru"), but any other
// word must match ("Risk Operations Analyst - SSO" ≠ "Risk Operations Analyst").
const ALIAS = { sr: 'senior', snr: 'senior', jr: 'junior', mgr: 'manager', engr: 'engineer', eng: 'engineer', dev: 'developer' };
const TAG = /^\s*(remote|hybrid|on-?site|in-?office|anywhere|worldwide|global|[mfwd]\s*\/\s*[mfwd](\s*\/\s*[mfwdx])?|all genders?)\s*$/i;
const isPlace = (seg) => TAG.test(seg) || !!resolveJob({ location: seg }).cc;
export function titleKey(t) {
  const kept = String(t || '').split(/\s[-–—|:]\s|[()[\]]|,/).filter((s) => s && s.trim() && !isPlace(s));
  const toks = kept.join(' ').toLowerCase().split(/[^a-z0-9+#]+/)
    .map((w) => ALIAS[w] || w).filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w));
  return [...new Set(toks)].sort().join(' ');
}
export const sameTitle = (a, b) => { const k = titleKey(a); return !!k && k === titleKey(b); };

// Regions some postings use instead of a country.
const REGIONS = [
  [/\b(europe|european union|emea|eu)\b/i, ['DE', 'IE', 'NL', 'GB']],
  [/\b(apac|asia|asian)\b/i, ['IN', 'AU', 'AE']], // "Asia", "Asian time zones"
  [/\b(americas|north america)\b/i, ['US']],
  [/\b(middle east|mena|gcc)\b/i, ['AE']],
];
// Countries we don't search in: a posting limited to one of these doesn't fit.
const FOREIGN = /\b(poland|canada|mexico|brazil|argentina|colombia|chile|peru|spain|portugal|france|italy|romania|ukraine|czech(ia| republic)?|hungary|bulgaria|serbia|croatia|greece|turkey|egypt|nigeria|kenya|south africa|singapore|malaysia|philippines|indonesia|vietnam|thailand|japan|korea|china|pakistan|bangladesh|sri lanka|new zealand|sweden|norway|denmark|finland|switzerland|austria|belgium|estonia|latvia|lithuania|israel|saudi arabia|qatar|latam|latin america)\b/i;

/** Every place a posting lists ("Dublin, Ireland; Remote - US"), resolved. */
function placesOf(loc, remote) {
  const parts = String(loc || '').split(/;|\s\|\s|\s\/\s|\bor\b/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [{ cc: null, city: null, remote: !!remote, open: true }];
  return parts.map((p) => {
    // "Virtual", "Anywhere", "Worldwide" are remote too.
    const isRem = remote || /\b(virtual|anywhere|worldwide|work from home|wfh)\b/i.test(p);
    const r = resolveJob({ location: p, country: p, isRemote: isRem }); // country: bare codes like "US", "IN"
    const region = r.cc ? null : REGIONS.find(([re]) => re.test(p))?.[1] || null;
    // "Remote" with no country or region: open to anywhere (description checked separately).
    const open = !r.cc && !region && r.workMode === 'Remote'
      && !/[a-z]{3,}/i.test(p.replace(/\b(remote|virtual|anywhere|worldwide|global|work from home|wfh|job|only|first|friendly)\b/gi, ''));
    return { cc: r.cc, city: r.city, remote: r.workMode === 'Remote', region, open, raw: p };
  });
}

// Sentences that limit who can take a remote job ("must be based in the US").
const LIMIT = /\b(based in|located in|resid(e|ing|ents?) (in|of)|living in|eligible to work in|authori[sz]ed to work in|right to work in|work permit|only (open|available) to|must be in|within the|time ?zones?)\b/i;
/** Countries a remote posting's description limits it to (empty: no limit found). */
function limitsInText(text) {
  const t = String(text || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  const out = new Set();
  for (const s of t.split(/(?<=[.!?])\s/).filter((x) => LIMIT.test(x))) {
    for (const [cc, re] of Object.entries(COUNTRY_WORDS)) if (re.test(s)) out.add(cc);
    if (/(^|[\s,(])US([\s,).]|$)/.test(s)) out.add('US');
    for (const [re, ccs] of REGIONS) if (re.test(s)) ccs.forEach((c) => out.add(c));
    if (FOREIGN.test(s)) out.add('elsewhere');
  }
  return [...out];
}
/** Could the user take this posting, given where the job they approved is? */
function placeFits(src, places, limits = []) {
  return places.some((d) => {
    if (d.open) return !limits.length || (!!src.cc && limits.includes(src.cc));
    if (!src.cc) return !!d.cc; // source place unknown: at least the posting must be somewhere we serve
    if (d.region) return d.region.includes(src.cc);
    if (d.cc !== src.cc) return false; // a different country, or one we don't serve (Poland, Canada…)
    return d.remote || !src.city || !d.city || d.city === src.city;
  });
}
function srcPlace(job) {
  if (job.country) return { cc: job.country, city: job.city || null };
  const r = resolveJob({ location: job.location_raw, workplaceType: job.work_mode, jdText: job.jd_text || '' });
  return { cc: r.cc, city: r.city };
}
const placeLabel = (loc) => String(loc || '').trim() || 'no location';

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

// Public job-board APIs: list a company's open jobs as { title, url, location, remote, country?, text? }.
// country: a structured country field; text: the description, read when the location is just "Remote".
const joinLoc = (...xs) => [...new Set(xs.flat().filter(Boolean).map((x) => String(x).trim()))].join('; ');
// Greenhouse's list has no description or offices; fetch them for the posting being checked.
const ghDetail = (s, id) => async () => {
  const d = await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs/${id}`);
  return d ? { country: joinLoc((d.offices || []).map((o) => o.location || o.name)), text: d.content || '' } : {};
};
const BOARDS = {
  // absolute_url is often the employer's own careers page wrapping the form; use the canonical form.
  greenhouse: async (s) => (await get(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs
    ?.map((j) => ({ title: j.title, url: `https://job-boards.greenhouse.io/${s}/jobs/${j.id}`, location: j.location?.name || '', detail: ghDetail(s, j.id) })),
  lever: async (s) => {
    const j = await get(`https://api.lever.co/v0/postings/${s}?mode=json`);
    return Array.isArray(j) ? j.map((x) => ({
      title: x.text, url: x.hostedUrl, location: joinLoc(x.categories?.location, x.categories?.allLocations || []),
      remote: /remote/i.test(x.workplaceType || ''), country: x.country || '',
      text: [x.descriptionPlain, x.additionalPlain, ...(x.lists || []).map((l) => l.content)].join(' '),
    })) : null;
  },
  ashby: async (s) => (await get(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.map((j) => ({
    title: j.title, url: j.jobUrl, remote: !!j.isRemote,
    location: joinLoc(j.location, (j.secondaryLocations || []).map((x) => x.location)),
    country: j.address?.postalAddress?.addressCountry || '', text: j.descriptionPlain || '',
  })),
  // Workable's careers-page API (the old v1 widget endpoint no longer answers).
  workable: async (s) => {
    try {
      const r = await fetch(`https://apply.workable.com/api/v3/accounts/${s}/jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'JobVibe/1.0' },
        body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return (j.results || []).map((x) => ({
        title: x.title, url: `https://apply.workable.com/${s}/j/${x.shortcode}/`, remote: !!x.remote,
        location: joinLoc((x.locations?.length ? x.locations : [x.location]).filter(Boolean).map((l) => [l.city, l.country].filter(Boolean).join(', '))),
      }));
    } catch { return null; }
  },
  // Recruitee's free-text location is often just "Remote job"; the structured places are reliable.
  recruitee: async (s) => (await get(`https://${s}.recruitee.com/api/offers/`))?.offers?.map((o) => {
    const places = (o.locations?.length ? o.locations : [o]).map((l) => [l.city, l.country].filter(Boolean).join(', ')).filter(Boolean);
    return { title: o.title, url: o.careers_url, remote: !!o.remote, location: places.length ? joinLoc(places) : o.location || '', text: `${o.description || ''} ${o.requirements || ''}` };
  }),
  // Keka career sites (Indian employers): the site's own job list, full JD included.
  keka: async (s) => {
    const r = await kekaAdapter.probe(s).catch(() => ({ live: false }));
    return r.live ? r.jobs.map((j) => ({ title: j.title, url: `https://${s}.keka.com/careers/jobdetails/${j.id}`, location: kekaAdapter.kekaLocation(j), text: j.description || '' })) : null;
  },
  smartrecruiters: async (s) => (await get(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`))?.content
    ?.map((p) => ({ title: p.name, url: `https://jobs.smartrecruiters.com/${s}/${p.id}`, location: [p.location?.city, p.location?.country].filter(Boolean).join(', '), remote: !!p.location?.remote })),
};

/**
 * Pick the one posting that is this job: exact title and a place the user can take.
 * @returns {{ pick?, reason?, postings }} pick when exactly one fits.
 */
async function choose(job, postings) {
  const same = postings.filter((p) => sameTitle(job.title, p.title));
  if (!same.length) return { reason: 'no posting with this exact title on the employer’s form' };
  const src = srcPlace(job);
  const fits = [];
  for (const p of same) {
    let places = p.places || placesOf(p.location, p.remote);
    let limits = [];
    if (places.some((x) => x.open)) {
      // Just "Remote": find out where. A country field first, then the description's limits.
      Object.assign(p, p.detail ? await p.detail() : {});
      if (p.country) {
        p.location = /^\s*remote\s*$/i.test(p.location || '') ? `Remote - ${p.country}` : joinLoc(p.location, `Remote - ${p.country}`);
        places = placesOf(p.country, true);
      }
      if (places.some((x) => x.open)) limits = limitsInText(p.text);
    }
    if (placeFits(src, places, limits)) fits.push(p);
  }
  const urls = [...new Set(fits.map((p) => p.url))];
  if (!urls.length) {
    return { reason: `this title is only open in ${[...new Set(same.map((p) => placeLabel(p.location)))].slice(0, 3).join(' / ')}, not where you're looking` };
  }
  if (urls.length > 1) return { reason: `${urls.length} postings with this title fit; can't tell which one is yours` };
  return { pick: fits[0] };
}

/** Live look-up of the employer's own board. */
export async function discoverOnBoards(job) {
  for (const s of slugs(job.company)) {
    const postings = [];
    for (const [ats, list] of Object.entries(BOARDS)) {
      const jobs = await list(s);
      if (jobs?.length) postings.push(...jobs.map((j) => ({ ...j, ats })));
    }
    if (!postings.length) continue; // not this slug
    const c = await choose(job, postings);
    if (c.pick && BOT_PROTECTED.has(c.pick.ats)) return { reason: `${c.pick.ats}: ${BLOCK_REASON[c.pick.ats]}` };
    return c; // found the employer under this slug
  }
  return { reason: null };
}

/** Same role at the same employer on a supported board, already in our pool. */
async function findInPool(job) {
  const d = await db();
  const co = normCompany(job.company);
  if (co.length < 3) return { reason: null };
  const cands = await d.query(
    `SELECT j.title, j.company, j.apply_url, j.final_url, j.source, j.source_job_id, j.location_raw, j.country, j.city, j.work_mode,
            j.jd_text, c.ats_slug
       FROM jobs j LEFT JOIN companies c ON c.id = j.company_id
      WHERE j.source IN ('greenhouse','lever','ashby') AND j.link_status != 'DEAD' AND j.last_seen_at > ?
        AND LOWER(j.company) LIKE ?`,
    [new Date(Date.now() - 30 * 86400000).toISOString(), `%${co.split(' ')[0]}%`]);
  const postings = cands.filter((c) => normCompany(c.company) === co).map((c) => ({
    ats: c.source, title: c.title, location: c.location_raw, remote: c.work_mode === 'Remote', text: c.jd_text,
    url: c.source === 'greenhouse' && c.ats_slug && c.source_job_id
      ? `https://job-boards.greenhouse.io/${c.ats_slug}/jobs/${c.source_job_id}` : c.final_url || c.apply_url,
    // The pool already resolved the country when it could (location, else a one-country JD).
    places: c.country ? [{ cc: c.country, city: c.city, remote: c.work_mode === 'Remote' }] : undefined,
    detail: c.source === 'greenhouse' && c.ats_slug && c.source_job_id ? ghDetail(c.ats_slug, c.source_job_id) : null,
  }));
  return postings.length ? choose(job, postings) : { reason: null };
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
      if (c.v === ROUTE_V && c.at && Date.now() - new Date(c.at).getTime() < CACHE_DAYS * 86400000 && (c.route === 'auto' || c.live || !live)) return c;
    } catch { /* recompute */ }
  }
  const own = job.final_url || job.apply_url;
  const ownAts = atsOfUrl(own);
  let out;
  if (BOT_PROTECTED.has(ownAts) || BOT_PROTECTED.has(job.source)) {
    out = { route: 'manual', reason: `${ownAts || job.source}: ${BLOCK_REASON[ownAts] || BLOCK_REASON[job.source] || 'blocks automated applications'}` };
  } else if (AUTO_ATS.includes(job.source) || ownAts) {
    out = { route: 'auto', ats: ownAts || job.source, url: own, via: 'job link' };
  } else {
    // Only the exact posting counts: same title, and a place the user can take.
    const pooled = await findInPool(job);
    const posting = (p) => ({ title: p.title, location: placeLabel(p.location) });
    if (pooled.pick) {
      out = { route: 'auto', ats: pooled.pick.ats, url: pooled.pick.url, via: `same posting on ${pooled.pick.ats}`, posting: posting(pooled.pick) };
    } else if (live) {
      const found = await discoverOnBoards(job);
      out = found.pick
        ? { route: 'auto', ats: found.pick.ats, url: found.pick.url, via: `employer's ${found.pick.ats} board`, posting: posting(found.pick) }
        : { route: 'manual', reason: found.reason || pooled.reason || (job.source === 'workday' ? 'Workday needs an account per employer' : `no application form the agent can fill (${job.source})`) };
      out.live = true;
    } else {
      out = { route: 'manual', reason: 'not checked yet' };
    }
  }
  out.v = ROUTE_V;
  out.at = new Date().toISOString();
  if (job.id) {
    const d = await db();
    await d.run('UPDATE jobs SET apply_route = ? WHERE id = ?', [JSON.stringify(out), job.id]);
  }
  return out;
}
