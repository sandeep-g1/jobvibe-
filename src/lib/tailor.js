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
// Duties a rewrite may not add unless the CV already shows them somewhere.
const DUTY = /\b(budget\w*|p&l|profit and loss|hiring|recruit\w*|headcount|people management|line management|direct reports|team of \d+|vendor contracts?|contract negotiation|sales targets?|quota|audit\w*|slas?)\b/gi;

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
// Spelled-out amounts ("two days", "doubled", "half"). "one" is left out: "one of", "one place".
const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|million|half|double[ds]?|twice|tripled?|threefold|tenfold)\b/g;
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

// Words that keep their capitals inside a sentence (tools, methods, names).
const PROPER = new Set(['agile', 'scrum', 'kanban', 'lean', 'six', 'sigma', 'power', 'bi', 'excel', 'jira', 'confluence', 'sql', 'python',
  'tableau', 'salesforce', 'sap', 'oracle', 'microsoft', 'google', 'aws', 'azure', 'finacle', 'prince2', 'pmp', 'itil', 'safe', 'api', 'apis']);
const SMALL = new Set(['and', 'of', 'for', 'to', 'in', 'on', 'with', '&']);

/**
 * "Led Project Planning & Execution" → "Led project planning & execution": ATS matching ignores case,
 * and Title Case keywords mid-sentence are the giveaway of a stuffed CV. Only generic multi-word
 * phrases change; acronyms and tool or method names keep their capitals.
 */
export function sentenceCase(text, keywords) {
  let out = text;
  for (const k of keywords) {
    const words = k.split(' ').filter(Boolean);
    if (words.length < 2) continue;
    const generic = words.every((w) => SMALL.has(w.toLowerCase()) || (/^[A-Z][a-z]+$/.test(w) && !PROPER.has(w.toLowerCase())));
    if (!generic) continue;
    let from = 0;
    for (;;) {
      const i = out.indexOf(k, from);
      if (i < 0) break;
      const before = out.slice(0, i).trimEnd();
      const startsSentence = !before || /[.:;!?•\-–]$/.test(before) || /^\s*$/.test(out.slice(0, i).replace(/^[\s•\-*▪●◦‣–·]+/, ''));
      if (!startsSentence) out = out.slice(0, i) + k.toLowerCase() + out.slice(i + k.length);
      from = i + k.length;
    }
  }
  return out;
}

/**
 * The keywords an ATS would screen this job for, fixed BEFORE any rewriting: the tailor aims at
 * them and the score is measured on them, so the model can't grade itself on a list it picked
 * to fit what it wrote.
 */
export async function atsKeywords(job, { model = null } = {}) {
  const r = await generate(`You configure an applicant tracking system (ATS) to screen CVs for this job.
List the 25 keywords and phrases the ATS should search for, in the job description's EXACT wording: hard skills,
tools, systems, methods, domain terms, certifications, and key duty phrases. Most important first. No soft
skills like "communication" unless the JD stresses them.
Also list, from the JD, every NAMED tool, technology, platform, programming language, standard or certification
(e.g. Selenium, Snowflake, SWIFT, ISO 20022, Tableau, CSM), whether or not it is in your 25.
JOB: ${job.title || ''} at ${job.company || ''}
${String(job.jd_text || '').slice(0, 12000)}
Return ONLY JSON: {"keywords":["..."],"named":["..."]}`, { json: true, temperature: 0, maxTokens: 2048, model, timeoutMs: 240000 });
  const p = r.ok ? parseJson(r.text) : null;
  const list = (p?.keywords || []).map(String).filter(Boolean).slice(0, 25);
  const named = (p?.named || []).map(String).filter(Boolean).slice(0, 40);
  return { keywords: list, named, usage: r.usage };
}

