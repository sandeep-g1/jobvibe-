// AI recruiter pass. Keyword scoring finds candidates cheaply; this reads the
// top few dozen JDs the way a recruiter would and judges real fit: role
// family, seniority, domain, must-have tools, adjacent skills. One Gemini call
// per batch of jobs, so ~4 calls per user per run.
//
// Final score = AI fit × AI_WEIGHT + keyword score × (1 − AI_WEIGHT).
// If Gemini is unavailable the keyword score stands on its own.
import { generate, geminiConfigured } from './gemini.js';

export const AI_WEIGHT = 0.65;
const TOP = 60;
const GAP_MS = 4000; // free tier is ~15 requests/minute
const BATCH = 10;

function snippet(jd, n = 900) {
  return String(jd || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function candidateBrief(profile) {
  return [
    `Target roles: ${(profile.jobTitles || []).join(', ') || 'not stated'}`,
    `Experience: ${profile.totalExpYears ?? '?'} years`,
    `Skills: ${(profile.skillBank || []).join(', ') || 'not stated'}`,
    `CV:\n${String(profile.cvText || profile.resumeText || '').slice(0, 3500)}`,
  ].join('\n');
}

function parse(text) {
  try { return JSON.parse(text); } catch { /* salvage */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * Re-rank the strongest keyword candidates with an AI fit judgement.
 * Mutates each item's `result` (score, recommendation, why_text, breakdown.ai)
 * and sets `aiJudged` on the items it judged.
 * @param {object} profile  user profile (cvText = full CV text if available)
 * @param {{job:object, result:object}[]} items  already keyword-scored
 * @returns {{ ok:boolean, judged:number, error?:string }}
 */
export async function aiRerank(profile, items) {
  if (!geminiConfigured() || !items.length) return { ok: false, judged: 0, error: 'gemini off' };
  const top = items.slice().sort((a, b) => b.result.score - a.result.score).slice(0, TOP);
  const brief = candidateBrief(profile);
  let judged = 0;
  let lastErr;

  for (let i = 0; i < top.length; i += BATCH) {
    if (i) await new Promise((r) => setTimeout(r, GAP_MS));
    const batch = top.slice(i, i + BATCH);
    const jobs = batch.map((it, k) =>
      `[j${k}] ${it.job.title} — ${it.job.company} (${it.job.city || it.job.work_mode || ''})\n${snippet(it.job.jd_text)}`
    ).join('\n\n');

    const prompt = `You are a senior recruiter screening jobs for one candidate.
For each job, rate 0-100 how likely this candidate is to be SHORTLISTED for an interview.
Judge: same role family and seniority, domain fit, must-have tools/certifications, years required.
Adjacent skills count partly (Azure for an AWS role, ServiceNow for a Zendesk role).
A job in a different profession scores under 20 no matter how many generic words overlap.

CANDIDATE
${brief}

JOBS
${jobs}

Return ONLY JSON: {"results":[{"id":"j0","fit":0-100,"reason":"max 14 words, plain, why it fits or not"}]}`;

    const r = await generate(prompt, { json: true, temperature: 0.1, maxTokens: 2048 });
    if (!r.ok) { lastErr = r.error; continue; }
    const out = parse(r.text);
    for (const x of out?.results || []) {
      const it = batch[Number(String(x.id).replace(/\D/g, ''))];
      const fit = Number(x.fit);
      if (!it || !Number.isFinite(fit)) continue;
      const kw = it.result.score;
      const score = Math.round(Math.max(0, Math.min(100, fit)) * AI_WEIGHT + kw * (1 - AI_WEIGHT));
      it.result.score = score;
      it.result.recommendation = score >= 75 ? 'apply' : score >= 60 ? 'consider' : 'skip';
      it.aiJudged = true;
      it.result.breakdown = { ...it.result.breakdown, ai: { fit, keyword: kw, note: String(x.reason || '').slice(0, 140) } };
      if (x.reason) it.result.why_text = `${String(x.reason).slice(0, 140)}. ${it.result.why_text || ''}`.trim();
      judged++;
    }
  }
  return { ok: judged > 0, judged, error: judged ? undefined : lastErr };
}
