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
    nationality: '', relocate: '', degree: '', school: '', fieldOfStudy: '', graduationYear: '',
    drivingLicense: '', languages: '',
    relativesOrReferrals: '', // 'no': no relatives or contacts at companies applied to
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

  // A typed reply to a yes/no question ("fluent in english not polish", "yes, 5 years"):
  // read it as yes or no when it clearly is one; anything unsure isn't guessed.
  const hasYes = opts.some((x) => YES.test(x.l)), hasNo = opts.some((x) => NO.test(x.l));
  if (hasYes && hasNo && !/^(yes|no)$/.test(a)) {
    // Numbers ("i have 2 years" to "at least 4 years?") are never guessed into a yes.
    const yn = /not sure|maybe|depends|unsure|don.?t know/.test(a) || (/\d/.test(a) && !/^(yes|no)\b/.test(a)) ? null
      : /^(yes|yeah|yep|y|sure|of course|correct|i am|i do|i have|i can)\b/.test(a) ? true
        : /^(no|nope|n|never|none|i am not|i'm not|i do not|i don't|i have not|i can't|cannot)\b|\bnot\b/.test(a) ? false : null;
    if (yn !== null) return pickOption(yn, options);
  }

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
  return cc === 'IN' ? `${lpa(v)} LPA` : `${CURRENCY[cc]} ${Number(v).toLocaleString('en-US')}${cc === 'AE' ? ' per month' : ' per year'}`;
}