/**
 * @param {Buffer} docxBuffer
 * @param {object} job        { title, company, jd_text, skills_required }
 * @param {string[]} skillBank the user's confirmed skills
 * @param {object} opts       { stretch: allow close-equivalent skills (default true), yearsExp, model,
 *                            push: premium job, one more pass at missing keywords }
 * @returns {Promise<{ok, buffer?, changed?, gaps?, added?, rejected?, ats?, error?}>}
 */
export async function tailorResume(docxBuffer, job, skillBank = [], { stretch = true, yearsExp = null, model = null, keywordModel = null, push = false, extraFacts = '' } = {}) {
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
  // Her other CV versions are her experience too: their facts may be used and pass the checks.
  const extra = String(extraFacts || '').slice(0, 12000);
  const facts = extra ? `${cvText}\n${extra}` : cvText;
  const cvSkills = extractSkills(facts).all;
  const candidate = [...new Set([...cvSkills, ...skillBank.map((s) => canonicalize(s))])];
  const allowed = stretch ? adjacentSkills(jdSkills, candidate) : [];

  const kw = await atsKeywords(job, { model: keywordModel });
  // Named tools, platforms, standards and certifications the JD wants that she has no trace of
  // (in either CV version) and that aren't an agreed close equivalent: never claimed.
  const factsLower = facts.toLowerCase();
  const allowedSkills = new Set(allowed.map((a) => a.skill.toLowerCase()));
  const lacks = kw.named.filter((n) => !factsLower.includes(n.toLowerCase()) && !allowedSkills.has(canonicalize(n).toLowerCase()) && !allowedSkills.has(n.toLowerCase()));
  // Duty and domain keywords too ("PI Planning", "API banking", "sanity testing"): one check of each
  // keyword against her experience. Unsupported ones are treated like a tool she never used.
  const sup = await generate(`For each job keyword, decide whether this candidate's experience supports claiming it.
"yes": she has done this or something that is plainly the same work. "close": a closely related practice of work
she has done (e.g. "sprint planning" for someone who ran Agile delivery). "no": no basis in her experience.
KEYWORDS: ${kw.keywords.join(' | ')}
HER EXPERIENCE:
${facts.slice(0, 14000)}
Return ONLY JSON: {"<keyword>":"yes|close|no", ...}`, { json: true, temperature: 0, maxTokens: 2048, model: keywordModel, timeoutMs: 240000 });
  const verdict = sup.ok ? parseJson(sup.text) || {} : {};
  for (const k of kw.keywords) if (verdict[k] === 'no' && !lacks.includes(k)) lacks.push(k);
  const target = kw.keywords.filter((k) => !lacks.some((n) => n.toLowerCase() === k.toLowerCase()));

  const prompt = `You are an expert CV writer for ATS (applicant tracking systems) and recruiters.
Goal: make this CV match the job as strongly as possible so it passes ATS keyword screening and wins an
interview, while staying true to what the candidate has actually done.

${target.length ? `ATS KEYWORDS this job is screened for (most important first):
${target.join(' | ')}
Cover each keyword the candidate's experience genuinely supports; leave out the ones she clearly lacks.
WHERE: the exact phrase goes in the SKILLS lines and the SUMMARY, where lists and key terms read naturally and
an ATS reads them just as well. In bullets, describe the work naturally: at most ONE exact keyword phrase per
bullet, only where it is how a person would say it. Each keyword at most twice in the whole CV.
${lacks.length ? `SHE HAS NO EXPERIENCE WITH (never mention them): ${lacks.join(', ')}\n` : ''}
` : `STEP 1. List the 15-25 most important ATS keywords of the job description: hard skills, tools, systems,
domain terms, certifications and key duty phrases, in the JD's exact wording.

`}Rewrite ONLY the editable lines below (by id). Rules:
- SUMMARY: retarget it to "${job.title || 'this role'}". Open with a SHORT role phrase that matches the job
  (e.g. "Business Analyst", "Project Manager"), never the posting's full title or the company's name,
  ${yearsExp != null ? `state experience as ${yearsExp} years,` : 'keep the experience years as written,'}
  and work in 5-8 JD keywords the candidate genuinely has. 2-4 sentences.
- SKILLS lines: keep each line's label and format (e.g. "•  Label: a, b, c"). Put JD keywords first. Add a
  JD keyword when the CV shows that experience anywhere${allowed.length ? ', or when it is in ALLOWED ADDITIONS. Every ALLOWED ADDITION must appear at least once, in a skills line or the summary' : ''}.
- Use the JD's exact phrase (in skills and summary) for things the candidate already does: ATS tools match
  words, not meaning. Practices of a method the candidate uses count as shown: Agile/Scrum -> "sprint
  planning", "backlog refinement", "user stories", "retrospectives"; requirements/UAT work -> "release notes",
  "user guides", "test cases", "product requirements".
- EXPERIENCE and PROJECT bullets: rewrite to mirror the JD's language for the SAME work. Keep EVERY number,
  percentage, client, system and fact, and keep the result the bullet ends with ("reducing manual effort",
  "improving accuracy"). Start with a plain strong verb. Similar length (may grow up to a third).
  Reposition hard: lead each bullet with the part of the work this JD cares about most, and bring in facts
  from MORE OF HER EXPERIENCE for the same role where they fit the JD better. Concrete and specific, but
  every detail (system, report, partner type, result) must already be in her CVs for that job: never add a new
  activity, system or outcome to make a bullet fit the JD. If the JD wants work she never did, leave it out.
- Facts stay with their employer: a bullet may only use results, numbers and duties from that same job (in
  this CV or that employer's part of MORE OF HER EXPERIENCE). Never move a result from one job to another.
- Never change what the work was: reporting stays reporting, partner management stays partner management.
  Never add a duty her experience (this CV or MORE OF HER EXPERIENCE) doesn't show: budgets, P&L, hiring,
  people management, vendor contracts, sales targets, audits, SLAs.
- Inside sentences write keywords in normal sentence case ("tracked performance metrics", not "Conducted
  Performance Monitoring"); keep capitals for tools, methods and proper names (Power BI, Agile, UAT, Jira).
  The result must read as if the candidate wrote it, not as a keyword list.
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

${extra ? `MORE OF HER EXPERIENCE (another version of her CV; these facts are true and may be used in the
matching role's bullets, but job titles, dates and employers always stay as in the CV being edited):
${extra}

` : ''}LOCKED CONTEXT (reference only, never edit):
${lockedContext}

EDITABLE LINES:
${editable.map((l) => `[${l.index}] (${l.section}) ${l.text}`).join('\n').slice(0, 14000)}

Return ONLY JSON: {"keywords":["..."],"edits":{"<id>":"<rewritten line>"},"gaps":["..."]}`;

  const r = await generate(prompt, { json: true, temperature: 0.35, maxTokens: 24000, model, timeoutMs: 240000 });
  if (!r.ok) return { ok: false, error: r.error };
  const usage = { model: r.model, in: (r.usage?.in || 0) + (kw.usage?.in || 0) + (sup.usage?.in || 0), out: (r.usage?.out || 0) + (kw.usage?.out || 0) + (sup.usage?.out || 0) };
  const parsed = parseJson(r.text);
  if (!parsed || typeof parsed.edits !== 'object') return { ok: false, error: 'the model did not return usable edits' };

  // Scored on the full list, including what she lacks: the score must match an outside ATS check.
  const keywords = dedupeKeywords([...(kw.keywords.length ? kw.keywords : parsed.keywords || []), ...extractSkills(jd).required]);
  const before = atsCoverage(cvText, keywords);
  const allowEmDash = cvText.includes('—');
  const allowedMap = new Map(allowed.map((a) => [a.skill, a.basedOn]));
  const bank = new Set(candidate);

  const cvNumbers = new Set(numbersIn(facts));

  // Facts belong to an employer: a bullet under TATA may only use what she did at TATA (in either
  // CV version). Each role's scope = its lines in this CV + that employer's section of the other one.
  const extraLower = extra.toLowerCase();
  const employerAt = (role) => {
    for (const l of lines.filter((x) => x.role === role && x.kind === 'role').reverse()) { // company line first, then the title
      const words = l.text.split('|')[0].replace(/[^A-Za-z ]+/g, ' ').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        const key = words.slice(0, n).join(' ');
        if (/^(manager|business|analyst|assistant|marketing|project|senior|coordinator)$/.test(key)) continue; // a title, not a name
        const at = extraLower.indexOf(key);
        if (at >= 0) return at;
      }
    }
    return -1;
  };
  const roleIds = [...new Set(lines.filter((l) => l.role != null).map((l) => l.role))];
  const starts = roleIds.map((r) => ({ r, at: employerAt(r) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  const roleScope = new Map(roleIds.map((r) => {
    const own = lines.filter((l) => l.role === r).map((l) => l.text).join('\n');
    const i = starts.findIndex((x) => x.r === r);
    const other = i >= 0 ? extra.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : undefined) : '';
    return [r, `${own}\n${other}`.toLowerCase()];
  }));
  const scopeOf = (line) => (line.section === 'experience' && roleScope.has(line.role) ? roleScope.get(line.role) : factsLower);

  /** Check one proposed line. Returns { text } or { why }. */
  const check = (line, v) => {
    if (typeof v !== 'string' || !v.trim()) return { why: 'empty' };
    const orig = line.text;
    let text = String(v).replace(/\s+$/, '');
    const prefix = (orig.match(BULLET_PREFIX) || [''])[0];
    if (prefix) text = prefix + text.replace(BULLET_PREFIX, '');
    text = humanize(text, { allowEmDash });
    if (line.section !== 'skills') text = sentenceCase(text, keywords);

    // Facts. Bullets keep every number they had; no line may introduce a number
    // that appears nowhere in the CV.
    if (line.section !== 'skills' && line.section !== 'summary') {
      const lost = numbersIn(orig).filter((n) => !text.includes(n));
      if (lost.length) return { why: `keep these numbers exactly: ${lost.join(', ')}` };
    }
    const invented = numbersIn(text).filter((n) => !cvNumbers.has(n));
    if (invented.length) return { why: `do not add numbers that are not in the CV (${invented.join(', ')})` };
    const scope = scopeOf(line);
    const moved = numbersIn(text).filter((n) => !numbersIn(orig).includes(n) && !scope.includes(n.toLowerCase()));
    if (moved.length) return { why: `${moved.join(', ')} is a result from a different job: use only facts from this employer` };

    const max = line.section === 'summary' ? 2.3 : line.section === 'skills' ? 2.0 : 2.0;
    if (text.length < orig.length * 0.5 || text.length > Math.max(orig.length * max, orig.length + 60)) {
      return { why: 'keep the length close to the original' };
    }

    // Results in words are numbers too: "from two days to two hours" must be in her CVs.
    const wordNums = (text.toLowerCase().match(NUMBER_WORDS) || []).filter((w) => !scope.includes(w));
    if (wordNums.length) return { why: `do not add amounts or durations that are not in the CV (${[...new Set(wordNums)].join(', ')})` };
    // Named tools and certifications she has no trace of.
    const claimed = lacks.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
    if (claimed.length) return { why: `do not claim ${claimed.join(', ')}: she has no experience with it` };

    // Duties are facts too: no budgets, hiring or people management the CV never shows.
    const duties = (text.match(DUTY) || []).filter((d) => !scope.includes(d.toLowerCase().slice(0, 5)));
    if (duties.length) return { why: `do not add duties the CV doesn't show (${[...new Set(duties)].join(', ')})` };

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
  // Keyword stuffing: a keyword in more than 2 lines reads robotic. Lines that added it
  // beyond that go back for a rewrite.
  for (const k of target) {
    const kl = k.toLowerCase();
    const has = (s) => String(s).toLowerCase().includes(kl);
    const holders = lines.filter((l) => has(valid[l.index] ?? l.text));
    let extra = holders.length - 2;
    for (const l of holders.reverse()) {
      if (extra <= 0) break;
      if (valid[l.index] == null || has(l.text)) continue; // only lines this edit pushed it into
      failed.push({ line: l, proposed: valid[l.index], why: `"${k}" is used in too many lines: drop it from this one` });
      delete valid[l.index];
      extra--;
    }
  }
  if (failed.length) {
    const fix = `These CV lines broke a rule. Rewrite each one again for the same job, fixing the problem.
Keep the JD keywords, keep the leading bullet characters, and follow the same rules as before.

${failed.map((f) => `[${f.line.index}] ORIGINAL: ${f.line.text}
YOUR VERSION: ${f.proposed}
PROBLEM: ${f.why}`).join('\n\n')}

${allowed.length ? `ALLOWED ADDITIONS: ${allowed.map((a) => a.skill).join(', ')}
` : ''}CANDIDATE SKILLS: ${candidate.join(', ').slice(0, 1200)}
Return ONLY JSON: {"edits":{"<id>":"<rewritten line>"}}`;
    const r2 = await generate(fix, { json: true, temperature: 0.2, maxTokens: 8192, model, timeoutMs: 240000 });
    if (r2.ok) { usage.in += r2.usage?.in || 0; usage.out += r2.usage?.out || 0; }
    const p2 = r2.ok ? parseJson(r2.text) : null;
    accept(p2?.edits || {}, 2);
    // Lines the repair round didn't return stay as they were.
    const retried = new Set(Object.keys(p2?.edits || {}).map(Number));
    failed.filter((f) => !retried.has(f.line.index)).forEach((f) => rejected.push({ index: f.line.index, why: f.why }));
  }

  const current = (l) => valid[l.index] ?? l.text;
  const fullText = () => lines.map(current).join('\n');
  const spend = (x) => { if (x?.ok) { usage.in += x.usage?.in || 0; usage.out += x.usage?.out || 0; } };
  const opts = { json: true, temperature: 0.2, maxTokens: 16000, model, timeoutMs: 240000 };

  // Premium jobs (reputed employer, good pay): one more pass at the keywords still missing.
  // Each new edit passes the same checks; one that would stuff a keyword is dropped.
  if (push) {
    const missing = atsCoverage(fullText(), keywords).missing;
    if (missing.length) {
      const r3 = await generate(`This CV was tailored for ${job.title || 'a job'} at ${job.company || ''}. These ATS keywords are still missing:
${missing.join(' | ')}

For each keyword the candidate's experience genuinely supports, work it into ONE editable line where it fits the work
that line describes (a skills line, the summary, or a bullet about that work), in the exact wording. Skip keywords
the candidate lacks. Same rules as before: keep every number, fact and result; no new duties, employers, titles,
degrees or certifications; keywords in sentence case inside sentences; it must read as written by the candidate.
Return the full new text of each line you change.

${allowed.length ? `ALLOWED ADDITIONS: ${allowed.map((a) => a.skill).join(', ')}\n` : ''}CANDIDATE SKILLS: ${candidate.join(', ').slice(0, 1200)}

LOCKED CONTEXT (reference only):
${lockedContext}

EDITABLE LINES (current text):
${editable.map((l) => `[${l.index}] (${l.section}) ${current(l)}`).join('\n').slice(0, 14000)}

Return ONLY JSON: {"edits":{"<id>":"<new line>"}}`, opts);
      spend(r3);
      const before3 = { ...valid };
      accept(parseJson(r3.text || '')?.edits || {}, 3);
      for (const k of keywords) {
        const kl = k.toLowerCase();
        const n = lines.filter((l) => current(l).toLowerCase().includes(kl)).length;
        if (n <= 2) continue;
        for (const i of Object.keys(valid)) {
          if (valid[i] !== before3[i] && valid[i].toLowerCase().includes(kl) && !String(before3[i] ?? '').toLowerCase().includes(kl)) {
            if (before3[i] == null) delete valid[i]; else valid[i] = before3[i];
          }
        }
      }
    }
  }

  // Every CV: would a recruiter take it for AI-written? A reviewer flags the lines that read
  // machine-made and rewrites them; a rewrite is kept only if it passes the checks and keeps
  // every keyword the line carried.
  // Up to three rounds, until the reviewer reads it as a person's CV (ai_feel 4 or less).
  let human = null;
  for (let round = 1; round <= 3; round++) {
    const reviewLines = lines.filter((l) => valid[l.index] != null);
    if (!reviewLines.length) break;
    const r4 = await generate(`You screen hundreds of CVs a week and can tell when one was written or keyword-stuffed by AI.
Review the tailored lines of this CV. Flag each line that reads AI-made, for example:
- buzzwords and stock phrases (results-driven, adept at, leveraging, spearheaded, seamless, robust, streamlined,
  ensuring, enabling, driving, fostering, dynamic, proven track record, in-depth, comprehensive);
- trailing "-ing" chains (", improving X, enhancing Y and driving Z") and "X, Y, and Z" triplets in every line;
- keyword lists dropped into a sentence, or odd capitals mid-sentence;
- the same opening verb, length or structure as the lines around it;
- vague, padded claims.
For each flagged line write a rewrite a person would write: plain verbs, one clear point per bullet, varied length
and rhythm. Keep exactly the same facts and numbers: rephrase and trim, but NEVER add an activity, system, detail
or outcome the line doesn't already state. Simpler and shorter is better than invented specifics.
These are the job's ATS keywords:
${keywords.join(' | ')}
In a bullet, a keyword phrase that sounds forced may be reworded naturally (the skills lines carry the exact
phrases). In the summary, keep them where they read well.
Keep the leading bullet characters. Skills lines (comma lists) are fine as lists; only flag odd items there.
Rate the whole CV: ai_feel 1-10 (1 = clearly a person wrote it, 10 = clearly AI), as it reads NOW, before your fixes.

CV LINES (tailored lines have an id; the rest is context):
${lines.filter((l) => l.kind !== 'blank').map((l) => (valid[l.index] != null ? `[${l.index}] ${current(l)}` : `    ${l.text}`)).join('\n').slice(0, 16000)}

Return ONLY JSON: {"ai_feel":0,"flags":{"<id>":{"issue":"...","rewrite":"..."}}}`, opts);
    spend(r4);
    const rv = parseJson(r4.text || '') || {};
    const flags = rv.flags && typeof rv.flags === 'object' ? rv.flags : {};
    let fixed = 0;
    for (const [k, f] of Object.entries(flags)) {
      const l = lines.find((x) => x.index === Number(k));
      if (!l || valid[l.index] == null || typeof f?.rewrite !== 'string') continue;
      const res = check(l, f.rewrite);
      if (res.why) continue;
      // De-stuffing may drop a keyword from a bullet only if the CV still has it elsewhere.
      const elsewhere = lines.filter((x) => x.index !== l.index).map(current).join('\n').toLowerCase();
      const lost = keywords.filter((kw) => current(l).toLowerCase().includes(kw.toLowerCase()) && !res.text.toLowerCase().includes(kw.toLowerCase()) && !elsewhere.includes(kw.toLowerCase()));
      if (lost.length) continue;
      res.newSkills.forEach((sk) => added.set(sk, allowedMap.get(sk)));
      valid[l.index] = res.text;
      fixed++;
    }
    const feel = Number(rv.ai_feel) || null;
    human = { aiFeel: human?.aiFeel ?? feel, lastFeel: feel, rounds: round, flagged: (human?.flagged || 0) + Object.keys(flags).length, fixed: (human?.fixed || 0) + fixed };
    if ((feel != null && feel <= 4) || fixed < 3) break; // reads human, or little left to fix
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
    human, // { aiFeel 1-10 at first review, lastFeel at the last review, rounds, flagged, fixed }
    usage,
  };
}
