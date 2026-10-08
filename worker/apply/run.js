// Apply to one job: read the form, answer it, fill it, then submit (or stop,
// in dry-run). Outcomes:
//   closed      the employer took the job down
//   ineligible  a truthful answer rules the user out (work rights, location, language)
//   needs_user  a required question only the user can answer: nothing filled
//   dry_run     filled and checked, not submitted (testing)
//   submitted   the site showed a new confirmation after the click (evidence kept)
//   captcha     the site asked for a human check: handed back to the user
//   failed      the form rejected something, or the page broke
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractFields, fillField, atsOf, formUrl, comboOptions } from './forms.js';
import { answerQuestion } from '../../src/lib/answers.js';
import { draftAnswer } from '../../src/lib/essay.js';
import { resolveChoice } from '../../src/lib/geo.js';

// Matched only against text that appears after the submit click: job descriptions
// themselves often say "Thank you for your interest in <company>".
export const CONFIRM = /thank(s| you) for (applying|your (application|interest|submission)|submitting)|application (has been |was |is )?(received|submitted|sent|complete)|we('ve| have) received your application|successfully (applied|submitted)|you('ve| have) (successfully )?applied/i;

// Questions that decide whether the user can take the job at all. A truthful "No" to one
// of these is an automatic rejection, so the agent stops instead of applying.
const ELIGIBILITY = /(authori[sz]ed|eligible|entitled|permitted|right|allowed) to work|legally (able to )?work|work (permit|authori[sz]ation)|fluen(t|cy)|proficien(t|cy)|native speaker|(speak|write|read)s? .{0,30}\b(english|german|dutch|french|spanish|polish|arabic|italian|portuguese)\b|(based|located|reside|residing|living|live) (in|within)|on-?site|in the office|commut|security clearance/i;
// "Do you require a visa / work permit / sponsorship?": here "No" is the good answer.
// ("Authorised to work here without sponsorship?" is not one of these: "No" there rules you out.)
const needsSupport = (label) => !/\bwithout\b.{0,40}\b(sponsor|visa|permit|support)/i.test(label)
  && /sponsor|\b(require|need)s?\b.{0,80}\b(visa|permit|support|right to work|authori[sz]ation)|\b(visa|permit|support)\b.{0,40}\b(required|needed)\b/i.test(label);
