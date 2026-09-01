// Adzuna India — Tier A. Free key from https://developer.adzuna.com/
// Broad India index with salary estimates. Apply link is `redirect_url`.
import { getJSON, htmlToText } from '../lib/http.js';
import { keys, hasKey } from '../lib/keys.js';

export const id = 'adzuna';
export const label = 'Adzuna';
export const kind = 'query';
export const trustLink = true;

export function configured() {
  return hasKey('adzuna');
}

export const setupUrl = 'https://developer.adzuna.com/';

/** One call per search term. Adzuna caps results_per_page at 50. */
export async function fetchQuery({ term, location, perPage = 50, maxAge = 30 }) {
  const k = keys().adzuna;
  const q = new URLSearchParams({
    app_id: k.appId,
    app_key: k.appKey,
    results_per_page: String(perPage),
    what: term,
    max_days_old: String(maxAge),
    content_type: 'application/json',
  });
  if (location) q.set('where', location);

  const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?${q}`;
  const res = await getJSON(url, { timeout: 25000 });
  if (!res.ok || !Array.isArray(res.data?.results)) {
    return { rows: [], error: `adzuna status=${res.status}` };
  }

  const rows = res.data.results
    .filter((j) => typeof j.redirect_url === 'string' && j.redirect_url)
    .map((j) => ({
      source: id,
      source_job_id: String(j.id ?? ''),
      title: (j.title || '').replace(/<[^>]+>/g, '').trim(),
      company: (j.company?.display_name || 'Unknown').trim(),
      company_id: null,
      location_raw: j.location?.display_name || (j.location?.area || []).join(', '),
      apply_url: j.redirect_url, // provider-supplied
      jd_text: htmlToText(j.description || ''),
      posted_at: j.created || null,
      employment_type_hint: j.contract_time || '',
      is_remote: /remote/i.test(j.location?.display_name || ''),
      workplace_type: '',
      country: 'in', // the /jobs/in/ endpoint is India-scoped
      salary_raw: j.salary_min
        ? `${Math.round(j.salary_min / 100000)}-${Math.round((j.salary_max || j.salary_min) / 100000)} LPA`
        : '',
    }));

  return { rows, error: null };
}
