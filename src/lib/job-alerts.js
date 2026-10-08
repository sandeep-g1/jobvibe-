// Job alerts from the portals common in India (Naukri, LinkedIn, Indeed, Foundit,
// Instahyre, IIMJobs, Hirist, Glassdoor…), arriving in the user's job-hunt inbox
// directly or forwarded from another address. The portals send these to the user;
// nothing is fetched from the portals themselves.
//
// For each job in an alert: look for the same posting on the employer's own
// application system (exact title + a location the user can take). Found: the job
// joins the pool with the employer's form as its link, so the agent can apply there.
// Not found: it joins with the portal link, for the user to apply herself.
import { createHash } from 'node:crypto';
import { generate, geminiConfigured } from './gemini.js';
import { discoverOnBoards } from './apply-route.js';
import { resolveJob } from './geo.js';
import { htmlToText } from './http.js';

export const PORTALS = [
  ['linkedin', /linkedin\.com/i], ['naukri', /naukri\.com/i], ['indeed', /indeed\.com/i],
  ['foundit', /foundit\.(in|com)|monsterindia\.com/i], ['instahyre', /instahyre\.com/i], ['iimjobs', /iimjobs\.com/i],
  ['hirist', /hirist\.(tech|com)/i], ['glassdoor', /glassdoor\./i], ['shine', /shine\.com/i], ['timesjobs', /timesjobs\.com/i],
  ['apna', /apna\.co/i], ['wellfound', /wellfound\.com|angel\.co/i],
];
// Alerts, not application updates ("your application was viewed").
const ALERT = /job alert|jobs? (for you|matching|you may|recommended)|recommended (jobs?|for you)|new jobs?|is hiring|@ |opportunit|openings?|match(es)? your|jobs? in /i;
const NOT_ALERT = /application (was |has been )?(sent|viewed|received|submitted)|you applied|your application|recruiter (viewed|messaged)|interview|verify|password|otp/i;

/** Which portal an email is a job alert from (also when forwarded), or null. */
export function alertPortal(mail) {
  const subject = String(mail.subject || '');
  if (NOT_ALERT.test(subject) || !ALERT.test(`${subject} ${String(mail.text || '').slice(0, 400)}`)) return null;
  const from = String(mail.fromAddr || mail.from || '');
  for (const [name, re] of PORTALS) if (re.test(from)) return name;
  // Forwarded: the original sender appears in the body ("From: LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>").
  if (/^(fwd?|fw):/i.test(subject)) {
    const head = String(mail.text || '').slice(0, 1500);
    for (const [name, re] of PORTALS) if (re.test(head)) return name;
  }
  return null;
}

/** The jobs in one alert email: [{ title, company, location, link }]. */
export async function extractAlertJobs(mail, portal) {
  // Indeed sends one job per email, in the subject: "Title @ Company".
  const one = String(mail.subject || '').match(/^(?:fwd?:\s*)?(.+?)\s+@\s+(.+)$/i);
  if (portal === 'indeed' && one) {
    const link = (mail.links || []).find((l) => l.text.toLowerCase() === one[1].trim().toLowerCase())?.href
      || (mail.links || []).find((l) => /view job/i.test(l.text))?.href || '';
    const loc = String(mail.text || '').match(new RegExp(`${one[2].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+([A-Z][A-Za-z .,]+?)(?:\\s+(?:Job type|Work setting|View job|Salary)|$)`));
    return [{ title: one[1].trim(), company: one[2].trim(), location: loc ? loc[1].trim() : '', link }];
  }
  if (!geminiConfigured()) return [];
  const links = (mail.links || []).filter((l) => l.text.length > 3 && l.text.length < 120)
    .map((l, i) => `[${i}] ${l.text}`).join('\n').slice(0, 6000);
  const prompt = `This is a job-alert email from ${portal}. List every job it advertises.
For each job give the exact job title, the company, the location as written, and the number of the link
(from LINKS) that opens that job. Skip ads, courses, "see all jobs" links and anything that is not a single job.
Return ONLY JSON: {"jobs":[{"title":"","company":"","location":"","link":0}]}

SUBJECT: ${mail.subject}
EMAIL TEXT:
${String(mail.text || '').slice(0, 6000)}

LINKS:
${links}`;
  const r = await generate(prompt, { json: true, temperature: 0, maxTokens: 4096 });
  if (!r.ok) return [];
  let parsed; try { parsed = JSON.parse(r.text); } catch { parsed = null; }
  const list = (mail.links || []).filter((l) => l.text.length > 3 && l.text.length < 120);
  return (parsed?.jobs || []).slice(0, 25).map((j) => ({
    title: String(j.title || '').trim(), company: String(j.company || '').trim(), location: String(j.location || '').trim(),
    link: list[Number(j.link)]?.href || '',
  })).filter((j) => j.title && j.company);
}

/**
 * Adapter-shaped rows for the pool. The employer's own posting when it can be found
 * (that's where the agent can apply), the portal link otherwise.
 */
export async function alertRows(mail, portal) {
  const jobs = await extractAlertJobs(mail, portal);
  const rows = [];
  for (const j of jobs) {
    const place = resolveJob({ location: j.location });
    const found = await discoverOnBoards({ company: j.company, title: j.title, location_raw: j.location, country: place.cc, city: place.city }).catch(() => ({}));
    const pick = found?.pick;
    let jd = '';
    if (pick) jd = pick.text || (pick.detail ? (await pick.detail().catch(() => ({}))).text || '' : '');
    rows.push({
      source: 'alerts',
      source_job_id: `${portal}:${createHash('sha1').update(`${j.company}|${j.title}|${j.location}`.toLowerCase()).digest('hex').slice(0, 16)}`,
      title: j.title,
      company: j.company,
      company_id: null,
      location_raw: pick?.location && pick.location !== 'no location' ? pick.location : j.location,
      apply_url: pick ? pick.url : j.link,
      jd_text: htmlToText(jd) || `${j.title} at ${j.company}, ${j.location}. (From a ${portal} job alert.)`,
      posted_at: mail.date || null,
      is_remote: /remote/i.test(j.location),
      workplace_type: '',
      publisher: portal,
      alt_links: j.link ? [{ publisher: portal, url: j.link }] : [],
      // The portal just sent it: live. (Their pages block automated checks anyway.)
      verified_by_source: true,
      employerForm: !!pick,
    });
  }
  return rows;
}
