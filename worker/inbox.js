// Job-hunt inbox: read new mail (read-only, never marks anything read),
// classify job emails, alert the user on Telegram with a drafted reply, and
// send replies only after the user taps "Send" there.
import { createRequire } from 'node:module';
import { insertInboxEvent, applicationsForMatching, updateQueueItem, repliesToSend, setReplyStatus, saveProfileRow } from '../src/db.js';
import { decrypt } from '../src/lib/secrets.js';
import { loadProfileAsync } from '../src/lib/profile.js';
import { looksJobRelated, matchApplication, classifyEmail } from '../src/lib/mail-classify.js';
import { telegramConfigured, send, h } from '../src/lib/telegram.js';

const require = createRequire(import.meta.url);
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const FIRST_RUN_DAYS = 14;
const MAX_PER_CHECK = 40;
const LABEL = {
  interview: '📅 Interview invite', assessment: '📝 Assessment', info_request: '📎 They need something from you',
  offer: '🎉 Offer', rejection: '📭 Not moving forward', received: '📨 Application received', other: '✉️ Job email',
};

async function saveMailbox(userId, patch) {
  const p = await loadProfileAsync(userId);
  const next = { ...p, mailbox: { ...(p.mailbox || {}), ...patch }, userId };
  delete next._source; delete next._updatedAt;
  await saveProfileRow(next, userId);
}

const tell = (p, html, opts) => (telegramConfigured() && p.telegram?.chatId ? send(p.telegram.chatId, html, opts) : null);

