// Search Settings — edit every field of the profile in the browser, and start a
// search on demand. Writes to the profiles table, so a change takes effect on
// the next run with no redeploy and no file editing.
import { layout, esc } from './pages.js';

const MODES = ['On-site', 'Hybrid', 'Remote'];

// Suggestions for the location chip input (datalist). Not a whitelist — the
// user can type any city; these just make the common ones one click away.
const CITY_SUGGEST = [
  'Remote', 'Bengaluru', 'Mumbai', 'Delhi', 'Gurugram', 'Noida', 'Hyderabad',
  'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Coimbatore', 'Kochi', 'Thiruvananthapuram',
  'Chandigarh', 'Jaipur', 'Indore', 'Nagpur', 'Bhubaneswar', 'Visakhapatnam',
  'Mysuru', 'Mangaluru', 'Vadodara', 'Surat', 'Lucknow', 'Bhopal', 'Nashik',
  'Gandhinagar', 'Faridabad', 'Ghaziabad', 'Madurai', 'Tiruchirappalli', 'Vijayawada',
];

// [id, label, keyless]
const SOURCES = [
  ['greenhouse', 'Greenhouse', true],
  ['lever', 'Lever', true],
  ['ashby', 'Ashby', true],
  ['smartrecruiters', 'SmartRecruiters', true],
  ['himalayas', 'Himalayas — remote roles open to India', true],
  ['cutshort', 'Cutshort — India tech roles (Naukri-class)', true],
  ['jsearch', 'Google for Jobs (JSearch)', false],
  ['adzuna', 'Adzuna', false],
  ['careerjet', 'Careerjet', false],
  ['jooble', 'Jooble', false],
];

