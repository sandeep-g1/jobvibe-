// The answer bank: facts an application form asks for, filled in once, and the
// engine that answers a form question from them.
//
// Rule: the engine only ever answers from stored facts. A question it cannot
// ground ("years of experience with SQL?", "do you have a non-compete?")
// comes back as needsHuman — the agent asks the user once and the answer is
// saved to answers.custom for next time. Open-ended questions ("why do you
// want to work here?") come back as essay, for the AI writer to draft.
import { COUNTRY_NAMES, ALL_CC, userScope, resolveChoice } from './geo.js';

export const AUTH_STATUS = {
  citizen: 'Citizen',
  permanent: 'Permanent resident',
  visa_no_sponsor: 'Have a work visa/permit, no sponsorship needed',
  visa_future_sponsor: 'Have a work visa now, will need sponsorship later',
  need_sponsorship: 'Need visa sponsorship',
  not_interested: 'Not looking to work here',
};

export const SALARY_UNIT = {
  IN: 'LPA (₹ lakh / year)', AE: 'AED / month', DE: 'EUR / year', IE: 'EUR / year',
  NL: 'EUR / year', AU: 'AUD / year', US: 'USD / year', GB: 'GBP / year',
};
const CURRENCY = { IN: 'INR', AE: 'AED', DE: 'EUR', IE: 'EUR', NL: 'EUR', AU: 'AUD', US: 'USD', GB: 'GBP' };

export const NOTICE_OPTIONS = [0, 15, 30, 45, 60, 90];
export const EEO_DECLINE = 'Prefer not to say';

/** Defaults for a profile that has never filled the bank. */
export function defaultAnswers(profile = {}) {
  const workAuth = {};
  for (const cc of ALL_CC) workAuth[cc] = { status: '', salary: '' };
  return {
    phone: '', email: (profile.emailTo || [])[0] || '', linkedin: '', portfolio: '',
    currentEmployer: '', currentTitle: '', currentCtcLpa: '',
    noticePeriodDays: '', servingNotice: false, lastWorkingDay: '',
    nationality: '', relocate: '', degree: '', fieldOfStudy: '', graduationYear: '',
    drivingLicense: '', languages: '',
    eeo: { gender: EEO_DECLINE, ethnicity: EEO_DECLINE, veteran: EEO_DECLINE, disability: EEO_DECLINE },
    consentStandard: false,
    workAuth,
    custom: [],
  };
}

/** Stored answers merged over defaults (so new fields appear for old profiles). */
export function getAnswers(profile = {}) {
  const d = defaultAnswers(profile);
  const a = profile.answers || {};
  return {
    ...d, ...a,
    eeo: { ...d.eeo, ...(a.eeo || {}) },
    workAuth: Object.fromEntries(ALL_CC.map((cc) => [cc, { ...d.workAuth[cc], ...((a.workAuth || {})[cc] || {}) }])),
    custom: Array.isArray(a.custom) ? a.custom : [],
  };
}

/** Countries the user is searching (their location scope), India first. */
export function targetCountries(profile) {
  const s = userScope(profile);
  return ALL_CC.filter((cc) => s.all || s.crawl.has(cc));
}

/**
 * What's still needed before the agent can apply on the user's behalf.
 * @returns {{ ready:boolean, missing:string[], pct:number }}
 */
export function answerBankStatus(profile) {
  const a = getAnswers(profile);
  const need = [
    ['phone', 'phone number'], ['email', 'email'], ['nationality', 'nationality'],
    ['noticePeriodDays', 'notice period'], ['relocate', 'willing to relocate'], ['degree', 'highest degree'],
  ];
  const missing = need.filter(([k]) => a[k] === '' || a[k] == null).map(([, l]) => l);
  for (const cc of targetCountries(profile)) {
    const w = a.workAuth[cc];
    if (!w.status) missing.push(`work status in ${COUNTRY_NAMES[cc]}`);
    else if (w.status !== 'not_interested' && !String(w.salary).trim()) missing.push(`expected salary in ${COUNTRY_NAMES[cc]}`);
  }
  if (!a.consentStandard) missing.push('permission to tick standard consent boxes');
  const total = need.length + targetCountries(profile).length * 2 + 1;
  return { ready: !missing.length, missing, pct: Math.round(((total - missing.length) / total) * 100) };
}

/* ------------------------------------------------------------------ */
/*  Answering                                                          */
/* ------------------------------------------------------------------ */

