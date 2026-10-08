// Tailor a résumé .docx to one job, ATS-first.
//
//   1. Code decides which lines are editable (cv-structure.js): summary, skills
//      lines, the first 4 bullets of each role, project bullets. Name, contact,
//      employers, titles, dates, education, certifications are never shown to
//      the model as editable and never written.
//   2. One Gemini call lists the JD's ATS keywords and rewrites those lines to
//      mirror the JD's language.
//   3. Code checks every edit before it lands: bullet prefix kept, every number
//      kept, length sane, and any newly claimed skill must be in the CV, the
//      user's skill list, or (if "stretch" is on) a close equivalent of one —
//      which is then reported back as "prepare before interview".
//   4. ATS keyword coverage is measured before and after.
import mammoth from 'mammoth';
import { readParagraphs, applyEdits } from './docx-edit.js';
import { generate, geminiConfigured } from './gemini.js';
import { classify } from './cv-structure.js';
import { extractSkills, canonicalize } from './skills.js';
import { adjacentSkills } from './skill-families.js';

const BULLET_PREFIX = /^\s*[•\-*▪●◦‣–·]\s*/;

// Generic skills a rewrite may surface without proof (they describe how, not what).
const SOFT = new Set(['Communication', 'Leadership', 'Problem Solving', 'Negotiation', 'Documentation',
  'Reporting', 'Stakeholder Management', 'Process Improvement', 'Client Management']);

// Words that make a CV read as machine-written, with plain replacements per form.
const TELLS = {
  spearheaded: 'led', spearheading: 'leading', spearhead: 'lead', spearheads: 'leads',
  leveraged: 'used', leveraging: 'using', leverage: 'use', leverages: 'uses',
  utilized: 'used', utilizing: 'using', utilize: 'use', utilizes: 'uses',
  utilised: 'used', utilising: 'using', utilise: 'use',
  orchestrated: 'coordinated', orchestrating: 'coordinating', orchestrate: 'coordinate',
  seamless: 'smooth', seamlessly: 'smoothly', robust: 'strong', synergy: 'teamwork',
  'cutting-edge': 'modern', 'results-driven': 'results-focused', meticulous: 'careful',
  meticulously: 'carefully', fostered: 'built', honed: 'built', delved: 'looked',
};
const TELL_RE = new RegExp(`\\b(${Object.keys(TELLS).map((k) => k.replace('-', '\\-')).join('|')})\\b`, 'gi');

