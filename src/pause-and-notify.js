// Pause the daily service for everyone, and invite each user to opt back in.
//
//   node src/pause-and-notify.js                 dry run: list recipients, write a preview
//   node src/pause-and-notify.js --pause         schedule OFF for every profile + opt-in tokens
//   node src/pause-and-notify.js --pause --send  ...and email each user their opt-in link
//
// The opt-in link is /resume-service?t=<token>; confirming it turns that user's
// daily schedule and email back on (see serve.js).
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { initDB, closeDB, allProfiles, saveProfileRow } from './db.js';
import { db } from './db/driver.js';
import { loadSecretsIntoEnv } from './lib/secrets.js';
import { sendEmail, emailConfigured } from './email.js';

const SITE = process.env.SITE_URL || 'https://jobvibe.evergreenskill.com';
const argv = process.argv.slice(2);
const PAUSE = argv.includes('--pause');
const SEND = argv.includes('--send');
// Weekly follow-up: only people still opted out, and never more than
// MAX_NOTICES emails in total (the first notice counts as one).
const REMINDER = argv.includes('--reminder');
const MAX_NOTICES = 4;
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ''));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SUBJECT = 'Your JobVibe daily job search is paused. Want it back?';
const REMINDER_SUBJECT = 'Reminder: your JobVibe daily job search is still paused';

export function noticeHtml(name, link) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f2f5">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:28px 12px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e">
<tr><td style="background:#0a66c2;border-radius:12px 12px 0 0;padding:22px 30px;color:#ffffff;font-size:20px;font-weight:800">JobVibe</td></tr>
<tr><td style="padding:28px 30px 8px;font-size:15px;line-height:1.65">
<p style="margin:0 0 14px">Hi ${esc(name || 'there')},</p>
<p style="margin:0 0 14px">We've <b>paused</b> JobVibe's daily India job shortlist because it hasn't been used for a while.
From today, no more daily searches or report emails will be sent.</p>
<p style="margin:0 0 22px">If you'd like the job search service again, click the button below and confirm.
Your daily shortlist restarts from the next 08:00 IST run. Your profile, CV and past reports are all kept.</p>
</td></tr>
<tr><td align="center" style="padding:0 30px 26px">
<a href="${esc(link)}" style="display:inline-block;background:#0a66c2;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:8px">Yes, I want my daily job search back</a>
</td></tr>
<tr><td style="padding:0 30px 26px;font-size:13px;line-height:1.6;color:#667085">
If you don't need it, there's nothing to do and you won't get more reports.<br>
Button not working? Paste this link into your browser:<br>
<a href="${esc(link)}" style="color:#0a66c2;word-break:break-all">${esc(link)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function main() {
  await initDB();
  await loadSecretsIntoEnv();
  const d = await db();

  const users = await d.query('SELECT id, email, display_name FROM users ORDER BY created_at');
  const profiles = new Map((await allProfiles()).map((p) => [p.userId, p.data]));

  // 1. Pause everyone (including the legacy "local" profile) and mint opt-in tokens.
  if (PAUSE) {
    for (const [userId, p] of profiles) {
      if (!p) continue;
      const next = { ...p, scheduleActive: false, userId };
      if (!next.optinToken) next.optinToken = randomBytes(24).toString('hex');
      delete next._source; delete next._updatedAt;
      await saveProfileRow(next, userId);
      profiles.set(userId, next);
    }
    console.log(`\n  paused ${profiles.size} profile(s): daily schedule OFF for all`);
  }

  // 2. Recipients: every account with a real email address.
  const recipients = users
    .filter((u) => validEmail(u.email))
    .map((u) => {
      const p = profiles.get(u.id) || {};
      return { id: u.id, email: u.email, name: p.name || u.display_name || '', token: p.optinToken,
        active: p.scheduleActive === true, sent: p.optinSentCount || 0 };
    })
    .filter((r) => !REMINDER || (!r.active && r.sent < MAX_NOTICES));

  console.log(`\n  ${recipients.length} recipient(s):`);
  for (const r of recipients) console.log(`   - ${r.email}${r.name ? ` (${r.name})` : ''}${r.token ? '' : '  [no token yet: run with --pause]'}`);

  const sample = recipients[0];
  if (sample) {
    const out = process.env.PREVIEW_OUT || 'notice-preview.html';
    writeFileSync(out, noticeHtml(sample.name, `${SITE}/resume-service?t=${sample.token || 'TOKEN'}`));
    console.log(`\n  preview written: ${out}`);
  }

  if (!SEND) {
    console.log('\n  dry run: no email sent (add --send to send)\n');
    await closeDB();
    return;
  }
  if (!emailConfigured()) throw new Error('RESEND_API_KEY is not set');

  let ok = 0;
  for (const r of recipients) {
    if (!r.token) { console.log(`   ✗ ${r.email}: no token (run with --pause first)`); continue; }
    const res = await sendEmail({
      to: [r.email],
      subject: REMINDER ? REMINDER_SUBJECT : SUBJECT,
      html: noticeHtml(r.name, `${SITE}/resume-service?t=${r.token}`),
    });
    console.log(res.sent ? `   ✓ ${r.email}` : `   ✗ ${r.email}: ${res.reason}`);
    if (res.sent) {
      ok++;
      const p = profiles.get(r.id);
      if (p) {
        const next = { ...p, optinSentCount: (p.optinSentCount || 0) + 1,
          optinLastSent: new Date().toISOString(), userId: r.id };
        delete next._source; delete next._updatedAt;
        await saveProfileRow(next, r.id);
      }
    }
    await new Promise((s) => setTimeout(s, 600)); // stay under Resend's rate limit
  }
  console.log(`\n  sent ${ok}/${recipients.length}\n`);
  await closeDB();
}

main().catch((e) => { console.error('\nfailed:', e.message); process.exit(1); });