const lc = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Which of our 8 countries a question is about, if it names one. */
function countryIn(q) {
  const t = lc(q);
  const names = {
    IN: /\bindia\b/, AE: /\b(uae|united arab emirates|dubai|abu dhabi)\b/, DE: /\b(germany|eu\b|european union)/,
    IE: /\bireland\b/, NL: /\b(netherlands|holland)\b/, AU: /\baustralia\b/,
    US: /\b(united states|u\.s\.|usa|us\b|america)/, GB: /\b(united kingdom|uk\b|u\.k\.|britain|england)/,
  };
  for (const [cc, re] of Object.entries(names)) if (re.test(t)) return cc;
  return null;
}

const YES = /^(yes|y|true|i am|i do|i will|i have|agree|i agree|i consent|consent|accept|i accept|acknowledge|i acknowledge|confirm|i confirm|i understand|understood|i have read)\b/i;
const NO = /^(no|n|false|i am not|i do not|i don't|i will not|decline)\b/i;

/**
 * Pick the form option that best expresses `answer`.
 * @param {string|boolean|number} answer
 * @param {string[]} options  option labels shown on the form
 */
export function pickOption(answer, options = []) {
  if (!options.length) return null;
  const opts = options.map((o) => ({ o, l: lc(o) }));
  if (typeof answer === 'boolean') {
    const re = answer ? YES : NO;
    return (opts.find((x) => re.test(x.l)) || {}).o || null;
  }
  const a = lc(answer);
  if (!a) return null;
  const exact = opts.find((x) => x.l === a);
  if (exact) return exact.o;

  // Numbers: notice periods arrive as a number of days; years of experience
  // as a numeric string. Choose the option whose range contains the value.
  const isDays = typeof answer === 'number' || /^\d+ days?$/.test(a);
  // Plain numbers and amounts with a unit ("12 LPA", "4 years") compare numerically against bands.
  const unitNum = a.match(/^(\d+(?:\.\d+)?)\s*(lpa|lakhs?|l|years?|yrs?)?$/);
  const num = isDays ? Number(String(answer).split(' ')[0]) : unitNum ? Number(unitNum[1]) : null;
  if (num != null) {
    if (isDays && num === 0) {
      const im = opts.find((x) => /immediate|right away|^now|0 ?days|serving/.test(x.l)); if (im) return im.o;
    }
    const fits = opts.filter((x) => { const r = rangeOf(x.l, isDays); return r && num >= r[0] && num <= r[1]; });
    // Prefer the narrowest range that fits ("4-6" over "4+").
    fits.sort((x, y) => { const rx = rangeOf(x.l, isDays), ry = rangeOf(y.l, isDays); return (rx[1] - rx[0]) - (ry[1] - ry[0]); });
    if (fits.length) return fits[0].o;
    // No exact bucket. Notice: round UP (never promise an earlier start than you can make).
    // Experience: round DOWN (never overstate it).
    const ranged = opts.map((x) => ({ ...x, r: rangeOf(x.l, isDays) })).filter((x) => x.r);
    const pick = isDays
      ? ranged.filter((x) => x.r[1] >= num).sort((x, y) => x.r[1] - y.r[1])[0]
      : ranged.filter((x) => x.r[0] <= num).sort((x, y) => y.r[0] - x.r[0])[0];
    return pick ? pick.o : null;
  }

  // Whole-word containment only: "male" must never match "female".
  const word = (needle) => new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  const starts = opts.find((x) => word(a).test(x.l) && x.l.startsWith(a));
  if (starts) return starts.o;
  const contains = opts.find((x) => word(a).test(x.l) || (x.l.length > 3 && word(x.l).test(a)));
  return contains ? contains.o : null;
}

/** Numeric range an option label covers: "0-4", "4+", "less than 2", "5 to 8 years", "1 month". */
export function rangeOf(label, days = false) {
  const l = String(label).toLowerCase().replace(/,/g, '');
  const unit = (s) => (days && /month/.test(l) ? 30 : days && /week/.test(l) ? 7 : 1) * Number(s);
  let r;
  if ((r = l.match(/(less than|under|below|fewer than|<)\s*(\d+(?:\.\d+)?)/))) return [-Infinity, unit(r[2]) - 0.001];
  if ((r = l.match(/(up ?to|upto|max(?:imum)?|<=)\s*(\d+(?:\.\d+)?)/))) return [-Infinity, unit(r[2])];
  if ((r = l.match(/(more than|over|above|greater than|>)\s*(\d+(?:\.\d+)?)/))) return [unit(r[2]) + 0.001, Infinity];
  if ((r = l.match(/(\d+(?:\.\d+)?)\s*(\+|or more|and above|plus)/))) return [unit(r[1]), Infinity];
  if ((r = l.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/))) return [unit(r[1]), unit(r[2])];
  if ((r = l.match(/(\d+(?:\.\d+)?)/))) return [unit(r[1]), unit(r[1])];
  return null;
}

