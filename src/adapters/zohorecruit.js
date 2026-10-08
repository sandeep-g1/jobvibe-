// Zoho Recruit career sites: https://{company}.zohorecruit.in (or .com) /jobs/Careers.
// The page carries its open jobs as JSON in a hidden field (id="jobs"): title, city,
// country, job type, id. No description in that list, and its application form ends with
// an image CAPTCHA, so these jobs are "apply yourself" (see apply-route BOT_PROTECTED).
// `ats_slug` is the site's host, e.g. "zeta.zohorecruit.in".
import { getText } from '../lib/http.js';

export const id = 'zohorecruit';
export const label = 'Zoho Recruit';
export const trustLink = true;

const decode = (s) => s.replace(/&#34;/g, '"').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function listJobs(host) {
  const r = await getText(`https://${host}/jobs/Careers`, { timeout: 30000, retries: 0 });
  if (!r.ok) return { ok: false, status: r.status };
  const m = String(r.body).match(/value="(\[[^"]*\])"\s+id="jobs"/);
  if (!m) return { ok: false, status: 404 }; // "Page does not exist": no career site
  try { return { ok: true, jobs: JSON.parse(decode(m[1])) }; } catch { return { ok: false, status: 500 }; }
}

export async function probe(host) {
  const r = await listJobs(host);
  return r.ok ? { live: true, status: 200, total: r.jobs.length, jobs: r.jobs } : { live: false, status: r.status, total: 0 };
}

const slugTitle = (t) => String(t || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function fetchJobs(company) {
  const host = company.ats_slug;
  const r = await listJobs(host);
  if (!r.ok) return { rows: [], error: `zohorecruit:${host} status=${r.status}` };
  const rows = r.jobs.filter((j) => j.Publish !== false && j.id).map((j) => {
    const title = String(j.Posting_Title || j.Job_Opening_Name || '').trim();
    const location = [j.City, j.Country].filter(Boolean).join(', ');
    return {
      source: id,
      source_job_id: String(j.id),
      title,
      company: company.name,
      company_id: company.id,
      location_raw: location,
      apply_url: `https://${host}/jobs/Careers/${j.id}/${slugTitle(title)}?source=CareerSite`,
      // The list has no description: title, industry and type are what there is.
      jd_text: [title, j.Industry, j.Job_Type, location].filter(Boolean).join('. '),
      posted_at: null,
      employment_type_hint: j.Job_Type || '',
      is_remote: j.Remote_Job === true,
      workplace_type: j.Remote_Job ? 'Remote' : '',
      country: j.Country || null,
    };
  });
  return { rows, error: null };
}
