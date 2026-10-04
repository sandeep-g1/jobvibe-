// Onboarding, two steps:
//   1. /onboarding         basic details + CV (required). Gemini autofills the rest.
//   2. /onboarding/review  confirm what matching depends on: job titles (at least
//                          one), locations, years, work modes, skills.
// Until both are done the dashboard shows a "finish your profile" card and the
// daily matcher skips the user — an incomplete profile only produces junk.
import { layout, esc } from './pages.js';
import { renderField, TAGS_SCRIPT } from './settings.js';
import { FIELDS } from '../lib/profile.js';

const steps = (n) => `
<div style="display:flex;gap:8px;margin-bottom:16px;font-size:.8rem;font-weight:600">
  <span style="padding:4px 12px;border-radius:14px;${n === 1 ? 'background:#0a66c2;color:#fff' : 'background:#dcfce7;color:#166534'}">${n === 1 ? '1' : '✓'} Your CV</span>
  <span style="padding:4px 12px;border-radius:14px;${n === 2 ? 'background:#0a66c2;color:#fff' : 'background:#eef1f5;color:#8a94a6'}">2 Confirm your search</span>
</div>`;

const errBox = (e) => e
  ? `<div class="saved" style="background:#fee2e2;color:#991b1b;border-color:#f0b6b8">${esc(e)}</div>` : '';

export function onboardingPage({ profile = {}, resume = null, error = null, geminiOn = true } = {}) {
  const v = (k) => esc(profile[k] ?? '');
  const body = `
<div class="hero">
  <h1>Welcome to JobVibe</h1>
  <p>Two quick steps. Your CV is what we match jobs against and what we tailor for each application.</p>
</div>

<div class="wrap" style="max-width:720px;margin:0 auto">
  ${steps(1)}
  ${errBox(error)}
  ${!geminiOn ? `<div class="saved" style="background:#fbf0d6;color:#8a5a00;border-color:#e2c88a">
    Automatic CV reading is off until an admin adds a Gemini key. You'll fill the next step by hand.</div>` : ''}

  <form method="POST" action="/onboarding" enctype="multipart/form-data" id="onbForm">
    <div class="card" style="margin-bottom:16px">
      <h3>About you</h3>
      <div class="fld"><label>Full name</label>
        <input type="text" name="name" value="${v('name')}" required></div>
      <div class="grid g2">
        <div class="fld"><label>Years of experience</label>
          <input type="number" name="totalExpYears" value="${profile.totalExpYears ?? ''}" min="0" max="50" required
                 placeholder="0 if you're a fresher"></div>
        <div class="fld"><label>City you live in</label>
          <input type="text" name="baseCity" value="${v('baseCity')}" placeholder="e.g. Bengaluru" required></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3>Your CV</h3>
      <p class="muted" style="margin-bottom:12px">
        Upload a <b>.docx</b> (best: it can then be tailored to each job), or a .pdf. We read it to suggest
        your job titles and skills; you confirm everything on the next step.
        ${resume ? `<br><span style="color:#166534;font-weight:600">On file: ${esc(resume.filename || 'resume')}</span> (upload again only to replace it)` : ''}
      </p>
      <input type="file" name="cv" accept=".docx,.pdf,.txt" ${resume ? '' : 'required'}>
    </div>

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" type="submit" id="goBtn">Continue</button>
      <span id="onbMsg" class="muted"></span>
    </div>
  </form>
</div>

<script>
document.getElementById('onbForm').addEventListener('submit', function () {
  var b = document.getElementById('goBtn'), m = document.getElementById('onbMsg');
  b.disabled = true; b.textContent = 'Reading your CV…';
  m.textContent = 'This takes a few seconds.';
});
</script>`;

  return layout({ title: 'Welcome — JobVibe', active: '', body, navExtra: '' });
}

export function reviewPage({ profile = {}, error = null, note = null } = {}) {
  const field = (k) => {
    const f = FIELDS.find((x) => x.key === k);
    return f ? renderField(f, profile) : '';
  };
  const body = `
<div class="hero">
  <h1>Confirm your search</h1>
  <p>${note ? esc(note) : 'Check what we picked up from your CV. Job titles and locations decide which jobs you see.'}</p>
</div>

<div class="wrap" style="max-width:820px;margin:0 auto">
  ${steps(2)}
  ${errBox(error)}
  <form method="POST" action="/onboarding/review">
    <div class="card" style="margin-bottom:16px">
      <h3>What you're looking for</h3>
      ${field('jobTitles')}
      ${field('preferredLocations')}
      ${field('workModes')}
      ${field('totalExpYears')}
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Your skills</h3>
      ${field('skillBank')}
      ${field('stretchSkills')}
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" type="submit">Save and go to my dashboard</button>
      <a class="btn btn-ghost" href="/onboarding">Back</a>
    </div>
  </form>
</div>
${TAGS_SCRIPT}`;

  return layout({ title: 'Confirm your search — JobVibe', active: '', body, navExtra: '' });
}