export const FORM_CSS = `
  form .fld { margin-bottom:15px; }
  form label { display:block; font-size:.8rem; font-weight:600; color:#475467; margin-bottom:5px; }
  form input[type=text], form input[type=number], form input[type=password], form textarea {
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
  .kstate { float:right; font-size:.66rem; font-weight:700; padding:1px 7px; border-radius:8px;
            text-transform:uppercase; letter-spacing:.4px; }
  .kstate.ok  { background:#dcfce7; color:#166534; }
  .kstate.env { background:#e0e7ff; color:#3730a3; }
  .kstate.no  { background:#f2f4f8; color:#8a94a6; }
  .saved { background:#dcfce7; color:#166534; border:1px solid #a7e3bf; border-radius:8px;
           padding:9px 14px; font-size:.85rem; font-weight:600; margin-bottom:14px; }
  .tag-chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
  .tag-chip { display:inline-flex; align-items:center; gap:6px; background:#eef4fc; color:#0a4a8f;
    border:1px solid #cfe1f7; border-radius:16px; padding:4px 6px 4px 12px; font-size:.83rem; font-weight:600; }
  .tag-chip button { border:0; background:#d4e4f7; color:#0a4a8f; border-radius:50%; width:18px; height:18px;
    line-height:1; font-size:.9rem; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; }
  .tag-chip button:hover { background:#0a66c2; color:#fff; }
  .tag-add { display:flex; gap:8px; }
  .tag-add .tag-input { flex:1; }
  .tag-btn { padding:8px 16px; }
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

  if (f.type === 'toggle') {
    const on = f.key === 'scheduleActive' ? val === true : val !== false;
    return `<div class="fld"><label class="chk" style="font-weight:600">` +
      `<input type="checkbox" name="${esc(f.key)}"${on ? ' checked' : ''}> ${esc(f.label)}</label>${help}</div>`;
  }

  if (f.type === 'list') {
    const arr = Array.isArray(val) ? val : [];
    const rows = Math.min(10, Math.max(3, arr.length + 1));
    return `<div class="fld"><label>${esc(f.label)}</label>` +
      `<textarea name="${esc(f.key)}" rows="${rows}">${esc(arr.join('\n'))}</textarea>${help}</div>`;
  }

  if (f.type === 'tags') {
    const arr = Array.isArray(val) ? val : [];
    const listId = `dl_${esc(f.key)}`;
    const chips = arr.map((c) =>
      `<span class="tag-chip">${esc(c)}<button type="button" onclick="tagDel(this)" aria-label="Remove">×</button></span>`
    ).join('');
    const opts = CITY_SUGGEST.map((c) => `<option value="${esc(c)}">`).join('');
    return `<div class="fld"><label>${esc(f.label)}</label>
      <div class="tags" data-key="${esc(f.key)}">
        <div class="tag-chips">${chips}</div>
        <div class="tag-add">
          <input type="text" class="tag-input" list="${listId}" placeholder="Type a city and press Enter…"
                 onkeydown="tagKey(event,this)" autocomplete="off">
          <button type="button" class="btn tag-btn" onclick="tagAdd(this)">Add</button>
        </div>
        <datalist id="${listId}">${opts}</datalist>
        <input type="hidden" name="${esc(f.key)}" value="${esc(arr.join(','))}">
      </div>${help}</div>`;
  }

  if (f.type === 'area') {
    return `<div class="fld"><label>${esc(f.label)}</label>` +
      `<textarea name="${esc(f.key)}" rows="8">${esc(val || '')}</textarea>${help}</div>`;
  }

  const t = f.type === 'number' ? 'number' : 'text';
  return `<div class="fld"><label>${esc(f.label)}</label>` +
    `<input type="${t}" name="${esc(f.key)}" value="${esc(val == null ? '' : val)}">${help}</div>`;
}

export function keysCard(secrets) {
  const rows = secrets.map((k) => {
    const state = k.fromEnv
      ? '<span class="kstate env">from .env</span>'
      : k.inDb
        ? '<span class="kstate ok">saved</span>'
        : '<span class="kstate no">not set</span>';
    return `<div class="fld">
      <label>${esc(k.label)} ${state}</label>
      <input type="${k.plain ? 'text' : 'password'}" name="${esc(k.key)}"
             autocomplete="off" spellcheck="false"
             placeholder="${k.set ? 'Leave blank to keep the current value' : 'Paste here'}">
      ${k.help ? `<span class="help">${esc(k.help)}</span>` : ''}
    </div>`;
  }).join('');

  return `
  <form method="POST" action="/settings/keys" id="keysForm">
    <div class="card" style="margin-bottom:16px">
      <h3>Keys &amp; credentials</h3>
      <p class="muted" style="margin-bottom:14px">
        Paste keys here instead of editing files. They are encrypted before being stored and are
        never shown again — only whether each one is set. A value in <code>.env</code> always wins.
      </p>
      <div class="grid g2">${rows}</div>
      <div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" type="submit">Save keys</button>
        <span class="muted">Blank fields are left unchanged. Type a single space to clear one.</span>
      </div>
      <p class="muted" style="margin-top:10px">
        Encrypted with your app password. If you change <code>APP_PASSWORD</code>, re-enter them.
        <code>DATABASE_URL</code> cannot live here — it is needed to reach this database.
      </p>
    </div>
  </form>`;
}

export function settingsPage(profile, fields, opts = {}) {
  const { runner = 'none', lastRun = null, saved = false, secrets = [], isAdmin = false,
    welcome = false, autofilled = false, autofillErr = false, resume = null } = opts;
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
  ${welcome ? '<div class="saved">Welcome! Review the details below — we filled in what we could from your CV. Turn on the daily schedule when you are ready.</div>' : ''}
  ${autofilled ? '<div class="saved">CV read successfully — your titles, skills and summary are filled in below. Edit anything that is off.</div>' : ''}
  ${autofillErr ? '<div class="saved" style="background:#fbf0d6;color:#8a5a00;border-color:#e2c88a">Your CV was saved, but autofill could not read it fully. Fill in anything missing below.</div>' : ''}

  <div class="card" style="margin-bottom:16px">
    <h3>Your CV</h3>
    <p class="muted">${resume
      ? `On file: <b>${esc(resume.filename || 'resume')}</b> (${esc(resume.kind || '')}) &middot; uploaded ${esc(new Date(resume.created_at).toLocaleDateString('en-IN'))}`
      : 'No CV uploaded yet.'}</p>
    <div style="margin-top:10px"><a class="btn" href="/onboarding">${resume ? 'Upload / replace CV' : 'Upload your CV'}</a></div>
  </div>

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
    <div id="runProgWrap" style="display:none;margin-top:14px">
      <div style="height:8px;border-radius:6px;background:#e6eaf0;overflow:hidden">
        <div id="runProgBar" style="height:100%;width:30%;border-radius:6px;
          background:linear-gradient(90deg,#0a66c2,#00a0dc);
          animation:runslide 1.4s ease-in-out infinite"></div>
      </div>
      <div class="muted" style="margin-top:6px;font-size:.8rem">
        <span id="runStage">Queuing the search…</span> · <span id="runElapsed">0s</span>
      </div>
    </div>
    <style>@keyframes runslide{0%{margin-left:-32%}50%{margin-left:52%}100%{margin-left:102%}}</style>
    <div class="muted" style="margin-top:10px">${runNote}</div>
    ${lastRun ? `<div class="muted" style="margin-top:8px">Last run: <b>#${lastRun.id}</b> &middot;
      ${esc(new Date(lastRun.started_at).toLocaleString('en-IN'))} &middot; ${lastRun.n_reported} jobs</div>` : ''}
  </div>

  ${isAdmin && secrets.length ? keysCard(secrets) : ''}

  <form method="POST" action="/settings">
    <div class="grid g2">
      <div class="card" id="profile"><h3>About you</h3>
        ${group(['name', 'totalExpYears', 'baseCity'])}</div>
      <div class="card"><h3>What to search for</h3>
        ${group(['jobTitles', 'preferredLocations', 'workModes'])}</div>
      <div class="card"><h3>Job portals</h3>
        ${group(['sources'])}</div>
      <div class="card" id="skills"><h3>Your skills</h3>
        ${group(['skillBank'])}</div>
      <div class="card"><h3>Filters</h3>
        ${group(['minScore', 'dailyLimit', 'excludeKeywords', 'excludeCompanies'])}</div>
      <div class="card"><h3>Resume summary</h3>
        ${group(['resumeText'])}</div>
      <div class="card"><h3>Email delivery</h3>
        ${group(['scheduleActive', 'emailEnabled', 'emailTo', 'emailCc'])}
        <p class="muted" style="margin-top:4px">${esc(opts.emailNote || '')}</p></div>
    </div>
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" type="submit">Save settings</button>
      <a class="btn btn-ghost" href="/">Back to dashboard</a>
      <span class="muted">Applies to the next search. No redeploy needed.</span>
    </div>
  </form>
</div>

<script>
// ---- location chip input ----
function tagSync(wrap){
  var vals = [].map.call(wrap.querySelectorAll('.tag-chip'), function(c){
    return c.firstChild.textContent.trim();
  });
  wrap.querySelector('input[type=hidden]').value = vals.join(',');
}
function tagAdd(btn){
  var wrap = btn.closest('.tags');
  var input = wrap.querySelector('.tag-input');
  var raw = (input.value || '').split(',');
  for (var i=0;i<raw.length;i++){
    var v = raw[i].trim(); if(!v) continue;
    var exists = [].some.call(wrap.querySelectorAll('.tag-chip'), function(c){
      return c.firstChild.textContent.trim().toLowerCase() === v.toLowerCase();
    });
    if (exists) continue;
    var chip = document.createElement('span'); chip.className = 'tag-chip';
    chip.appendChild(document.createTextNode(v));
    var x = document.createElement('button'); x.type='button'; x.textContent='×';
    x.setAttribute('aria-label','Remove'); x.onclick = function(){ tagDel(this); };
    chip.appendChild(x);
    wrap.querySelector('.tag-chips').appendChild(chip);
  }
  input.value = ''; input.focus(); tagSync(wrap);
}
function tagDel(btn){
  var wrap = btn.closest('.tags'); btn.parentNode.remove(); tagSync(wrap);
}
function tagKey(e, input){
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(input.parentNode.querySelector('.tag-btn')); }
}
var runStart = 0, runTimer = null;
var STAGES = [
  [0,   'Queuing the search…'],
  [20,  'Fetching jobs from every portal…'],
  [90,  'Scoring jobs against your profile…'],
  [150, 'Verifying every apply link…'],
  [210, 'Building your report…'],
];
function tickElapsed() {
  var s = Math.floor((Date.now() - runStart) / 1000);
  document.getElementById('runElapsed').textContent =
    s < 60 ? s + 's' : Math.floor(s/60) + 'm ' + (s%60) + 's';
  var stage = STAGES[0][1];
  for (var i = 0; i < STAGES.length; i++) if (s >= STAGES[i][0]) stage = STAGES[i][1];
  document.getElementById('runStage').textContent = stage;
}
async function runNow() {
  var b = document.getElementById('runBtn'), m = document.getElementById('runMsg');
  b.disabled = true; b.textContent = 'Starting...'; m.textContent = '';
  try {
    var res = await fetch('/api/run', { method: 'POST' });
    var j = await res.json();
    if (j.started) {
      m.textContent = j.message || 'Search running. This page will open the report when it is ready.';
      b.textContent = 'Searching...';
      document.getElementById('runProgWrap').style.display = 'block';
      runStart = Date.now(); tickElapsed();
      runTimer = setInterval(tickElapsed, 1000);
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
  if (tries > 80) {
    if (runTimer) clearInterval(runTimer);
    document.getElementById('runProgWrap').style.display = 'none';
    document.getElementById('runMsg').textContent =
      'Still running. Check the Reports tab in a few minutes.';
    return;
  }
  setTimeout(async function () {
    try {
      var runs = await (await fetch('/api/runs')).json();
      if (runs.length > known) {
        if (runTimer) clearInterval(runTimer);
        document.getElementById('runStage').textContent = 'Report ready — opening…';
        location.href = '/reports/' + runs[0].id; return;
      }
    } catch (e) { /* keep polling */ }
    poll(known, tries + 1);
  }, 15000);
}
</script>`;

  return layout({ title: 'Search Settings — JobVibe', active: 'settings', body });
}
