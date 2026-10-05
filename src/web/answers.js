// Application Answers — the facts application forms ask for, filled once.
// The apply agent answers only from these; anything else comes back to the
// user. The page ends with a live preview: real questions taken from live
// Greenhouse forms, answered by the same engine the agent uses.
import { layout, esc } from './pages.js';
import {
  getAnswers, answerBankStatus, answerQuestion, targetCountries,
  AUTH_STATUS, SALARY_UNIT, NOTICE_OPTIONS, EEO_DECLINE,
} from '../lib/answers.js';
import { COUNTRY_NAMES, ALL_CC } from '../lib/geo.js';

// Real questions seen on live application forms (Greenhouse, Oct 2026).
export const SAMPLE_QUESTIONS = [
  { label: 'Are you legally authorized to work in the country in which this job is located?', type: 'select', options: ['Yes', 'No'] },
  { label: 'Will you now or in the future require visa sponsorship?', type: 'select', options: ['Yes', 'No'] },
  { label: 'What is your notice period?', type: 'text' },
  { label: 'Notice Period (In Days)', type: 'select', options: ['Immediate', '15 days', '1 month', '2 months', '3 months or more'] },
  { label: 'Current CTC (In Lakhs - INR)', type: 'text' },
  { label: 'Expected CTC (In Lakhs - INR)', type: 'text' },
  { label: 'Total Professional Experience', type: 'select', options: ['0-2 Years', '2-4 Years', '4+ Years'] },
  { label: 'What is your current location?', type: 'text' },
  { label: 'Willingness to relocate', type: 'select', options: ['Yes', 'No'] },
  { label: 'Have you previously worked for this organization?', type: 'select', options: ['Yes', 'No'] },
  { label: 'How did you hear about this job?', type: 'select', options: ['LinkedIn', 'Company careers page', 'Referral', 'Other'] },
  { label: 'Gender', type: 'select', options: ['Male', 'Female', 'Non-binary', 'Decline to self-identify'] },
  { label: 'I acknowledge and agree to the processing of my personal data in accordance with the privacy notice', type: 'select', options: ['I acknowledge'] },
  { label: 'Are you currently subject to any non-compete or non-solicitation agreement?', type: 'select', options: ['Yes', 'No'] },
];

const DEGREES = ['10th / SSLC', '12th / Higher Secondary', 'Diploma', "Bachelor's Degree", "Master's Degree", 'MBA / PGDM', 'PhD'];
const NATIONALITIES = ['Indian', 'Emirati', 'German', 'Irish', 'Dutch', 'Australian', 'American', 'British'];

const sel = (name, value, options, { blank = '— choose —' } = {}) =>
  `<select name="${name}">${blank !== null ? `<option value="">${blank}</option>` : ''}${options.map(([v, l]) =>
    `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const inp = (name, value, extra = '') => `<input type="text" name="${name}" value="${esc(value ?? '')}" ${extra}>`;
const fld = (label, control, help = '') =>
  `<div class="fld"><label>${esc(label)}</label>${control}${help ? `<span class="help">${esc(help)}</span>` : ''}</div>`;

/** Connect a dedicated job-hunt Gmail (app password) so the agent can read employer replies. */
function mailboxCard(mb, msg) {
  const status = !mb?.email ? ''
    : mb.status === 'ok' ? `<span class="pill" style="background:#dcfce7;color:#166534">connected</span>${mb.lastCheck ? ` <span class="muted" style="font-size:.78rem">checked ${esc(new Date(mb.lastCheck).toLocaleString('en-IN'))}</span>` : ''}`
      : mb.status === 'error' ? `<span class="pill" style="background:#fee2e2;color:#991b1b">${esc(mb.error || 'error')}</span>`
        : '<span class="pill">saved: checked within 10 minutes once the worker is running</span>';
  return `
  <div class="card" style="margin-bottom:16px;border-left:4px solid #0a66c2">
    <h3>Job-hunt inbox ${status}</h3>
    ${msg ? `<div class="saved" style="margin:6px 0 10px">${esc(msg)}</div>` : ''}
    ${mb?.email ? `
      <p style="font-size:.88rem">Watching <b>${esc(mb.email)}</b> for replies from employers. Interview invites, assessments,
        document requests and offers come to you on Telegram with a drafted reply; nothing is sent until you tap Send.</p>
      <form method="POST" action="/answers/mailbox/disconnect" style="margin-top:10px"><button class="btn btn-ghost" type="submit">Disconnect inbox</button></form>`
    : `
      <p class="muted" style="margin-bottom:10px">Use a <b>separate Gmail just for job hunting</b> and put it as your application email above.
        Then the agent can spot interview invites and requests and draft replies for you.</p>
      <ol style="font-size:.85rem;color:#475467;margin:0 0 12px 18px;line-height:1.7">
        <li>Sign in to that Gmail and turn on <b>2-Step Verification</b> at <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">myaccount.google.com/security</a>.</li>
        <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, name it <b>JobVibe</b>, and copy the 16-letter code.</li>
        <li>Paste the Gmail address and that code below. (Not your normal Gmail password.)</li>
      </ol>
      <form method="POST" action="/answers/mailbox" class="grid g2" autocomplete="off">
        <div class="fld"><label>Job-hunt Gmail address</label><input type="text" name="mb_email" placeholder="you.jobhunt@gmail.com" autocomplete="off"></div>
        <div class="fld"><label>Gmail app password (16 letters)</label><input type="text" class="secret" name="mb_pass" autocomplete="off" data-lpignore="true" data-1p-ignore></div>
        <div><button class="btn" type="submit">Connect inbox</button></div>
      </form>`}
  </div>`;
}

