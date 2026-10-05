// Read and fill application forms in a Playwright page.
//
// extractFields(): every question on the form as { id, label, type, options,
// required } — label text comes from the place each ATS actually puts it.
// fillField(): writes one answer the way that control needs it.
//
// Nothing here submits; the caller decides that.

export const ATS = {
  greenhouse: /(^|\.)greenhouse\.io$/,
  lever: /(^|\.)lever\.co$/,
  ashby: /(^|\.)ashbyhq\.com$/,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/,
  workday: /(^|\.)myworkdayjobs\.com$/,
  recruitee: /(^|\.)recruitee\.com$/,
  workable: /(^|\.)workable\.com$/,
};

export function atsOf(url) {
  try {
    const host = new URL(url).hostname;
    return Object.entries(ATS).find(([, re]) => re.test(host))?.[0] || null;
  } catch { return null; }
}

/** The URL of the application form itself for a job URL. */
export function formUrl(url, ats) {
  const u = new URL(url);
  // Greenhouse: use the embeddable application form. Employers wrap the normal
  // job page in their own careers sites (Stripe, Okta…); the embed is always the
  // plain Greenhouse form.
  if (ats === 'greenhouse') {
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m && !u.pathname.startsWith('/embed')) return `https://job-boards.greenhouse.io/embed/job_app?for=${m[1]}&token=${m[2]}`;
  }
  // Recruitee: the offer page links to its application form at /o/<offer>/c/new.
  if (ats === 'recruitee') { const m = u.pathname.match(/^\/o\/[^/]+/); if (m) return `${u.origin}${m[0]}/c/new`; }
  if (ats === 'lever') return u.pathname.endsWith('/apply') ? u.href : `${u.origin}${u.pathname.replace(/\/+$/, '')}/apply`;
  if (ats === 'ashby') return u.pathname.endsWith('/application') ? u.href : `${u.origin}${u.pathname.replace(/\/+$/, '')}/application`;
  return u.href;
}

/**
 * Catalogue the form. Runs inside the page; returns plain data plus a CSS
 * selector per question so it can be filled afterwards.
 */
export async function extractFields(page) {
  return page.evaluate(() => {
    const txt = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim();
    const sel = (el) => (el.id ? `#${CSS.escape(el.id)}` : el.name ? `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]` : null);

    // Where the question text lives, per ATS. Order matters: most specific first.
    // Button-ish label text on file inputs ("Attach", "Upload") is not the question.
    const GENERIC = /^(attach|upload|choose( a)? file|browse|select file|drop files?.*|or|enter manually)$/i;
    const questionText = (el) => {
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && txt(l) && !['radio', 'checkbox'].includes(el.type) && !GENERIC.test(txt(l))) return txt(l);
      }
      // File uploads: the section heading (Greenhouse: <div class="file-upload"><div class="label">Resume/CV</div>…).
      if (el.type === 'file') {
        const box = el.closest('[class*="file-upload"], [class*="upload"], .field, fieldset, [role="group"]');
        const head = box && [...box.querySelectorAll('label, legend, [class*="label"], [id$="-label"]')].map(txt).find((t) => t && !GENERIC.test(t));
        if (head) return head;
      }
      const lever = el.closest('.application-question, li.application-question');
      if (lever) { const t = lever.querySelector('.application-label, .text'); if (t && txt(t)) return txt(t); }
      // Nearest enclosing fieldset that actually has a legend (forms nest fieldsets).
      for (let fs = el.closest('fieldset'); fs; fs = fs.parentElement?.closest('fieldset')) {
        const lg = fs.querySelector(':scope > legend');
        if (lg && txt(lg)) return txt(lg);
      }
      const ashby = el.closest('[class*="fieldEntry"], [class*="_field"], .field');
      if (ashby) { const l = ashby.querySelector('label, [class*="label"]'); if (l && txt(l)) return txt(l); }
      // aria-labelledby on the input or its group.
      const lb = el.getAttribute('aria-labelledby') || el.closest('[aria-labelledby]')?.getAttribute('aria-labelledby');
      if (lb) { const t = lb.split(/\s+/).map((i) => txt(document.getElementById(i))).filter(Boolean).join(' '); if (t) return t; }
      // Some company-hosted forms put the question in the element the input is "described by".
      const db = el.getAttribute('aria-describedby');
      if (db) { const t = db.split(/\s+/).map((i) => txt(document.getElementById(i))).filter(Boolean).join(' '); if (t) return t; }
      // Walk up a few levels to the first label-like element that isn't this option's own label.
      const own = el.id ? txt(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) : txt(el.closest('label'));
      let node = el.parentElement;
      for (let i = 0; node && i < 5; i++, node = node.parentElement) {
        const cand = [...node.querySelectorAll('label, legend, [class*="label"], [class*="question"]')]
          .map(txt).find((t) => t && t !== own && t.length > 3);
        if (cand) return cand;
      }
      return el.getAttribute('aria-label') || el.placeholder || el.name || '';
    };

    const fields = [];
    const groups = new Map(); // radio/checkbox groups by name
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text');
      if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue;
      const visible = el.offsetParent !== null || type === 'file';
      if (!visible) continue;
      const required = el.required || el.getAttribute('aria-required') === 'true' ||
        /[*✱]\s*$/.test((el.closest('label, .application-question, fieldset, [class*="field"]')?.innerText || '').split('\n')[0]);

      if (type === 'radio' || type === 'checkbox') {
        // The ATS's own UI toggles (Greenhouse "Upload PDF / Paste") are not questions.
        if (/_format$/.test(el.name || '')) continue;
        const key = el.name || el.id;
        // A checkbox's own statement (aria-labelledby) beats a generic section heading ("Legal Agreements").
        const ownIds = el.getAttribute('aria-labelledby');
        const own = ownIds ? ownIds.split(/\s+/).map((i) => txt(document.getElementById(i))).filter(Boolean).join(' ') : '';
        const optLabel = (el.id && txt(document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) || txt(el.closest('label')) || (type === 'checkbox' && own) || el.value;
        if (!groups.has(key)) {
          const label = type === 'checkbox' && own.length > 15 ? own : questionText(el);
          const g = { id: key, selector: `input[name="${CSS.escape(el.name)}"]`, label, type, options: [], values: [], required };
          groups.set(key, g); fields.push(g);
        }
        const g = groups.get(key);
        g.options.push(optLabel); g.values.push(el.value);
        g.required = g.required || required;
        continue;
      }
      // Searchable dropdowns (react-select & co.) look like text inputs but only accept their options.
      const combo = type !== 'select' && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list' || /select__input/.test(el.className));
      const f = { id: el.name || el.id, selector: sel(el), label: questionText(el), type: combo ? 'combobox' : type, required };
      if (type === 'select') f.options = [...el.options].map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
      if (type === 'file') f.accept = el.accept || '';
      if (f.selector) fields.push(f);
    }
    // A single-checkbox "group" is a consent/acknowledge box: its own label is the question.
    for (const g of fields) if (g.type === 'checkbox' && g.options.length === 1 && !g.label) g.label = g.options[0];
    return fields;
  });
}

