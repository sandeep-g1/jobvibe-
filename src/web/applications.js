// Applications: every job the user approved, where it stands, how the agent
// applies (or why it can't), and the tailored CV it used.
import { layout, esc } from './pages.js';
import { COUNTRY_NAMES } from '../lib/geo.js';

const STATUS = {
  submitted: ['✓ Applied', 'ok'], unconfirmed: ['Submitted, not confirmed', 'warn'], needs_user: ['Needs your answer', 'warn'],
  captcha: ['Finish it (CAPTCHA)', 'warn'], manual: ['Apply yourself', 'muted'], waiting: ['⚡ Auto-apply soon', 'info'],
  blocked: ['Waiting on your answers', 'warn'], queued: ['Queued', 'info'], running: ['Applying…', 'info'],
  failed: ['Failed', 'bad'], skipped: ['Skipped', 'muted'], dry_run: ['Test run (not submitted)', 'muted'],
  held: ['On hold', 'muted'], ineligible: ['Not eligible', 'muted'], already_applied: ['Already applied', 'muted'], closed: ['Job closed', 'muted'], email_code: ['Needs email code (not sent)', 'warn'],
};
const EMAIL = { interview: '📅 Interview', assessment: '📝 Assessment', offer: '🎉 Offer', info_request: '📎 Info requested', rejection: 'Not selected', received: 'Received' };

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// Online if it checked in recently: the loop beats every 1-2 minutes, and one application can take several.
function workerBanner(w) {
  if (!w) {
    return `<div class="wk off"><b>Apply worker: never run.</b> Approved jobs wait until it runs on your PC.
      Double-click <code>worker\\install-autostart.cmd</code> once and it starts by itself every time you sign in to Windows.</div>`;
  }
  const fresh = Date.now() - new Date(w.seen_at).getTime() < 10 * 60000 && w.note !== 'stopped';
  return fresh
    ? `<div class="wk on"><b>● Apply worker running</b> on ${esc(w.host)}${w.mode === 'dry-run' ? ' (test mode: nothing is submitted)' : ''} · checked in ${esc(ago(w.seen_at))}</div>`
    : `<div class="wk off"><b>○ Apply worker offline</b> since ${esc(ago(w.seen_at))} (${esc(w.host)}). Approved jobs wait until the PC is on and you are signed in.</div>`;
}

const MSG = {
  queued: 'Sent to the worker. It picks it up within two minutes while it is running.',
  test: 'Test run queued: the worker fills the form, stops before submitting, and sends you a screenshot on Telegram.',
};

function actions(r) {
  const btn = (mode, text, cls = '') => `<form method="post" action="/applications/${r.id}/retry" style="display:inline">
    <input type="hidden" name="mode" value="${mode}"><button class="act ${cls}">${text}</button></form>`;
  if (r.status === 'failed') return `<div class="acts">${btn('test', 'Test run')}${btn('real', 'Try again', 'go')}</div>`;
  let det = {}; try { det = JSON.parse(r.detail || '{}'); } catch { /* none */ }
  if (r.status === 'dry_run' && det.testRun) return `<div class="acts">${btn('real', 'Submit for real', 'go')}</div>`;
  return '';
}