const isNo = (v) => v === false || /^(no|n|false)\b|^i (am not|do not|don't|will not|can't|cannot)\b|^not (authori|eligible|willing|able|located|based|fluent)/i.test(String(v ?? '').trim());
export function blocksEligibility(f, r) {
  if (!ELIGIBILITY.test(f.label) || needsSupport(f.label) || /^(voluntary|no marketing)/.test(r.source || '')) return false;
  // A lone attestation checkbox ("I confirm I'm based in the EU") only matters when required.
  if (f.type === 'checkbox' && (f.options?.length || 0) <= 1) return r.answer === false && f.required;
  return isNo(r.answer);
}
const CLOSED = /no longer (open|available|accepting)|job (you requested )?(was )?not found|(job|position|posting|role) (is )?no longer (available|open|active|accepting)|no longer accepting applications|(job|position|posting) has (been )?(closed|filled|expired)|this (job|position) (is )?closed|page (you('re| are) looking for )?(could not be|was not|wasn't) found/i;
// Two field values that say the same thing: equal text, the same URL (http/https, www,
// trailing slash), or the same city ("Bengaluru, Karnataka, IND" = "Bengaluru, India").
// A site's own location pick is kept: retyping it as free text can clear an autocomplete.
const urlKey = (s) => String(s).trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
function sameMeaning(a, b) {
  const x = String(a ?? '').trim(), y = String(b ?? '').trim();
  if (x.toLowerCase() === y.toLowerCase()) return true;
  // Phone numbers the site reformats ("7030193602" → "70301 93602", "+91 …"): same digits, same number.
  const dx = x.replace(/\D/g, ''), dy = y.replace(/\D/g, '');
  if (/^[\d\s()+-]{7,}$/.test(x) && /^[\d\s()+-]{7,}$/.test(y) && (dx === dy || dx.endsWith(dy) || dy.endsWith(dx))) return true;
  if (/^(https?:\/\/|www\.)/i.test(x) && /^(https?:\/\/|www\.)/i.test(y)) return urlKey(x) === urlKey(y);
  const cx = resolveChoice(x.split(',')[0]), cy = resolveChoice(y.split(',')[0]);
  return !!(cx?.city && cy?.city && cx.city === cy.city);
}
// After Submit, Greenhouse may email a code to the applicant and wait for it.
const EMAIL_CODE = /(security|verification|confirmation) code|enter the (\d+[- ]character )?code|we('ve| have) (just )?(sent|emailed) (you )?(a|an|the) .{0,30}code/i;
/** Error messages a person would actually see right now. */
const visibleErrors = (page) => page.evaluate(() => [...document.querySelectorAll('[class*="error" i], [role="alert"], .invalid-feedback')]
  .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  .map((e) => e.innerText.trim()).filter(Boolean)).catch(() => []);
/** A bot check that wants a person: a known challenge frame, or any large visible CAPTCHA frame. */
async function challengeShown(page) {
  if (await page.locator(CHALLENGE).first().isVisible().catch(() => false)) return true;
  return page.evaluate(() => [...document.querySelectorAll('iframe')].some((f) => {
    if (!/captcha|challenges\.cloudflare/i.test(f.src)) return false;
    const r = f.getBoundingClientRect();
    return r.height > 120 && r.width > 120 && getComputedStyle(f).visibility !== 'hidden';
  })).catch(() => false);
}
/** Type an emailed code into the form: one box, or one box per character. */
async function enterCode(page, code) {
  const boxes = page.locator('input[maxlength="1"]:visible');
  const n = await boxes.count();
  if (n >= code.length) {
    for (let k = 0; k < code.length; k++) await boxes.nth(k).fill(code[k]);
    return true;
  }
  // Most specific first; never a postal, zip or phone-country "code" field.
  const not = ':not([type=hidden]):not([name*="postal" i]):not([id*="postal" i]):not([name*="zip" i]):not([name*="country" i]):not([id*="country" i])';
  for (const sel of ['input[autocomplete="one-time-code"]', 'input[id*="security" i]', 'input[name*="security" i]',
    'input[aria-label*="security code" i]', `input[id*="code" i]${not}`, `input[name*="code" i]${not}`]) {
    const one = page.locator(sel).filter({ visible: true }).first();
    if (await one.count()) { await one.fill(code); return true; }
  }
  return false;
}
const PARSING = /analy[sz]ing (your )?(resume|cv)|parsing (your )?(resume|cv)|reading your (resume|cv)/i;
const CHALLENGE = 'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[title*="challenge" i]';

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/**
 * The form's real submit button: visible, enabled, a submit-type control or one
 * labelled submit/send/apply. Never "Apply with LinkedIn/Indeed" or tab links.
 */
async function findSubmit(page) {
  const cands = page.locator('button, input[type=submit]');
  const n = await cands.count();
  let best = null;
  for (let i = 0; i < n; i++) {
    const c = cands.nth(i);
    if (!(await c.isVisible().catch(() => false)) || !(await c.isEnabled().catch(() => false))) continue;
    const text = ((await c.innerText().catch(() => '')) || (await c.getAttribute('value')) || '').trim();
    if (/linkedin|indeed|google|seek|with |save|draft|cancel|back|upload|attach|locate/i.test(text)) continue;
    const type = (await c.getAttribute('type')) || '';
    const score = (/^(submit( application)?|send( application)?|apply( now)?|complete application)$/i.test(text) ? 3 : /submit|send/i.test(text) ? 2 : 0)
      + (type === 'submit' ? 1 : 0);
    if (score > 0 && (!best || score >= best.score)) best = { c, score };
  }
  return best?.c || null;
}

async function openForm(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  // Cookie banners can cover the form: decline non-essential cookies.
  await page.locator('a, button').filter({ hasText: /^\s*(decline non-essential|reject all|decline all|reject non-essential)\s*$/i }).first().click({ timeout: 2000 }).catch(() => {});
  let fields = await extractFields(page);
  // Some boards show the description first and the form behind an "Apply" button.
  if (!fields.some((f) => f.type === 'file' || /email/i.test(f.label))) {
    const btn = page.locator('a, button').filter({ hasText: /^\s*(apply( (now|for this job))?|i'?m interested)\s*$/i }).first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(3000); fields = await extractFields(page); }
  }
  return fields;
}

/**
 * @param {object} o
 * @param {import('playwright').Browser} o.browser
 * @param {object} o.job      { url, title, company, country, jd_text }
 * @param {object} o.profile  user profile (answers live in profile.answers)
 * @param {Buffer} o.cv       CV to upload (tailored .docx, or the original)
 * @param {string} o.cvName   file name for the upload
 * @param {string} o.cvText   plain CV text (for essays)
 * @param {boolean} o.dryRun  fill but never submit
 */
/**
 * …plus, for forms with a CAPTCHA (assisted mode):
 * @param {import('playwright').Browser} [o.visibleBrowser]  a browser window on the user's screen: the agent
 *        fills the form there, the user types the CAPTCHA and presses Submit, the agent watches for the confirmation
 * @param {Function} [o.onYourTurn]  called once the form is filled and waiting for the user
 */
export async function applyOne({ browser, job, profile, cv, cvName, cvText, dryRun = true, getEmailCode = null, visibleBrowser = null, onYourTurn = null }) {
  const ats = atsOf(job.url);
  const url = formUrl(job.url, ats);
  const dir = join(tmpdir(), 'jobvibe-apply', safe(`${job.company}_${job.title}`));
  mkdirSync(dir, { recursive: true });
  const cvPath = join(dir, cvName || 'Resume.docx');
  writeFileSync(cvPath, cv);

  const context = await (visibleBrowser || browser).newContext({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const log = [];
  let clicked = false;
  try {
    const fields = await openForm(page, url);
    // A closed job often lands on the company's job list ("The job you are looking for is
    // no longer open"), whose search box is not an application form. A real form asks for
    // a CV or an email.
    const isForm = fields.some((f) => f.type === 'file' || /e-?mail/i.test(f.label));
    if (!fields.length || !isForm) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (CLOSED.test(text)) return { status: 'closed', reason: 'the employer has closed this job', url };
      return { status: 'failed', reason: 'no application form found on the page', url };
    }
    // A typed CAPTCHA ("Type the text in the image", Keka, Zoho Recruit): a person must submit
    // this form. Hand it over before filling anything; never ask the user about the box.
    const typedCaptcha = await page.evaluate(() => [...document.querySelectorAll('input')]
      .some((el) => el.getClientRects().length && /captcha|image text|text in the image|security text/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') || ''}`)))
      .catch(() => false);
    if (typedCaptcha && !visibleBrowser) return { status: 'captcha', reason: 'the application form has a CAPTCHA', url };
    const humanSubmits = typedCaptcha && !!visibleBrowser; // assisted: she types the CAPTCHA and submits

    // 1. Decide every answer before touching the page.
    const plan = [];
    const ask = [];
    const noGo = [];
    for (const f of fields) {
      if (/captcha/i.test(`${f.id} ${f.selector} ${f.label}`)) continue; // the person types this one
      // A lone checkbox whose "label" swallowed half the form ("First Name* Last Name* Email*…"):
      // its own text is the real question.
      if (f.type === 'checkbox' && f.options?.length === 1 && (f.label.length > 200 || (f.label.match(/\*/g) || []).length >= 3)) f.label = f.options[0];
      // Searchable dropdowns: read the real choices so answers pick one of them.
      if (f.type === 'combobox' && !f.options?.length) f.options = await comboOptions(page, f);
      // A 100-item list is a page of a searchable directory (schools, cities): answer with the
      // stored text and let the filler search for it, instead of choosing from a partial list.
      if (f.type === 'combobox' && f.options?.length >= 100) { f.options = []; f.allowOther = /school|university|college|institution|employer|company/i.test(f.label); }
      const qType = f.type === 'radio' || (f.type === 'combobox' && f.options?.length) ? 'select' : f.type === 'combobox' ? 'text' : f.type;
      const q = { label: f.label, type: qType, options: f.options, required: f.required };
      const r = answerQuestion(q, profile, { country: job.country || 'IN', company: job.company, cvText });
      if (r.answer === 'CV_FILE') { plan.push({ f, value: cvPath, source: 'CV' }); continue; }
      if (r.essay) {
        if (!f.required && !/cover/i.test(f.label)) continue; // optional essays: skip
        let d = await draftAnswer({ question: f.label, type: f.type === 'file' ? 'file' : f.type, job, profile, cvText });
        if (!d.ok) { await new Promise((res) => setTimeout(res, 6000)); d = await draftAnswer({ question: f.label, type: f.type === 'file' ? 'file' : f.type, job, profile, cvText }); }
        if (!d.ok) log.push(`draft failed for "${f.label.slice(0, 60)}": ${d.error}`);
        if (!d.ok) { if (f.required) ask.push({ label: f.label, reason: `couldn't draft: ${d.error}` }); continue; }
        if (f.type === 'file') {
          const p = join(dir, `${safe(profile.name || 'Candidate')}_Cover_Letter.txt`); writeFileSync(p, d.text);
          plan.push({ f, value: p, source: 'AI cover letter', text: d.text });
        } else plan.push({ f, value: d.text, source: 'AI draft' });
        continue;
      }
      if (r.needsHuman) { if (f.required) ask.push({ label: f.label, reason: r.reason, options: f.options || [] }); continue; }
      if (r.answer === '' || r.answer == null) continue;
      if (blocksEligibility(f, r)) noGo.push({ label: f.label, answer: r.answer === false ? 'No' : String(r.answer) });
      plan.push({ f, value: r.answer, source: r.source });
    }
    // Not eligible (unless the user said apply anyway): stop before asking or filling anything.
    if (noGo.length && !job.override) return { status: 'ineligible', reasons: noGo, url };
    if (ask.length) return { status: 'needs_user', questions: ask, url };

    // 2. Fill.
    for (const step of plan) {
      const okFill = await fillField(page, step.f, step.value).catch((e) => { log.push(`${step.f.label}: ${e.message.split('\n')[0]}`); return false; });
      if (!okFill && step.f.required) return { status: 'failed', reason: `could not fill "${step.f.label}"`, url, log };
    }
    await page.waitForTimeout(800);

    // Some boards (Lever) read the uploaded CV in the background and then overwrite or clear
    // fields already filled. Wait for that to finish, then put back anything that changed.
    for (let i = 0; i < 20 && PARSING.test(await page.evaluate(() => document.body.innerText).catch(() => '')); i++) await page.waitForTimeout(1000);
    for (const step of plan) {
      if (!['text', 'email', 'tel', 'url', 'number', 'textarea'].includes(step.f.type)) continue;
      const now = await page.locator(step.f.selector).first().inputValue().catch(() => null);
      if (now != null && !sameMeaning(now, step.value)) {
        log.push(`refilled "${step.f.label.slice(0, 50)}" (the site changed it to "${now.slice(0, 40)}")`);
        await fillField(page, step.f, step.value).catch(() => false);
      }
    }

    // 3. Every required field must now hold a value.
    // Required is marked either way: the `required` attribute, or aria-required (Greenhouse).
    const empty = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.required || el.getAttribute('aria-required') === 'true')
      .filter((el) => el.offsetParent !== null && el.type !== 'file' && el.type !== 'hidden')
      .filter((el) => !/captcha/i.test(`${el.name} ${el.id} ${el.placeholder}`)) // typed by the person
      .filter((el) => {
        if (el.type === 'checkbox' || el.type === 'radio') return !document.querySelector(`input[name="${CSS.escape(el.name)}"]:checked`);
        // Searchable dropdown: its text box stays empty; the chosen value shows next to it.
        if (el.getAttribute('role') === 'combobox' || /select__input/.test(el.className)) {
          // The whole dropdown ("…__control"), not the inner "input-container" around the text box.
          const box = el.closest('[class*="control"]') || el.closest('[class*="value-container"]');
          return !(box && box.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]'));
        }
        return !String(el.value || '').trim();
      })
      .map((el) => el.name || el.id || el.getAttribute('aria-label') || 'unnamed field'));
    if (empty.length) return { status: 'failed', reason: `required fields left empty: ${empty.join(', ')}`, url, log };

    const screenshot = await page.screenshot({ fullPage: true });
    const filled = plan.map((s) => ({ label: s.f.label, value: s.f.type === 'file' ? `[file] ${s.source}` : String(s.value).slice(0, 200), source: s.source }));
    if (dryRun) return { status: 'dry_run', url, filled, screenshot, log };

    // 4a. Assisted: the person types the CAPTCHA and presses Submit; watch for the confirmation.
    if (humanSubmits) {
      const startUrl = page.url();
      const seen = new Set((await page.evaluate(() => document.body.innerText).catch(() => '')).split('\n').map((x) => x.trim()));
      await page.bringToFront().catch(() => {});
      if (onYourTurn) await onYourTurn();
      clicked = true; // from here on the person may have submitted: never auto-retry
      const until = Date.now() + 15 * 60000;
      while (Date.now() < until) {
        await page.waitForTimeout(3000);
        if (page.isClosed()) return { status: 'unconfirmed', reason: 'the browser window was closed before a confirmation showed', url, filled, clicked };
        const fresh = (await page.evaluate(() => document.body.innerText).catch(() => '')).split('\n').map((x) => x.trim()).filter((x) => x && !seen.has(x));
        const line = fresh.find((l) => CONFIRM.test(l));
        if (line || (page.url() !== startUrl && /confirm|thank|success|submitted/i.test(page.url()))) {
          return { status: 'submitted', url, filled, evidence: { url: page.url(), text: (line || '').slice(0, 300), at: new Date().toISOString(), assisted: true }, screenshot: await page.screenshot({ fullPage: true }).catch(() => null) };
        }
      }
      return { status: 'captcha', reason: 'not submitted within 15 minutes (CAPTCHA left for you)', url, filled, clicked: false };
    }

    // 4. Submit and read the outcome.
    const btn = await findSubmit(page);
    if (!btn) return { status: 'failed', reason: 'could not find the submit button', url, filled, log };
    // Baseline: what the page says before submitting. Only lines that appear afterwards count.
    const visibleLines = () => page.evaluate(() => document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean)).catch(() => []);
    const before = new Set(await visibleLines());
    const urlBefore = page.url();
    const errorsBefore = new Set(await visibleErrors(page));
    const clickedAt = new Date();
    await btn.click({ timeout: 15000 });
    clicked = true; // from here on, never auto-retry unless the form clearly rejected it
    let codeEntered = false;
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      const fresh = (await visibleLines()).filter((l) => !before.has(l));
      const line = fresh.find((l) => CONFIRM.test(l));
      const movedTo = page.url() !== urlBefore && /confirm|thank|success|submitted/i.test(page.url()) ? page.url() : null;
      if (line || movedTo) {
        const evidence = { url: page.url(), text: (line || '').slice(0, 300), at: new Date().toISOString() };
        return { status: 'submitted', url, filled, evidence, screenshot: await page.screenshot({ fullPage: true }) };
      }
      if (await challengeShown(page)) {
        return { status: 'captcha', url, filled, screenshot: await page.screenshot({ fullPage: true }).catch(() => screenshot) };
      }
      // Greenhouse emails the applicant a security code and waits for it: not submitted yet.
      // With the user's mailbox connected, read the code sent after this click, enter it, resubmit.
      const asks = !codeEntered && fresh.find((l) => EMAIL_CODE.test(l));
      if (asks) {
        if (!getEmailCode) return { status: 'email_code', reason: asks.slice(0, 200), url, filled, log, clicked };
        const code = await getEmailCode(clickedAt);
        if (!code) return { status: 'email_code', reason: 'the security code email did not arrive within 2 minutes', url, filled, log, clicked };
        if (!(await enterCode(page, code))) return { status: 'email_code', reason: "couldn't find the security code field", url, filled, log, clicked };
        log.push('entered the security code emailed to the applicant');
        const again = await findSubmit(page);
        if (again) await again.click({ timeout: 15000 }).catch(() => {});
        codeEntered = true;
        i = 0; // give the resubmission its own wait
      }
    }
    // Only errors that became visible after the click: forms carry hidden error templates
    // ("File exceeds the maximum upload size…") from the moment they load.
    const errors = (await visibleErrors(page)).filter((e) => !errorsBefore.has(e)).slice(0, 5);
    // The form showed errors: nothing was accepted, safe to fix and retry.
    if (errors.length) return { status: 'failed', reason: `form said: ${errors.join(' | ')}`, url, filled, log, clicked, rejected: true };
    // Clicked but no confirmation and no errors: it may have gone through. Never resend blindly.
    return { status: 'unconfirmed', reason: 'submitted, but the site showed no confirmation', url, filled, log, clicked,
      screenshot: await page.screenshot({ fullPage: true }).catch(() => null) };
  } catch (err) {
    // A crash after the submit click may still have submitted: don't resend blindly.
    if (clicked) return { status: 'unconfirmed', reason: `after submitting: ${err.message.split('\n')[0]}`, url, log, clicked };
    return { status: 'failed', reason: err.message.split('\n')[0], url, log };
  } finally {
    await context.close();
  }
}
