// Security codes some application forms email the applicant after Submit
// ("Copy and paste this code into the security code field on your application").
// The user connected this mailbox for the agent; it is read here read-only and
// nothing is marked read. Codes are never logged.
import { createRequire } from 'node:module';
import { decrypt } from '../src/lib/secrets.js';

const require = createRequire(import.meta.url);
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const SUBJECT = /(security|verification) code|code for your application/i;
const text = (m) => `${m.text || ''} ${String(m.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')}`.replace(/\s+/g, ' ');

/** The code in a code email, or null. */
export function codeIn(body) {
  const m = body.match(/code[^:.]{0,80}:\s*([A-Za-z0-9]{6,12})\b/i) || body.match(/\b(?:code|passcode) (?:is|=)\s*([A-Za-z0-9]{6,12})\b/i);
  return m ? m[1] : null;
}

async function lookOnce(mb, { since, company }) {
  const client = new ImapFlow({
    host: mb.host || 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: mb.email, pass: decrypt(mb.passEnc) },
  });
  client.on('error', () => {}); // a dropped socket must not crash the worker
  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  try {
    // IMAP "since" is by day; the exact time is checked below.
    const uids = (await client.search({ since: new Date(since.getTime() - 86400000) }, { uid: true })) || [];
    const recent = uids.sort((a, b) => b - a).slice(0, 15);
    if (!recent.length) return null;
    for await (const msg of client.fetch(recent, { uid: true, source: true }, { uid: true })) {
      const m = await simpleParser(msg.source);
      if (!m.date || m.date.getTime() < since.getTime() - 60000) continue; // only mail sent after this submit
      if (!SUBJECT.test(m.subject || '')) continue;
      if (company && !new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/)[0], 'i').test(`${m.subject} ${text(m)}`)) continue;
      const code = codeIn(text(m));
      if (code) return code;
    }
    return null;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

/**
 * Wait for an account-verification email sent after `since` and return its link on `host`
 * (e.g. "hitachi.wd1.myworkdayjobs.com"), or null on timeout. Read-only, nothing marked read.
 */
export async function waitForVerifyLink(mb, { since, host, timeoutMs = 180000 }) {
  if (!mb?.passEnc) return null;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const link = await lookForLink(mb, { since, host });
      if (link) return link;
    } catch (err) {
      console.log(`verify mail check: ${err.code || err.message}`);
    }
  }
  return null;
}

async function lookForLink(mb, { since, host }) {
  const client = new ImapFlow({
    host: mb.host || 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: mb.email, pass: decrypt(mb.passEnc) },
  });
  client.on('error', () => {});
  await client.connect();
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  try {
    const uids = (await client.search({ since: new Date(since.getTime() - 86400000) }, { uid: true })) || [];
    const recent = uids.sort((a, b) => b - a).slice(0, 15);
    if (!recent.length) return null;
    for await (const msg of client.fetch(recent, { uid: true, source: true }, { uid: true })) {
      const m = await simpleParser(msg.source);
      if (!m.date || m.date.getTime() < since.getTime() - 60000) continue;
      if (!/verif|activat|confirm/i.test(m.subject || '')) continue;
      const links = [...String(m.html || m.text || '').matchAll(/https:\/\/[^\s"'<>]+/g)].map((x) => x[0].replace(/&amp;/g, '&'));
      const link = links.find((u) => { try { return new URL(u).hostname === host && /verif|activat|confirm|token/i.test(u); } catch { return false; } });
      if (link) return link;
    }
    return null;
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

/** Wait for the code email sent after `since` (a Date). Returns the code or null on timeout. */
export async function waitForEmailCode(mb, { since, company, timeoutMs = 120000 }) {
  if (!mb?.passEnc) return null;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const code = await lookOnce(mb, { since, company });
      if (code) return code;
    } catch (err) {
      console.log(`code mail check: ${err.code || err.message}`);
    }
  }
  return null;
}
