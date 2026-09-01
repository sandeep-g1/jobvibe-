// Deterministic match scoring. No LLM, no API, no cost.
//
// Phase 1 note: the architecture defines six components totalling 100, the last
// being resume parse-health (5 pts), which needs the DOCX checker from Phase 5.
// Until that exists this module scores the five measurable components and
// renormalises them to 100, rather than inventing a value for the sixth.
import { contentTokens } from './lib/normalize.js';
import { canonicalize } from './lib/skills.js';

export const WEIGHTS = {
  mustHave: 35,
  semantic: 25,
  experience: 15,
  title: 10,
  location: 10,
};
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 95 in Phase 1

/* ---------------- BM25 ---------------- */

export function buildCorpus(docs) {
  const N = docs.length || 1;
  const df = new Map();
  const docTokens = docs.map((text) => {
    const toks = contentTokens(text);
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    return toks;
  });
  const avgdl = docTokens.reduce((s, t) => s + t.length, 0) / N || 1;
  const idf = new Map();
  for (const [term, freq] of df) {
    idf.set(term, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
  }
  return { idf, avgdl, N };
}

/** BM25 score of `queryTokens` against one document. */
export function bm25(queryTokens, docText, corpus, k1 = 1.5, b = 0.75) {
  const doc = contentTokens(docText);
  if (!doc.length) return 0;
  const tf = new Map();
  for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  for (const q of new Set(queryTokens)) {
    const f = tf.get(q);
    if (!f) continue;
    const idf = corpus.idf.get(q) ?? Math.log(1 + corpus.N);
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.length / corpus.avgdl))));
  }
  return score;
}

/* ---------------- components ---------------- */

/**
 * Skill rarity weighting.
 *
 * Without this the component saturates: "Communication", "Leadership" and
 * "Reporting" appear in nearly every JD and sit in every PM's skill bank, so an
 * upholstery sales role scored a perfect 35/35 on skills. Weighting each
 * required skill by how rare it is across today's corpus makes common skills
 * nearly free and specific ones decisive.
 */
export function buildSkillIDF(requiredLists) {
  const N = Math.max(requiredLists.length, 1);
  const df = new Map();
  for (const list of requiredLists) {
    for (const s of new Set(list)) df.set(s, (df.get(s) || 0) + 1);
  }
  const idf = new Map();
  for (const [skill, count] of df) idf.set(skill, Math.log(1 + N / (1 + count)));
  return { idf, N, df };
}

function skillWeight(skill, skillIDF) {
  if (!skillIDF) return 1;
  return skillIDF.idf.get(skill) ?? Math.log(1 + skillIDF.N);
}

function mustHaveScore(required, bank, skillIDF) {
  if (!required.length) {
    return { pct: 0.5, matched: [], missing: [], note: 'JD lists no explicit skills' };
  }
  const have = new Set(bank.map((s) => canonicalize(s).toLowerCase()));
  const matched = required.filter((s) => have.has(canonicalize(s).toLowerCase()));
  const missing = required.filter((s) => !have.has(canonicalize(s).toLowerCase()));

  let totalW = 0;
  let matchedW = 0;
  for (const s of required) {
    const w = skillWeight(s, skillIDF);
    totalW += w;
    if (have.has(canonicalize(s).toLowerCase())) matchedW += w;
  }

  const coverage = totalW > 0 ? matchedW / totalW : 0;

  // How much evidence does this JD actually offer? Total weighted mass, not the
  // rarest single skill: a sales JD that lists two generic skills scores 100%
  // coverage but says almost nothing, so it must not earn the full component.
  // REF ≈ five or six mid-rarity skills.
  const REF = 15;
  const informativeness = Math.min(1, totalW / REF);
  const pct = coverage * (0.35 + 0.65 * informativeness);

  return {
    pct,
    matched,
    missing,
    note: `${matched.length}/${required.length} required, weighted ${(coverage * 100) | 0}%` +
      (informativeness < 0.6 ? `, thin JD evidence` : ''),
  };
}

function experienceScore(userYears, min, max) {
  if (min == null && max == null) return { pct: 0.7, note: 'no experience stated' };
  const lo = min ?? 0;
  const hi = max ?? min + 4;
  if (userYears >= lo && userYears <= hi) return { pct: 1, note: `in band ${lo}-${hi}y` };
  if (userYears > hi) {
    const over = userYears - hi;
    // Being overqualified is a mild penalty, not a disqualification.
    return { pct: Math.max(0.45, 1 - over * 0.12), note: `${over}y over the ${lo}-${hi}y band` };
  }
  const under = lo - userYears;
  return { pct: Math.max(0, 1 - under * 0.3), note: `${under}y under the ${lo}y minimum` };
}

// Light stemming so "Project Management Office" and "Project Manager" are
// recognised as the same family. Without it, PMO roles scored 3.8/10.
function stem(w) {
  return w.replace(/(ements|ement|ments|ment|ers|er|ors|or|ing|ies|s)$/i, '');
}