export function applicationsPage(rows, { worker = null, msg = null } = {}) {
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const chips = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<span class="hero-chip">${esc((STATUS[s] || [s])[0])}: ${n}</span>`).join('');

  const body = rows.length ? rows.map((r) => {
    let route = null; try { route = JSON.parse(r.apply_route || 'null'); } catch { /* none */ }
    const det = (() => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } })();
    const [label, cls] = STATUS[r.status] || [r.status, 'muted'];
    const place = [r.city ? r.city.replace(/\b\w/g, (c) => c.toUpperCase()) : (r.work_mode === 'Remote' ? 'Remote' : ''), COUNTRY_NAMES[r.country] || '']
      .filter(Boolean).join(', ');
    const how = route?.route === 'auto'
      ? `<span class="tag info">⚡ Auto-apply</span><div class="sub">${esc(route.via === 'job link' ? `${route.ats} form` : route.via || route.ats || '')}</div>`
        + (route.posting ? `<div class="sub">${esc(route.posting.title)} · ${esc(route.posting.location)}</div>` : '')
      : route?.route === 'manual'
        ? `<span class="tag muted">✋ You apply</span><div class="sub">${esc(route.reason || '')}</div>`
        : '<span class="sub">—</span>';
    const note = [det.lastEmail ? EMAIL[det.lastEmail] : '', r.reason && !['submitted'].includes(r.status) ? r.reason : '',
      r.status === 'submitted' && det.evidence?.text ? `Site said: “${det.evidence.text}”` : '']
      .filter(Boolean).map(esc).join('<br>');
    return `<tr>
      <td><a href="${esc(r.final_url || r.apply_url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a><div class="sub">${esc(r.company)}</div></td>
      <td>${esc(place) || '—'}</td>
      <td>${r.score != null ? `${Math.round(r.score)}%` : '—'}</td>
      <td>${how}</td>
      <td><span class="tag ${cls}">${esc(label)}</span>${r.attempts > 1 ? `<div class="sub">${r.attempts} attempts</div>` : ''}${actions(r)}</td>
      <td class="note">${note || '<span class="sub">—</span>'}</td>
      <td>${r.has_cv ? `<a class="dl" href="/applications/${r.id}/cv">⬇ ${esc(r.cv_name || 'CV')}</a>` : '<span class="sub">—</span>'}</td>
      <td class="sub">${esc(when(r.updated_at))}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="sub" style="padding:24px">No applications yet. Approve jobs in Telegram (or from your report) and the agent takes it from there.</td></tr>';

  return layout({
    title: 'Applications — JobVibe',
    active: 'applications',
    body: `
<div class="hero">
  <h1>Applications</h1>
  <p>Every job you approved: whether the agent applied, how, and the CV it sent.</p>
  <div class="hero-chips">${chips || '<span class="hero-chip">none yet</span>'}</div>
</div>
<div class="wrap">
  ${workerBanner(worker)}
  ${msg ? `<div class="wk ${MSG[msg] ? 'on' : 'off'}">${esc(MSG[msg] || msg)}</div>` : ''}
  <div class="card" style="padding:0;overflow-x:auto">
    <table class="apps">
      <thead><tr><th>Job</th><th>Location</th><th>Match</th><th>How it applies</th><th>Status</th><th>Details</th><th>CV sent</th><th>Updated</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <p class="muted" style="margin-top:12px">⚡ Auto-apply: the agent fills and submits the employer's own form with your tailored CV.
    ✋ You apply: the site blocks automated applications or needs your account; the tailored CV is still prepared for you.</p>
</div>
<style>
  .apps { width:100%; border-collapse:collapse; min-width:980px; }
  .apps th { text-align:left; font-size:.7rem; text-transform:uppercase; letter-spacing:.5px; color:#8a94a6; padding:12px; border-bottom:2px solid #eef0f4; white-space:nowrap; }
  .apps td { padding:12px; border-bottom:1px solid #f0f2f5; font-size:.85rem; vertical-align:top; }
  .apps a { color:#0a66c2; text-decoration:none; } .apps a:hover { text-decoration:underline; }
  .apps .sub { font-size:.75rem; color:#8a94a6; margin-top:3px; } .apps .note { max-width:260px; font-size:.78rem; color:#475467; }
  .tag { display:inline-block; padding:3px 9px; border-radius:10px; font-size:.74rem; font-weight:700; white-space:nowrap; }
  .tag.ok { background:#dcfce7; color:#15803d; } .tag.warn { background:#fef3c7; color:#92400e; } .tag.bad { background:#fee2e2; color:#b91c1c; }
  .tag.info { background:#eef4fc; color:#0a66c2; } .tag.muted { background:#f2f4f8; color:#667085; }
  .wk { padding:10px 14px; border-radius:10px; font-size:.85rem; margin-bottom:12px; }
  .wk.on { background:#ecfdf3; color:#166534; } .wk.off { background:#fff7ed; color:#9a3412; }
  .wk code { background:rgba(0,0,0,.06); padding:1px 5px; border-radius:4px; }
  .acts { margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; }
  .act { font:inherit; font-size:.74rem; font-weight:600; padding:4px 10px; border-radius:8px; border:1px solid #d0d5dd; background:#fff; color:#344054; cursor:pointer; }
  .act.go { background:#0a66c2; border-color:#0a66c2; color:#fff; }
  .dl { font-size:.78rem; font-weight:600; white-space:nowrap; }
</style>`,
  });
}
