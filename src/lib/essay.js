// Drafts open-ended application answers (cover letters, "why us?", short
// prompts) from the candidate's CV and the job description — and nothing else.
// Plain first-person writing, no invented facts or numbers, passed through the
// same AI-tell filter as CV tailoring.
import { generate, geminiConfigured } from './gemini.js';
import { humanize } from './tailor.js';

/** Word budget from the question and the control it goes in. */
function budget(label, type) {
  const t = String(label).toLowerCase();
  if (/cover letter/.test(t)) return { min: 120, max: 190 };
  if (type === 'text') return { min: 4, max: 30 };
  if (/one word|in a word/.test(t)) return { min: 1, max: 3 };
  return { min: 40, max: 110 };
}

/**
 * @param {object} p { question, type: 'text'|'textarea'|'file', job: {title, company, jd_text}, profile, cvText }
 * @returns {Promise<{ ok:boolean, text?:string, error?:string }>}
 */
export async function draftAnswer({ question, type = 'textarea', job = {}, profile = {}, cvText = '' }) {
  if (!geminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY is not set' };
  const { min, max } = budget(question, type);
  const prompt = `You are helping a job candidate answer an application question in their own voice.

QUESTION: ${question}
JOB: ${job.title || ''} at ${job.company || ''}

Rules:
- First person, plain and specific, like a capable person writing quickly. ${min}-${max} words.
- Use ONLY facts from the CV below. Never invent employers, projects, numbers, tools or achievements.
  If the CV has nothing relevant, answer briefly and honestly from what it does show.
- Connect the candidate's real experience to what this job needs. No flattery of the company.
- No buzzwords (passionate, leverage, synergy, dynamic, spearheaded, thrilled, excited to). No em dashes.
- ${/cover letter/i.test(question) ? 'Cover letter: no address block or date. Start with "Dear Hiring Team," and end with the candidate\'s name.' : 'Answer the question directly. No greeting or sign-off.'}
- Output only the answer text.

CANDIDATE: ${profile.name || ''}, ${profile.totalExpYears ?? '?'} years of experience
CV:
${String(cvText || profile.resumeText || '').slice(0, 6000)}

JOB DESCRIPTION:
${String(job.jd_text || '').slice(0, 5000)}`;

  const r = await generate(prompt, { temperature: 0.6, maxTokens: 1024 });
  if (!r.ok) return { ok: false, error: r.error };
  let text = humanize(String(r.text || '').trim().replace(/^["']|["']$/g, ''), { allowEmDash: false });
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > max * 1.3) text = words.slice(0, Math.round(max * 1.2)).join(' ').replace(/[,;:]?$/, '.');
  if (!text) return { ok: false, error: 'empty draft' };
  return { ok: true, text };
}