function titleScore(jobTitle, targetTitles) {
  const jt = String(jobTitle || '').toLowerCase();
  const jw = new Set(jt.split(/[^a-z0-9]+/).filter(Boolean).map(stem));
  let best = 0;
  let bestTitle = '';

  for (const t of targetTitles) {
    const target = t.toLowerCase();
    if (jt === target) return { pct: 1, note: `exact: ${t}` };
    if (jt.includes(target)) {
      if (0.9 > best) { best = 0.9; bestTitle = t; }
      continue;
    }
    const tw = new Set(target.split(/[^a-z0-9]+/).filter(Boolean).map(stem));
    let shared = 0;
    for (const w of tw) if (jw.has(w)) shared++;
    if (!shared) continue;
    // Coverage of the target title, softened by how much extra the job title carries.
    const coverage = shared / tw.size;
    const dilution = shared / jw.size;
    const pct = Math.min(0.85, coverage * (0.72 + 0.28 * dilution));
    if (pct > best) { best = pct; bestTitle = t; }
  }
  return { pct: best, note: bestTitle ? `closest: ${bestTitle}` : 'no title overlap' };
}

function locationScore(city, workMode, profile) {
  const prefs = (profile.preferredLocations || []).map((s) => s.toLowerCase());
  const modes = (profile.workModes || []).map((s) => s.toLowerCase());
  const modeOk = !modes.length || modes.includes(String(workMode || '').toLowerCase());

  if (!modeOk) return { pct: 0, note: `${workMode} not in your accepted modes` };
  if (String(workMode).toLowerCase() === 'remote' && prefs.includes('remote')) {
    return { pct: 1, note: 'remote, accepted' };
  }
  if (city && prefs.includes(city)) return { pct: 1, note: `${city} is a preferred city` };
  if (!city) return { pct: 0.5, note: 'India, city unresolved' };
  return { pct: 0.25, note: `${city} is outside your preferred cities` };
}

/* ---------------- main ---------------- */

export function scoreJob(job, profile, corpus, skillIDF) {
  const required = JSON.parse(job.skills_required || '[]');
  const nice = JSON.parse(job.skills_nice || '[]');

  const must = mustHaveScore(required, profile.skillBank || [], skillIDF);
  const resumeTokens = contentTokens(profile.resumeText || '');
  const raw = bm25(resumeTokens, job.jd_text || '', corpus);
  // Saturating transform: BM25 is unbounded, so map it into 0..1 smoothly.
  const semanticPct = raw <= 0 ? 0 : raw / (raw + 12);

  const exp = experienceScore(profile.totalExpYears ?? 0, job.min_exp, job.max_exp);
  const title = titleScore(job.title, profile.jobTitles || []);
  const loc = locationScore(job.city, job.work_mode, profile);

  const parts = {
    mustHave: must.pct * WEIGHTS.mustHave,
    semantic: semanticPct * WEIGHTS.semantic,
    experience: exp.pct * WEIGHTS.experience,
    title: title.pct * WEIGHTS.title,
    location: loc.pct * WEIGHTS.location,
  };
  const earned = Object.values(parts).reduce((a, b) => a + b, 0);
  const score = Math.round((earned / TOTAL_WEIGHT) * 100);

  const breakdown = {
    mustHave: { pts: round1(parts.mustHave), of: WEIGHTS.mustHave, note: must.note || `${must.matched.length}/${required.length} required skills` },
    semantic: { pts: round1(parts.semantic), of: WEIGHTS.semantic, note: `bm25 ${raw.toFixed(1)}` },
    experience: { pts: round1(parts.experience), of: WEIGHTS.experience, note: exp.note },
    title: { pts: round1(parts.title), of: WEIGHTS.title, note: title.note },
    location: { pts: round1(parts.location), of: WEIGHTS.location, note: loc.note },
    parseHealth: { pts: null, of: 5, note: 'not measured until Phase 5' },
  };

  return {
    score,
    breakdown,
    skills_matched: must.matched,
    skills_missing: must.missing,
    skills_nice: nice,
    exp_gap: exp.note,
    recommendation: score >= 75 ? 'apply' : score >= 60 ? 'consider' : 'skip',
    why_text: whyText({ score, must, exp, title, loc, required }),
  };
}

function whyText({ must, exp, title, loc, required }) {
  const bits = [];
  if (required.length) {
    bits.push(`${must.matched.length}/${required.length} required skills matched`);
    if (must.missing.length) bits.push(`missing ${must.missing.slice(0, 4).join(', ')}`);
  } else {
    bits.push('JD lists no explicit skills');
  }
  bits.push(exp.note);
  if (title.note) bits.push(title.note);
  bits.push(loc.note);
  const s = bits.filter(Boolean).join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/**
 * Competition signal — the always-free replacement for LinkedIn's applicant
 * count. Built only from observable facts: posting age, how many portals carry
 * it, and whether the JD is from a small board or a mass-syndicated one.
 */
export function competitionSignal(job) {
  const altCount = JSON.parse(job.alt_links || '[]').length;
  const hours = job.posted_at ? (Date.now() - new Date(job.posted_at).getTime()) / 36e5 : null;

  let points = 0;
  const reasons = [];

  if (hours == null) { points += 1; reasons.push('posting date unknown'); }
  else if (hours <= 24) { reasons.push('posted today'); }
  else if (hours <= 72) { points += 1; reasons.push('posted in last 3 days'); }
  else if (hours <= 24 * 14) { points += 2; reasons.push(`${Math.round(hours / 24)} days old`); }
  else { points += 3; reasons.push(`${Math.round(hours / 24)} days old`); }

  if (altCount > 2) { points += 2; reasons.push(`listed on ${altCount} sources`); }
  else if (altCount === 2) { points += 1; reasons.push('listed on 2 sources'); }
  else { reasons.push('single source'); }

  const level = points <= 1 ? 'Low' : points <= 3 ? 'Medium' : 'High';
  return { level, reason: reasons.join(', ') };
}

const round1 = (n) => Math.round(n * 10) / 10;
