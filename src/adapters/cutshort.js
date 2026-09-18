// Cutshort — an India tech hiring platform that explicitly invites AI agents.
// Its llms.txt states it is "compatible with AI agents like Claude" and offers
// "a public REST API and MCP server"; robots.txt allows /job/ pages (only
// /apply/, /view/j/ and /profile/ are disallowed). This is the opposite of
// Naukri: a wanted, Naukri-class India source.
//
// The recruiter REST API (/api/v1/*) needs a key, but every job page carries a
// complete schema.org JobPosting as JSON-LD. So this adapter:
//   1. reads the public jobs sitemap once (43k+ live jobs), whose URL slugs
//      already contain the title and city, and filters on those — no page
//      fetch for non-matches;
//   2. fetches only the matching job pages (bounded), parsing the JSON-LD.
//
// The apply_url is the job page itself (an allowed /job/ path); the candidate
// applies there normally. Nothing here submits an application.
import { getText, htmlToText, mapLimit, sleep } from '../lib/http.js';
import { normalizeCity, KNOWN_CITIES } from '../lib/india.js';

export const id = 'cutshort';
export const label = 'Cutshort';
export const kind = 'query';
export const trustLink = true;

/** Keyless — always available. */
export function configured() {
  return true;
}

export const setupUrl = 'https://cutshort.io/a/devdocs';

const SITEMAP = 'https://cutshort.io/sitemap_jobs.xml';
const MAX_PAGES_PER_TERM = 25; // bound the page fetches per search term
const CITY_HINT = new RegExp(`(${KNOWN_CITIES.join('|')}|bangalore|gurgaon|remote)`, 'i');

// The sitemap is 8 MB and the same for every search term in a run. Fetch and
// parse it once, then reuse across terms.
let sitemapCache = null;
async function loadSitemap() {
  if (sitemapCache) return sitemapCache;
  const res = await getText(SITEMAP, { timeout: 60000 });
  if (!res.ok) {
    sitemapCache = { urls: [], error: `cutshort sitemap status=${res.status}` };
    return sitemapCache;
  }
  const urls = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  sitemapCache = { urls, error: null };
  return sitemapCache;
}

/** Turn "Senior Project Manager" into a token set for slug matching. */
function termTokens(term) {
  return String(term).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

function slugMatches(url, tokens) {
  const slug = url.toLowerCase();
  if (!CITY_HINT.test(slug)) return false; // must look India-located
  // Every meaningful term token should appear in the slug.
  return tokens.every((t) => slug.includes(t));
}

function parseJobPosting(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const j of items) {
      if (j && j['@type'] === 'JobPosting') return j;
    }
  }
  return null;
}

export async function fetchQuery({ term, pages = 1 }) {
  const { urls, error } = await loadSitemap();
  if (error) return { rows: [], error };

  const tokens = termTokens(term);
  const matched = urls.filter((u) => slugMatches(u, tokens)).slice(0, MAX_PAGES_PER_TERM);
  if (!matched.length) return { rows: [], error: null };

  const rows = [];
  await mapLimit(matched, 4, async (url) => {
    const res = await getText(url, { timeout: 25000, retries: 1 });
    if (!res.ok) return;
    const j = parseJobPosting(res.body);
    if (!j) return;

    const addr = j.jobLocation?.address || {};
    const city = normalizeCity(`${addr.addressLocality || ''} ${addr.addressRegion || ''}`);
    const country = addr.addressCountry;
    const remote = /remote/i.test(j.jobLocationType || '') || /remote/i.test(url);

    rows.push({
      source: id,
      source_job_id: url.split('-').pop(), // the trailing slug id
      title: (j.title || '').trim(),
      company: (j.hiringOrganization?.name || 'Unknown').trim(),
      company_id: null,
      location_raw: [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ')
        || (remote ? 'Remote, India' : 'India'),
      apply_url: j.url && /^https?:/.test(j.url) ? j.url : url, // the allowed /job/ page
      jd_text: htmlToText(j.description || ''),
      posted_at: j.datePosted || null,
      employment_type_hint: [].concat(j.employmentType || []).join(', '),
      is_remote: remote,
      workplace_type: remote ? 'Remote' : '',
      // Sitemap+slug already scoped these to India cities; tell the gate so.
      country: country && /^(IN|India)$/i.test(country) ? 'in' : (city ? 'in' : country),
      city,
      publisher: 'Cutshort',
      // Live by construction: the job is in today's sitemap and not past validThrough.
      verified_by_source: !j.validThrough || new Date(j.validThrough) > new Date(),
      salary_raw: j.baseSalary?.value
        ? `${j.baseSalary.value.minValue || ''}-${j.baseSalary.value.maxValue || ''} ${j.baseSalary.currency || ''}`.trim()
        : '',
    });
    await sleep(150);
  });

  return { rows: rows.filter((r) => r.verified_by_source), error: null };
}

/** Let a run reset the per-run sitemap cache if needed (tests). */
export function _resetCache() {
  sitemapCache = null;
}
