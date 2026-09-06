// Search Settings — edit every field of the profile in the browser, and start a
// search on demand. Writes to the profiles table, so a change takes effect on
// the next run with no redeploy and no file editing.
import { layout, esc } from './pages.js';

const MODES = ['On-site', 'Hybrid', 'Remote'];

// [id, label, keyless]
const SOURCES = [
  ['greenhouse', 'Greenhouse', true],
  ['lever', 'Lever', true],
  ['ashby', 'Ashby', true],
  ['smartrecruiters', 'SmartRecruiters', true],
  ['jsearch', 'Google for Jobs — Naukri, LinkedIn, Indeed, Foundit', false],
  ['adzuna', 'Adzuna', false],
  ['careerjet', 'Careerjet', false],
  ['jooble', 'Jooble', false],
];

export const FORM_CSS = `
  form .fld { margin-bottom:15px; }
  form label { display:block; font-size:.8rem; font-weight:600; color:#475467; margin-bottom:5px; }
  form input[type=text], form input[type=number], form textarea {
    width:100%; padding:8px 11px; border:1.5px solid #d0d5dd; border-radius:7px;
    font-size:.86rem; font-family:inherit; background:#fff; color:#1a1a2e; }
  form textarea { resize:vertical; line-height:1.55; }
  form input:focus, form textarea:focus { outline:none; border-color:#0a66c2; }
  .help { display:block; font-size:.73rem; color:#8a94a6; margin-top:4px; }
  .checks { display:flex; flex-direction:column; gap:7px; }
  .chk { font-weight:500 !important; font-size:.84rem !important; color:#1a1a2e !important;
         display:flex; align-items:center; gap:8px; margin-bottom:0 !important; }
  .chk input { width:auto; margin:0; }
  .needkey { font-size:.67rem; background:#fef3c7; color:#92400e; padding:1px 6px;
             border-radius:8px; font-weight:700; }
  button.btn { border:0; cursor:pointer; font-family:inherit; }
  button.btn:disabled { opacity:.55; cursor:default; }
  .saved { background:#dcfce7; color:#166534; border:1px solid #a7e3bf; border-radius:8px;
           padding:9px 14px; font-size:.85rem; font-weight:600; margin-bottom:14px; }
`;

function renderField(f, profile) {
  const val = profile[f.key];
  const help = f.help ? `<span class="help">${esc(f.help)}</span>` : '';

  if (f.type === 'modes' || f.type === 'sources') {
    const chosen = new Set(Array.isArray(val) ? val : []);
    const opts = f.type === 'modes' ? MODES.map((m) => [m, m, true]) : SOURCES;
    const boxes = opts.map(([id, label, keyless]) =>
      `<label class="chk"><input type="checkbox" name="${esc(f.key)}" value="${esc(id)}"` +
      `${chosen.has(id) ? ' checked' : ''}> ${esc(label)}` +
      `${keyless ? '' : ' <span class="needkey">needs free key</span>'}</label>`
    ).join('');
    return `<div class="fld"><label>${esc(f.label)}</label><div class="checks">${boxes}</div>${help}</div>`;
  }

  if (f.type === 'list') {
    const arr = Array.isArray(val) ? val : [];
    const rows = Math.min(10, Math.max(3, arr.length + 1));
    return `<div class="fld"><label>${esc(f.label)}</label>` +
      `<textarea name="${esc(f.key)}" rows="${rows}">${esc(arr.join('\n'))}</textarea>${help}</div>`;
  }

  if (f.type === 'area') {
    return `<div class="fld"><label>${esc(f.label)}</label>` +
      `<textarea name="${esc(f.key)}" rows="8">${esc(val || '')}</textarea>${help}</div>`;
  }

  const t = f.type === 'number' ? 'number' : 'text';
  return `<div class="fld"><label>${esc(f.label)}</label>` +
    `<input type="${t}" name="${esc(f.key)}" value="${esc(val == null ? '' : val)}">${help}</div>`;
}