/** Declines on demographic questions: find the "prefer not / decline" option. */
function declineOption(options) {
  return (options.map((o) => ({ o, l: lc(o) }))
    .find((x) => /prefer not|decline|don.?t wish|do not wish|choose not|not to (say|disclose|answer)|rather not/.test(x.l)) || {}).o || null;
}

function noticeText(days) {
  const d = Number(days);
  if (d === 0) return 'Immediately';
  return `${d} days`;
}

function startDate(a) {
  if (a.lastWorkingDay) {
    const d = new Date(a.lastWorkingDay); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(); d.setDate(d.getDate() + Number(a.noticePeriodDays || 0));
  return d.toISOString().slice(0, 10);
}

function salaryText(cc, val) {
  const v = String(val || '').trim();
  if (!v) return '';
  if (/[a-z₹$€£]/i.test(v)) return v; // user already wrote units
  return cc === 'IN' ? `${v} LPA` : `${CURRENCY[cc]} ${Number(v).toLocaleString('en-US')}${cc === 'AE' ? ' per month' : ' per year'}`;
}

function nameParts(full = '') {
  const p = String(full).trim().split(/\s+/);
  return { first: p[0] || '', last: p.length > 1 ? p.slice(1).join(' ') : '' };
}

// Filler that every question shares; similarity is judged on the rest, so
// "years of Python experience" never borrows the answer to "years of SQL experience".
const FILLER = new Set(['how', 'many', 'much', 'years', 'year', 'experience', 'have', 'you', 'your', 'what', 'with',
  'the', 'are', 'did', 'does', 'any', 'this', 'for', 'and', 'please', 'do', 'can', 'will', 'would', 'currently',
  'working', 'work', 'hands', 'on', 'level', 'total', 'relevant', 'professional', 'select', 'describe', 'our', 'role',
  'of', 'in', 'to', 'is', 'an', 'at', 'be', 'or', 'if', 'as', 'by']);
const tokens = (s) => new Set(lc(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 1 && !FILLER.has(w)));
export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / Math.max(A.size, B.size);
}

function savedAnswer(label, custom) {
  let best = null;
  for (const c of custom) {
    const s = similarity(label, c.q);
    if (s >= 0.75 && (!best || s > best.s)) best = { s, c };
  }
  return best ? best.c : null;
}

/**
 * Answer one application question from the bank.
 * @param {object} q        { label, type: 'text'|'textarea'|'select'|'multiselect'|'checkbox'|'file', options?: string[], required? }
 * @param {object} profile  user profile (answers live in profile.answers)
 * @param {object} ctx      { country: ISO code of the job, company, title, cvText }
 * @returns {{ answer?:any, source?:string, needsHuman?:boolean, essay?:boolean, reason?:string }}
 */
