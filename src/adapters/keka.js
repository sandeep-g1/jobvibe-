// Keka careers: the HR system many Indian companies use. Each company's career site is
// https://{company}.keka.com/careers; its page names the career portal's id, and
// /careers/api/embedjobs/default/active/{id} lists every open job with the full JD.
// Public and keyless (the career site's own data). Applications need no account.
import { getText, getJSON, htmlToText } from '../lib/http.js';

export const id = 'keka';
export const label = 'Keka';
export const trustLink = true;

const site = (slug) => `https://${slug}.keka.com/careers`;
const MAX_AGE_DAYS = 90; // Keka leaves old openings up; skip the stale ones

/** The company's career-portal id, or null when it has no Keka career site. */
async function portalId(slug) {
  const r = await getText(`${site(slug)}/`, { timeout: 20000, retries: 0 });
  if (!r.ok) return null;
  return (String(r.body).match(/\/ats\/documents\/([0-9a-f-]{36})\//i) || [])[1] || null;
}

async function listJobs(slug) {
  const pid = await portalId(slug);
  if (!pid) return { ok: false, status: 404 };
  const res = await getJSON(`${site(slug)}/api/embedjobs/default/active/${pid}`, { timeout: 25000 });
  return res.ok && Array.isArray(res.data) ? { ok: true, jobs: res.data } : { ok: false, status: res.status };
}

export async function probe(slug) {
  const r = await listJobs(slug);
  return r.ok ? { live: true, status: 200, total: r.jobs.length, jobs: r.jobs } : { live: false, status: r.status, total: 0 };
}

/** "Mumbai, India; Bengaluru, India" from Keka's structured locations. */
export const kekaLocation = (j) => (j.jobLocations || [])
  .map((l) => [l.city, l.countryName].filter(Boolean).join(', ') || l.name).filter(Boolean).join('; ');

export async function fetchJobs(company) {
  const r = await listJobs(company.ats_slug);
  if (!r.ok) return { rows: [], error: `keka:${company.ats_slug} status=${r.status}` };
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const rows = r.jobs
    .filter((j) => !j.publishedOn || new Date(j.publishedOn).getTime() > cutoff)
    .map((j) => ({
      source: id,
      source_job_id: String(j.id),
      title: String(j.title || '').trim(),
      company: company.name,
      company_id: company.id,
      location_raw: kekaLocation(j),
      apply_url: `${site(company.ats_slug)}/jobdetails/${j.id}`, // the site's own job page
      jd_text: htmlToText(j.description || ''),
      posted_at: j.publishedOn || null,
      employment_type_hint: '',
      is_remote: /remote/i.test(kekaLocation(j)),
      workplace_type: '',
      country: (j.jobLocations || [])[0]?.countryCode || null,
    }));
  return { rows, error: null };
}
