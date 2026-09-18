// Tailor a resume .docx to one JD. Gemini decides which paragraphs are the
// skills line and the first 3-4 task bullets of each role, and rewrites ONLY
// those to work in the JD's keywords truthfully. Everything else — titles,
// employers, dates, education, summary, later bullets — is left untouched.
import { readParagraphs, applyEdits } from './docx-edit.js';
import { generate, geminiConfigured } from './gemini.js';

function extractJson(text) {
  try { return JSON.parse(text); } catch { /* try to salvage */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

/**
 * @param {Buffer} docxBuffer  the user's stored resume
 * @param {object} job         { title, company, jd_text, skills_required }
 * @param {string[]} skillBank the candidate's confirmed skills (truth boundary)
 * @returns {{ ok:boolean, buffer?:Buffer, changed?:number, gaps?:string[], error?:string }}
 */
export async function tailorResume(docxBuffer, job, skillBank = []) {
  if (!geminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  let paragraphs;
  try {
    ({ paragraphs } = await readParagraphs(docxBuffer));
  } catch (e) {
    return { ok: false, error: `Could not read the .docx (${e.message}). Upload a .docx to tailor.` };
  }
  // Number the paragraphs for the model; skip empties to save tokens.
  const numbered = paragraphs
    .filter((p) => p.text.trim())
    .map((p) => `[${p.index}] ${p.text}`)
    .join('\n');

  const jd = String(job.jd_text || '').slice(0, 8000);
  const required = (() => { try { return JSON.parse(job.skills_required || '[]'); } catch { return []; } })();

  const prompt = `You tailor a résumé to a specific job, editing as little as possible.

You are given the résumé as indexed paragraphs and a job description. Return ONLY JSON:
{
  "edits": { "<paragraphIndex>": "<rewritten text>", ... },
  "gaps": ["<JD-required skill the candidate clearly does NOT have>", ...]
}

WHAT YOU MAY EDIT — nothing else:
- The skills / technologies / competencies line(s).
- The FIRST 3-4 task or bullet lines under EACH work-experience role (a role is a
  line with a job title + company/date). Never edit a role's 5th bullet onward.

NEVER EDIT (do not include their indices in "edits"):
- Name, contact details, job titles, company names, employment dates.
- Education, certifications, the professional summary, section headings.

HOW TO REWRITE:
- Work in the exact keywords and phrasing from the job description WHERE THE
  CANDIDATE GENUINELY HAS THAT EXPERIENCE — judged from their existing bullets and
  this confirmed skill list: ${JSON.stringify(skillBank).slice(0, 1500)}.
- Never invent a tool, skill, or achievement the résumé does not support. If the
  JD wants something the candidate lacks, put it in "gaps", not in an edit.
- Keep each edited line about the same length and style (action-verb led, keep any
  numbers/metrics), so the document still looks like theirs.
- Reorder the skills line to surface the JD-relevant skills the candidate has first.

JOB: ${job.title || ''} at ${job.company || ''}
JD REQUIRED SKILLS (detected): ${JSON.stringify(required).slice(0, 800)}

===JOB DESCRIPTION===
${jd}
===END JOB DESCRIPTION===

===RESUME PARAGRAPHS===
${numbered.slice(0, 12000)}
===END RESUME===`;

  const r = await generate(prompt, { json: true, temperature: 0.25, maxTokens: 4096 });
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = extractJson(r.text);
  if (!parsed || typeof parsed.edits !== 'object') {
    return { ok: false, error: 'the model did not return usable edits' };
  }

  // Safety net: never allow an edit to a paragraph the model was told is off-limits
  // is enforced by the model, but we also drop any index that does not exist.
  const valid = {};
  const maxIdx = Math.max(...paragraphs.map((p) => p.index), -1);
  for (const [k, v] of Object.entries(parsed.edits)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i <= maxIdx && typeof v === 'string' && v.trim()) valid[i] = v;
  }

  const { buffer, changed } = await applyEdits(docxBuffer, valid);
  return {
    ok: true,
    buffer,
    changed,
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String).filter(Boolean).slice(0, 12) : [],
  };
}
