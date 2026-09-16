// Himalayas — remote jobs through its official, documented public API.
// No key. The country filter scopes results to roles open to India.
//   https://himalayas.app/jobs/api/search?q=...&country=India
//
// Job pages sit behind a Cloudflare browser challenge, so fetching a link from
// a script returns 403 even when the job is live. The verifier is told to trust
// the API instead: a job listed in the API response today with an expiryDate in
// the future is treated as live. That is a stronger signal than an HTTP probe
// would be, not a weaker one.
import { getJSON, htmlToText, sleep } from '../lib/http.js';

export const id = 'himalayas';
export const label = 'Himalayas';
export const kind = 'query';
export const trustLink = true;

/** Keyless — always available. */
export function configured() {
  return true;
}

export const setupUrl = 'https://himalayas.app/api';

const PAGE = 20; // the API caps limit at 20

export async function fetchQuery({ term, pages = 3 }) {
  const rows = [];
  let error = null;

  for (let p = 0; p < pages; p++) {
    const q = new URLSearchParams({
      q: term,
      country: 'India',
      limit: String(PAGE),
      offset: String(p * PAGE),
    });
    const res = await getJSON(`https://himalayas.app/jobs/api/search?${q}`, { timeout: 30000 });
    if (!res.ok || !Array.isArray(res.data?.jobs)) {
      error = `himalayas status=${res.status}`;
      break;
    }

    const now = Date.now() / 1000;
    for (const j of res.data.jobs) {
      if (typeof j.applicationLink !== 'string' || !j.applicationLink) continue;
      if (j.expiryDate && j.expiryDate < now) continue; // expired: not live

      const restrictions = Array.isArray(j.locationRestrictions) ? j.locationRestrictions : [];
      const indiaOnly = restrictions.some((r) => /india/i.test(r));

      rows.push({
        source: id,
        source_job_id: j.guid || j.applicationLink,
        title: (j.title || '').trim(),
        company: (j.companyName || 'Unknown').trim(),
        company_id: null,
        // Remote roles: either restricted to India, or open worldwide.
        location_raw: indiaOnly ? 'Remote, India' : 'Remote (worldwide, includes India)',
        apply_url: j.applicationLink, // provider-supplied
        jd_text: htmlToText(j.description || j.excerpt || ''),
        posted_at: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : null,
        employment_type_hint: j.employmentType || '',
        is_remote: true,
        workplace_type: 'Remote',
        // The API already scoped these to India; tell the India gate so.
        country: 'in',
        publisher: 'Himalayas',
        salary_raw: j.minSalary
          ? `${j.minSalary}-${j.maxSalary || j.minSalary} ${j.currency || ''} ${j.salaryPeriod || ''}`.trim()
          : '',
        // Liveness proven by the API itself, so the HTTP probe can be skipped.
        verified_by_source: true,
      });
    }

    if (res.data.jobs.length < PAGE) break;
    await sleep(400); // be polite between pages
  }

  return { rows, error };
}
