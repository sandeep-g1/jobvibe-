// SmartRecruiters postings API — public, keyless, and the only Tier-B source
// with a server-side India filter (?country=in). Bosch alone returns 540 India
// postings, so this is the highest-yield adapter for the India gate.
//
// The list endpoint carries no apply URL and no JD, so each kept posting needs
// one detail call. That is bounded by DETAIL_CAP per company.
import { getJSON, mapLimit, htmlToText } from '../lib/http.js';

export const id = 'smartrecruiters';
export const label = 'SmartRecruiters';
export const trustLink = true;

const DETAIL_CAP = 40;      // detail calls per company per run
const DETAIL_CONCURRENCY = 6;

export function boardUrl(slug, { country = 'in', limit = 100, offset = 0 } = {}) {
  const q = new URLSearchParams({ country, limit: String(limit), offset: String(offset) });
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?${q}`;
}

export async function probe(slug) {
  const res = await getJSON(boardUrl(slug, { limit: 10 }), { timeout: 25000 });
  if (!res.ok || !Array.isArray(res.data?.content)) {
    return { live: false, status: res.status, total: 0 };
  }
  // totalFound here is already India-scoped, which makes the seed report accurate.
  return {
    live: true,
    status: res.status,
    total: res.data.totalFound ?? res.data.content.length,
    indiaTotal: res.data.totalFound ?? 0,
    jobs: res.data.content,
  };
}

async function detail(slug, postingId) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(postingId)}`;
  const res = await getJSON(url, { timeout: 25000, retries: 1 });
  if (!res.ok || !res.data) return null;
  return res.data;
}

function jdFromAd(jobAd) {
  const s = jobAd?.sections || {};
  return [
    s.jobDescription?.text,
    s.qualifications?.text,
    s.additionalInformation?.text,
  ]
    .filter(Boolean)
    .map(htmlToText)
    .join('\n\n')
    .trim();
}

export async function fetchJobs(company) {
  const list = await getJSON(boardUrl(company.ats_slug, { limit: 100 }), { timeout: 30000 });
  if (!list.ok || !Array.isArray(list.data?.content)) {
    return { rows: [], error: `smartrecruiters:${company.ats_slug} status=${list.status}` };
  }

  const postings = list.data.content.slice(0, DETAIL_CAP);
  const details = await mapLimit(postings, DETAIL_CONCURRENCY, (p) => detail(company.ats_slug, p.id));

  const rows = [];
  for (let i = 0; i < postings.length; i++) {
    const p = postings[i];
    const d = details[i];
    // No detail => no provider apply URL => the row is dropped, never assembled.
    if (!d || !(d.postingUrl || d.applyUrl)) continue;

    rows.push({
      source: id,
      source_job_id: String(p.id ?? ''),
      title: (p.name || d.name || '').trim(),
      company: company.name,
      company_id: company.id,
      location_raw: p.location?.fullLocation ||
        [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', '),
      apply_url: d.postingUrl || d.applyUrl, // provider-supplied
      jd_text: jdFromAd(d.jobAd),
      posted_at: p.releasedDate || d.releasedDate || null,
      employment_type_hint: p.typeOfEmployment?.label || '',
      is_remote: p.location?.remote === true,
      workplace_type: p.location?.hybrid ? 'Hybrid' : p.location?.remote ? 'Remote' : '',
      country: p.location?.country || 'in',
    });
  }

  const skipped = postings.length - rows.length;
  return {
    rows,
    error: skipped > 0 ? `smartrecruiters:${company.ats_slug} skipped ${skipped} without provider URL` : null,
  };
}
