// Follow-ups: when she replied to a recruiter and the thread went quiet for 5 days, a short
// polite follow-up in the same thread; at most two per thread (about day 5 and day 10).
// Automatic when profile.autoReply is on; otherwise drafted and sent to Telegram for one tap.
import { createRequire } from 'node:module';
import { quietThreads, insertFollowup, followupsToSend, setFollowupStatus } from '../src/db.js';
import { loadProfileAsync } from '../src/lib/profile.js';
import { decrypt } from '../src/lib/secrets.js';
import { NO_REPLY } from '../src/lib/reply-policy.js';
import { telegramConfigured, send, h } from '../src/lib/telegram.js';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

const QUIET_DAYS = 5;
const MAX_PER_THREAD = 2;

/** The follow-up text: plain, short, in her voice. No new claims, no pressure. */
export function followupText({ name, company, title, n }) {
  const role = title ? `the ${title} role${company ? ` at ${company}` : ''}` : company ? `the role at ${company}` : 'my application';
  const first = String(name || '').trim();
  return n === 1
    ? `Hello,\n\nI wanted to follow up on my previous email about ${role}. I'm still very interested and happy to share anything else you need.\n\nBest regards,\n${first}`
    : `Hello,\n\nFollowing up once more on ${role}. If the position has been filled or the timing has changed, I'd appreciate a short note either way. Thank you for your time.\n\nBest regards,\n${first}`;
}

const tell = (p, html, opts) => (telegramConfigured() && p.telegram?.chatId ? send(p.telegram.chatId, html, opts) : null);

/** Write follow-ups for one user's quiet threads. Returns how many were written. */
export async function planFollowups(userId) {
  const profile = await loadProfileAsync(userId);
  if (!profile.mailbox?.passEnc) return 0;
  let made = 0;
  for (const e of await quietThreads(userId, QUIET_DAYS)) {
    if (e.followupsSent >= MAX_PER_THREAD || NO_REPLY.test(e.from_addr || '')) continue;
    const n = e.followupsSent + 1;
    const title = (e.subject || '').replace(/^(re|fw|fwd):\s*/i, '');
    const body = followupText({ name: profile.name, company: e.company, title: e.job_title || null, n });
    const auto = !!profile.autoReply;
    const id = await insertFollowup({ user_id: userId, event_id: e.id, queue_id: e.queue_id, to_addr: e.from_addr,
      subject: /^re:/i.test(e.subject || '') ? e.subject : `Re: ${e.subject || ''}`, in_reply_to: e.message_id, body, n, auto, status: auto ? 'approved' : 'drafted' });
    made++;
    if (!auto) {
      await tell(profile, `⏰ <b>No reply from ${h(e.company || e.from_addr)} for ${QUIET_DAYS} days</b> (${h(title)}).\nFollow-up ${n} of ${MAX_PER_THREAD}, ready to send to ${h(e.from_addr)}:\n<i>${h(body)}</i>`,
        { buttons: [[{ text: '✉️ Send follow-up', callback_data: `fs:${id}` }, { text: '✋ Skip', callback_data: `fd:${id}` }]] });
    }
  }
  return made;
}

/** Send approved follow-ups (threaded). Returns how many went out. */
export async function sendFollowups() {
  let sent = 0;
  for (const f of await followupsToSend()) {
    const profile = await loadProfileAsync(f.user_id);
    const mb = profile.mailbox;
    if (!mb?.passEnc) { await setFollowupStatus(f.id, f.user_id, 'failed'); continue; }
    const transport = process.env.MAIL_TRANSPORT_JSON === '1'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: mb.email, pass: decrypt(mb.passEnc) } });
    try {
      const info = await transport.sendMail({ from: `${profile.name || ''} <${mb.email}>`, to: f.to_addr, subject: f.subject, text: f.body,
        ...(f.in_reply_to ? { inReplyTo: f.in_reply_to, references: f.in_reply_to } : {}) });
      if (process.env.MAIL_TRANSPORT_JSON === '1') console.log(`[test transport] ${info.message}`);
      await setFollowupStatus(f.id, f.user_id, 'sent');
      await tell(profile, `📨 Follow-up ${f.n} sent to ${h(f.to_addr)}${f.auto ? ' (automatic)' : ''}.`);
      sent++;
    } catch (err) {
      await setFollowupStatus(f.id, f.user_id, 'failed');
      await tell(profile, `⚠️ I couldn't send the follow-up to ${h(f.to_addr)}: ${h(err.message)}.`);
    }
  }
  return sent;
}
