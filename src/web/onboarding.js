// Onboarding — the first screen after signup: a few basic details and a CV
// upload. The CV is parsed by Gemini to autofill the rest of the profile.
import { layout, esc } from './pages.js';

export function onboardingPage({ profile = {}, resume = null, error = null, geminiOn = true, busy = false } = {}) {
  const v = (k) => esc(profile[k] ?? '');
  const body = `
<div class="hero">
  <h1>Welcome to JobVibe</h1>
  <p>A couple of details and your CV — then we tailor a daily India job shortlist to you.</p>
</div>

<div class="wrap" style="max-width:720px;margin:0 auto">
  ${error ? `<div class="saved" style="background:#fee2e2;color:#991b1b;border-color:#f0b6b8">${esc(error)}</div>` : ''}
  ${!geminiOn ? `<div class="saved" style="background:#fbf0d6;color:#8a5a00;border-color:#e2c88a">
    Resume autofill is off until an admin adds a Gemini key. You can still fill the details below.</div>` : ''}

  <form method="POST" action="/onboarding" enctype="multipart/form-data" id="onbForm">
    <div class="card" style="margin-bottom:16px">
      <h3>About you</h3>
      <div class="fld"><label>Full name</label>
        <input type="text" name="name" value="${v('name')}" required></div>
      <div class="grid g2">
        <div class="fld"><label>Years of experience</label>
          <input type="number" name="totalExpYears" value="${v('totalExpYears') || ''}" min="0" max="50"></div>
        <div class="fld"><label>Base city</label>
          <input type="text" name="baseCity" value="${v('baseCity') || 'bengaluru'}"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3>Your CV</h3>
      <p class="muted" style="margin-bottom:12px">
        Upload a <b>.docx</b> (recommended), .pdf or .txt. We read it to fill in your job titles,
        skills and a résumé summary — you confirm everything on the next screen.
        ${resume ? `<br><span style="color:#166534;font-weight:600">Current: ${esc(resume.filename || 'resume')}</span>` : ''}
      </p>
      <input type="file" name="cv" accept=".docx,.pdf,.txt" ${geminiOn ? '' : ''}>
      <p class="muted" style="margin-top:8px">
        Tip: upload <b>.docx</b> so later, per-job tailoring can edit only your skills and top
        bullet points while leaving the rest of your CV exactly as it is.
      </p>
    </div>

    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" type="submit" id="goBtn">Continue</button>
      <a class="btn btn-ghost" href="/settings">Skip for now</a>
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
