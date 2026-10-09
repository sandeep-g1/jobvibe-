// Job-hunt inbox: read new mail (read-only, never marks anything read),
// classify job emails, alert the user on Telegram with a drafted reply, and
// send replies only after the user taps "Send" there.
import { createRequire } from 'node:module';
import { insertInboxEvent, applicationsForMatching, updateQueueItem, repliesToSend, setReplyStatus, saveProfileRow, markApplied,
  approveAutoReply, queueCv, defaultResume } from '../src/db.js';
import { replyPolicy, attachCv } from '../src/lib/reply-policy.js';
import { decrypt } from '../src/lib/secrets.js';
import { loadProfileAsync } from '../src/lib/profile.js';
import { looksJobRelated, matchApplication, classifyEmail } from '../src/lib/mail-classify.js';
import { telegramConfigured, send, h } from '../src/lib/telegram.js';
import { alertPortal, alertRows } from '../src/lib/job-alerts.js';
import { persistRows } from '../src/ingest.js';
import { userScope } from '../src/lib/geo.js';

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
  // A socket error after a failed or finished session must not crash the worker:
  // without a listener, Node treats the emitted 'error' as fatal.
  client.on('error', (err) => console.log(`imap ${mb.email}: ${err.code || err.message}`));
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
          subject: m.subject || '',
          // HTML-only emails (most job alerts) have no text part: use the HTML's text.
          text: (m.text || String(m.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#8203;|&emsp;/g, ' ').replace(/\s+/g, ' ')).slice(0, 8000),
          // Link text → address, for job alerts (the jobs are links).
          links: [...String(m.html || '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
            .map((x) => ({ href: x[1].replace(/&amp;/g, '&'), text: x[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim() }))
            .filter((l) => l.text && /^https?:/i.test(l.href)).slice(0, 80),
          messageId: m.messageId || null,
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
  const alerts = [];
  for (const mail of result.messages) {
    if (mail.fromAddr && mail.fromAddr.toLowerCase() === mb.email.toLowerCase()) continue; // our own sent mail
    // Job alerts from Naukri, LinkedIn, Indeed… (direct or forwarded): jobs for the pool, not messages.
    const portal = alertPortal(mail);
    if (portal) { alerts.push({ mail, portal }); continue; }
    if (!looksJobRelated(mail, apps)) continue;
    const app = matchApplication(mail, apps);
    const c = await classifyEmail(mail, { profile, application: app });
    if (!c.ok) continue;
    const id = await insertInboxEvent({
      user_id: userId, uid: mail.uid, queue_id: app?.id ?? null, company: c.company, from_addr: mail.fromAddr || mail.from,
      subject: mail.subject, category: c.category, summary: c.summary, draft_reply: c.draftReply, message_id: mail.messageId,
      received_at: mail.date, asks: c.asks, attach_cv: c.draftReply && attachCv(c),
    });
    if (!id) continue; // seen before
    found++;
    if ((app?.status === 'unconfirmed' || app?.status === 'captcha') && c.category !== 'other') {
      // (A CAPTCHA after Submit doesn't always stop the application: the employer's email decides.)
      // The site showed no confirmation, but the employer's own email proves it arrived.
      const detail = { ...JSON.parse(app.detail || '{}'), evidence: { email: mail.subject, from: mail.fromAddr || mail.from, at: mail.date } };
      await updateQueueItem(app.id, { status: 'submitted', reason: null, detail: JSON.stringify(detail) });
      await markApplied(app.fingerprint, userId);
      app.status = 'submitted'; app.detail = JSON.stringify(detail);
      await tell(profile, `✅ <b>Confirmed: ${h(app.company)} received your application</b> · ${h(app.title)}\nTheir email: "${h(mail.subject)}"`);
    }
    if (app) {
      // A routine "received" or unrelated email never hides an interview, offer, etc.
      const detail = JSON.parse(app.detail || '{}');
      const minor = ['received', 'other'];
      if (!(minor.includes(c.category) && detail.lastEmail && !minor.includes(detail.lastEmail))) {
        await updateQueueItem(app.id, { status: app.status, reason: null, detail: JSON.stringify({ ...detail, lastEmail: c.category }) });
        app.detail = JSON.stringify({ ...detail, lastEmail: c.category }); // later mails in this batch see it
      }
    }
    // No need to ping for these (a recruiter writing personally does get a draft, below).
    if (c.category === 'received' || (c.category === 'other' && !c.draftReply)) continue;

    const head = `<b>${LABEL[c.category]}</b>: ${h(c.company || mail.from)}${app ? ` · ${h(app.title)}` : ''}\n${h(c.summary)}`;
    const policy = replyPolicy(c, { app, fromAddr: mail.fromAddr, profile });
    const cv = c.draftReply && attachCv(c) ? '\n📎 Your CV goes with it.' : '';
    if (policy.mode === 'auto') {
      // Routine answer to a verified recruiter: goes out on the next tick, no tap needed.
      await approveAutoReply(id);
      await tell(profile, `${head}\n\n🤖 <b>Replying for you</b> (to ${h(mail.fromAddr)}):\n<i>${h(c.draftReply)}</i>${cv}`);
    } else if (policy.mode === 'confirm') {
      // Why it waits for her, beyond the switch being off (that one is the same every time).
      const why = policy.why.filter((w) => w !== 'automatic replies are off');
      await tell(profile, `${head}\n\n<b>Draft reply</b> (to ${h(mail.fromAddr || mail.from)}):\n<i>${h(c.draftReply)}</i>${cv}${why.length ? `\n\n<i>Needs your OK: ${h(why.join('; '))}.</i>` : ''}`, {
        buttons: [[{ text: '✉️ Send this reply', callback_data: `rs:${id}` }, { text: '✋ I\'ll handle it', callback_data: `rd:${id}` }]],
      });
    } else if (c.draftReply) {
      await tell(profile, `${head}\n\nIt came from an address that doesn't take replies, so I haven't drafted one.`);
    } else {
      await tell(profile, `${head}${c.needs ? `\n\n<b>They need:</b> ${h(c.needs)}\nReply to them from your Gmail.` : ''}`);
    }
  }
  await saveMailbox(userId, { status: 'ok', error: null, lastUid: result.maxUid, lastCheck: new Date().toISOString() });
  let alertNote = '';
  if (alerts.length) {
    const rows = [];
    for (const { mail, portal } of alerts) rows.push(...await alertRows(mail, portal).catch(() => []));
    const { newJobs } = rows.length ? await persistRows(rows, userScope(profile).crawl) : { newJobs: 0 };
    alertNote = `, ${alerts.length} job alert(s): ${rows.length} jobs (${rows.filter((r) => r.employerForm).length} on the employer's own form), ${newJobs} new`;
  }
  return `${result.messages.length} new, ${found} job email(s)${alertNote}`;
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
    // The CV she applied with (the one tailored for that job), else her main resume.
    let attachments = [];
    if (ev.attach_cv) {
      const q = ev.queue_id ? await queueCv(ev.queue_id, ev.user_id) : null;
      const r = q?.cv_b64 ? null : await defaultResume(ev.user_id);
      const file = q?.cv_b64 ? { filename: q.cv_name, content: q.cv_b64 } : r?.content_b64 ? { filename: r.filename, content: r.content_b64 } : null;
      if (!file) {
        // The draft says the CV is attached: never send it without one.
        await setReplyStatus(ev.id, ev.user_id, 'failed');
        await tell(profile, `⚠️ The reply to ${h(ev.from_addr)} needs your CV attached and I couldn't find one. Upload it in JobVibe or reply from Gmail.`);
        continue;
      }
      // Employers see "<Name>_CV.docx", as on application forms (her copy is named by company).
      const ext = String(file.filename || '').match(/\.(\w+)$/)?.[1] || 'docx';
      const who = String(profile.name || 'Resume').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      attachments = [{ filename: `${who}_CV.${ext}`, content: Buffer.from(file.content, 'base64') }];
    }
    try {
      const info = await transport.sendMail({
        from: `${profile.name || ''} <${mb.email}>`, to: ev.from_addr,
        subject: /^re:/i.test(ev.subject || '') ? ev.subject : `Re: ${ev.subject || ''}`,
        text: ev.draft_reply, attachments,
        ...(ev.message_id ? { inReplyTo: ev.message_id, references: ev.message_id } : {}),
      });
      if (process.env.MAIL_TRANSPORT_JSON === '1') console.log(`[test transport] ${info.message}`);
      await setReplyStatus(ev.id, ev.user_id, 'sent');
      await tell(profile, `✉️ Reply sent to ${h(ev.from_addr)} (${h(ev.company || ev.subject || '')})${attachments.length ? `, with ${h(attachments[0].filename)}` : ''}${ev.auto_reply ? ' · automatic' : ''}.`);
      sent++;
    } catch (err) {
      await setReplyStatus(ev.id, ev.user_id, 'failed');
      await tell(profile, `⚠️ I couldn't send your reply to ${h(ev.from_addr)}: ${h(err.message)}. Please reply from Gmail.`);
    }
  }
  return sent;
}
