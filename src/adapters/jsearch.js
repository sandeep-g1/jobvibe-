// JSearch (RapidAPI) — Tier A, and the important one: it aggregates
// Google for Jobs, which indexes Naukri, LinkedIn, Indeed, Foundit, Shine,
// TimesJobs and Hirist. This is how you reach those portals without scraping
// them. `job_apply_link` is the canonical link Google resolved to, and
// `job_publisher` tells you which portal it came from.
//
// Free key: https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
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

export async function fetchQuery({ term, location = 'India', page = 1, datePosted = 'month' }) {
  const k = keys().jsearch;
  const q = new URLSearchParams({
    query: `${term} in ${location}`,
    page: String(page),
    num_pages: '1',
    country: 'in',
    date_posted: datePosted,
  });

  const res = await getJSON(`https://jsearch.p.rapidapi.com/search?${q}`, {
    timeout: 25000,
    headers: {
      'X-RapidAPI-Key': k.rapidApiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  });

  if (!res.ok || !Array.isArray(res.data?.data)) {
    return { rows: [], error: `jsearch status=${res.status}` };
  }

  const rows = res.data.data
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
      employment_type_hint: j.job_employment_type || '',
      is_remote: j.job_is_remote === true,
      workplace_type: j.job_is_remote ? 'Remote' : '',
      country: j.job_country || 'IN',
      // Which Indian portal this actually came from — shown as the source badge.
      publisher: j.job_publisher || '',
      salary_raw: j.job_min_salary
        ? `${j.job_min_salary}-${j.job_max_salary || j.job_min_salary} ${j.job_salary_currency || ''}`
        : '',
    }));

  return { rows, error: null };
}