/** Fetch new messages. `fetcher` can be swapped in tests. */
export async function fetchNewMail(mb) {
  const client = new ImapFlow({
    host: mb.host || 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: mb.email, pass: decrypt(mb.passEnc) },
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  const out = [];
  let maxUid = mb.lastUid || 0;
  try {
    let uids;
    if (mb.lastUid) uids = (await client.search({ uid: `${mb.lastUid + 1}:*` }, { uid: true })).filter((u) => u > mb.lastUid);
    else uids = await client.search({ since: new Date(Date.now() - FIRST_RUN_DAYS * 86400000) }, { uid: true });
    uids = (uids || []).sort((a, b) => a - b).slice(-MAX_PER_CHECK);
    if (uids.length) {
      for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
        const m = await simpleParser(msg.source);
        out.push({
          uid: msg.uid, from: m.from?.text || '', fromAddr: m.from?.value?.[0]?.address || '',
          subject: m.subject || '', text: (m.text || '').slice(0, 8000), messageId: m.messageId || null,
          date: m.date ? m.date.toISOString() : null,
        });
        maxUid = Math.max(maxUid, msg.uid);
      }
    }
    if (!uids.length && !mb.lastUid) maxUid = (client.mailbox.uidNext || 1) - 1; // empty inbox: start from here
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return { messages: out, maxUid };
}

/**
 * Check one user's inbox. Returns a short summary for the log.
 * @param {object} opts.fetcher  replaces fetchNewMail (tests)
 */
export async function checkInbox(userId, { fetcher = fetchNewMail } = {}) {
  const profile = await loadProfileAsync(userId);
  const mb = profile.mailbox;
  if (!mb?.email || !mb.passEnc) return 'no mailbox';

  let result;
  try {
    result = await fetcher(mb);
  } catch (err) {
    const msg = /auth|credential|invalid|password/i.test(err.message) ? 'Gmail rejected the app password' : err.message;
    if (mb.status !== 'error') {
      await tell(profile, `⚠️ I couldn't open your job-hunt inbox (${h(mb.email)}): ${h(msg)}.\nCheck the app password in JobVibe → <b>Application Answers</b>.`);
    }
    await saveMailbox(userId, { status: 'error', error: msg, lastCheck: new Date().toISOString() });
    return `error: ${msg}`;
  }
  if (mb.status !== 'ok') await tell(profile, `📬 Your job-hunt inbox <b>${h(mb.email)}</b> is connected. I'll watch it for replies from employers.`);

  const apps = await applicationsForMatching(userId);
  let found = 0;
  for (const mail of result.messages) {
    if (mail.fromAddr && mail.fromAddr.toLowerCase() === mb.email.toLowerCase()) continue; // our own sent mail
    if (!looksJobRelated(mail, apps)) continue;
    const app = matchApplication(mail, apps);
    const c = await classifyEmail(mail, { profile, application: app });
    if (!c.ok) continue;
    const id = await insertInboxEvent({
      user_id: userId, uid: mail.uid, queue_id: app?.id ?? null, company: c.company, from_addr: mail.fromAddr || mail.from,
      subject: mail.subject, category: c.category, summary: c.summary, draft_reply: c.draftReply, message_id: mail.messageId,
      received_at: mail.date,
    });
    if (!id) continue; // seen before
    found++;
    if (app) {
      // A routine "received" or unrelated email never hides an interview, offer, etc.
      const detail = JSON.parse(app.detail || '{}');
      const minor = ['received', 'other'];
      if (!(minor.includes(c.category) && detail.lastEmail && !minor.includes(detail.lastEmail))) {
        await updateQueueItem(app.id, { status: app.status, reason: null, detail: JSON.stringify({ ...detail, lastEmail: c.category }) });
        app.detail = JSON.stringify({ ...detail, lastEmail: c.category }); // later mails in this batch see it
      }
    }
    if (c.category === 'received' || c.category === 'other') continue; // no need to ping for these

    const head = `<b>${LABEL[c.category]}</b>: ${h(c.company || mail.from)}${app ? ` · ${h(app.title)}` : ''}\n${h(c.summary)}`;
    if (c.draftReply) {
      await tell(profile, `${head}\n\n<b>Draft reply</b> (to ${h(mail.fromAddr || mail.from)}):\n<i>${h(c.draftReply)}</i>`, {
        buttons: [[{ text: '✉️ Send this reply', callback_data: `rs:${id}` }, { text: '✋ I\'ll handle it', callback_data: `rd:${id}` }]],
      });
    } else {
      await tell(profile, `${head}${c.needs ? `\n\n<b>They need:</b> ${h(c.needs)}\nReply to them from your Gmail.` : ''}`);
    }
  }
  await saveMailbox(userId, { status: 'ok', error: null, lastUid: result.maxUid, lastCheck: new Date().toISOString() });
  return `${result.messages.length} new, ${found} job email(s)`;
}

/** Send replies the user approved on Telegram. */
export async function sendApprovedReplies() {
  let sent = 0;
  for (const ev of await repliesToSend()) {
    const profile = await loadProfileAsync(ev.user_id);
    const mb = profile.mailbox;
    if (!mb?.email || !mb.passEnc) { await setReplyStatus(ev.id, ev.user_id, 'failed'); continue; }
    const transport = process.env.MAIL_TRANSPORT_JSON === '1'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: mb.email, pass: decrypt(mb.passEnc) } });
    try {
      const info = await transport.sendMail({
        from: `${profile.name || ''} <${mb.email}>`, to: ev.from_addr,
        subject: /^re:/i.test(ev.subject || '') ? ev.subject : `Re: ${ev.subject || ''}`,
        text: ev.draft_reply,
        ...(ev.message_id ? { inReplyTo: ev.message_id, references: ev.message_id } : {}),
      });
      if (process.env.MAIL_TRANSPORT_JSON === '1') console.log(`[test transport] ${info.message}`);
      await setReplyStatus(ev.id, ev.user_id, 'sent');
      await tell(profile, `✉️ Reply sent to ${h(ev.from_addr)} (${h(ev.company || ev.subject || '')}).`);
      sent++;
    } catch (err) {
      await setReplyStatus(ev.id, ev.user_id, 'failed');
      await tell(profile, `⚠️ I couldn't send your reply to ${h(ev.from_addr)}: ${h(err.message)}. Please reply from Gmail.`);
    }
  }
  return sent;
}
