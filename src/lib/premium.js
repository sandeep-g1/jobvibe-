// Premium jobs: a reputed employer that pays well. These get the extra tailoring pass
// (tailorResume push) aimed at a higher ATS score; every CV still gets the "reads like AI?" review.
//
//   reputed   a cached one-time rating per company: tier 1 = well-known large company, MNC, bank,
//             listed company or top product/fintech firm; staffing agencies posting for an
//             unnamed client never count.
//   pays well the posted salary reaches the bar (profile.premiumMinLpa, else current CTC + 20%);
//             with no salary posted, the employer's usual pay level must not be "low".
import { db } from '../db/driver.js';
import { generate } from './gemini.js';

const key = (name) => String(name || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|llp|india|technologies|corp(oration)?)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** { tier: 1|2|3, pay: 'high'|'average'|'low', staffing: bool } for an employer, rated once. */
export async function companyRating(name) {
  const k = key(name);
  if (!k) return null;
  const d = await db();
  const hit = await d.one('SELECT tier, pay, staffing FROM company_ratings WHERE name = ?', [k]);
  if (hit) return { tier: Number(hit.tier), pay: hit.pay, staffing: !!Number(hit.staffing) };
  const r = await generate(`Rate this employer for a job seeker in India. Employer: "${name}"
- tier: 1 = well-known large company, MNC, bank, listed company, or top product / fintech / funded startup;
  2 = established mid-size company; 3 = unknown or very small.
- staffing: true if it is a recruitment, staffing or job-placement agency (posting for someone else's job).
- pay: the employer's usual pay versus the Indian market for professional roles: "high", "average" or "low".
If you don't recognise the name, say tier 3, pay "average".
Return ONLY JSON: {"tier":1,"staffing":false,"pay":"average","note":"a few words"}`, { json: true, temperature: 0, maxTokens: 512 });
  let out = null;
  try { out = JSON.parse(r.text); } catch { /* unrated */ }
  if (!out || ![1, 2, 3].includes(Number(out.tier))) return null; // try again next time
  const rating = { tier: Number(out.tier), pay: ['high', 'average', 'low'].includes(out.pay) ? out.pay : 'average', staffing: out.staffing === true };
  await d.run(`INSERT INTO company_ratings (name, tier, pay, staffing, note, rated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT (name) DO NOTHING`, [k, rating.tier, rating.pay, rating.staffing ? 1 : 0, String(out.note || '').slice(0, 120), new Date().toISOString()]);
  return rating;
}

/** Highest annual figure in a salary text, in lakhs (LPA). null when none can be read. */
export function salaryLpa(raw) {
  const s = String(raw || '').toLowerCase().replace(/,/g, '');
  if (!s.trim()) return null;
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lacs?|l\b|cr|crores?|k\b)?/g)].map((m) => {
    const n = Number(m[1]); const u = m[2] || '';
    if (/^(lpa|lakh|lac|l)/.test(u)) return n;
    if (/^cr/.test(u)) return n * 100;
    if (u === 'k') return /month|pm|per month/.test(s) ? (n * 12) / 100 : n / 100; // ₹k: monthly or yearly
    if (n >= 100000) return (/month|pm|per month/.test(s) ? n * 12 : n) / 100000; // plain rupees
    return null;
  }).filter((x) => x && x > 0.5 && x < 1000);
  return nums.length ? Math.max(...nums) : null;
}

/**
 * @returns {Promise<{ premium: boolean, why: string }>}
 */
export async function isPremium(job, profile = {}) {
  const rating = await companyRating(job.company).catch(() => null);
  if (!rating) return { premium: false, why: 'employer not rated' };
  if (rating.staffing) return { premium: false, why: 'staffing agency' };
  if (rating.tier !== 1) return { premium: false, why: `tier ${rating.tier} employer` };
  const ctc = Number(profile.answers?.currentCtcLpa) || null;
  const bar = Number(profile.premiumMinLpa) || (ctc ? Math.round(ctc * 1.2 * 10) / 10 : null);
  const posted = salaryLpa(job.salary_raw);
  if (posted != null && bar != null) {
    return posted >= bar ? { premium: true, why: `reputed employer, pays up to ${posted} LPA` } : { premium: false, why: `pays up to ${posted} LPA, below ${bar}` };
  }
  return rating.pay === 'low' ? { premium: false, why: 'employer usually pays low' } : { premium: true, why: `reputed employer (${rating.pay} pay)` };
}
