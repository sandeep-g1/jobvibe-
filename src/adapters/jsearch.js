// JSearch (RapidAPI, OpenWeb Ninja) — Tier A, and the important one: it
// aggregates Google for Jobs, which indexes LinkedIn, Indeed, Naukri, Foundit,
// Glassdoor and the rest. This is how those portals are reached without
// scraping them: `job_apply_link` is the canonical link Google resolved to,
// and `job_publisher` says which portal it came from.
//
// API v5. Two things differ from earlier versions and both were found the hard
// way against the live API:
//   * the endpoint is /search-v2, not /search
//   * results are nested at data.jobs, not data
import { getJSON } from '../lib/http.js';
import { keys, hasKey } from '../lib/keys.js';

export const id = 'jsearch';
export const label = 'Google for Jobs';
export const kind = 'query';
export const trustLink = true;

export function configured() {
  return hasKey('jsearch');
}

export const setupUrl = 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch';

const HOST = 'jsearch.p.rapidapi.com';

export async function fetchQuery({ term, location = 'India', page = 1, datePosted = 'month', pages = 1 }) {
  const k = keys().jsearch;
  const q = new URLSearchParams({
    query: `${term} in ${location}`,
    page: String(page),
    num_pages: String(pages),
    country: 'in',
    date_posted: datePosted,
  });

  const res = await getJSON(`https://${HOST}/search-v2?${q}`, {
    timeout: 30000,
    headers: {
      'x-rapidapi-key': k.rapidApiKey,
      'x-rapidapi-host': HOST,
    },
  });

  if (!res.ok) return { rows: [], error: `jsearch status=${res.status}` };

  const jobs = res.data?.data?.jobs;
  if (!Array.isArray(jobs)) {
    return { rows: [], error: `jsearch: unexpected shape (${Object.keys(res.data?.data || {}).join(',') || 'no data'})` };
  }

  const rows = jobs
    .filter((j) => typeof j.job_apply_link === 'string' && j.job_apply_link)
    .map((j) => ({
      source: id,
      source_job_id: String(j.job_id ?? ''),
      title: (j.job_title || '').trim(),
      company: (j.employer_name || 'Unknown').trim(),
      company_id: null,
      location_raw: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', '),
      apply_url: j.job_apply_link, // provider-supplied, resolved by Google
      jd_text: j.job_description || '',
      posted_at: j.job_posted_at_datetime_utc || null,
      employment_type_hint: j.job_employment_type || (j.job_employment_types || [])[0] || '',
      is_remote: j.job_is_remote === true,
      workplace_type: j.job_is_remote ? 'Remote' : '',
      country: j.job_country || 'IN',
      // Which portal this actually came from — drives the per-portal reports.
      publisher: j.job_publisher || (j.job_publishers || [])[0] || '',
      salary_raw: j.job_min_salary
        ? `${j.job_min_salary}-${j.job_max_salary || j.job_min_salary} ${j.job_salary_currency || ''}`.trim()
        : '',
    }));

  return { rows, error: null };
}