export function humanize(text, { allowEmDash = true } = {}) {
  let out = text.replace(TELL_RE, (w) => {
    const r = TELLS[w.toLowerCase()];
    return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
  out = out.replace(/\bproven track record\b/gi, 'track record').replace(/\bpassionate about\b/gi, 'focused on');
  if (!allowEmDash) out = out.replace(/\s*—\s*/g, ', ');
  return out.replace(/\s{2,}(?=\S)/g, (m, i) => (i < 6 ? m : ' ')); // keep leading bullet spacing only
}

const numbersIn = (s) => (String(s).match(/\d+(?:[.,]\d+)?%?/g) || []);
const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9+#/&]+/g, ' ').replace(/\s+/g, ' ')} `;

/** ATS keyword coverage of `text` against `keywords` (exact phrase, or same canonical skill). */
export function atsCoverage(text, keywords) {
  const t = norm(text);
  const skillsInText = new Set(extractSkills(text).all);
  const matched = [];
  const missing = [];
  for (const k of keywords) {
    const kn = norm(k).trim();
    const hit = (kn && t.includes(` ${kn} `)) || skillsInText.has(canonicalize(k));
    (hit ? matched : missing).push(k);
  }
  const score = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0;
  return { score, matched, missing };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* salvage */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

function dedupeKeywords(list) {
  const seen = new Set();
  return list.map((k) => String(k || '').trim()).filter((k) => {
    const key = (canonicalize(k) || k).toLowerCase();
    if (!k || k.length > 60 || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

/**
 * @param {Buffer} docxBuffer
 * @param {object} job        { title, company, jd_text, skills_required }
 * @param {string[]} skillBank the user's confirmed skills
 * @param {object} opts       { stretch: allow close-equivalent skills (default true), yearsExp }
 * @returns {Promise<{ok, buffer?, changed?, gaps?, added?, rejected?, ats?, error?}>}
 */
export async function tailorResume(docxBuffer, job, skillBank = [], { stretch = true, yearsExp = null } = {}) {
  if (!geminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  let paragraphs, cvText;
  try {
    ({ paragraphs } = await readParagraphs(docxBuffer));
    cvText = (await mammoth.extractRawText({ buffer: docxBuffer })).value || '';
  } catch (e) {
    return { ok: false, error: `Could not read the .docx (${e.message}). Upload a .docx to tailor.` };
  }

  const lines = classify(paragraphs);
  const editable = lines.filter((l) => l.editable);
  if (!editable.length) return { ok: false, error: 'Could not find a summary, skills or experience section to tailor.' };
  const editableIdx = new Set(editable.map((l) => l.index));
  const lockedContext = lines.filter((l) => !l.editable && l.kind !== 'blank' && l.section !== 'header')
    .filter((l) => l.kind === 'role' || l.kind === 'heading' || l.section === 'locked')
    .map((l) => l.text.trim()).filter(Boolean).slice(0, 40).join('\n');

  const jd = String(job.jd_text || '').slice(0, 9000);
  const jdSkills = extractSkills(jd).all;
  const cvSkills = extractSkills(cvText).all;
  const candidate = [...new Set([...cvSkills, ...skillBank.map((s) => canonicalize(s))])];
  const allowed = stretch ? adjacentSkills(jdSkills, candidate) : [];

  const prompt = `You are an expert CV writer for ATS (applicant tracking systems) and recruiters.
Goal: make this CV match the job as strongly as possible so it passes ATS keyword screening and wins an
interview, while staying true to what the candidate has actually done.

STEP 1. List the 15-25 most important ATS keywords of the job description: hard skills, tools, systems,
domain terms, certifications and key duty phrases, in the JD's exact wording.

STEP 2. Rewrite ONLY the editable lines below (by id). Rules:
- SUMMARY: retarget it to "${job.title || 'this role'}". Open with a role phrase that matches the job,
  ${yearsExp != null ? `state experience as ${yearsExp} years,` : 'keep the experience years as written,'}
  and work in 5-8 JD keywords the candidate genuinely has. 2-4 sentences.
- SKILLS lines: keep each line's label and format (e.g. "•  Label: a, b, c"). Put JD keywords first. Add a
  JD keyword when the CV shows that experience anywhere${allowed.length ? ', or when it is in ALLOWED ADDITIONS. Every ALLOWED ADDITION must appear at least once, in a skills line or the summary' : ''}.
- Use the JD's EXACT phrase for things the candidate already does: ATS tools match words, not meaning.
  Practices of a method the candidate uses count as shown: Agile/Scrum -> "sprint planning", "backlog
  refinement", "user stories", "retrospectives"; requirements/UAT work -> "release notes", "user guides",
  "test cases", "product requirements". Work them into bullets about that same work.
- EXPERIENCE and PROJECT bullets: rewrite to mirror the JD's language for the same work. Keep EVERY number,
  percentage, client, system and fact. Start with a plain strong verb. Similar length (may grow up to a third).
- Return each line's leading bullet characters exactly as given.
- Never invent employers, job titles, degrees, certifications, numbers, or tools that are not in the CV,
  the candidate skills${allowed.length ? ' or ALLOWED ADDITIONS' : ''}.
- Write like a person: plain verbs, no buzzwords (spearheaded, leveraged, utilized, orchestrated, seamless,
  robust, synergy, cutting-edge, dynamic, results-driven, passionate, meticulous). Vary how bullets start.
- Leave out any line that is already ideal.
- "gaps": JD must-haves the candidate clearly lacks (not covered by ALLOWED ADDITIONS).

${allowed.length ? `ALLOWED ADDITIONS (JD skill <- candidate skill it rests on):\n${allowed.map((a) => `${a.skill} <- ${a.basedOn}`).join('\n')}\n` : ''}CANDIDATE SKILLS: ${candidate.join(', ').slice(0, 1500)}

JOB: ${job.title || ''} at ${job.company || ''}
===JOB DESCRIPTION===
${jd}
===END===

LOCKED CONTEXT (reference only, never edit):
${lockedContext}

EDITABLE LINES:
${editable.map((l) => `[${l.index}] (${l.section}) ${l.text}`).join('\n').slice(0, 14000)}

Return ONLY JSON: {"keywords":["..."],"edits":{"<id>":"<rewritten line>"},"gaps":["..."]}`;

  const r = await generate(prompt, { json: true, temperature: 0.35, maxTokens: 8192 });
  if (!r.ok) return { ok: false, error: r.error };
  const parsed = parseJson(r.text);
  if (!parsed || typeof parsed.edits !== 'object') return { ok: false, error: 'the model did not return usable edits' };

  const keywords = dedupeKeywords([...(parsed.keywords || []), ...extractSkills(jd).required]);
  const before = atsCoverage(cvText, keywords);
  const allowEmDash = cvText.includes('—');
  const allowedMap = new Map(allowed.map((a) => [a.skill, a.basedOn]));
  const bank = new Set(candidate);

  const cvNumbers = new Set(numbersIn(cvText));

  /** Check one proposed line. Returns { text } or { why }. */
  const check = (line, v) => {
    if (typeof v !== 'string' || !v.trim()) return { why: 'empty' };
    const orig = line.text;
    let text = String(v).replace(/\s+$/, '');
    const prefix = (orig.match(BULLET_PREFIX) || [''])[0];
    if (prefix) text = prefix + text.replace(BULLET_PREFIX, '');
    text = humanize(text, { allowEmDash });

    // Facts. Bullets keep every number they had; no line may introduce a number
    // that appears nowhere in the CV.
    if (line.section !== 'skills' && line.section !== 'summary') {
      const lost = numbersIn(orig).filter((n) => !text.includes(n));
      if (lost.length) return { why: `keep these numbers exactly: ${lost.join(', ')}` };
    }
    const invented = numbersIn(text).filter((n) => !cvNumbers.has(n));
    if (invented.length) return { why: `do not add numbers that are not in the CV (${invented.join(', ')})` };

    const max = line.section === 'summary' ? 2.3 : line.section === 'skills' ? 2.0 : 1.7;
    if (text.length < orig.length * 0.5 || text.length > Math.max(orig.length * max, orig.length + 60)) {
      return { why: 'keep the length close to the original' };
    }

    // Truth boundary: new hard skills must be in the CV/skills, or an allowed equivalent.
    const newSkills = extractSkills(text).all.filter((sk) => !bank.has(sk) && !SOFT.has(sk));
    const unearned = newSkills.filter((sk) => !allowedMap.has(sk));
    if (unearned.length) return { why: `do not claim ${unearned.join(', ')}: not in the CV` };
    return { text, newSkills };
  };

  const valid = {};
  const rejected = [];
  const added = new Map();
  const accept = (edits, round) => {
    const failed = [];
    for (const [k, v] of Object.entries(edits || {})) {
      const i = Number(k);
      const line = lines.find((l) => l.index === i);
      if (!line || !editableIdx.has(i)) continue;
      const res = check(line, v);
      if (res.why) { failed.push({ line, proposed: String(v), why: res.why }); continue; }
      res.newSkills.forEach((sk) => added.set(sk, allowedMap.get(sk)));
      if (res.text !== line.text) valid[i] = res.text;
    }
    if (round === 2) failed.forEach((f) => rejected.push({ index: f.line.index, why: f.why }));
    return failed;
  };

  // Round 1, then one repair round for lines that broke a rule.
  const failed = accept(parsed.edits, 1);
  if (failed.length) {
    const fix = `These CV lines broke a rule. Rewrite each one again for the same job, fixing the problem.
Keep the JD keywords, keep the leading bullet characters, and follow the same rules as before.

${failed.map((f) => `[${f.line.index}] ORIGINAL: ${f.line.text}
YOUR VERSION: ${f.proposed}
PROBLEM: ${f.why}`).join('\n\n')}

${allowed.length ? `ALLOWED ADDITIONS: ${allowed.map((a) => a.skill).join(', ')}
` : ''}CANDIDATE SKILLS: ${candidate.join(', ').slice(0, 1200)}
Return ONLY JSON: {"edits":{"<id>":"<rewritten line>"}}`;
    const r2 = await generate(fix, { json: true, temperature: 0.2, maxTokens: 4096 });
    const p2 = r2.ok ? parseJson(r2.text) : null;
    accept(p2?.edits || {}, 2);
    // Lines the repair round didn't return stay as they were.
    const retried = new Set(Object.keys(p2?.edits || {}).map(Number));
    failed.filter((f) => !retried.has(f.line.index)).forEach((f) => rejected.push({ index: f.line.index, why: f.why }));
  }

  const { buffer, changed } = await applyEdits(docxBuffer, valid);
  const afterText = (await mammoth.extractRawText({ buffer })).value || '';
  const after = atsCoverage(afterText, keywords);

  return {
    ok: true,
    buffer,
    changed,
    gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String).filter(Boolean).slice(0, 10) : [],
    added: [...added].map(([skill, basedOn]) => ({ skill, basedOn })),
    rejected,
    ats: { before: before.score, after: after.score, keywords, missing: after.missing },
  };
}