export function answersPage(profile, { saved = false, mailboxMsg = null } = {}) {
  const a = getAnswers(profile);
  const st = answerBankStatus(profile);
  const targets = new Set(targetCountries(profile));
  const yn = [['yes', 'Yes'], ['no', 'No']];

  const countryRows = ALL_CC.map((cc) => {
    const w = a.workAuth[cc];
    return `<tr class="${targets.has(cc) ? 'tgt' : ''}">
      <td><b>${esc(COUNTRY_NAMES[cc])}</b>${targets.has(cc) ? ' <span class="pill">you search here</span>' : ''}</td>
      <td>${sel(`wa_${cc}_status`, w.status, Object.entries(AUTH_STATUS))}</td>
      <td><input type="text" name="wa_${cc}_salary" value="${esc(w.salary)}" placeholder="${cc === 'IN' ? 'e.g. 8' : 'e.g. 60000'}" style="width:110px">
        <span class="unit">${esc(SALARY_UNIT[cc])}</span></td></tr>`;
  }).join('');

  const preview = SAMPLE_QUESTIONS.map((q) => {
    const r = answerQuestion(q, profile, { country: [...targets][0] || 'IN', company: 'Example Corp', cvText: '' });
    const out = r.essay ? '<span class="essay">AI drafts it for your approval</span>'
      : r.needsHuman ? `<span class="ask">Asks you: ${esc(r.reason)}</span>`
        : `<b>${esc(String(r.answer))}</b>${r.source ? ` <span class="src">(${esc(r.source)})</span>` : ''}`;
    return `<tr><td>${esc(q.label)}</td><td>${out}</td></tr>`;
  }).join('');

  const customRows = [...a.custom, { q: '', a: '' }, { q: '', a: '' }].map((c) =>
    `<div class="qa"><input type="text" name="custom_q" value="${esc(c.q)}" placeholder="Question, e.g. Years of SQL experience?">
      <input type="text" name="custom_a" value="${esc(c.a)}" placeholder="Your answer, e.g. 3"></div>`).join('');

  const body = `
<div class="hero">
  <h1>Application Answers</h1>
  <p>The questions every application form asks. Fill them once; the agent answers from these and asks you about anything else.</p>
  <div class="hero-chips"><span class="hero-chip">${st.pct}% complete</span>
    <span class="hero-chip">${st.ready ? 'Ready for auto-apply' : 'Needed before auto-apply'}</span></div>
</div>
<div class="wrap" style="max-width:980px;margin:0 auto">
  ${saved ? '<div class="saved">Saved.</div>' : ''}
  ${st.missing.length ? `<div class="card" style="margin-bottom:16px;border-left:4px solid #f59e0b;background:#fffbeb">
    <h3 style="color:#92400e">Still needed</h3><p style="font-size:.88rem;color:#78350f">${esc(st.missing.join(' · '))}</p></div>` : ''}
  ${mailboxCard(profile.mailbox, mailboxMsg)}
  <form method="POST" action="/answers">
    <div class="grid g2">
      <div class="card"><h3>Contact &amp; links</h3>
        ${fld('Phone (with country code)', inp('a_phone', a.phone, 'placeholder="+91 98xxx xxxxx"'))}
        ${fld('Email for applications', inp('a_email', a.email), 'Ideally a dedicated job-hunt Gmail; the inbox agent will read it.')}
        ${fld('LinkedIn URL', inp('a_linkedin', a.linkedin, 'placeholder="https://linkedin.com/in/…"'))}
        ${fld('Portfolio / GitHub / website (optional)', inp('a_portfolio', a.portfolio))}
      </div>
      <div class="card"><h3>Current job</h3>
        ${fld('Current or last employer', inp('a_currentEmployer', a.currentEmployer))}
        ${fld('Current or last job title', inp('a_currentTitle', a.currentTitle))}
        ${fld('Current CTC (India, in LPA)', inp('a_currentCtcLpa', a.currentCtcLpa, 'placeholder="e.g. 5.5"'), 'Only given to Indian employers. Forms abroad asking for current pay are sent to you.')}
        ${fld('Notice period', sel('a_noticePeriodDays', a.noticePeriodDays, NOTICE_OPTIONS.map((d) => [d, d === 0 ? 'Immediate / not working' : `${d} days`])))}
        <label class="chk"><input type="checkbox" name="a_servingNotice"${a.servingNotice ? ' checked' : ''}> I'm already serving my notice</label>
        ${fld('Last working day (if known)', `<input type="date" name="a_lastWorkingDay" value="${esc(a.lastWorkingDay)}">`)}
      </div>
    </div>

    <div class="card" style="margin-top:16px"><h3>Where you can work</h3>
      <p class="muted" style="margin-bottom:10px">Your status in each country decides the visa and sponsorship answers. Answer truthfully:
        a wrong "authorized to work" answer gets an offer withdrawn. Expected salary is what the agent states for jobs in that country.</p>
      ${fld('Nationality', inp('a_nationality', a.nationality, 'list="nat"') + `<datalist id="nat">${NATIONALITIES.map((n) => `<option value="${n}">`).join('')}</datalist>`)}
      <table class="wa"><tr><th>Country</th><th>Your work status</th><th>Expected salary</th></tr>${countryRows}</table>
    </div>

    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Other common questions</h3>
        ${fld('Willing to relocate?', sel('a_relocate', a.relocate, yn))}
        ${fld('Highest degree', inp('a_degree', a.degree, 'list="deg"') + `<datalist id="deg">${DEGREES.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>`)}
        ${fld('University / school (of highest degree)', inp('a_school', a.school, 'placeholder="e.g. Bangalore University"'))}
        ${fld('Field of study', inp('a_fieldOfStudy', a.fieldOfStudy, 'placeholder="e.g. Commerce, Mechanical Engineering"'))}
        ${fld('Graduation year', inp('a_graduationYear', a.graduationYear, 'placeholder="e.g. 2020"'))}
        ${fld('Driving licence?', sel('a_drivingLicense', a.drivingLicense, yn), 'Often asked in UAE and Australia.')}
        ${fld('Languages you speak', inp('a_languages', a.languages, 'placeholder="English, Hindi, Tamil"'))}
      </div>
      <div class="card"><h3>Voluntary self-identification</h3>
        <p class="muted" style="margin-bottom:10px">US/UK forms ask these; answering is optional and never affects eligibility.
          Left as "${EEO_DECLINE}", the agent picks the decline option.</p>
        ${fld('Gender', sel('eeo_gender', a.eeo.gender, [[EEO_DECLINE, EEO_DECLINE], ['Male', 'Male'], ['Female', 'Female'], ['Non-binary', 'Non-binary']], { blank: null }))}
        ${fld('Race / ethnicity', inp('eeo_ethnicity', a.eeo.ethnicity))}
        ${fld('Veteran status', sel('eeo_veteran', a.eeo.veteran, [[EEO_DECLINE, EEO_DECLINE], ['I am not a protected veteran', 'Not a veteran'], ['I am a veteran', 'Veteran']], { blank: null }))}
        ${fld('Disability', sel('eeo_disability', a.eeo.disability, [[EEO_DECLINE, EEO_DECLINE], ['No', 'No'], ['Yes', 'Yes']], { blank: null }))}
      </div>
    </div>

    <div class="card" style="margin-top:16px"><h3>Permission</h3>
      <label class="chk" style="font-weight:600"><input type="checkbox" name="a_consentStandard"${a.consentStandard ? ' checked' : ''}>
        Let the agent tick standard boxes for me: privacy notice, data processing for this application, "the information I gave is accurate".</label>
      <span class="help">It never opts you into marketing or talent pools, and never answers legal questions (non-compete, conflicts of interest, export rules): those always come to you.</span>
    </div>

    <div class="card" style="margin-top:16px"><h3>Saved answers</h3>
      <p class="muted" style="margin-bottom:10px">Questions you've answered before. When a form asks something new, it lands here so it's answered automatically next time.</p>
      ${customRows}
    </div>

    <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
      <button class="btn" type="submit">Save answers</button><span class="muted">The preview below updates after saving.</span>
    </div>
  </form>

  <div class="card" style="margin-top:20px"><h3>How the agent would answer real application questions</h3>
    <table class="prev">${preview}</table>
  </div>
</div>
<style>
  .wa { width:100%; border-collapse:collapse; margin-top:6px; }
  .wa th { text-align:left; font-size:.72rem; color:#8a94a6; text-transform:uppercase; padding:6px 8px; border-bottom:1px solid #eef0f4; }
  .wa td { padding:7px 8px; border-bottom:1px solid #f3f4f6; font-size:.86rem; }
  .wa tr.tgt td { background:#f6faff; }
  .wa select, .fld select { padding:7px 9px; border:1.5px solid #d0d5dd; border-radius:7px; font-size:.84rem; background:#fff; max-width:100%; }
  .pill { font-size:.66rem; background:#dbeafe; color:#1e40af; padding:1px 7px; border-radius:8px; font-weight:700; }
  .unit { font-size:.75rem; color:#8a94a6; }
  .qa { display:grid; grid-template-columns:1.4fr 1fr; gap:8px; margin-bottom:8px; }
  .prev { width:100%; border-collapse:collapse; }
  .prev td { padding:8px; border-bottom:1px solid #f0f2f5; font-size:.84rem; vertical-align:top; }
  .prev td:first-child { color:#475467; width:58%; }
  .src { color:#8a94a6; font-size:.76rem; } .ask { color:#b45309; } .essay { color:#6d28d9; }
  @media (max-width:640px){ .qa{grid-template-columns:1fr} .wa,.wa tbody{display:block;width:100%}
    .wa td{display:block;border:0;padding:4px 8px} .wa tr{display:block;border-bottom:1px solid #eef0f4;padding:6px 0}
    .wa th{display:none} .wa select{width:100%} .wa input{width:45%!important}
    .prev td{display:block;width:auto!important;padding:4px 8px} .prev tr{display:block;border-bottom:1px solid #f0f2f5;padding:6px 0} }
</style>`;

  return layout({ title: 'Application Answers — JobVibe', active: 'answers', body });
}

/** Turn the submitted form into an answers object. */
export function answersFromForm(form, prev = {}) {
  const s = (k) => String(form[k] ?? '').trim();
  const arr = (k) => (Array.isArray(form[k]) ? form[k] : form[k] != null ? [form[k]] : []).map((x) => String(x).trim());
  const workAuth = {};
  for (const cc of ALL_CC) {
    workAuth[cc] = { status: AUTH_STATUS[s(`wa_${cc}_status`)] ? s(`wa_${cc}_status`) : '', salary: s(`wa_${cc}_salary`) };
  }
  const qs = arr('custom_q'), as = arr('custom_a');
  const now = new Date().toISOString();
  const oldCustom = new Map((prev.custom || []).map((c) => [c.q, c]));
  const custom = qs.map((q, i) => ({ q, a: as[i] || '' })).filter((c) => c.q && c.a)
    .map((c) => ({ ...c, updatedAt: oldCustom.get(c.q)?.a === c.a ? oldCustom.get(c.q).updatedAt : now }));
  const notice = s('a_noticePeriodDays');
  return {
    phone: s('a_phone'), email: s('a_email'), linkedin: s('a_linkedin'), portfolio: s('a_portfolio'),
    currentEmployer: s('a_currentEmployer'), currentTitle: s('a_currentTitle'), currentCtcLpa: s('a_currentCtcLpa'),
    noticePeriodDays: notice === '' ? '' : Number(notice), servingNotice: form.a_servingNotice != null,
    lastWorkingDay: s('a_lastWorkingDay'), nationality: s('a_nationality'),
    relocate: ['yes', 'no'].includes(s('a_relocate')) ? s('a_relocate') : '',
    degree: s('a_degree'), school: s('a_school'), fieldOfStudy: s('a_fieldOfStudy'), graduationYear: s('a_graduationYear'),
    drivingLicense: ['yes', 'no'].includes(s('a_drivingLicense')) ? s('a_drivingLicense') : '',
    languages: s('a_languages'),
    eeo: { gender: s('eeo_gender') || EEO_DECLINE, ethnicity: s('eeo_ethnicity') || EEO_DECLINE,
      veteran: s('eeo_veteran') || EEO_DECLINE, disability: s('eeo_disability') || EEO_DECLINE },
    consentStandard: form.a_consentStandard != null,
    workAuth,
    custom,
  };
}