export function answerQuestion(q, profile, ctx = {}) {
  const a = getAnswers(profile);
  const label = q.label || '';
  const t = lc(label);
  const opts = q.options || [];
  const isChoice = opts.length > 0;
  const cc = countryIn(label) || ctx.country || 'IN';
  const w = a.workAuth[cc] || {};
  const yesno = (bool, source) => {
    if (!isChoice) return { answer: bool ? 'Yes' : 'No', source };
    const o = pickOption(bool, opts);
    return o ? { answer: o, source } : { needsHuman: true, reason: `no ${bool ? 'yes' : 'no'} option` };
  };
  const text = (v, source, missing) => (v === '' || v == null
    ? { needsHuman: true, reason: `${missing} is not in your answer bank yet` }
    : isChoice
      ? (pickOption(v, opts) ? { answer: pickOption(v, opts), source } : { needsHuman: true, reason: `"${v}" doesn't match the options` })
      : { answer: v, source });

  // ---- the user's own earlier answer to this question wins over every rule ----
  const saved = q.type !== 'file' && savedAnswer(label, a.custom);
  if (saved) return text(saved.a, 'your saved answer', 'saved answer');

  if (q.type === 'file') {
    if (/resume|cv/.test(t)) return { answer: 'CV_FILE', source: 'tailored CV' };
    if (/cover/.test(t)) return { essay: true, reason: 'cover letter' };
    return { needsHuman: true, reason: 'document upload' };
  }

  // ---- identity & contact ----
  const n = nameParts(profile.name);
  if (/^(legal )?first name|given name/.test(t)) return text(n.first, 'name', 'first name');
  if (/^(legal )?last name|surname|family name/.test(t)) return text(n.last, 'name', 'last name');
  if (/preferred (first )?name/.test(t)) return text(n.first, 'name', 'preferred name');
  if (/^(full |legal )?name\b/.test(t)) return text(profile.name, 'name', 'name');
  if (/e-?mail/.test(t) && !/confirm|marketing|newsletter/.test(t)) return text(a.email, 'email', 'email');
  if (/phone|mobile|contact number/.test(t)) return text(a.phone, 'phone', 'phone');
  if (/linkedin/.test(t)) return text(a.linkedin, 'linkedin', 'LinkedIn URL');
  if (/github|portfolio|website|personal (site|url)/.test(t)) return a.portfolio ? text(a.portfolio, 'portfolio') : (q.required ? { needsHuman: true, reason: 'portfolio link' } : { answer: '', source: 'optional, left blank' });

  // ---- legal restrictions: always the user's call ----
  if (/non-?compete|non-?solicit|restrictive covenant|post-employment restriction|agreements? (that )?(may )?restrict|subject to any (employment )?agreement|outside business|conflict of interest|deemed export|export control|government official|procurement|security clearance|criminal|convicted|background (issue|record)/.test(t)) {
    return { needsHuman: true, reason: 'legal question: only you can answer this' };
  }

  // ---- work authorization ----
  if (/(what|which) (type|kind) of visa|visa type|current visa|on a visa/.test(t)) {
    const holds = ['visa_no_sponsor', 'visa_future_sponsor'].includes(w.status);
    if (!w.status) return { needsHuman: true, reason: `work status in ${COUNTRY_NAMES[cc]} not set` };
    if (holds) return { needsHuman: true, reason: 'which visa you hold' };
    if (!isChoice) return { answer: 'Not applicable', source: 'work status' };
    const na = opts.find((o) => /not applicable|n\/a|none|no visa|citizen|not on a visa/i.test(o));
    return na ? { answer: na, source: 'work status' } : { needsHuman: true, reason: 'visa type options' };
  }
  if (/(require|need).{0,40}sponsor|sponsorship|visa.{0,30}(support|transfer|sponsor)/.test(t)) {
    if (!w.status) return { needsHuman: true, reason: `work status in ${COUNTRY_NAMES[cc]} not set` };
    return yesno(['visa_future_sponsor', 'need_sponsorship'].includes(w.status), `work status in ${COUNTRY_NAMES[cc]}`);
  }
  if (/(legally )?(authori[sz]ed|eligible|entitled|permitted|right) to work|legally (able to )?work|able to (legally )?work in|work (permit|authori[sz]ation)|right to work/.test(t)) {
    if (!w.status) return { needsHuman: true, reason: `work status in ${COUNTRY_NAMES[cc]} not set` };
    return yesno(['citizen', 'permanent', 'visa_no_sponsor', 'visa_future_sponsor'].includes(w.status), `work status in ${COUNTRY_NAMES[cc]}`);
  }
  if (/citizenship|nationality/.test(t)) return text(a.nationality, 'nationality', 'nationality');

  // ---- where the candidate is / can work ----
  const home = resolveChoice(profile.baseCity) || {};
  const homeCountry = home.cc ? COUNTRY_NAMES[home.cc] : '';
  const city = profile.baseCity ? String(profile.baseCity).replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  if (/home address|street address|postal address|\bzip\b|pin ?code|postcode/.test(t)) return { needsHuman: true, reason: 'full address' };
  if (/country of residence|country (do )?you (currently )?(live|reside)|current country|^country\b|country (in which|where) you (are|currently) (located|based|reside)|choose the country/.test(t)) return text(homeCountry, 'your city', 'base city');
  if (/^location\b|current location|where are you (currently )?(based|located)|city of residence|current city|which city/.test(t) && !/prefer/.test(t)) {
    return text(city && homeCountry ? city + ', ' + homeCountry : '', 'your city', 'base city');
  }
  const named = (label.match(/[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?/g) || []).map((w2) => resolveChoice(w2)).filter((r) => r && r.city);
  if (named.length && /(currently )?(based|located|living|residing) in/.test(t)) {
    return yesno(named.some((r) => r.city === home.city), 'your city');
  }
  if (named.length && /work(ing)? (from|in|at|out of)|office|open to|relocat|commute|on-?site in|comfortable (with )?(working|being based)/.test(t)) {
    const scope = userScope(profile);
    const ok = named.some((r) => r.city === home.city || scope.cities.get(r.city) === r.cc || scope.countries.has(r.cc));
    if (ok || a.relocate === 'yes') return yesno(true, ok ? 'your chosen locations' : 'willing to relocate');
    if (a.relocate === 'no') return yesno(false, 'not in your locations, not relocating');
    return { needsHuman: true, reason: 'relocation not set' };
  }

  // ---- notice, start date, relocation ----
  if (/notice period|how soon.{0,20}join|joining time/.test(t)) {
    if (a.noticePeriodDays === '') return { needsHuman: true, reason: 'notice period not set' };
    return isChoice ? text(Number(a.noticePeriodDays), 'notice period') : { answer: noticeText(a.noticePeriodDays), source: 'notice period' };
  }
  if (/serving (your )?notice|currently on notice/.test(t)) return yesno(!!a.servingNotice, 'serving notice');
  if (/(earliest|available|availability).{0,25}(start|join)|start date|when can you start/.test(t)) {
    if (a.noticePeriodDays === '' && !a.lastWorkingDay) return { needsHuman: true, reason: 'notice period not set' };
    return isChoice ? text(Number(a.noticePeriodDays), 'notice period') : { answer: startDate(a), source: 'notice period' };
  }
  if (/relocat/.test(t)) return a.relocate === '' ? { needsHuman: true, reason: 'relocation not set' } : yesno(a.relocate === 'yes', 'relocation');

  // ---- money ----
  if (/(expected|desired|target|salary expectation|compensation expectation|expected ctc)/.test(t) && /(salary|ctc|compensation|pay|package)/.test(t)) {
    const v = salaryText(cc, w.salary);
    return v ? text(v, `expected salary in ${COUNTRY_NAMES[cc]}`) : { needsHuman: true, reason: `expected salary in ${COUNTRY_NAMES[cc]} not set` };
  }
  if (/(current|present|last drawn).{0,20}(ctc|salary|compensation|package)/.test(t)) {
    if (cc !== 'IN') return { needsHuman: true, reason: 'current salary outside India (often illegal to ask; your call)' };
    return a.currentCtcLpa === '' ? { needsHuman: true, reason: 'current CTC not set' } : text(`${a.currentCtcLpa} LPA`, 'current CTC');
  }

  // ---- current job, education, misc facts ----
  if (/current .{0,25}(company|employer)|(most recent|latest|present) (company|employer)/.test(t)) return text(a.currentEmployer, 'current employer', 'current employer');
  if (/current .{0,25}(job )?(title|designation)|(most recent|latest) (job )?title|current (role|designation)/.test(t)) return text(a.currentTitle, 'current title', 'current title');
  if (/total (years of )?(professional |work )?experience|years of (professional |work )?experience\??$|how many years.{0,20}(work|professional) experience|how many years of experience (do )?you have\??$|^(professional|work) experience$/.test(t) && !/relevant/.test(t)) {
    return profile.totalExpYears == null ? { needsHuman: true, reason: 'years of experience not set' } : text(String(profile.totalExpYears), 'years of experience');
  }
  if (/years.{0,30}experience (with|in|using)|experience (with|in) .{2,40}\?/.test(t)) return { needsHuman: true, reason: 'skill-specific experience (answer once, reused after)' };
  if (/highest (level of )?(education|degree|qualification)|degree/.test(t) && !/field|major|discipline/.test(t)) return text(a.degree, 'degree', 'highest degree');
  if (/field of study|major|discipline|specialization/.test(t)) return text(a.fieldOfStudy, 'field of study', 'field of study');
  if (/graduat.{0,20}year|year of (graduation|passing)/.test(t)) return text(a.graduationYear, 'graduation year', 'graduation year');
  if (/driv(ing|er'?s) licen[cs]e/.test(t)) return a.drivingLicense === '' ? { needsHuman: true, reason: 'driving licence not set' } : yesno(a.drivingLicense === 'yes', 'driving licence');
  if (/languages? (do you speak|spoken|known)|which languages/.test(t)) return text(a.languages, 'languages', 'languages');
  if (/(18|eighteen) years|legal age|age of majority/.test(t)) return yesno(true, 'adult');
  if (/how did you (hear|find|learn)|source of (application|referral)|where did you (hear|see|find)/.test(t)) {
    if (!isChoice) return { answer: 'Company careers website', source: 'default' };
    const o = opts.find((x) => /company (career|website)|careers? (page|site)|corporate website|website/i.test(x) && !/college|university|campus|event|fair/i.test(x))
      || opts.find((x) => /job board|online|linkedin/i.test(x)) || opts.find((x) => /^other/i.test(x));
    return o ? { answer: o, source: 'default' } : { needsHuman: true, reason: 'referral source options' };
  }
  if (/(previously|ever) (worked|been employed|employed)|former employee|worked (for|at) .{0,40} before|(been|currently,? or have you been) employed (by|at|with)|employed by .{0,60}(past|previous|before|within)/.test(t)) {
    const co = lc(ctx.company);
    const worked = co && co.length > 2 && lc(ctx.cvText || '').includes(co);
    return worked ? { needsHuman: true, reason: `your CV mentions ${ctx.company}` } : yesno(false, 'CV has no record of this employer');
  }
  if (/referr?ed by|referral|know anyone (who works|at)|relative|family member.{0,30}(work|employ)/.test(t)) return yesno(false, 'default: no referral');

  // ---- voluntary self-identification (US/UK/EU forms) ----
  const eeo = /\bgender\b|\bsex\b/.test(t) ? 'gender' : /race|ethnic/.test(t) ? 'ethnicity'
    : /veteran|military/.test(t) ? 'veteran' : /disab/.test(t) ? 'disability' : null;
  if (eeo) {
    const v = a.eeo[eeo] || EEO_DECLINE;
    if (v === EEO_DECLINE) {
      const o = isChoice ? declineOption(opts) : 'Prefer not to say';
      return o ? { answer: o, source: 'voluntary: declined' } : { needsHuman: true, reason: `${eeo}: no "prefer not to say" option` };
    }
    return text(v, `voluntary: ${eeo}`, eeo);
  }

  // ---- consent boxes ----
  if (/\b(i )?(agree|consent|acknowledge|certify|confirm|accept)(?!ments?\b)|privacy (policy|notice)|data (processing|protection)|gdpr|terms (and|&) conditions|information policy|have read/.test(t)) {
    // Marketing and talent-pool opt-ins: never ticked. A required one goes to the user.
    if (/marketing|newsletter|sms|text message|whatsapp updates|talent (pool|community|network)|future (job|role|position|opening|vacanc|opportunit)|other (current or future |open |suitable )?(roles|positions|jobs|opportunities|openings)|keep (my|your) (data|information|details|cv|resume) (on file|for)|retain (my|your) .{0,40}for/.test(t)) {
      if (q.required) return { needsHuman: true, reason: 'talent-pool / marketing consent is required here' };
      // A lone checkbox has no "No" option: declining means leaving it unticked.
      return q.type === 'checkbox' ? { answer: false, source: 'no marketing / talent pool' } : yesno(false, 'no marketing / talent pool');
    }
    return a.consentStandard ? yesno(true, 'standard consent (you allowed this)') : { needsHuman: true, reason: 'consent box: you have not allowed the agent to tick these' };
  }

  // ---- follow-ups to an earlier yes/no ("If yes, please describe") ----
  if (/^(if (yes|so|applicable|you (selected|answered|chose) yes|you have)|please (specify|describe|explain) if)\b/.test(t)) {
    return q.required ? { needsHuman: true, reason: 'follow-up detail' } : { answer: '', source: 'follow-up, left blank' };
  }

  // ---- open-ended ----
  if (q.type === 'textarea' || /why (do you|are you|this)|tell us|describe|cover letter|additional information|anything else|proud of|something you|a time (when|you)|an example of|share (a|an|your)|what (excites|interests|motivates|attracts)/.test(t)) {
    return { essay: true, reason: 'open-ended: AI drafts it for your approval' };
  }

  if (!q.required) return { answer: '', source: 'optional, left blank' };
  return { needsHuman: true, reason: 'not covered by your answer bank yet' };
}