/** An Indian amount in lakhs: "12" stays 12; a rupee figure ("1000000", "10,00,000") becomes 10. */
function lpa(val) {
  const n = Number(String(val).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(val);
  return n >= 1000 ? String(+(n / 100000).toFixed(2)) : String(n);
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
    // A lone checkbox: yes = tick it (its only option), no = leave it unticked.
    if (q.type === 'checkbox' && opts.length <= 1) return { answer: bool ? (opts[0] ?? true) : false, source };
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
  // Only a short label is the email field ("you'll write to clients via email…" is an essay).
  if (/e-?mail/.test(t) && t.length <= 45 && !/confirm|marketing|newsletter/.test(t)) return text(a.email, 'email', 'email');
  // Phone kind and dialing code (Workday and others ask these beside the number).
  if (/phone (device )?type|type of phone|device type/.test(t)) {
    const o = isChoice ? opts.find((x) => /mobile|cell/i.test(x)) : 'Mobile';
    return o ? { answer: o, source: 'phone' } : { needsHuman: true, reason: 'phone type options' };
  }
  if (/country phone code|phone country( code)?|country code|dialing code|calling code/.test(t)) {
    const dial = { IN: '+91', AE: '+971', DE: '+49', IE: '+353', NL: '+31', AU: '+61', US: '+1', GB: '+44' }[(resolveChoice(profile.baseCity) || {}).cc];
    const name = COUNTRY_NAMES[(resolveChoice(profile.baseCity) || {}).cc];
    if (!dial) return { needsHuman: true, reason: 'phone country code' };
    if (!isChoice) return { answer: dial, source: 'your city' };
    const o = opts.find((x) => x.includes(`(${dial})`) || x.includes(dial) && new RegExp(`\\b${name}\\b`, 'i').test(x)) || opts.find((x) => new RegExp(`^${name}\\b`, 'i').test(x));
    return o ? { answer: o, source: 'your city' } : { needsHuman: true, reason: 'phone country code options' };
  }
  if (/phone|mobile|contact number/.test(t)) return text(a.phone, 'phone', 'phone');
  if (/linkedin/.test(t)) return text(String(a.linkedin || '').replace(/[?#].*$/, ''), 'linkedin', 'LinkedIn URL'); // no tracking tail (?isSelf…)
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
  // "Authorised to work here without (requiring) sponsorship?": yes only if no support is needed, now or later.
  if (/\bwithout\b.{0,40}\b(sponsor|visa|support)/.test(t)) {
    if (!w.status) return { needsHuman: true, reason: `work status in ${COUNTRY_NAMES[cc]} not set` };
    return yesno(['citizen', 'permanent', 'visa_no_sponsor'].includes(w.status), `work status in ${COUNTRY_NAMES[cc]}`);
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

  // ---- messaging / marketing opt-ins: always no ----
  if (/opt[- ]?in|whatsapp|\bsms\b|text messages?|newsletter|marketing (emails?|communications?)/.test(t) && !/privacy|processing of my personal data/.test(t)) {
    if (q.type === 'checkbox') return { answer: false, source: 'no marketing / messages' };
    return yesno(false, 'no marketing / messages');
  }

  // ---- questions that only apply if the candidate lives somewhere else ("If located in the US, …") ----
  const condWhere = t.match(/^if (you are |you're |you )?(located|based|living|residing|reside|live) in (the )?([a-z .]+?)[,?]/);
  if (condWhere) {
    const there = countryIn(condWhere[4]);
    const homeCc = (resolveChoice(profile.baseCity) || {}).cc;
    if (there && homeCc && there !== homeCc) {
      if (!isChoice) return { answer: 'Not applicable', source: `not located in ${COUNTRY_NAMES[there]}` };
      const na = opts.find((o) => /not applicable|n\/a|none|not located|outside/i.test(o));
      return na ? { answer: na, source: `not located in ${COUNTRY_NAMES[there]}` } : { needsHuman: true, reason: 'conditional location question' };
    }
  }

  // ---- where the candidate is / can work ----
  const home = resolveChoice(profile.baseCity) || {};
  const homeCountry = home.cc ? COUNTRY_NAMES[home.cc] : '';
  const city = profile.baseCity ? String(profile.baseCity).replace(/\b\w/g, (c) => c.toUpperCase()) : '';
  if (/home address|street address|postal address|\bzip\b|pin ?code|postcode/.test(t)) return { needsHuman: true, reason: 'full address' };
  if (/country of residence|country (do )?you (currently )?(live|reside)|current country|^country\b|country (in which|where) you (are|currently) (located|based|reside)|choose the country/.test(t)) return text(homeCountry, 'your city', 'base city');
  // A bare "City" field (address forms such as Workday's): just the city.
  if (/^(town ?\/ ?)?city( ?\/ ?town)?$/.test(t.trim())) return text(city, 'your city', 'base city');
  if (/^location\b|current location|where are you (currently )?(based|located)|city of residence|current city|which city/.test(t) && !/prefer/.test(t)) {
    return text(city && homeCountry ? city + ', ' + homeCountry : '', 'your city', 'base city');
  }
  // "Do you plan to work remotely?" → from the user's accepted work modes and cities.
  if (/(plan|intend|prefer|want|like) to work remotely|work remotely or (from|in) (an|the) office|remote or (in[- ]office|on[- ]?site)/.test(t)) {
    const modes = (profile.workModes || []).map((m) => m.toLowerCase());
    const officeOk = !modes.length || modes.some((m) => m !== 'remote');
    const remoteOk = !modes.length || modes.includes('remote');
    const scope = userScope(profile);
    const cityOk = ctx.city ? scope.cities.has(ctx.city) || scope.countries.has(ctx.country || 'IN') : scope.cities.size > 0;
    const wantsRemote = remoteOk && !(officeOk && cityOk);
    return yesno(wantsRemote, wantsRemote ? 'you prefer remote' : 'job is in your city; you accept office work');
  }
  // Which country would you work from remotely → home country.
  if (/(remote location|work(ing)? remotely|remote basis).{0,100}(which|what) country|country.{0,40}(would|will|do) you (be )?(work|working) from/.test(t)) {
    return text(homeCountry, 'your city', 'base city');
  }
  // Countries you expect to work in → the job's country.
  if (/countr(y|ies).{0,40}(anticipate|expect|plan|intend|would like).{0,25}work/.test(t)) {
    return text(COUNTRY_NAMES[ctx.country || 'IN'], "the job's country", 'country');
  }
  const named = (label.match(/[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?/g) || []).map((w2) => resolveChoice(w2)).filter((r) => r && r.city);
  if (named.length && /(based|located|living|residing|staying) (in|out of|at)\b|currently in\b/.test(t)) {
    const here = named.some((r) => r.city === home.city);
    // "Based in Bangalore / Willing to relocate / Need fully remote": pick the one that's true.
    if (isChoice && !opts.some((o) => YES.test(lc(o)))) {
      const o = here ? opts.find((x) => /\b(based|live|living|located|resid)/i.test(x) && !/relocat|remote/i.test(x))
        : a.relocate === 'yes' ? opts.find((x) => /relocat/i.test(x) && !/can.?t|not|unable/i.test(x)) : null;
      return o ? { answer: o, source: here ? 'your city' : 'willing to relocate' } : { needsHuman: true, reason: 'where you are based' };
    }
    return yesno(here, 'your city');
  }
  if (named.length && /work(ing)? (from|in|at|out of)|office|open to|relocat|commute|on-?site in|comfortable (with )?(working|being based)/.test(t)) {
    const scope = userScope(profile);
    const ok = named.some((r) => r.city === home.city || scope.cities.get(r.city) === r.cc || scope.countries.has(r.cc));
    if (ok || a.relocate === 'yes') return yesno(true, ok ? 'your chosen locations' : 'willing to relocate');
    if (a.relocate === 'no') return yesno(false, 'not in your locations, not relocating');
    return { needsHuman: true, reason: 'relocation not set' };
  }

  // "Location preference: Bengaluru / Hyderabad / Other": the user's own city, else one of their chosen ones.
  if (isChoice && /location preference|preferred (work |job )?location|(which|what) (of our )?(location|office|city)/.test(t)) {
    const scope = userScope(profile);
    const cities = opts.map((o) => ({ o, r: resolveChoice(o) })).filter((x) => x.r?.city);
    const pick = cities.find((x) => x.r.city === home.city) || cities.find((x) => scope.cities.get(x.r.city) === x.r.cc);
    if (pick) return { answer: pick.o, source: pick.r.city === home.city ? 'your city' : 'your chosen locations' };
  }

  // ---- notice, start date, relocation ----
  if (/notice period|how soon.{0,20}join|joining time|^availability\b|available to start|when (can|could) you (start|join)/.test(t)) {
    if (a.noticePeriodDays === '') return { needsHuman: true, reason: 'notice period not set' };
    if (isChoice) return text(Number(a.noticePeriodDays), 'notice period');
    // "Notice period (in days)": a number, not "Immediately".
    if (/in days|\(days\)|number of days|no\.? of days|how many days/.test(t)) return { answer: String(Number(a.noticePeriodDays)), source: 'notice period' };
    return { answer: noticeText(a.noticePeriodDays), source: 'notice period' };
  }
  if (/serving (your )?notice|currently on notice/.test(t)) return yesno(!!a.servingNotice, 'serving notice');
  // (Not "Start date month/year": that's a work-history or education date.)
  if (/(earliest|available|availability).{0,25}(start|join)|start date|when can you start/.test(t) && !/\b(month|year)\b/.test(t)) {
    if (a.noticePeriodDays === '' && !a.lastWorkingDay) return { needsHuman: true, reason: 'notice period not set' };
    return isChoice ? text(Number(a.noticePeriodDays), 'notice period') : { answer: startDate(a), source: 'notice period' };
  }
  if (/relocat/.test(t)) return a.relocate === '' ? { needsHuman: true, reason: 'relocation not set' } : yesno(a.relocate === 'yes', 'relocation');
  if (/^(preferred )?(employment|job|contract) type$|full[- ]?time or part[- ]?time/.test(t)) {
    const want = a.employmentType || 'Full-time';
    const o = isChoice ? opts.find((x) => lc(x).replace(/[^a-z]/g, '') === lc(want).replace(/[^a-z]/g, '')) : want;
    return o ? { answer: o, source: 'employment type (default full-time)' } : { needsHuman: true, reason: 'employment type' };
  }

  // ---- money ----
  if (/(expected|desired|target|salary expectation|compensation expectation|expected ctc)/.test(t) && /(salary|ctc|compensation|pay|package)/.test(t)) {
    const v = salaryText(cc, w.salary);
    return v ? text(v, `expected salary in ${COUNTRY_NAMES[cc]}`) : { needsHuman: true, reason: `expected salary in ${COUNTRY_NAMES[cc]} not set` };
  }
  if (/(current|present|last drawn).{0,20}(ctc|salary|compensation|package)/.test(t)) {
    if (cc !== 'IN') return { needsHuman: true, reason: 'current salary outside India (often illegal to ask; your call)' };
    return a.currentCtcLpa === '' ? { needsHuman: true, reason: 'current CTC not set' }
      : text(/[a-z₹]/i.test(String(a.currentCtcLpa)) ? a.currentCtcLpa : `${lpa(a.currentCtcLpa)} LPA`, 'current CTC');
  }

  // ---- current job, education, misc facts ----
  if (/current .{0,25}(company|employer)|(most recent|latest|present) (company|employer)/.test(t)) return text(a.currentEmployer, 'current employer', 'current employer');
  if (/current .{0,25}(job )?(title|designation)|(most recent|latest) (job )?title|current (role|designation)/.test(t)) return text(a.currentTitle, 'current title', 'current title');
  if (/total (years of )?(professional |work )?experience|years of (professional |work )?experience\??$|how many years.{0,20}(work|professional) experience|how many years of experience (do )?you have\??$|^(professional|work) experience$/.test(t) && !/relevant/.test(t)) {
    return profile.totalExpYears == null ? { needsHuman: true, reason: 'years of experience not set' } : text(String(profile.totalExpYears), 'years of experience');
  }
  if (/years.{0,30}experience (with|in|using)|experience (with|in) .{2,40}\?/.test(t)) return { needsHuman: true, reason: 'skill-specific experience (answer once, reused after)' };
  if (/^(school|university|college|institution|institute)( name)?$|name of (your )?(school|university|college|institution)|which (school|university|college)/.test(t)) {
    return text(a.school, 'school / university', 'school or university');
  }
  if (/highest (level of )?(education|degree|qualification)|degree/.test(t) && !/field|major|discipline/.test(t)) return text(a.degree, 'degree', 'highest degree');
  if (/field of study|major|discipline|specialization/.test(t)) return text(a.fieldOfStudy, 'field of study', 'field of study');
  if (/graduat.{0,20}year|year of (graduation|passing)/.test(t)) return text(a.graduationYear, 'graduation year', 'graduation year');
  if (/driv(ing|er'?s) licen[cs]e/.test(t)) return a.drivingLicense === '' ? { needsHuman: true, reason: 'driving licence not set' } : yesno(a.drivingLicense === 'yes', 'driving licence');
  if (/languages? (do you speak|spoken|known)|which languages/.test(t)) return text(a.languages, 'languages', 'languages');
  if (/(18|eighteen) years|legal age|age of majority/.test(t)) return yesno(true, 'adult');
  if (/how did you (hear|find|learn|get to know|come to know|come across)|source of (application|referral)|where did you (hear|see|find)/.test(t)) {
    if (!isChoice) return { answer: 'Company careers website', source: 'default' };
    const o = opts.find((x) => /company (career|website)|careers? (page|site)|corporate website|website|job site/i.test(x) && !/college|university|campus|event|fair/i.test(x))
      || opts.find((x) => /job board|online|linkedin/i.test(x)) || opts.find((x) => /^other/i.test(x));
    return o ? { answer: o, source: 'default' } : { needsHuman: true, reason: 'referral source options' };
  }
  if (/(previously|ever) (worked|been employed|employed)|former employee|worked (for|at) .{0,40} before|(been|currently,? or have you been) employed (by|at|with)|employed by .{0,60}(past|previous|before|within)/.test(t)) {
    const co = lc(ctx.company);
    const worked = co && co.length > 2 && lc(ctx.cvText || '').includes(co);
    return worked ? { needsHuman: true, reason: `your CV mentions ${ctx.company}` } : yesno(false, 'CV has no record of this employer');
  }
  // Relatives / people you know at the company: a fact about the user, so only their own standing answer.
  if (/know anyone (who works|at)|relative|family member|related to (any|an) (employee|person)/.test(t)) {
    if (a.relativesOrReferrals === 'no') return yesno(false, 'your answer: no relatives or contacts at employers');
    return { needsHuman: true, reason: 'relatives or contacts at this company' };
  }
  // Referred by an employee: the agent applied directly, so no (unless the user says otherwise).
  if (/referr?ed by|referral/.test(t)) return yesno(false, 'applied directly, no referral');

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
    if (/marketing|newsletter|sms|text message|whatsapp updates|talent (pool|community|network)|future (job|role|position|opening|vacanc|opportunit|recruit|hiring|application)|(subsequent|other|later) recruitment|other (current or future |open |suitable )?(roles|positions|jobs|opportunities|openings)|keep (my|your) (data|information|details|cv|resume) (on file|for)|retain (my|your) .{0,40}for/.test(t)) {
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
