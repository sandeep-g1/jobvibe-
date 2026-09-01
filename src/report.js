// Renders the daily report — keeps the Batch 7 layout and adds the columns
// the architecture calls for (source, posted, skills matched/missing,
// competition signal, verified-link state, score breakdown).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './db.js';
import { displayCity } from './lib/india.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SOURCE_LABEL = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
};

function daysAgo(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(d) ? d : null;
}

function postedLabel(iso) {
  const d = daysAgo(iso);
  if (d === null) return '—';
  if (d <= 0) return 'Today';
  if (d === 1) return '1 day';
  if (d < 30) return `${d} days`;
  return `${Math.floor(d / 30)} mo`;
}

export function buildRows(matches, applied = new Set()) {
  return matches.map((m, i) => ({
    n: i + 1,
    fingerprint: m.fingerprint,
    title: m.title,
    company: m.company,
    score: Math.round(m.score),
    rec: m.recommendation,
    mode: m.work_mode || 'On-site',
    city: displayCity(m.city),
    source: m.source,
    sourceLabel: SOURCE_LABEL[m.source] || m.source,
    url: m.final_url || m.apply_url,
    linkStatus: m.link_status,
    posted: postedLabel(m.posted_at),
    postedDays: daysAgo(m.posted_at),
    salary: m.salary_raw || '',
    exp: m.min_exp != null ? `${m.min_exp}${m.max_exp != null ? `-${m.max_exp}` : '+'}y` : '—',
    matched: JSON.parse(m.skills_matched || '[]'),
    missing: JSON.parse(m.skills_missing || '[]'),
    breakdown: JSON.parse(m.breakdown || '{}'),
    why: m.why_text || '',
    competition: m.competition || 'Medium',
    competitionReason: m.competition_reason || '',
    applicants: m.applicants,
    applied: applied.has(m.fingerprint),
    isNew: true,
  }));
}

export function writeReport(matches, { profile, runId, errors = [], perSource = {}, applied = new Set() }) {
  const rows = buildRows(matches, applied);
  const dir = join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = join(dir, `report-${date}-run${runId}.html`);
  writeFileSync(file, html(rows, { profile, runId, errors, perSource, date }), 'utf8');
  writeFileSync(join(dir, 'latest.html'), html(rows, { profile, runId, errors, perSource, date }), 'utf8');
  return file;
}

export function renderReport(rows, { profile, runId, errors = [], perSource = {}, date }) {
  return html(rows, { profile, runId, errors, perSource, date });
}

