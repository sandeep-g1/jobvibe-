// Greenhouse job boards API — public, keyless, unmetered, full JD in `content`.
// https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
import { getJSON, htmlToText } from '../lib/http.js';

export const id = 'greenhouse';
export const label = 'Greenhouse';
export const trustLink = true; // boards are not bot-hostile

export function boardUrl(slug) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
}

/** Probe a board without ingesting — used by the seed/verify step. */
export async function probe(slug) {
  const res = await getJSON(boardUrl(slug), { timeout: 25000 });
  if (!res.ok || !Array.isArray(res.data?.jobs)) {
    return { live: false, status: res.status, total: 0 };
  }
  return { live: true, status: res.status, total: res.data.jobs.length, jobs: res.data.jobs };
}

export async function fetchJobs(company) {
  const res = await getJSON(boardUrl(company.ats_slug), { timeout: 30000 });
  if (!res.ok || !Array.isArray(res.data?.jobs)) {
    return { rows: [], error: `greenhouse:${company.ats_slug} status=${res.status}` };
  }

  const rows = res.data.jobs.map((j) => ({
    source: id,
    source_job_id: String(j.id ?? ''),
    title: (j.title || '').trim(),
    company: company.name,
    company_id: company.id,
    location_raw: j.location?.name || '',
    apply_url: j.absolute_url, // provider-supplied, never assembled
    jd_text: htmlToText(j.content || ''),
    posted_at: j.updated_at || j.first_published || null,
    employment_type_hint: '',
    is_remote: /remote/i.test(j.location?.name || ''),
    workplace_type: '',
    country: null,
  }));

  return { rows, error: null };
}
