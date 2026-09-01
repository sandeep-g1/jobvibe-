// Careerjet India — Tier A. Free affiliate id from https://www.careerjet.com/partners/
// Large India index. Apply link is `url`.
import { getJSON, htmlToText } from '../lib/http.js';
import { keys, hasKey } from '../lib/keys.js';

export const id = 'careerjet';
export const label = 'Careerjet';
export const kind = 'query';
export const trustLink = true;

export function configured() {
  return hasKey('careerjet');
}

export const setupUrl = 'https://www.careerjet.com/partners/';

export async function fetchQuery({ term, location = 'India', perPage = 50 }) {
  const k = keys().careerjet;
  const q = new URLSearchParams({
    locale_code: 'en_IN',
    keywords: term,
    location,
    affid: k.affid,
    pagesize: String(perPage),
    page: '1',
    sort: 'date',
    // The API requires these to attribute the request.
    user_ip: '127.0.0.1',
    user_agent: 'Mozilla/5.0',
    url: 'http://localhost/',
  });

  const res = await getJSON(`http://public.api.careerjet.net/search?${q}`, { timeout: 25000 });
  if (!res.ok || res.data?.type !== 'JOBS' || !Array.isArray(res.data?.jobs)) {
    return { rows: [], error: `careerjet status=${res.status} type=${res.data?.type || '?'}` };
  }

  const rows = res.data.jobs
    .filter((j) => typeof j.url === 'string' && j.url)
    .map((j) => ({
      source: id,
      source_job_id: '',
      title: (j.title || '').trim(),
      company: (j.company || 'Unknown').trim(),
      company_id: null,
      location_raw: j.locations || location,
      apply_url: j.url, // provider-supplied
      jd_text: htmlToText(j.description || ''),
      posted_at: j.date ? new Date(j.date).toISOString() : null,
      employment_type_hint: '',
      is_remote: /remote/i.test(j.locations || ''),
      workplace_type: '',
      country: 'in',
      publisher: j.site || '',
      salary_raw: j.salary || '',
    }));

  return { rows, error: null };
}
