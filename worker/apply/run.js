// Apply to one job: read the form, answer it, fill it, then submit (or stop,
// in dry-run). Outcomes:
//   needs_user  a required question only the user can answer: nothing filled
//   dry_run     filled and checked, not submitted (testing)
//   submitted   the site confirmed the application
//   captcha     the site asked for a human check: handed back to the user
//   failed      the form rejected something, or the page broke
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractFields, fillField, atsOf, formUrl, comboOptions } from './forms.js';
import { answerQuestion } from '../../src/lib/answers.js';
import { draftAnswer } from '../../src/lib/essay.js';

const CONFIRM = /thank(s| you) for (applying|your (application|interest))|application (has been |was )?(received|submitted|sent)|we('ve| have) received your application|successfully (applied|submitted)|you('ve| have) applied/i;
const CHALLENGE = 'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[title*="challenge" i]';

const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

async function openForm(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  let fields = await extractFields(page);
  // Some boards show the description first and the form behind an "Apply" button.
  if (!fields.some((f) => f.type === 'file' || /email/i.test(f.label))) {
    const btn = page.locator('a, button').filter({ hasText: /^\s*apply( (now|for this job))?\s*$/i }).first();
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
export async function applyOne({ browser, job, profile, cv, cvName, cvText, dryRun = true }) {
  const ats = atsOf(job.url);
  const url = formUrl(job.url, ats);
  const dir = join(tmpdir(), 'jobvibe-apply', safe(`${job.company}_${job.title}`));
  mkdirSync(dir, { recursive: true });
  const cvPath = join(dir, cvName || 'Resume.docx');
  writeFileSync(cvPath, cv);

  const context = await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const log = [];
  try {
    const fields = await openForm(page, url);
    if (!fields.length) return { status: 'failed', reason: 'no application form found on the page', url };

    // 1. Decide every answer before touching the page.
    const plan = [];
    const ask = [];
    for (const f of fields) {
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
          const p = join(dir, 'Cover_Letter.txt'); writeFileSync(p, d.text);
          plan.push({ f, value: p, source: 'AI cover letter', text: d.text });
        } else plan.push({ f, value: d.text, source: 'AI draft' });
        continue;
      }
      if (r.needsHuman) { if (f.required) ask.push({ label: f.label, reason: r.reason, options: f.options || [] }); continue; }
      if (r.answer === '' || r.answer == null) continue;
      plan.push({ f, value: r.answer, source: r.source });
    }
    if (ask.length) return { status: 'needs_user', questions: ask, url };

    // 2. Fill.
    for (const step of plan) {
      const okFill = await fillField(page, step.f, step.value).catch((e) => { log.push(`${step.f.label}: ${e.message.split('\n')[0]}`); return false; });
      if (!okFill && step.f.required) return { status: 'failed', reason: `could not fill "${step.f.label}"`, url, log };
    }
    await page.waitForTimeout(800);

    // 3. Every required field must now hold a value.
    // Required is marked either way: the `required` attribute, or aria-required (Greenhouse).
    const empty = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.required || el.getAttribute('aria-required') === 'true')
      .filter((el) => el.offsetParent !== null && el.type !== 'file' && el.type !== 'hidden')
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

    // 4. Submit and read the outcome.
    const submit = page.locator('button, input[type=submit]').filter({ hasText: /submit|send application|apply/i }).last();
    const submitInput = page.locator('input[type=submit]').last();
    await ((await submit.count()) ? submit : submitInput).click({ timeout: 15000 });
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(1000);
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (CONFIRM.test(text) || /confirmation|thank|success/i.test(page.url())) {
        return { status: 'submitted', url, filled, screenshot: await page.screenshot({ fullPage: true }) };
      }
      if (await page.locator(CHALLENGE).first().isVisible().catch(() => false)) {
        return { status: 'captcha', url, filled, screenshot };
      }
    }
    const errors = await page.evaluate(() => [...document.querySelectorAll('[class*="error" i], [role="alert"], .invalid-feedback')]
      .map((e) => e.innerText.trim()).filter(Boolean).slice(0, 5));
    return { status: 'failed', reason: errors.length ? `form said: ${errors.join(' | ')}` : 'no confirmation after submitting', url, filled, log };
  } catch (err) {
    return { status: 'failed', reason: err.message.split('\n')[0], url, log };
  } finally {
    await context.close();
  }
}
