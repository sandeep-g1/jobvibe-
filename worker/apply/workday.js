// Workday applications: one candidate account per employer site, then a
// multi-page wizard (Autofill with Resume → My Information → My Experience →
// Application Questions → Voluntary Disclosures → Review → Submit).
//
// Workday's candidate pages are the same product everywhere and mark their
// controls with data-automation-id, so one driver covers every employer.
//
// Account rules:
//  - The account uses the user's connected job-hunt email and a generated password,
//    stored encrypted on her profile per Workday site. Verification emails go to
//    that inbox, which the agent reads (read-only).
//  - The privacy-notice box is ticked only if the user allowed standard consent boxes.
//  - "beecatcher" is a hidden honeypot field: it is never touched.
//  - Any CAPTCHA or bot check: stop and hand back to the user. No workarounds.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { answerQuestion, pickOption } from '../../src/lib/answers.js';
import { draftAnswer } from '../../src/lib/essay.js';
import { blocksEligibility, CONFIRM } from './run.js';

const ID = (id) => `[data-automation-id="${id}"]`;
const NEXT = `${ID('pageFooterNextButton')}, ${ID('bottom-navigation-next-button')}`;
const ERRORS = `${ID('errorBanner')}, ${ID('errorMessage')}, [data-automation-id*="error-message" i]`;
const SUBMITTED = /application (has been |was )?(submitted|received)|thanks? (you )?for applying|you('ve| have) (successfully )?applied|successfully submitted|congratulations/i;
const ALREADY = /you('ve| have) already applied|already (submitted|applied)/i;
const VERIFY = /verify (your )?(email|account)|verification (email|link)|check your (email|inbox)|activate your account/i;
const CHALLENGE_FRAME = /captcha|turnstile|challenges\.cloudflare/i;

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/** Workday site key: "hitachi.wd1" from https://hitachi.wd1.myworkdayjobs.com/… */
export const siteKey = (url) => new URL(url).hostname.replace(/\.myworkdayjobs\.com$/, '');

/** A password meeting Workday's usual rules (upper, lower, number, special, 8+). */
export function newPassword() {
  const body = randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  return `${body}Jv7#q`;
}

async function settle(page) {
  await page.locator(ID('applyFlowLoadingPage')).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function challengeShown(page) {
  return page.evaluate((src) => [...document.querySelectorAll('iframe')].some((f) => {
    if (!new RegExp(src, 'i').test(f.src)) return false;
    const r = f.getBoundingClientRect();
    return r.height > 60 && r.width > 60 && getComputedStyle(f).visibility !== 'hidden';
  }), CHALLENGE_FRAME.source).catch(() => false);
}

const bodyText = (page) => page.evaluate(() => document.body.innerText).catch(() => '');
const visibleErrors = (page) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()).filter(Boolean), ERRORS).catch(() => []);

/* ---------------- sign in / create account ---------------- */

async function signIn(page, acc) {
  await page.locator(ID('email')).first().fill(acc.email);
  await page.locator(ID('password')).first().fill(acc.password);
  await page.locator(ID('signInSubmitButton')).first().click();
  await settle(page);
}

/**
 * Get past "Create Account/Sign In". Returns null when signed in, or an outcome to stop with.
 * `account` is the stored { email, password } for this site, or null.
 */
async function enter(page, { account, profile, createAccount, getVerifyLink }) {
  const emailBtn = page.locator(ID('SignInWithEmailButton'));
  await Promise.race([
    emailBtn.waitFor({ timeout: 45000 }),
    page.locator(ID('email')).first().waitFor({ timeout: 45000 }),
  ]).catch(() => {});
  if (await emailBtn.isVisible().catch(() => false)) { await emailBtn.click(); await page.waitForTimeout(1500); }
  if (await challengeShown(page)) return { status: 'captcha', reason: 'Workday asked for a human check at sign-in' };

  if (account) {
    await signIn(page, account);
    const errs = await visibleErrors(page);
    if (errs.length && await page.locator(ID('signInSubmitButton')).isVisible().catch(() => false)) {
      return { status: 'failed', reason: `Workday sign-in failed: ${errs.join(' | ').slice(0, 150)}`, signInFailed: true };
    }
    return null;
  }

  // New account on this employer's Workday site.
  const email = profile.mailbox?.email;
  if (!email) return { status: 'manual', reason: 'Workday needs your job-hunt mailbox connected (for the account and its emails)' };
  if (!profile.answers?.consentStandard) return { status: 'needs_user', questions: [{ label: 'Workday account: allow the agent to accept the employer\'s data-privacy notice?', reason: 'consent box', options: ['Yes', 'No'] }] };
  await page.locator(ID('createAccountLink')).first().click();
  await page.locator(ID('verifyPassword')).first().waitFor({ timeout: 15000 });
  const acc = { email, password: newPassword() };
  await page.locator(ID('email')).first().fill(acc.email);
  await page.locator(ID('password')).first().fill(acc.password);
  await page.locator(ID('verifyPassword')).first().fill(acc.password);
  const box = page.locator(ID('createAccountCheckbox')).first();
  if (await box.count() && !(await box.isChecked().catch(() => false))) await box.check({ force: true });
  const since = new Date();
  await page.locator(ID('createAccountSubmitButton')).first().click();
  await settle(page);
  await createAccount(acc); // stored before anything else can go wrong: the account now exists

  const errs = await visibleErrors(page);
  if (errs.some((e) => /already (exists|in use|registered)|account with this email/i.test(e))) {
    return { status: 'manual', reason: 'a Workday account with your email already exists on this site; apply there with your own password' };
  }
  if (errs.length && await page.locator(ID('createAccountSubmitButton')).isVisible().catch(() => false)) {
    return { status: 'failed', reason: `Workday did not create the account: ${errs.join(' | ').slice(0, 150)}` };
  }
  if (await challengeShown(page)) return { status: 'captcha', reason: 'Workday asked for a human check when creating the account' };

  // Some sites email a verification link before the account works.
  if (VERIFY.test(await bodyText(page))) {
    const link = getVerifyLink ? await getVerifyLink(since) : null;
    if (!link) return { status: 'email_code', reason: 'Workday emailed an account verification link that did not arrive' };
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await createAccount({ ...acc, verified: true });
    return { restart: acc }; // verified: start again from the job page and sign in
  }
  return null;
}

/* ---------------- one wizard page ---------------- */

/** Every question on the current page, with what it already holds. Runs in the page. */
const readFields = (page) => page.evaluate(() => {
  const vis = (e) => e && e.getClientRects().length > 0;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const root = document.querySelector('[data-automation-id="applyFlowPage"]') || document.body;
  const out = [];
  const all = [...root.querySelectorAll('[data-automation-id^="formField-"]')];
  all.filter(vis).forEach((box) => {
    if (box.parentElement?.closest('[data-automation-id^="formField-"]')) return; // nested: the outer one covers it
    if (box.querySelector('[data-automation-id="beecatcher"]')) return; // honeypot
    const labelEl = box.querySelector('label, legend, [data-automation-id="richText"]');
    const raw = (labelEl?.innerText || box.getAttribute('aria-label') || '').trim();
    const label = clean(raw);
    const required = /\*\s*$/.test(raw) || !!box.querySelector('[aria-required="true"], [required]');
    // Address it by Workday's own field id (and its position among equals): pages re-render,
    // so attributes added here would not survive.
    const key = box.getAttribute('data-automation-id');
    const nth = all.filter((b) => b.getAttribute('data-automation-id') === key).indexOf(box);
    const sel = `[data-automation-id="${key}"] >> nth=${nth}`;
    const file = box.querySelector('input[type=file]');
    const dropdown = box.querySelector('button[aria-haspopup="listbox"]');
    const multi = box.querySelector('[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="selectinput"]');
    const radios = [...box.querySelectorAll('input[type=radio]')];
    const checks = [...box.querySelectorAll('input[type=checkbox]')];
    const area = box.querySelector('textarea');
    const date = box.querySelector('[data-automation-id*="dateSection"]');
    const input = box.querySelector('input[type=text], input[type=email], input[type=tel], input[type=number], input:not([type])');
    const optLabel = (el) => clean(document.querySelector(`label[for="${el.id}"]`)?.innerText || el.getAttribute('aria-label') || el.value);
    let f;
    if (file) f = { type: 'file', filled: !!box.querySelector('[data-automation-id="file-upload-successful"], [data-automation-id*="fileName" i]') };
    else if (dropdown) { const v = clean(dropdown.innerText); f = { type: 'dropdown', filled: !!v && !/^select one$/i.test(v), value: v }; }
    else if (multi) f = { type: 'multi', filled: !!box.querySelector('[data-automation-id="selectedItem"]') };
    else if (radios.length) f = { type: 'radio', options: radios.map(optLabel), filled: radios.some((r) => r.checked) };
    else if (checks.length > 1) f = { type: 'checks', options: checks.map(optLabel), filled: checks.some((c) => c.checked) };
    else if (checks.length === 1) f = { type: 'checkbox', options: [optLabel(checks[0]) || label], filled: checks[0].checked };
    else if (area) f = { type: 'textarea', filled: !!area.value.trim() };
    else if (date) f = { type: 'date', filled: [...box.querySelectorAll('input')].every((x) => x.value.trim()) };
    else if (input) f = { type: 'text', filled: !!input.value.trim(), value: input.value };
    else return;
    out.push({ ...f, key, label, required, sel });
  });
  return out;
});

/** Open a Workday dropdown, read its options, close it. */
async function dropdownOptions(page, f) {
  const btn = page.locator(f.sel).locator('button[aria-haspopup="listbox"]').first();
  await btn.click().catch(() => {});
  await page.locator('[role="listbox"] [role="option"]').first().waitFor({ timeout: 4000 }).catch(() => {});
  const opts = await page.$$eval('[role="listbox"] [role="option"]', (os) => os.map((o) => o.innerText.trim()).filter(Boolean)).catch(() => []);
  await page.keyboard.press('Escape').catch(() => {});
  return opts.filter((o) => !/^select one$/i.test(o));
}

/** Open a multi-select picker and read its top-level choices. */
async function multiOptions(page, f) {
  await page.locator(f.sel).locator('input').first().click().catch(() => {});
  await page.locator('[data-automation-id="promptOption"]').first().waitFor({ timeout: 4000 }).catch(() => {});
  const opts = await page.$$eval('[data-automation-id="promptOption"]', (os) => os.filter((o) => o.getClientRects().length).map((o) => o.innerText.trim()).filter(Boolean)).catch(() => []);
  await page.keyboard.press('Escape').catch(() => {});
  return [...new Set(opts)].slice(0, 100);
}

/** Write one answer. Returns true if the page took it. */
async function fill(page, f, value, files) {
  const box = page.locator(f.sel).first();
  switch (f.type) {
    case 'file': {
      await box.locator('input[type=file]').first().setInputFiles(files.cv);
      await page.locator(f.sel).locator('[data-automation-id="file-upload-successful"], [data-automation-id*="fileName" i]').first()
        .waitFor({ timeout: 30000 }).catch(() => {});
      return true;
    }
    case 'dropdown': {
      await box.locator('button[aria-haspopup="listbox"]').first().click();
      const opt = page.locator('[role="listbox"] [role="option"]').filter({ hasText: String(value) }).first();
      await opt.waitFor({ timeout: 5000 });
      await opt.click();
      await page.waitForTimeout(400);
      return true;
    }
    case 'multi': {
      const input = box.locator('input').first();
      await input.click();
      await input.fill(String(value));
      await input.press('Enter');
      await page.waitForTimeout(1200);
      const opt = page.locator('[data-automation-id="promptOption"], [role="option"]').filter({ hasText: String(value) }).first();
      if (!(await opt.count())) return false;
      await opt.click();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape').catch(() => {});
      return !!(await box.locator('[data-automation-id="selectedItem"]').count());
    }
    case 'radio': {
      const idx = f.options.findIndex((o) => o === value);
      if (idx < 0) return false;
      await box.locator('input[type=radio]').nth(idx).check({ force: true });
      return true;
    }
    case 'checkbox': {
      const cb = box.locator('input[type=checkbox]').first();
      if (value === false) await cb.uncheck({ force: true }); else await cb.check({ force: true });
      return true;
    }
    case 'checks': {
      const idx = f.options.findIndex((o) => o === value);
      if (idx < 0) return false;
      await box.locator('input[type=checkbox]').nth(idx).check({ force: true });
      return true;
    }
    case 'date': {
      // value "YYYY-MM-DD" (or "MM/YYYY"): fill whichever parts the field has.
      const [y, m, d] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-') : [value.split('/')[1], value.split('/')[0], '01'];
      for (const [part, v] of [['Month', m], ['Day', d], ['Year', y]]) {
        const el = box.locator(`[data-automation-id*="dateSection${part}"] input, input[data-automation-id*="dateSection${part}"]`).first();
        if (await el.count()) await el.fill(String(v));
      }
      return true;
    }
    case 'textarea': await box.locator('textarea').first().fill(String(value)); return true;
    default: await box.locator('input').first().fill(String(value)); return true;
  }
}

/* ---------------- the whole application ---------------- */

/**
 * @param {object} o  as applyOne, plus:
 *   account          stored { email, password } for this Workday site, or null
 *   createAccount    async (acc) => void   store a new account (encrypted by the caller)
 *   getVerifyLink    async (since) => url  read the verification link from the inbox
 */
export async function applyWorkday({ browser, job, profile, cv, cvName, cvText, dryRun = true, account = null, createAccount, getVerifyLink }) {
  const dir = join(tmpdir(), 'jobvibe-apply', safe(`${job.company}_${job.title}`));
  mkdirSync(dir, { recursive: true });
  const files = { cv: join(dir, cvName || 'Resume.docx') };
  writeFileSync(files.cv, cv);
  const context = await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const url = job.url;
  const log = [];
  const filled = [];
  let clicked = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);
      // Cookie banner: decline non-essential cookies.
      await page.locator(ID('legalNoticeDeclineButton')).first().click({ timeout: 2000 }).catch(() => {});
      const text = await bodyText(page);
      if (/(job|posting) (is )?no longer available|page (you are looking for )?(doesn't|does not) exist/i.test(text)) return { status: 'closed', reason: 'the employer has closed this job', url };
      await page.locator(ID('adventureButton')).first().click({ timeout: 20000 });
      const how = page.locator(`${ID('autofillWithResume')}, ${ID('applyManually')}`).first();
      await how.waitFor({ timeout: 15000 }).catch(() => {});
      if (await how.count()) await how.click();
      await settle(page);
      if (ALREADY.test(await bodyText(page))) return { status: 'already_applied', reason: 'Workday says you already applied to this job', url };
      const r = await enter(page, { account, profile, createAccount, getVerifyLink });
      if (r?.restart) { account = r.restart; continue; }
      if (r) return { ...r, url, log };
      break;
    }

    // The wizard: answer what's empty on each page, then Next, until Review.
    const asked = [];
    for (let step = 0; step < 14; step++) {
      await settle(page);
      if (await challengeShown(page)) return { status: 'captcha', reason: 'Workday asked for a human check', url, filled };
      const stepName = (await page.locator(ID('progressBarActiveStep')).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (ALREADY.test(await bodyText(page))) return { status: 'already_applied', reason: 'Workday says you already applied to this job', url };
      const nextBtn = page.locator(NEXT).first();
      const nextText = (await nextBtn.innerText().catch(() => '')).trim();
      const isReview = /review/i.test(stepName) || /^submit$/i.test(nextText);

      if (isReview) {
        const screenshot = await page.screenshot({ fullPage: true });
        if (dryRun) return { status: 'dry_run', url, filled, screenshot, log };
        const before = new Set((await bodyText(page)).split('\n').map((s) => s.trim()).filter(Boolean));
        await nextBtn.click();
        clicked = true;
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(1000);
          const fresh = (await bodyText(page)).split('\n').map((s) => s.trim()).filter((l) => l && !before.has(l));
          const line = fresh.find((l) => SUBMITTED.test(l) || CONFIRM.test(l));
          if (line) return { status: 'submitted', url, filled, evidence: { url: page.url(), text: line.slice(0, 300), at: new Date().toISOString() }, screenshot: await page.screenshot({ fullPage: true }) };
          if (await challengeShown(page)) return { status: 'captcha', url, filled, screenshot };
        }
        const errs = await visibleErrors(page);
        if (errs.length) return { status: 'failed', reason: `Workday said: ${errs.join(' | ').slice(0, 250)}`, url, filled, log, clicked, rejected: true };
        return { status: 'unconfirmed', reason: 'submitted, but Workday showed no confirmation', url, filled, log, clicked, screenshot: await page.screenshot({ fullPage: true }).catch(() => null) };
      }

      // Answer this page.
      const fields = await readFields(page);
      const ask = [];
      const noGo = [];
      for (const f of fields) {
        if (f.filled) continue; // Workday's resume autofill or an earlier page already set it
        if (f.type === 'file') { if (await fill(page, f, null, files)) filled.push({ label: f.label || 'Resume', value: '[file] CV', source: 'CV' }); continue; }
        if (f.type === 'dropdown') f.options = await dropdownOptions(page, f);
        if (f.type === 'multi') f.options = await multiOptions(page, f);
        const qType = ['dropdown', 'radio', 'checks', 'multi'].includes(f.type) && f.options?.length ? 'select'
          : f.type === 'checkbox' ? 'checkbox' : f.type === 'textarea' ? 'textarea' : 'text';
        const r = answerQuestion({ label: f.label, type: qType, options: f.options || [], required: f.required }, profile, { country: job.country || 'IN', company: job.company, cvText });
        if (r.answer === 'CV_FILE') continue;
        if (r.essay) {
          if (!f.required) continue;
          const d = await draftAnswer({ question: f.label, type: 'textarea', job, profile, cvText });
          if (!d.ok) { ask.push({ label: f.label, reason: `couldn't draft: ${d.error}` }); continue; }
          if (await fill(page, f, d.text, files)) filled.push({ label: f.label, value: d.text.slice(0, 200), source: 'AI draft' });
          continue;
        }
        if (r.needsHuman) { if (f.required) ask.push({ label: f.label, reason: r.reason, options: f.options || [] }); continue; }
        if (r.answer === '' || r.answer == null) continue;
        if (blocksEligibility({ label: f.label, type: f.type === 'checkbox' ? 'checkbox' : 'radio', options: f.options, required: f.required }, r)) {
          noGo.push({ label: f.label, answer: r.answer === false ? 'No' : String(r.answer) });
        }
        // Multi-select prompts take free text; map yes/no style answers onto real options where there are some.
        const value = f.options?.length && typeof r.answer !== 'boolean' ? (pickOption(r.answer, f.options) || r.answer) : r.answer;
        const ok = await fill(page, f, value, files).catch((e) => { log.push(`${f.label}: ${e.message.split('\n')[0]}`); return false; });
        if (ok) filled.push({ label: f.label, value: String(value).slice(0, 200), source: r.source });
        else if (f.required) ask.push({ label: f.label, reason: `couldn't set "${String(value).slice(0, 40)}"`, options: f.options || [] });
      }
      if (noGo.length && !job.override) return { status: 'ineligible', reasons: noGo, url };
      if (ask.length) return { status: 'needs_user', questions: [...asked, ...ask], url };

      const before = stepName;
      await nextBtn.click({ timeout: 15000 });
      await settle(page);
      const after = (await page.locator(ID('progressBarActiveStep')).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (after === before) {
        const errs = await visibleErrors(page);
        if (errs.length) return { status: 'needs_user', questions: errs.slice(0, 6).map((e) => ({ label: e.replace(/^error[-:\s]*/i, ''), reason: `Workday (${stepName || 'form'}) needs this` })), url };
        log.push(`stayed on "${stepName}" after Next`);
      }
    }
    return { status: 'failed', reason: 'Workday wizard did not reach the review page', url, filled, log };
  } catch (err) {
    if (clicked) return { status: 'unconfirmed', reason: `after submitting: ${err.message.split('\n')[0]}`, url, log, clicked };
    return { status: 'failed', reason: `Workday: ${err.message.split('\n')[0]}`, url, filled, log };
  } finally {
    await context.close();
  }
}
