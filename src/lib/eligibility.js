// Must-haves: before a job is picked, check the requirements the posting says are mandatory
// (degree type, years managing people, languages, licences…) against her CV. A job she clearly
// can't meet is left out, with the reason. Checked once per user and job (cached).
import { db } from '../db/driver.js';
import { generate } from './gemini.js';

function parse(text) {
  try { return JSON.parse(text); } catch { /* salvage */ }
  const m = String(text || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * @returns {Promise<{ eligible: boolean, fails: {requirement:string, why:string}[] } | null>}
 *   null when the check couldn't run (then the job is treated as eligible).
 */
export async function hardCheck(job, profile, userId) {
  const d = await db();
  const hit = await d.one('SELECT verdict FROM eligibility WHERE user_id = ? AND job_id = ?', [userId, job.id]);
  if (hit) { try { return JSON.parse(hit.verdict); } catch { /* re-check */ } }

  const cv = `${profile.cvText || ''}\n${profile.extraCvText || ''}`.slice(0, 12000);
  // How far short of a "N+ years" requirement she may be and still apply (profile setting, default 2).
  const slack = Number.isFinite(Number(profile.yearsStretch)) && profile.yearsStretch !== '' ? Number(profile.yearsStretch) : 2;
  if (!cv.trim() || !String(job.jd_text || '').trim()) return null;
  const r = await generate(`Does this candidate fail any MUST-HAVE requirement of this job?
MUST-HAVES are only what the posting states as required: "must", "required", "minimum", "mandatory", "essential".
Ignore anything "preferred", "nice to have", "a plus", "ideally", and "or equivalent" alternatives.
Count as a FAIL only when her CV clearly shows she doesn't meet it:
- a specific degree type is required (e.g. engineering) and hers is different, with no "or equivalent";
- years: count all her relevant experience across roles (e.g. every role where she built reports counts toward
  "years of reporting"). FAIL only if she is short by MORE than ${slack} years. Her total experience: ${profile.totalExpYears ?? 'see CV'} years.
  A function she has never done at all (e.g. "5+ years managing people" with no people management) is a fail;
- a required language she doesn't list; a mandatory licence or certification she doesn't hold;
- mandatory experience in a domain or industry her CV shows no trace of.
If it's unclear or she might meet it, it is NOT a fail.

JOB: ${job.title} at ${job.company}
${String(job.jd_text).slice(0, 9000)}

CANDIDATE CV:
${cv}

Return ONLY JSON: {"fails":[{"requirement":"short, as the posting says it","why":"what her CV shows instead"}]}`, { json: true, temperature: 0, maxTokens: 1024 });
  const out = r.ok ? parse(r.text) : null;
  if (!out || !Array.isArray(out.fails)) return null; // couldn't check: don't block the job
  const fails = out.fails.filter((f) => f && f.requirement).slice(0, 5)
    .map((f) => ({ requirement: String(f.requirement).slice(0, 120), why: String(f.why || '').slice(0, 160) }));
  const verdict = { eligible: fails.length === 0, fails };
  await d.run(`INSERT INTO eligibility (user_id, job_id, verdict, checked_at) VALUES (?,?,?,?)
    ON CONFLICT (user_id, job_id) DO NOTHING`, [userId, job.id, JSON.stringify(verdict), new Date().toISOString()]);
  return verdict;
}