export function settingsPage(profile, fields, opts = {}) {
  const { runner = 'none', lastRun = null, saved = false } = opts;
  const group = (keys) => fields.filter((f) => keys.includes(f.key))
    .map((f) => renderField(f, profile)).join('');

  const runNote = runner === 'local'
    ? 'This server runs the search directly. Keep this tab open; it opens the new report when finished.'
    : runner === 'github'
      ? 'Starts the workflow on GitHub Actions. It takes about five minutes, then the new report appears here.'
      : 'A search cannot be started from this hosted page yet — a serverless request cannot stay open for five minutes. ' +
        'Set a GITHUB_TOKEN environment variable to trigger the workflow on demand, or run <code>npm run run</code> ' +
        'on your machine. The scheduled 08:00 run is unaffected.';

  const body = `
<div class="hero">
  <h1>Search Settings</h1>
  <p>Change what you search for, then run a new search. Everything here is saved to the database.</p>
  <div class="hero-chips">
    <span class="hero-chip">source: ${esc(profile._source || 'file')}</span>
    ${profile._updatedAt ? `<span class="hero-chip">saved ${esc(new Date(profile._updatedAt).toLocaleString('en-IN'))}</span>` : ''}
  </div>
</div>

<div class="wrap">
  ${saved ? '<div class="saved">Saved. Your next search will use these settings.</div>' : ''}

  <div class="card" style="margin-bottom:16px">
    <h3>Run a search now</h3>
    <p class="muted" style="margin-bottom:12px">
      Fetches every selected portal again, drops anything you have already been shown,
      scores the rest against your profile, and verifies every apply link before it reaches the report.
    </p>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" id="runBtn" type="button" onclick="runNow()"
        ${runner === 'none' ? 'disabled' : ''}>Search jobs now</button>
      <span id="runMsg" class="muted"></span>
    </div>
    <div class="muted" style="margin-top:10px">${runNote}</div>
    ${lastRun ? `<div class="muted" style="margin-top:8px">Last run: <b>#${lastRun.id}</b> &middot;
      ${esc(new Date(lastRun.started_at).toLocaleString('en-IN'))} &middot; ${lastRun.n_reported} jobs</div>` : ''}
  </div>

  <form method="POST" action="/settings">
    <div class="grid g2">
      <div class="card"><h3>About you</h3>
        ${group(['name', 'totalExpYears', 'baseCity'])}</div>
      <div class="card"><h3>What to search for</h3>
        ${group(['jobTitles', 'preferredLocations', 'workModes'])}</div>
      <div class="card"><h3>Job portals</h3>
        ${group(['sources'])}</div>
      <div class="card"><h3>Your skills</h3>
        ${group(['skillBank'])}</div>
      <div class="card"><h3>Filters</h3>
        ${group(['minScore', 'dailyLimit', 'excludeKeywords', 'excludeCompanies'])}</div>
      <div class="card"><h3>Resume summary</h3>
        ${group(['resumeText'])}</div>
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" type="submit">Save settings</button>
      <a class="btn btn-ghost" href="/">Back to dashboard</a>
      <span class="muted">Applies to the next search. No redeploy needed.</span>
    </div>
  </form>
</div>

<script>
async function runNow() {
  var b = document.getElementById('runBtn'), m = document.getElementById('runMsg');
  b.disabled = true; b.textContent = 'Starting...'; m.textContent = '';
  try {
    var res = await fetch('/api/run', { method: 'POST' });
    var j = await res.json();
    if (j.started) {
      m.textContent = j.message || 'Search running. This page will open the report when it is ready.';
      b.textContent = 'Searching...';
      poll(j.knownRuns || 0, 0);
    } else {
      m.textContent = j.message || 'Could not start a search.';
      b.disabled = false; b.textContent = 'Search jobs now';
    }
  } catch (e) {
    m.textContent = 'Error: ' + e.message;
    b.disabled = false; b.textContent = 'Search jobs now';
  }
}
function poll(known, tries) {
  if (tries > 60) {
    document.getElementById('runMsg').textContent =
      'Still running. Check the Reports tab in a few minutes.';
    return;
  }
  setTimeout(async function () {
    try {
      var runs = await (await fetch('/api/runs')).json();
      if (runs.length > known) { location.href = '/reports/' + runs[0].id; return; }
    } catch (e) { /* keep polling */ }
    poll(known, tries + 1);
  }, 15000);
}
</script>`;

  return layout({ title: 'Search Settings — JobVibe', active: 'settings', body });
}
