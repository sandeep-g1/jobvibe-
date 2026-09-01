// Dashboard ("face page") and the reports index. Same visual language as the
// report itself so the whole app reads as one product.
import { dashboardStats, allRuns } from '../db.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SOURCE_LABEL = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters', adzuna: 'Adzuna', jooble: 'Jooble',
  careerjet: 'Careerjet', jsearch: 'Google for Jobs',
};

export const SHELL_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; background:#f0f2f5; color:#1a1a2e; }
  a { color:inherit; }

  .nav { background:#fff; border-bottom:1px solid #e2e6ee; padding:0 40px; display:flex; align-items:center;
         gap:4px; position:sticky; top:0; z-index:200; box-shadow:0 1px 4px rgba(0,0,0,.05); }
  .nav-brand { font-weight:800; font-size:.98rem; color:#0a66c2; margin-right:22px; padding:16px 0;
               letter-spacing:-.3px; text-decoration:none; }
  .nav a.tab { padding:16px 16px; font-size:.87rem; font-weight:600; color:#667085; text-decoration:none;
               border-bottom:2.5px solid transparent; }
  .nav a.tab:hover { color:#0a66c2; }
  .nav a.tab.on { color:#0a66c2; border-bottom-color:#0a66c2; }
  .nav-right { margin-left:auto; font-size:.78rem; color:#8a94a6; }

  .hero { background:linear-gradient(135deg,#0a66c2 0%,#00a0dc 100%); padding:30px 40px; color:#fff; }
  .hero h1 { font-size:1.55rem; font-weight:700; letter-spacing:-.5px; }
  .hero p { font-size:.86rem; opacity:.9; margin-top:6px; }
  .hero-chips { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }
  .hero-chip { background:rgba(255,255,255,.2); border-radius:20px; padding:5px 14px; font-size:.79rem; font-weight:600; }

  .wrap { padding:22px 40px 44px; }
  .grid { display:grid; gap:16px; }
  .g4 { grid-template-columns:repeat(auto-fit,minmax(178px,1fr)); }
  .g2 { grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); align-items:start; }

  .card { background:#fff; border-radius:12px; padding:18px 22px; box-shadow:0 2px 10px rgba(0,0,0,.06); }
  .card h3 { font-size:.74rem; font-weight:700; color:#8a94a6; text-transform:uppercase;
             letter-spacing:.8px; margin-bottom:12px; }
  .stat-n { font-size:2rem; font-weight:800; color:#0a66c2; line-height:1; letter-spacing:-1px; }
  .stat-l { font-size:.79rem; color:#667085; margin-top:6px; font-weight:500; }
  .stat-sub { font-size:.72rem; color:#a3aab8; margin-top:3px; }

  .chip { display:inline-block; background:#eef4fc; color:#0a66c2; border:1px solid #cfe1f7;
          border-radius:16px; padding:4px 11px; font-size:.76rem; font-weight:600; margin:0 5px 6px 0; }
  .chip-g { background:#dcfce7; color:#166534; border-color:#a7e3bf; }
  .chip-r { background:#fee2e2; color:#991b1b; border-color:#f0b6b8; }
  .chip-n { background:#f2f4f8; color:#5a6478; border-color:#dfe4ec; }

  .kv { display:flex; justify-content:space-between; gap:14px; padding:7px 0;
        border-bottom:1px solid #f0f2f5; font-size:.85rem; }
  .kv:last-child { border-bottom:none; }
  .kv span:first-child { color:#667085; }
  .kv span:last-child { font-weight:600; text-align:right; }

  .bar-row { display:grid; grid-template-columns:120px 1fr 44px; gap:10px; align-items:center;
             font-size:.8rem; margin-bottom:7px; }
  .bar { height:7px; background:#eef1f6; border-radius:20px; overflow:hidden; }
  .bar i { display:block; height:100%; background:#0a66c2; border-radius:20px; }
  .bar-n { text-align:right; font-weight:700; color:#667085; font-size:.78rem; }

  table.rt { width:100%; border-collapse:collapse; }
  table.rt th { text-align:left; padding:11px 14px; font-size:.72rem; font-weight:700; color:#667085;
                text-transform:uppercase; letter-spacing:.5px; background:#f8fafc;
                border-bottom:2px solid #eaecf0; white-space:nowrap; }
  table.rt td { padding:13px 14px; border-bottom:1px solid #f0f2f5; font-size:.86rem; }
  table.rt tr:last-child td { border-bottom:none; }
  table.rt tbody tr:hover td { background:#fafbff; }
  .run-id { font-weight:800; color:#0a66c2; }
  .btn { display:inline-block; background:#0a66c2; color:#fff; padding:6px 15px; border-radius:6px;
         text-decoration:none; font-size:.79rem; font-weight:600; white-space:nowrap; }
  .btn:hover { background:#084fa1; }
  .btn-ghost { background:#fff; color:#0a66c2; border:1.5px solid #cfe1f7; }
  .btn-ghost:hover { background:#eef4fc; }
  .muted { color:#8a94a6; font-size:.8rem; }
  .empty { text-align:center; padding:50px 20px; color:#8a94a6; }

  @media (max-width:760px){
    .nav,.hero,.wrap { padding-left:14px; padding-right:14px; }
    .nav { overflow-x:auto; }
  }
`;

function nav(active, extra = '') {
  const tab = (href, label, id) =>
    `<a class="tab${active === id ? ' on' : ''}" href="${href}">${label}</a>`;
  return `<div class="nav">
  <a class="nav-brand" href="/">Shortlist India</a>
  ${tab('/', 'Dashboard', 'dash')}
  ${tab('/reports', 'Reports', 'reports')}
  ${tab('/reports/latest', 'Latest Report', 'latest')}
  <span class="nav-right">${extra}</span>
</div>`;
}

export function layout({ title, active, body, navExtra = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
${nav(active, navExtra)}
${body}
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */

export async function dashboardPage(profile, sourceStatus) {
  const s = await dashboardStats();
  const runs = await allRuns();
  const latest = runs[0];

  // Most-demanded skills you don't have — the Phase 5 gap-review queue, previewed.
  const missCount = new Map();
  for (const row of s.topMissing) {
    for (const sk of JSON.parse(row.skills_missing || '[]')) {
      missCount.set(sk, (missCount.get(sk) || 0) + 1);
    }
  }
  const topGaps = [...missCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const recMap = Object.fromEntries(s.byRec.map((r) => [r.r, r.c]));
  const maxSrc = Math.max(1, ...s.bySource.map((r) => r.c));

  const body = `
<div class="hero">
  <h1>${esc(profile.name)}</h1>
  <p>${esc(profile.jobTitles.slice(0, 4).join(' · '))}</p>
  <div class="hero-chips">
    <span class="hero-chip">${profile.totalExpYears} years experience</span>
    <span class="hero-chip">${esc(profile.preferredLocations.slice(0, 3).join(', '))}</span>
    <span class="hero-chip">${esc(profile.workModes.join(' / '))}</span>
    <span class="hero-chip">${profile.skillBank.length} skills</span>
  </div>
</div>

<div class="wrap">
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card"><div class="stat-n">${s.runs}</div><div class="stat-l">Reports generated</div>
      <div class="stat-sub">${latest ? new Date(latest.started_at).toLocaleDateString('en-IN') : 'none yet'}</div></div>
    <div class="card"><div class="stat-n">${s.shown}</div><div class="stat-l">Jobs shown to you</div>
      <div class="stat-sub">${s.jobs} in database</div></div>
    <div class="card"><div class="stat-n">${recMap.apply || 0}</div><div class="stat-l">Rated “Apply”</div>
      <div class="stat-sub">${recMap.consider || 0} consider · ${recMap.skip || 0} skip</div></div>
    <div class="card"><div class="stat-n">${s.applied}</div><div class="stat-l">You applied</div>
      <div class="stat-sub">tracked in database</div></div>
    <div class="card"><div class="stat-n">${s.avgScore}%</div><div class="stat-l">Average match</div>
      <div class="stat-sub">best ${s.topScore}%</div></div>
    <div class="card"><div class="stat-n">${s.boards}</div><div class="stat-l">Live job boards</div>
      <div class="stat-sub">${s.indiaJobs} India jobs visible</div></div>
  </div>

  <div class="grid g2">
    <div class="card">
      <h3>Your skills — the truth boundary</h3>
      <p class="muted" style="margin-bottom:11px">Resume tailoring may only ever use what is in this list.</p>
      ${profile.skillBank.map((k) => `<span class="chip chip-g">${esc(k)}</span>`).join('')}
    </div>

    <div class="card">
      <h3>Skills employers want that you don't list</h3>
      <p class="muted" style="margin-bottom:11px">Ranked by how many of your matched jobs asked for them. Answering these is the Phase&nbsp;5 gap review.</p>
      ${topGaps.length
        ? topGaps.map(([k, n]) => `<span class="chip chip-r">${esc(k)} · ${n}</span>`).join('')
        : '<p class="muted">No gaps yet — run a report first.</p>'}
    </div>

    <div class="card">
      <h3>Search profile</h3>
      <div class="kv"><span>Base city</span><span>${esc(profile.baseCity)}</span></div>
      <div class="kv"><span>Experience</span><span>${profile.totalExpYears} years</span></div>
      <div class="kv"><span>Preferred locations</span><span>${esc(profile.preferredLocations.join(', '))}</span></div>
      <div class="kv"><span>Work modes</span><span>${esc(profile.workModes.join(', '))}</span></div>
      <div class="kv"><span>Minimum score</span><span>${profile.minScore}</span></div>
      <div class="kv"><span>Jobs per report</span><span>${profile.dailyLimit}</span></div>
      <div class="kv"><span>Excluded words</span><span>${esc((profile.excludeKeywords || []).join(', ') || '—')}</span></div>
      <p class="muted" style="margin-top:12px">Edit <code>profile.json</code> and run again to change any of this.</p>
    </div>

    <div class="card">
      <h3>Where your jobs come from</h3>
      ${s.bySource.length ? s.bySource.map((r) => `
        <div class="bar-row">
          <span>${esc(SOURCE_LABEL[r.s] || r.s)}</span>
          <span class="bar"><i style="width:${Math.round((r.c / maxSrc) * 100)}%"></i></span>
          <span class="bar-n">${r.c}</span>
        </div>`).join('')
        : '<p class="muted">No jobs yet.</p>'}
      <h3 style="margin-top:18px">Source status</h3>
      ${sourceStatus.map((t) => `<span class="chip ${t.ready ? 'chip-g' : 'chip-n'}">${esc(t.label)}${t.ready ? '' : ' · needs key'}</span>`).join('')}
    </div>

    <div class="card">
      <h3>Top companies hiring you</h3>
      ${s.topCompanies.length
        ? s.topCompanies.map((c) => `<div class="kv"><span>${esc(c.c)}</span><span>${c.n} roles</span></div>`).join('')
        : '<p class="muted">No jobs yet.</p>'}
    </div>

    <div class="card">
      <h3>Latest report</h3>
      ${latest ? `
        <div class="kv"><span>Report number</span><span>#${latest.id}</span></div>
        <div class="kv"><span>Generated</span><span>${new Date(latest.started_at).toLocaleString('en-IN')}</span></div>
        <div class="kv"><span>Jobs shown</span><span>${latest.n_reported}</span></div>
        <div class="kv"><span>New jobs found</span><span>${latest.n_new}</span></div>
        <div class="kv"><span>Dead links removed</span><span>${latest.n_links_dead}</span></div>
        <div style="margin-top:15px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="/reports/${latest.id}">Open report #${latest.id}</a>
          <a class="btn btn-ghost" href="/reports">All reports</a>
        </div>`
        : '<p class="muted">No report yet. Run <code>npm run run</code>.</p>'}
    </div>
  </div>
</div>`;

  return layout({ title: `${profile.name} — Dashboard`, active: 'dash', body });
}

/* ------------------------------------------------------------------ */
/*  Reports index                                                      */
/* ------------------------------------------------------------------ */

export async function reportsPage(profile) {
  const runs = await allRuns();

  const body = `
<div class="hero">
  <h1>All Reports</h1>
  <p>Every run ever generated. Nothing is deleted — open any past report exactly as it was.</p>
  <div class="hero-chips">
    <span class="hero-chip">${runs.length} reports</span>
    <span class="hero-chip">${runs.reduce((a, r) => a + r.n_reported, 0)} jobs total</span>
  </div>
</div>

<div class="wrap">
  <div class="card" style="padding:0;overflow-x:auto">
    ${runs.length ? `
    <table class="rt">
      <thead><tr>
        <th>Report</th><th>Date</th><th>Time</th><th>Jobs</th><th>New found</th>
        <th>Fetched</th><th>India</th><th>Dead links</th><th>Duration</th><th></th>
      </tr></thead>
      <tbody>
      ${runs.map((r) => {
        const d = new Date(r.started_at);
        const secs = r.finished_at
          ? ((new Date(r.finished_at) - d) / 1000).toFixed(0) + 's'
          : '—';
        return `<tr>
          <td class="run-id">#${r.id}</td>
          <td>${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td>${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
          <td><b>${r.n_reported}</b></td>
          <td>${r.n_new}</td>
          <td>${r.n_fetched}</td>
          <td>${r.n_after_india}</td>
          <td>${r.n_links_dead}</td>
          <td class="muted">${secs}</td>
          <td><a class="btn" href="/reports/${r.id}">Open</a></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>` : '<div class="empty">No reports yet. Run <code>npm run run</code> to create one.</div>'}
  </div>
  <p class="muted" style="margin-top:14px">
    Reports are rebuilt live from the database, so your Applied marks stay correct on old reports too.
  </p>
</div>`;

  return layout({ title: 'All Reports — Shortlist India', active: 'reports', body });
}

export function notFoundPage(msg) {
  return layout({
    title: 'Not found',
    active: '',
    body: `<div class="wrap"><div class="card empty"><h2 style="margin-bottom:8px">Not found</h2>
      <p class="muted">${esc(msg)}</p>
      <p style="margin-top:16px"><a class="btn" href="/">Back to dashboard</a></p></div></div>`,
  });
}
