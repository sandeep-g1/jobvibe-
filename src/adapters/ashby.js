// Ashby posting API — public, keyless. Verified fields: jobUrl, applyUrl,
// descriptionPlain, location, isRemote, workplaceType, employmentType, publishedAt.
// https://api.ashbyhq.com/posting-api/job-board/{slug}
import { getJSON } from '../lib/http.js';

export const id = 'ashby';
export const label = 'Ashby';
export const trustLink = true;

export function boardUrl(slug) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
}

export async function probe(slug) {
  const res = await getJSON(boardUrl(slug), { timeout: 25000 });
  if (!res.ok || !Array.isArray(res.data?.jobs)) return { live: false, status: res.status, total: 0 };
  return { live: true, status: res.status, total: res.data.jobs.length, jobs: res.data.jobs };
}

export async function fetchJobs(company) {
  const res = await getJSON(boardUrl(company.ats_slug), { timeout: 30000 });
  if (!res.ok || !Array.isArray(res.data?.jobs)) {
    return { rows: [], error: `ashby:${company.ats_slug} status=${res.status}` };
  }

  const rows = res.data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const secondary = (j.secondaryLocations || [])
        .map((s) => s.location || s.name || '')
        .filter(Boolean)
        .join(' / ');
      return {
        source: id,
        source_job_id: String(j.id ?? ''),
        title: (j.title || '').trim(),
        company: company.name,
        company_id: company.id,
        location_raw: [j.location, secondary].filter(Boolean).join(' / '),
        apply_url: j.jobUrl || j.applyUrl, // provider-supplied
        jd_text: (j.descriptionPlain || '').trim(),
        posted_at: j.publishedAt || null,
        employment_type_hint: j.employmentType || '',
        is_remote: j.isRemote === true,
        workplace_type: j.workplaceType || '',
        country: j.address?.postalAddress?.addressCountry || null,
      };
    });

  return { rows, error: null };
}
