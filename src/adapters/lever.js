// Lever postings API — public, keyless. Gives hostedUrl, applyUrl and
// descriptionPlain, so no HTML stripping and no URL assembly.
// https://api.lever.co/v0/postings/{slug}?mode=json
import { getJSON } from '../lib/http.js';

export const id = 'lever';
export const label = 'Lever';
export const trustLink = true;

export function boardUrl(slug) {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
}

export async function probe(slug) {
  const res = await getJSON(boardUrl(slug), { timeout: 25000 });
  if (!res.ok || !Array.isArray(res.data)) return { live: false, status: res.status, total: 0 };
  return { live: true, status: res.status, total: res.data.length, jobs: res.data };
}

export async function fetchJobs(company) {
  const res = await getJSON(boardUrl(company.ats_slug), { timeout: 30000 });
  if (!res.ok || !Array.isArray(res.data)) {
    return { rows: [], error: `lever:${company.ats_slug} status=${res.status}` };
  }

  const rows = res.data.map((j) => {
    const desc = [j.descriptionPlain || '', ...(j.lists || []).map(
      (l) => `${l.text || ''}\n${String(l.content || '').replace(/<[^>]+>/g, ' ')}`
    )].join('\n');

    return {
      source: id,
      source_job_id: String(j.id ?? ''),
      title: (j.text || '').trim(),
      company: company.name,
      company_id: company.id,
      location_raw: j.categories?.location || '',
      apply_url: j.hostedUrl || j.applyUrl, // provider-supplied
      jd_text: desc.trim(),
      posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      employment_type_hint: j.categories?.commitment || '',
      is_remote: /remote/i.test(j.categories?.location || '') ||
                 /remote/i.test(j.workplaceType || ''),
      workplace_type: j.workplaceType || '',
      country: null,
    };
  });

  return { rows, error: null };
}
