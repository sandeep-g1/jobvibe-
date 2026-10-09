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

const OUT = {
  reply: (e) => `↩ Reply sent${e.auto ? ' (automatic)' : ''}`, reply_waiting: () => '↩ Reply drafted, waiting for your OK in Telegram',
  reply_queued: () => '↩ Reply going out', followup: (e) => `⏰ Follow-up ${e.n} sent${e.auto ? ' (automatic)' : ''}`,
  followup_waiting: (e) => `⏰ Follow-up ${e.n} drafted, waiting for your OK`,
};
const IN = { ...EMAIL, other: '✉️ Recruiter wrote' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
/** One line per email in or out: "8 Oct · 📅 Interview: Re: your application". */
const threadLine = (e) => `<div class="mail ${e.dir}">${esc(day(e.at))} · ${esc(e.dir === 'in' ? `${IN[e.kind] || 'Email'}: ${e.text || ''}` : OUT[e.kind](e))}</div>`;

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function applicationsPage(rows, timeline = []) {
  const byApp = new Map();
  for (const e of timeline) if (e.queue_id != null) byApp.set(Number(e.queue_id), [...(byApp.get(Number(e.queue_id)) || []), e]);
  const loose = timeline.filter((e) => e.queue_id == null);
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
    const thread = byApp.get(Number(r.id)) || [];
    const note = [thread.length ? '' : det.lastEmail ? EMAIL[det.lastEmail] : '', r.reason && !['submitted'].includes(r.status) ? r.reason : '',
      r.status === 'submitted' && det.evidence?.text ? `Site said: “${det.evidence.text}”` : '']
      .filter(Boolean).map(esc).join('<br>') + thread.map(threadLine).join('');
    return `<tr>
      <td><a href="${esc(r.final_url || r.apply_url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a><div class="sub">${esc(r.company)}</div></td>
      <td>${esc(place) || '—'}</td>
      <td>${r.score != null ? `${Math.round(r.score)}%` : '—'}</td>
      <td>${how}</td>
      <td><span class="tag ${cls}">${esc(label)}</span>${r.attempts > 1 ? `<div class="sub">${r.attempts} attempts</div>` : ''}</td>
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
  <div class="card" style="padding:0;overflow-x:auto">
    <table class="apps">
      <thead><tr><th>Job</th><th>Location</th><th>Match</th><th>How it applies</th><th>Status</th><th>Details</th><th>CV sent</th><th>Updated</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  ${loose.length ? `<div class="card" style="margin-top:16px"><h3 style="margin:0 0 8px">Recruiter emails not tied to an application</h3>${loose.map((e) =>
    `${e.dir === 'in' ? `<div class="sub" style="margin-top:8px"><b>${esc(e.company || '')}</b></div>` : ''}${threadLine(e)}`).join('')}</div>` : ''}
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
  .mail { font-size:.74rem; margin-top:4px; color:#475467; } .mail.out { color:#15803d; }
  .dl { font-size:.78rem; font-weight:600; white-space:nowrap; }
</style>`,
  });
}