const optionTexts = (page) => page.$$eval('[role="option"]', (os) => os
  .filter((o) => o.offsetParent !== null).map((o) => (o.innerText || o.textContent || '').trim()).filter(Boolean));

/** Open a searchable dropdown and read its options (closed again afterwards). */
export async function comboOptions(page, f) {
  const el = page.locator(f.selector).first();
  try {
    await el.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const opts = await optionTexts(page);
    await el.press('Escape').catch(() => {});
    return opts.slice(0, 300);
  } catch { return []; }
}

/** Fill one field with an answer from the answer engine. Returns true if it took. */
export async function fillField(page, f, answer) {
  const el = page.locator(f.selector).first();
  if (f.type === 'combobox') {
    // Type to filter, then click the option whose text is the answer.
    await el.click({ timeout: 5000 });
    await el.fill('');
    await el.pressSequentially(String(answer).slice(0, 40), { delay: 15 });
    await page.waitForTimeout(700);
    const want = String(answer).trim().toLowerCase();
    const opts = page.locator('[role="option"]');
    const n = await opts.count();
    for (let i = 0; i < n; i++) {
      const t = ((await opts.nth(i).innerText().catch(() => '')) || '').trim().toLowerCase();
      if (t === want) { await opts.nth(i).click(); return true; }
    }
    if (n > 0) {
      // Filtered down to options containing what we typed: take the first.
      const t = ((await opts.first().innerText().catch(() => '')) || '').trim().toLowerCase();
      if (t.includes(want) || want.includes(t)) { await opts.first().click(); return true; }
    }
    // Typeahead places ("Pune, India" vs "Pune, Maharashtra, India"): search the first part only.
    const head = want.split(',')[0].trim();
    if (head && head !== want) {
      await el.fill('');
      await el.pressSequentially(head, { delay: 15 });
      await page.waitForTimeout(1500);
      const m = await opts.count();
      for (let i = 0; i < m; i++) {
        const t = ((await opts.nth(i).innerText().catch(() => '')) || '').trim().toLowerCase();
        if (t.startsWith(head)) { await opts.nth(i).click(); return true; }
      }
    }
    // Directories (schools, employers) that don't list it: their own "Other" entry.
    if (f.allowOther) {
      await el.fill('');
      await el.pressSequentially('Other', { delay: 15 });
      await page.waitForTimeout(1000);
      const m = await opts.count();
      for (let i = 0; i < m; i++) {
        const t = ((await opts.nth(i).innerText().catch(() => '')) || '').trim().toLowerCase();
        if (t === 'other' || t.startsWith('other ')) { await opts.nth(i).click(); return true; }
      }
    }
    await el.press('Escape').catch(() => {});
    return false;
  }
  if (f.type === 'file') { await el.setInputFiles(answer); return true; }
  if (f.type === 'select') {
    await el.selectOption({ label: String(answer) }).catch(async () => el.selectOption(String(answer)));
    return true;
  }
  if (f.type === 'radio' || f.type === 'checkbox') {
    const want = f.type === 'checkbox' && f.options.length === 1 ? f.options[0] : String(answer);
    const idx = f.options.findIndex((o) => o.trim().toLowerCase() === want.trim().toLowerCase());
    if (idx < 0) return false;
    const input = page.locator(`${f.selector}[value="${f.values[idx].replace(/"/g, '\\"')}"]`).first();
    if (f.type === 'checkbox' && answer === false) { await input.uncheck({ force: true }); return true; }
    await input.check({ force: true });
    return true;
  }
  await el.fill(String(answer));
  return true;
}
