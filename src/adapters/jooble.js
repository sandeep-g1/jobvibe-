// Jooble India — Tier A. Free key from https://jooble.org/api/about
// POST-based API. Apply link is `link`.
import { keys, hasKey } from '../lib/keys.js';
import { htmlToText } from '../lib/http.js';

export const id = 'jooble';
export const label = 'Jooble';
export const kind = 'query';
export const trustLink = true;

export function configured() {
  return hasKey('jooble');
}

export const setupUrl = 'https://jooble.org/api/about';

/** Conservative monthly call budget (src/lib/quota.js spreads it over the month; a 429 pauses it). */
export const monthlyBudget = 500;

export async function fetchQuery({ term, location = 'India', page = 1 }) {
  const k = keys().jooble;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);

  let data;
  try {
    const res = await fetch(`https://jooble.org/api/${encodeURIComponent(k.apiKey)}`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      // Jooble's API matches India only as "India" (or "<city>, India"); a bare city
      // ("bengaluru", "Bangalore, Karnataka") returns nothing.
      body: JSON.stringify({ keywords: term, location: /india/i.test(location) ? location : `${location}, India`, page: String(page) }),
    });
    clearTimeout(timer);
    if (!res.ok) return { rows: [], error: `jooble status=${res.status}` };
    data = await res.json();
  } catch (err) {
    clearTimeout(timer);
    return { rows: [], error: `jooble ${err.message}` };
  }

  const rows = (data?.jobs || [])
    .filter((j) => typeof j.link === 'string' && j.link)
    .map((j) => ({
      source: id,
      source_job_id: String(j.id ?? ''),
      title: (j.title || '').trim(),
      company: (j.company || 'Unknown').trim(),
      company_id: null,
      location_raw: j.location || location,
      apply_url: j.link, // provider-supplied
      jd_text: htmlToText(j.snippet || ''),
      posted_at: j.updated || null,
      employment_type_hint: j.type || '',
      is_remote: /remote/i.test(j.location || ''),
      workplace_type: '',
      country: 'in',
      publisher: j.source || '',
      salary_raw: j.salary || '',
    }));

  return { rows, error: null };
}
