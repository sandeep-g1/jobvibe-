// Daily applications report: one email per user who has applications in the last
// 30 days, with the admin in CC. What the agent applied to (with the site's
// confirmation), what needs the user, what is in progress, closed or ruled out,
// and job emails from employers in the last day.
//
// Sent by the daily cron (/api/cron) and by `node src/tools/app-report.js`.
import { db } from './db/driver.js';
import { sendEmail, emailConfigured } from './email.js';
import { loadProfileAsync } from './lib/profile.js';

export const REPORT_CC = (process.env.REPORT_CC || 'virtualgen360@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
const SITE = () => (process.env.SITE_URL || 'https://jobvibe.evergreenskill.com').replace(/\/+$/, '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Status → section and plain words. Order of sections is the order in the email.
const SECTIONS = [
  { key: 'you', title: '👉 Needs you', statuses: ['needs_user', 'captcha', 'email_code', 'manual', 'blocked'] },
  { key: 'applied', title: '✅ Applied', statuses: ['submitted'] },
  { key: 'progress', title: '⏳ In progress', statuses: ['queued', 'running', 'dry_run', 'waiting', 'unconfirmed'] },
  { key: 'done', title: '— Closed or not going ahead', statuses: ['closed', 'ineligible', 'already_applied', 'failed', 'skipped', 'held'] },
];
const WORDS = {
  needs_user: 'Waiting for your answer in Telegram', captcha: 'Finish it yourself (human check)', email_code: 'Needs the email code: not sent yet',
  manual: 'Apply yourself', blocked: 'Waiting on your application answers', submitted: 'Applied', queued: 'Queued',
  running: 'Applying now', dry_run: 'Filled and checked, ready to send', waiting: 'Will apply automatically soon',
  unconfirmed: 'Sent, waiting for the employer to confirm', closed: 'The employer closed this job', ineligible: 'Not eligible (your answers rule it out)',
  already_applied: 'Already applied', failed: 'Could not apply', skipped: 'Skipped', held: 'On hold',
};
const EMAIL_WORDS = { interview: '📅 Interview', assessment: '📝 Assessment', offer: '🎉 Offer', info_request: '📎 They need something', rejection: 'Not selected', received: 'Application received' };

/** Users with any application activity in the last `days` days. */
async function activeUsers(days = 30) {
  const d = await db();
  return (await d.query(`SELECT DISTINCT q.user_id, u.email FROM apply_queue q JOIN users u ON u.id = q.user_id WHERE q.updated_at > ?`,
    [new Date(Date.now() - days * 86400000).toISOString()]));
}

async function rowsFor(userId) {
  const d = await db();
  return d.query(
    `SELECT q.id, q.status, q.reason, q.detail, q.updated_at, j.title, j.company, j.city, j.apply_url, j.final_url
       FROM apply_queue q JOIN job_matches m ON m.id = q.match_id JOIN jobs j ON j.id = m.job_id
      WHERE q.user_id = ? AND q.updated_at > ? ORDER BY q.updated_at DESC`,
    [userId, new Date(Date.now() - 30 * 86400000).toISOString()]);
}

async function emailsFor(userId) {
  const d = await db();
  return d.query(`SELECT company, from_addr, subject, category, summary, created_at FROM inbox_events
    WHERE user_id = ? AND created_at > ? AND category NOT IN ('other') ORDER BY created_at DESC`,
  [userId, new Date(Date.now() - 26 * 3600000).toISOString()]);
}

/** The reason in words for the user: no stack traces, page dumps or internal notes. */
function friendly(r) {
  const why = String(r.reason || '');
  if (r.status === 'failed') {
    if (/workday/i.test(why)) return 'The Workday account step did not go through; the agent will try again.';
    return why.length < 90 && !/locator|timeout|page said|\berror\b/i.test(why) ? why : 'The agent could not complete this form; it will be looked at.';
  }
  if (r.status === 'manual') {
    const m = why.match(/no application form the agent can fill \((\w+)\)/);
    if (m) return `Listed on ${m[1][0].toUpperCase()}${m[1].slice(1)}; the agent can't reach the employer's form.`;
  }
  if (r.status === 'closed') return '';
  const text = why.replace(/^held:\s*/i, '').slice(0, 200);
  // A note that only repeats the status ("the employer has closed this job") adds nothing.
  return WORDS[r.status] && text.toLowerCase().includes(WORDS[r.status].toLowerCase().replace(/^the /, '')) ? '' : text;
}
const appliedByUser = (r) => r.status === 'manual' && /applied (herself|himself|themselves|yourself)/i.test(r.reason || '');

/** Build one user's report. Returns null when there is nothing to report. */
export function buildAppReport({ name, rows: all, emails }) {
  if (!all.length && !emails.length) return null;
  // Jobs the user applied to herself count as applied, not as "apply yourself".
  const rows = all.map((r) => (appliedByUser(r) ? { ...r, status: 'submitted', reason: 'You applied yourself.', byUser: true } : r));
  const count = (key) => rows.filter((r) => SECTIONS.find((s) => s.key === key).statuses.includes(r.status)).length;
  const applied = count('applied'), you = count('you'), progress = count('progress');
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const subject = `JobVibe ${today}: ${applied} applied${you ? ` · ${you} need${you === 1 ? 's' : ''} you` : ''}${progress ? ` · ${progress} in progress` : ''}`;

  const line = (r) => {
    let det = {}; try { det = JSON.parse(r.detail || '{}'); } catch { /* none */ }
    const link = r.final_url || r.apply_url;
    const note = r.status === 'submitted' && det.evidence
      ? (det.evidence.text ? `Site said: “${det.evidence.text}”` : det.evidence.email ? `Their email: “${det.evidence.email}”` : '')
      : r.byUser ? 'You applied yourself.' : friendly(r);
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee"><a href="${esc(link)}" style="color:#0a66c2;text-decoration:none"><b>${esc(r.title)}</b></a><br><span style="color:#667085;font-size:12px">${esc(r.company)}${r.city ? ` · ${esc(r.city.replace(/\b\w/g, (c) => c.toUpperCase()))}` : ''}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(WORDS[r.status] || r.status)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#475467;font-size:12px">${esc(String(note).slice(0, 220))}</td></tr>`;
  };
  const sections = SECTIONS.map((s) => {
    const list = rows.filter((r) => s.statuses.includes(r.status));
    if (!list.length) return '';
    return `<h3 style="margin:22px 0 6px;font-size:15px">${s.title} (${list.length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">${list.map(line).join('')}</table>`;
  }).join('');
  const mail = emails.length ? `<h3 style="margin:22px 0 6px;font-size:15px">✉️ Employer emails (last 24 hours)</h3><ul style="padding-left:18px;font-size:13px">${emails.map((e) =>
    `<li><b>${esc(EMAIL_WORDS[e.category] || e.category)}</b>: ${esc(e.company || e.from_addr)}: “${esc(e.subject)}”<br><span style="color:#475467">${esc(e.summary || '')}</span></li>`).join('')}</ul>` : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;color:#101828">
    <h2 style="margin:0 0 4px">Your applications · ${esc(today)}</h2>
    <p style="margin:0;color:#475467">Hi ${esc((name || '').split(' ')[0] || 'there')}, here is where every job you approved stands.</p>
    ${sections}${mail}
    <p style="margin-top:24px;font-size:12px;color:#667085">Approve jobs in Telegram; the agent applies with a CV tailored to each one. Full list: <a href="${SITE()}/applications">${SITE()}/applications</a></p></div>`;
  return { subject, html };
}

/** Send every active user their report, admin in CC. Returns a summary. */
export async function sendAppReports({ only = null, dryRun = false } = {}) {
  if (!emailConfigured() && !dryRun) return { sent: 0, reason: 'RESEND_API_KEY is not set' };
  const out = { sent: 0, skipped: 0, errors: [] , previews: [] };
  for (const u of await activeUsers()) {
    if (only && u.user_id !== only) continue;
    const profile = await loadProfileAsync(u.user_id);
    const to = (profile.emailTo || [])[0] || u.email;
    const report = buildAppReport({ name: profile.name, rows: await rowsFor(u.user_id), emails: await emailsFor(u.user_id) });
    if (!report || !to) { out.skipped++; continue; }
    if (dryRun) { out.previews.push({ to, cc: REPORT_CC, ...report }); continue; }
    const r = await sendEmail({ to, cc: REPORT_CC.filter((c) => c.toLowerCase() !== to.toLowerCase()), subject: report.subject, html: report.html });
    if (r.sent) out.sent++; else out.errors.push(`${to}: ${r.reason}`);
  }
  return out;
}