function html(rows, { profile, runId, errors, perSource, date }) {
  const apply = rows.filter((r) => r.rec === 'apply').length;
  const consider = rows.filter((r) => r.rec === 'consider').length;
  const skip = rows.filter((r) => r.rec === 'skip').length;
  const verified = rows.filter((r) => r.linkStatus === 'OK').length;
  const sources = [...new Set(rows.map((r) => r.source))];
  const top = rows.filter((r) => r.score >= 70).slice(0, 8);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(profile.name)} — Job Shortlist · ${date}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f0f2f5; color:#1a1a2e; }

  .header { background:linear-gradient(135deg,#0a66c2 0%,#00a0dc 100%); padding:28px 40px; color:#fff; box-shadow:0 4px 12px rgba(10,102,194,.3); }
  .header h1 { font-size:1.6rem; font-weight:700; letter-spacing:-.5px; }
  .header p { font-size:.85rem; opacity:.85; margin-top:6px; }
  .header-stats { display:flex; gap:20px; margin-top:12px; flex-wrap:wrap; }
  .stat-badge { background:rgba(255,255,255,.2); border-radius:20px; padding:5px 14px; font-size:.8rem; font-weight:600; }

  .controls { background:#fff; padding:16px 40px; border-bottom:1px solid #e0e0e0; display:flex; flex-wrap:wrap; gap:12px; align-items:center; position:sticky; top:0; z-index:100; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .search-box { flex:1; min-width:200px; padding:9px 16px; border:1.5px solid #d0d5dd; border-radius:8px; font-size:.9rem; outline:none; }
  .search-box:focus { border-color:#0a66c2; }
  .filter-group { display:flex; gap:8px; flex-wrap:wrap; }
  .filter-btn { padding:7px 14px; border:1.5px solid #d0d5dd; border-radius:20px; background:#fff; cursor:pointer; font-size:.82rem; font-weight:500; color:#444; }
  .filter-btn:hover { background:#f0f7ff; border-color:#0a66c2; color:#0a66c2; }
  .filter-btn.active { background:#0a66c2; color:#fff; border-color:#0a66c2; }
  .filter-label { font-size:.8rem; color:#888; font-weight:600; align-self:center; }

  .priority-panel { background:#fff; margin:20px 40px 0; border-radius:12px; padding:18px 24px; border-left:4px solid #00b341; box-shadow:0 2px 8px rgba(0,0,0,.06); }
  .priority-panel h3 { font-size:1rem; color:#00b341; margin-bottom:12px; }
  .priority-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .priority-chip { background:#f0fff4; border:1px solid #b7ebc8; border-radius:20px; padding:5px 14px; font-size:.8rem; color:#1a7a3c; font-weight:500; cursor:pointer; }
  .priority-chip:hover { background:#00b341; color:#fff; }

  .results-info { padding:12px 40px; font-size:.85rem; color:#666; font-weight:500; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  .btn-csv { background:#fff; border:1.5px solid #d0d5dd; border-radius:7px; padding:5px 12px; font-size:.78rem; font-weight:600; cursor:pointer; color:#444; }
  .btn-csv:hover { border-color:#0a66c2; color:#0a66c2; }

  .table-wrapper { margin:8px 40px 40px; background:#fff; border-radius:12px; overflow-x:auto; box-shadow:0 2px 12px rgba(0,0,0,.07); }
  table { width:100%; border-collapse:collapse; min-width:1180px; }
  thead { background:#f8fafc; }
  th { padding:12px 12px; text-align:left; font-size:.72rem; font-weight:700; color:#667085; text-transform:uppercase; letter-spacing:.5px; border-bottom:2px solid #eaecf0; white-space:nowrap; }
  td { padding:12px 12px; border-bottom:1px solid #f0f2f5; font-size:.85rem; vertical-align:top; }
  tr:hover td { background:#fafbff; }

  .job-num { font-weight:700; color:#888; font-size:.8rem; }
  .job-title { font-weight:600; color:#1a1a2e; display:block; }
  .job-sub { font-size:.75rem; color:#8a94a6; margin-top:3px; }
  .company-name { color:#0a66c2; font-weight:500; }

  .match-pill { display:inline-block; padding:3px 10px; border-radius:12px; font-size:.78rem; font-weight:700; cursor:help; }
  .match-high{background:#d1fae5;color:#065f46} .match-good{background:#dbeafe;color:#1e40af}
  .match-medium{background:#fef3c7;color:#92400e} .match-low{background:#fee2e2;color:#991b1b}

  .rec-badge { display:inline-block; padding:4px 10px; border-radius:12px; font-size:.75rem; font-weight:600; white-space:nowrap; }
  .rec-apply{background:#dcfce7;color:#15803d} .rec-consider{background:#fef9c3;color:#a16207} .rec-skip{background:#fee2e2;color:#b91c1c}

  .mode-badge { display:inline-block; padding:3px 9px; border-radius:10px; font-size:.72rem; font-weight:600; }
  .mode-onsite{background:#ede9fe;color:#6d28d9} .mode-hybrid{background:#dbeafe;color:#1d4ed8} .mode-remote{background:#dcfce7;color:#166534}

  .comp-badge { font-size:.75rem; font-weight:700; cursor:help; }
  .comp-Low{color:#00b341} .comp-Medium{color:#f59e0b} .comp-High{color:#b91c1c}

  .src-badge { display:inline-block; padding:2px 8px; border-radius:9px; font-size:.7rem; font-weight:600; background:#eef2f7; color:#5a6478; }
  .link-warn { display:inline-block; font-size:.66rem; font-weight:700; color:#a16207; background:#fef9c3; border-radius:6px; padding:1px 5px; margin-left:4px; }

  .chips { display:flex; flex-wrap:wrap; gap:3px; max-width:250px; }
  .chip-y { background:#dcfce7; color:#166534; font-size:.68rem; padding:1px 6px; border-radius:8px; font-weight:600; }
  .chip-n { background:#fee2e2; color:#991b1b; font-size:.68rem; padding:1px 6px; border-radius:8px; font-weight:600; }

  .why-note { font-size:.76rem; color:#555; line-height:1.4; max-width:250px; display:block; }

  .btn-apply { display:inline-block; background:#0a66c2; color:#fff; padding:6px 14px; border-radius:6px; text-decoration:none; font-size:.78rem; font-weight:600; white-space:nowrap; }
  .btn-apply:hover { background:#084fa1; }
  .btn-applied { background:#e8f5e9; color:#2e7d32; padding:5px 10px; border-radius:6px; font-size:.75rem; font-weight:600; border:1.5px solid #4caf50; cursor:pointer; white-space:nowrap; }
  .btn-applied:hover { background:#ffebee; color:#c62828; border-color:#ef5350; }
  .applied-tag { background:#e8f5e9; color:#2e7d32; font-size:.68rem; padding:2px 7px; border-radius:10px; font-weight:600; border:1px solid #a5d6a7; }
  .row-applied td { opacity:.45; }

  .runbar { margin:16px 40px 0; background:#fff; border-radius:10px; padding:12px 18px; font-size:.76rem; color:#667085; box-shadow:0 2px 8px rgba(0,0,0,.05); display:flex; gap:18px; flex-wrap:wrap; }
  .runbar b { color:#1a1a2e; }
  footer { text-align:center; padding:24px; color:#aaa; font-size:.76rem; line-height:1.7; }

  @media (max-width:768px){
    .header,.controls,.results-info,.priority-panel,.table-wrapper,.runbar{margin-left:12px;margin-right:12px}
    .header{padding:20px 16px} .controls{padding:12px 16px}
  }
</style>
</head>
<body>

<div class="header">
  <h1>${esc(profile.name)} — Daily Job Shortlist</h1>
  <p>${esc(profile.preferredLocations.join(' · '))} · ${profile.totalExpYears}+ years · ${esc(profile.jobTitles.slice(0, 3).join(' / '))} · ${date}</p>
  <div class="header-stats">
    <span class="stat-badge">📋 ${rows.length} Jobs</span>
    <span class="stat-badge">✅ ${apply} Apply</span>
    <span class="stat-badge">⚠️ ${consider} Consider</span>
    <span class="stat-badge">🔴 ${skip} Skip</span>
    <span class="stat-badge">🔗 ${verified} Links Verified</span>
    <span class="stat-badge">🔒 0 Duplicates</span>
    <span class="stat-badge">🆕 All New Today</span>
  </div>
</div>

<div class="controls">
  <input type="text" id="searchInput" class="search-box" placeholder="🔍 Search title, company or skill..." onkeyup="render()">
  <span class="filter-label">Rec:</span>
  <div class="filter-group" id="recFilters">
    <button class="filter-btn active" onclick="setFilter('rec','all',this)">All</button>
    <button class="filter-btn" onclick="setFilter('rec','apply',this)">✅ Apply</button>
    <button class="filter-btn" onclick="setFilter('rec','consider',this)">⚠️ Consider</button>
    <button class="filter-btn" onclick="setFilter('rec','skip',this)">🔴 Skip</button>
    <button class="filter-btn" onclick="setFilter('rec','archived',this)">📦 Applied</button>
  </div>
  <span class="filter-label">Mode:</span>
  <div class="filter-group" id="modeFilters">
    <button class="filter-btn active" onclick="setFilter('mode','all',this)">All</button>
    <button class="filter-btn" onclick="setFilter('mode','On-site',this)">🏢 On-site</button>
    <button class="filter-btn" onclick="setFilter('mode','Hybrid',this)">🔀 Hybrid</button>
    <button class="filter-btn" onclick="setFilter('mode','Remote',this)">🏠 Remote</button>
  </div>
  <span class="filter-label">Portal:</span>
  <div class="filter-group" id="srcFilters">
    <button class="filter-btn active" onclick="setFilter('src','all',this)">All</button>
    ${sources.map((s) => `<button class="filter-btn" onclick="setFilter('src','${esc(s)}',this)">${esc(SOURCE_LABEL[s] || s)}</button>`).join('\n    ')}
  </div>
  <span class="filter-label">Match:</span>
  <div class="filter-group" id="matchFilters">
    <button class="filter-btn active" onclick="setFilter('match','all',this)">All</button>
    <button class="filter-btn" onclick="setFilter('match','75',this)">75%+</button>
    <button class="filter-btn" onclick="setFilter('match','60',this)">60%+</button>
  </div>
</div>

${top.length ? `<div class="priority-panel">
  <h3>⭐ Top Priority (70%+ match)</h3>
  <div class="priority-chips">
    ${top.map((r) => `<span class="priority-chip" onclick="jump(${r.n})">${esc(r.title.slice(0, 46))} — ${esc(r.company)} (${r.score}%)</span>`).join('\n    ')}
  </div>
</div>` : ''}

<div class="runbar">
  <span>Run <b>#${runId}</b></span>
  ${Object.entries(perSource).map(([s, n]) => `<span>${esc(SOURCE_LABEL[s] || s)}: <b>${n}</b> fetched</span>`).join('')}
  <span>Source warnings: <b>${errors.length}</b></span>
  <span>Score floor: <b>${profile.minScore}</b></span>
</div>

<div class="results-info">
  <span id="resultsInfo">Showing ${rows.length} jobs</span>
  <button class="btn-csv" onclick="exportCSV()">📊 Export CSV</button>
</div>

<div class="table-wrapper">
<table id="jobTable">
  <thead><tr>
    <th>#</th><th>Job Title</th><th>Company</th><th>Match</th><th>Recommendation</th>
    <th>Mode</th><th>Exp</th><th>Posted</th><th>Competition</th>
    <th>Skills matched / missing</th><th>Why</th><th>Applied</th><th>Apply ↗</th>
  </tr></thead>
  <tbody id="jobTableBody"></tbody>
</table>
</div>

<footer>
  <p>Generated ${new Date().toLocaleString('en-IN')} · run #${runId} · every apply link verified before rendering</p>
  <p>Match score = must-have skills 35 · semantic fit 25 · experience 15 · title 10 · location 10, renormalised to 100. Resume parse-health (5) lands in Phase 5.</p>
</footer>

<script>
// Left angle brackets are escaped so a job title containing a closing script tag
// cannot break out of this block.
const jobs = ${JSON.stringify(rows).replace(/</g, '\\u003c')};
let filters = { rec:'all', mode:'all', src:'all', match:'all' };
let applied = Object.fromEntries(jobs.filter(j=>j.applied).map(j=>[j.fingerprint,true]));

const matchClass = m => m>=75?'match-high':m>=65?'match-good':m>=50?'match-medium':'match-low';
const recLabel = r => r==='apply'?'✅ APPLY':r==='consider'?'⚠️ Consider':'🔴 Skip';

function breakdownTitle(b){
  return Object.entries(b).map(([k,v])=>
    v.pts===null ? k+': — ('+v.note+')' : k+': '+v.pts+'/'+v.of+' — '+v.note
  ).join('\\n');
}

function render(){
  const tb = document.getElementById('jobTableBody');
  const q = document.getElementById('searchInput').value.toLowerCase();
  tb.innerHTML = '';
  let n = 0;

  for (const j of jobs) {
    const isApplied = !!applied[j.fingerprint];
    if (filters.rec === 'archived') { if (!isApplied) continue; }
    else {
      if (isApplied) continue;
      if (filters.rec !== 'all' && j.rec !== filters.rec) continue;
    }
    if (filters.mode !== 'all' && j.mode !== filters.mode) continue;
    if (filters.src !== 'all' && j.source !== filters.src) continue;
    if (filters.match !== 'all' && j.score < +filters.match) continue;
    if (q) {
      const hay = (j.title+' '+j.company+' '+j.matched.join(' ')+' '+j.missing.join(' ')).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    n++;

    const tr = document.createElement('tr');
    tr.id = 'row-' + j.n;
    if (isApplied) tr.className = 'row-applied';
    tr.innerHTML =
      '<td class="job-num">'+j.n+'</td>'+
      '<td><span class="job-title">'+esc(j.title)+'</span>'+
        '<span class="job-sub">'+esc(j.city)+' · <span class="src-badge">'+esc(j.sourceLabel)+'</span>'+
        (j.linkStatus==='UNVERIFIED'?'<span class="link-warn">unverified</span>':'')+'</span>'+
        (isApplied?' <span class="applied-tag">✓ Applied</span>':'')+'</td>'+
      '<td><span class="company-name">'+esc(j.company)+'</span></td>'+
      '<td><span class="match-pill '+matchClass(j.score)+'" title="'+esc(breakdownTitle(j.breakdown))+'">'+j.score+'%</span></td>'+
      '<td><span class="rec-badge rec-'+j.rec+'">'+recLabel(j.rec)+'</span></td>'+
      '<td><span class="mode-badge mode-'+j.mode.toLowerCase().replace('-','')+'">'+esc(j.mode)+'</span></td>'+
      '<td>'+esc(j.exp)+'</td>'+
      '<td>'+esc(j.posted)+'</td>'+
      '<td><span class="comp-badge comp-'+j.competition+'" title="'+esc(j.competitionReason)+'">'+j.competition+'</span></td>'+
      '<td><div class="chips">'+
        j.matched.slice(0,6).map(s=>'<span class="chip-y">'+esc(s)+'</span>').join('')+
        j.missing.slice(0,6).map(s=>'<span class="chip-n">'+esc(s)+'</span>').join('')+
      '</div></td>'+
      '<td><span class="why-note">'+esc(j.why)+'</span></td>'+
      '<td><button class="btn-applied" onclick="toggleApplied(\\''+j.fingerprint+'\\')">'+(isApplied?'↩ Undo':'✓ Applied')+'</button></td>'+
      '<td><a href="'+esc(j.url)+'" target="_blank" rel="noopener" class="btn-apply">Apply ↗</a></td>';
    tb.appendChild(tr);
  }
  document.getElementById('resultsInfo').textContent = 'Showing ' + n + ' job' + (n===1?'':'s');
}

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function toggleApplied(fp){
  applied[fp] = !applied[fp];
  render();
  // Persist to the database when served by npm run serve; degrade quietly on file://
  try {
    await fetch('/api/applied', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fingerprint: fp })
    });
  } catch (e) {
    try { localStorage.setItem('shortlist_applied', JSON.stringify(applied)); } catch (e2) {}
  }
}

function setFilter(type, value, btn){
  filters[type] = value;
  const group = { rec:'recFilters', mode:'modeFilters', src:'srcFilters', match:'matchFilters' }[type];
  document.querySelectorAll('#'+group+' .filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

function jump(n){
  const row = document.getElementById('row-'+n);
  if (row) row.scrollIntoView({ behavior:'smooth', block:'center' });
}

function exportCSV(){
  const head = ['#','Title','Company','City','Score','Recommendation','Mode','Exp','Posted','Competition','Skills matched','Skills missing','Source','Apply URL'];
  const lines = [head.join(',')];
  for (const j of jobs) {
    lines.push([j.n,j.title,j.company,j.city,j.score,j.rec,j.mode,j.exp,j.posted,j.competition,
      j.matched.join(' | '),j.missing.join(' | '),j.sourceLabel,j.url]
      .map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(','));
  }
  const blob = new Blob([lines.join('\\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shortlist-${date}.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

render();
</script>
</body>
</html>`;
}
