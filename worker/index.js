// JobVibe worker: applies to jobs users approved in Telegram.
//
//   npm --prefix worker start            loop forever (checks every minute)
//   npm --prefix worker start -- --once  process what's queued, then exit
//   --dry-run   fill forms but never submit (testing)
//   --headed    show the browser window
//
// Also: reads each user's job-hunt inbox every 10 minutes (worker/inbox.js).
//
// Per approved job: still approved? answer bank complete? under the daily cap?
// supported form? → tailor the CV → fill → submit → Telegram receipt. Anything
// it can't do alone goes back to the user on Telegram.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initDB, enqueueApproved, nextQueued, updateQueueItem, submittedToday, defaultResume, markApplied, allProfiles, saveQueueCv,
  claimDestination, saveProfileRow,
} from '../src/db.js';
import { db } from '../src/db/driver.js';
import { loadSecretsIntoEnv, encrypt, decrypt } from '../src/lib/secrets.js';
import { loadProfileAsync } from '../src/lib/profile.js';
import { answerBankStatus } from '../src/lib/answers.js';
import { tailorResume } from '../src/lib/tailor.js';
import { extractText } from '../src/lib/resume.js';
import { telegramConfigured, send, sendFile, askUser, h } from '../src/lib/telegram.js';
import { applyOne } from './apply/run.js';
import { ownDocx } from '../src/lib/docx-meta.js';
import { waitForEmailCode, waitForVerifyLink } from './mailcode.js';
import { applyWorkday, siteKey } from './apply/workday.js';
import { atsOf, destKey } from './apply/forms.js';
import { resolveApplyRoute } from '../src/lib/apply-route.js';
import { checkInbox, sendApprovedReplies } from './inbox.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const DRY = argv.includes('--dry-run');
const HEADED = argv.includes('--headed');
const SUPPORTED = new Set(['greenhouse', 'lever', 'ashby', 'recruitee', 'workday']);
const DEFAULT_DAILY_CAP = 10;
const LOCK = join(tmpdir(), 'jobvibe-worker.lock');
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

/* ---------------- single instance ---------------- */
function takeLock() {
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    try { process.kill(pid, 0); return false; } catch { /* stale lock */ }
  }
  writeFileSync(LOCK, String(process.pid));
  const release = () => { try { unlinkSync(LOCK); } catch { /* gone */ } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });
  return true;
}

/* ---------------- job lookup ---------------- */
async function loadJob(matchId) {
  const d = await db();
  const j = await d.one(
    `SELECT m.id AS match_id, m.decision, j.id, j.title, j.company, j.country, j.city, j.work_mode, j.location_raw, j.jd_text, j.source, j.source_job_id,
            j.apply_url, j.final_url, j.skills_required, j.apply_route, c.ats_slug
       FROM job_matches m JOIN jobs j ON j.id = m.job_id LEFT JOIN companies c ON c.id = j.company_id
      WHERE m.id = ?`, [matchId]);
  if (!j) return null;
  let url = j.final_url || j.apply_url;
  // Greenhouse jobs often link to the company's page; the canonical board form is consistent.
  if (j.source === 'greenhouse' && j.ats_slug && j.source_job_id) {
    url = `https://job-boards.greenhouse.io/${j.ats_slug}/jobs/${j.source_job_id}`;
  }
  return { ...j, url };
}

const notify = async (profile, html) => {
  if (telegramConfigured() && profile.telegram?.chatId) await send(profile.telegram.chatId, html);
};
const notifyFile = async (profile, file) => {
  if (telegramConfigured() && profile.telegram?.chatId) await sendFile(profile.telegram.chatId, file);
};

/* ---------------- Workday accounts ---------------- */
// One candidate account per employer's Workday site, on her job-hunt email, with a
// generated password stored encrypted on her profile (profile.workdayAccounts[site]).
function workdayAccount(userId, profile, url) {
  const key = siteKey(url);
  const stored = profile.workdayAccounts?.[key];
  let account = null;
  try { if (stored?.passEnc) account = { email: stored.email, password: decrypt(stored.passEnc) }; } catch { /* unreadable: treated as none */ }
  return {
    account,
    createAccount: async (acc) => {
      const p = await loadProfileAsync(userId);
      const next = { ...p, userId, workdayAccounts: { ...(p.workdayAccounts || {}),
        [key]: { email: acc.email, passEnc: encrypt(acc.password), createdAt: stored?.createdAt || new Date().toISOString(), verified: !!acc.verified } } };
      delete next._source; delete next._updatedAt;
      await saveProfileRow(next, userId);
      log(`${userId}: Workday account ${acc.verified ? 'verified' : 'created'} on ${key}`);
      // She should know an account exists in her name (she can use "Forgot password" there to sign in herself).
      if (!stored && !acc.verified) await notify(profile, `🔐 I created a Workday candidate account for you on <b>${h(new URL(url).hostname)}</b> with ${h(acc.email)}, to apply there. The password is stored encrypted; use "Forgot password" on that site if you ever want to sign in yourself.`);
    },
    getVerifyLink: (since) => waitForVerifyLink(profile.mailbox, { since, host: new URL(url).hostname }),
  };
}

/* ---------------- one queue item ---------------- */
async function processItem(item, browser) {
  const job = await loadJob(item.match_id);
  let profile = await loadProfileAsync(item.user_id);
  const detail = JSON.parse(item.detail || '{}');
  const save = (status, reason, extra = {}, attempts) =>
    updateQueueItem(item.id, { status, reason, detail: JSON.stringify({ ...detail, ...extra }), attempts });

  if (!job || job.decision !== 'approved') return save('skipped', 'no longer approved');
  const label = `<b>${h(job.title)}</b> at ${h(job.company)}`;

  // Answer bank must be complete before any form is touched.
  const bank = answerBankStatus(profile);
  if (!bank.ready) {
    if (!detail.toldBank) {
      await notify(profile, `⏸ I can't apply to ${label} yet. Your application answers are missing: ${h(bank.missing.slice(0, 5).join(', '))}.\nFill them in on JobVibe → <b>Application Answers</b>.`);
    }
    return save('blocked', `answers missing: ${bank.missing.join(', ')}`, { toldBank: true });
  }

  const cap = Number(profile.applyDailyCap || DEFAULT_DAILY_CAP);
  if ((await submittedToday(item.user_id)) >= cap) {
    log(`${item.user_id}: daily cap ${cap} reached, leaving queued`);
    return 'capped';
  }

  // Where to apply: the job's own form, or the same role on the employer's own system
  // (Himalayas / Cutshort / aggregator listings). Decided before the CV is tailored.
  const generic = process.env.WORKER_ALLOW_GENERIC === '1' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(job.url);
  let ats = atsOf(job.url);
  let manualWhy = null;
  if (!generic && !SUPPORTED.has(ats)) {
    const route = await resolveApplyRoute(job);
    if (route.route === 'auto' && SUPPORTED.has(route.ats)) {
      job.url = route.url; ats = route.ats;
      log(`${item.user_id}: ${job.company} → applying via ${route.via}`);
    } else if (route.route === 'auto') {
      // An employer form we'll be able to fill once that system is supported: wait, don't hand off.
      log(`${item.user_id}: ${job.company} waits for ${route.ats} support`);
      return save('waiting', `form is on ${route.ats}; applies automatically once supported`, { waitAts: route.ats });
    } else {
      manualWhy = route.reason;
    }
  }

  // One application per employer posting, even when two sources listed it.
  if (!manualWhy) {
    const dup = await claimDestination(item.id, item.user_id, destKey(job.url));
    if (dup) return save('already_applied', `same posting as "${dup.title}" at ${dup.company} (${dup.status})`);
  }
  job.override = !!detail.override;

  // CV: tailored for this job when possible, else the original.
  const cvRow = await defaultResume(item.user_id);
  if (!cvRow?.content_b64) return save('blocked', 'no CV on file');
  const original = Buffer.from(cvRow.content_b64, 'base64');
  const ext = cvRow.kind === 'pdf' ? 'pdf' : 'docx';
  let cv = original;
  let tailored = false;
  if (ext === 'docx') {
    const t = await tailorResume(original, job, profile.skillBank || [], { stretch: profile.stretchSkills !== false, yearsExp: profile.totalExpYears ?? null });
    if (t.ok) { cv = t.buffer; tailored = true; }
  }
  // What the employer receives: "<Name>_CV.docx", with her name in the file's properties.
  if (ext === 'docx') cv = await ownDocx(cv, profile.name);
  const cvName = `${safe(profile.name || 'Resume')}_CV.${ext}`;
  const cvText = (await extractText(original, cvRow.filename || cvName, '')).text || '';
  // Keep the CV used for this application so it can be downloaded later. Her own copy is
  // named by company so she can tell them apart; employers only ever see "<Name>_CV".
  await saveQueueCv(item.id, `${safe(profile.name || 'Resume')}_CV_${safe(job.company)}.${ext}`, cv);

  if (manualWhy) {
    await notify(profile, `✋ Please apply to ${label} yourself: ${h(manualWhy)}.\n<a href="${h(job.url)}">Open the job</a>. Your ${tailored ? 'tailored ' : ''}CV is attached.`);
    await notifyFile(profile, { kind: 'document', buffer: cv, filename: cvName, caption: `CV for ${h(job.title)} at ${h(job.company)}` });
    return save('manual', manualWhy);
  }

  log(`${item.user_id}: applying to ${job.title} @ ${job.company} (${ats || 'generic'})${DRY ? ' [dry run]' : ''}`);
  // A form that emails a security code after Submit: read it from her connected job-hunt inbox.
  const getEmailCode = profile.mailbox?.passEnc ? (since) => waitForEmailCode(profile.mailbox, { since, company: job.company }) : null;
  const r = ats === 'workday'
    ? await applyWorkday({ browser, job, profile, cv, cvName, cvText, dryRun: DRY, ...workdayAccount(item.user_id, profile, job.url) })
    : await applyOne({ browser, job, profile, cv, cvName, cvText, dryRun: DRY, getEmailCode });
  const filled = (r.filled || []).map((f) => ({ label: f.label, value: f.value, source: f.source }));

  if (r.status === 'manual') {
    await notify(profile, `✋ Please apply to ${label} yourself: ${h(r.reason)}.
<a href="${h(job.url)}">Open the job</a>. Your ${tailored ? 'tailored ' : ''}CV is attached.`);
    await notifyFile(profile, { kind: 'document', buffer: cv, filename: cvName, caption: `CV for ${h(job.title)} at ${h(job.company)}` });
    return save('manual', r.reason);
  }
  if (r.status === 'already_applied') return save('already_applied', r.reason);
  if (r.status === 'email_code') {
    // Greenhouse emailed her a security code and holds the application until it's entered.
    await notify(profile, `✉️ ${label}: the site emailed you a security code to finish the application, so it is <b>not submitted yet</b>. I won't retry it on my own.\n<a href="${h(job.url)}">Open the application</a>`);
    return save('email_code', 'not submitted: the site asked for the security code it emailed you', { filled, tailored });
  }
  if (r.status === 'closed') {
    // Taken down: no retry, and the job leaves the pool so it isn't offered again.
    await (await db()).run(`UPDATE jobs SET link_status = 'DEAD', link_checked_at = ? WHERE id = ?`, [new Date().toISOString(), job.id]);
    await notify(profile, `🔒 ${label} is no longer open, so there's nothing to apply to.`);
    return save('closed', r.reason);
  }
  if (r.status === 'ineligible') {
    const why = r.reasons.map((x) => `• ${x.label} → <b>${h(x.answer)}</b>`).join('\n');
    if (telegramConfigured() && profile.telegram?.chatId) {
      await send(profile.telegram.chatId, `🚫 I didn't apply to ${label}: your truthful answers rule you out, so it would be auto-rejected.\n${why}\n\nIf you know you qualify, tap <b>Apply anyway</b>.`,
        { buttons: [[{ text: '✅ Apply anyway', callback_data: `ov:${item.id}` }], [{ text: '🔗 View job', url: job.url }]] });
    }
    return save('ineligible', r.reasons.map((x) => `${x.label}: ${x.answer}`).join(' | '));
  }
  if (r.status === 'needs_user') {
    // Ask whatever isn't already open in her chat. (These questions are unanswered by
    // definition: the form engine just asked for them.) A question whose answer was
    // removed, or whose message was lost, gets asked again.
    for (const q of r.questions) {
      profile = await loadProfileAsync(item.user_id); // askUser stores pending questions on the profile
      if ((profile.telegram?.pending || []).some((x) => x.q === q.label)) continue;
      await askUser(item.user_id, profile, q.label, { context: `${job.title} at ${job.company}`, options: q.options });
    }
    return save('needs_user', r.questions.map((q) => q.label).join(' | '));
  }
  if (r.status === 'dry_run') {
    await notify(profile, `🧪 Dry run: filled the application for ${label} (${filled.length} answers). Not submitted.`);
    if (r.screenshot) await notifyFile(profile, { kind: 'photo', buffer: r.screenshot, filename: 'filled.png', caption: `Filled form: ${h(job.title)}` });
    return save('dry_run', null, { filled });
  }
  if (r.status === 'submitted') {
    await markApplied(item.fingerprint, item.user_id);
    await notify(profile, `✅ Applied to ${label}${tailored ? ' with a tailored CV' : ''}.`);
    if (r.screenshot) await notifyFile(profile, { kind: 'photo', buffer: r.screenshot, filename: 'receipt.png', caption: `Receipt: ${h(job.title)} at ${h(job.company)}` });
    return save('submitted', null, { filled, tailored, evidence: r.evidence });
  }
  if (r.status === 'captcha') {
    await notify(profile, `🧩 Almost done: ${label} asked for a human check (CAPTCHA), which only you can do.\n<a href="${h(job.url)}">Open the application</a> and submit. Your ${tailored ? 'tailored ' : ''}CV is attached.`);
    await notifyFile(profile, { kind: 'document', buffer: cv, filename: cvName, caption: `CV for ${h(job.title)}` });
    return save('captcha', 'human check required', { filled });
  }
  if (r.status === 'unconfirmed') {
    // Submit was clicked but nothing confirmed it. Resending could apply twice, so ask instead.
    await notify(profile, `⚠️ I submitted ${label}, but the site didn't confirm it. Please check ${h(profile.answers?.email || 'your job-hunt email')} for a confirmation. I won't resend it, to avoid applying twice.\n<a href="${h(job.url)}">Open the application</a>`);
    if (r.screenshot) await notifyFile(profile, { kind: 'photo', buffer: r.screenshot, filename: 'after-submit.png', caption: `After submitting: ${h(job.title)}` });
    return save('unconfirmed', r.reason, { filled, tailored });
  }
  // failed: one retry later (only if nothing was submitted, or the form clearly rejected it), then hand it over.
  const attempts = (item.attempts || 0) + 1;
  if (attempts < 2) return save('queued', r.reason, { lastError: r.reason }, attempts);
  await notify(profile, `⚠️ I couldn't apply to ${label}: ${h(r.reason || 'unknown error')}.\n<a href="${h(job.url)}">Open the application</a> to apply yourself.`);
  return save('failed', r.reason, { filled }, attempts);
}

/* ---------------- inbox ---------------- */
const INBOX_EVERY_MS = 10 * 60 * 1000;
const lastInbox = new Map();
async function inboxTick() {
  const sent = await sendApprovedReplies();
  if (sent) log(`sent ${sent} approved repl${sent === 1 ? 'y' : 'ies'}`);
  for (const p of await allProfiles()) {
    if (!p.data?.mailbox?.passEnc) continue;
    if (!ONCE && Date.now() - (lastInbox.get(p.userId) || 0) < INBOX_EVERY_MS) continue;
    lastInbox.set(p.userId, Date.now());
    try { log(`${p.userId}: inbox ${await checkInbox(p.userId)}`); } catch (err) { log(`${p.userId}: inbox failed ${err.message}`); }
  }
}

/* ---------------- loop ---------------- */
async function unblockReady() {
  const d = await db();
  // Jobs waiting for a form-filler that now exists go back in the queue.
  for (const it of await d.query(`SELECT id, detail FROM apply_queue WHERE status = 'waiting'`)) {
    const det = JSON.parse(it.detail || '{}');
    if (SUPPORTED.has(det.waitAts)) await updateQueueItem(it.id, { status: 'queued', reason: null, detail: it.detail });
  }
  for (const it of await d.query(`SELECT id, user_id FROM apply_queue WHERE status = 'blocked'`)) {
    const p = await loadProfileAsync(it.user_id);
    if (answerBankStatus(p).ready) await updateQueueItem(it.id, { status: 'queued', reason: null });
  }
}

async function tick(browser) {
  const added = await enqueueApproved();
  if (added) log(`queued ${added} newly approved job(s)`);
  await unblockReady();
  let done = 0;
  for (;;) {
    const [item] = await nextQueued(1);
    if (!item) break;
    await updateQueueItem(item.id, { status: 'running', reason: null, detail: item.detail });
    let out;
    try { out = await processItem(item, browser); } catch (err) {
      log(`item ${item.id} crashed: ${err.message}`);
      await updateQueueItem(item.id, { status: 'failed', reason: err.message.slice(0, 300), detail: item.detail });
    }
    if (out === 'capped') { await updateQueueItem(item.id, { status: 'queued', reason: 'daily cap reached', detail: item.detail }); break; }
    done++;
    if (!ONCE) break; // in loop mode: one application per tick, spaced out
  }
  return done;
}

async function main() {
  if (!takeLock()) { console.log('Another worker is already running.'); return; }
  await initDB();
  await loadSecretsIntoEnv();
  // Going live after test runs: jobs that were only test-filled get applied to for real.
  if (!DRY) {
    const d = await db();
    const n = (await d.query(`SELECT id FROM apply_queue WHERE status = 'dry_run'`)).length;
    if (n) { await d.run(`UPDATE apply_queue SET status = 'queued', reason = NULL WHERE status = 'dry_run'`); log(`${n} test-run job(s) queued to apply for real`); }
  }
  const browser = await chromium.launch({ headless: !HEADED });
  log(`worker started${DRY ? ' (dry run: nothing is submitted)' : ''}${ONCE ? ', single pass' : ''}`);
  if (ONCE) { await inboxTick(); await tick(browser); await inboxTick(); await browser.close(); return; }
  for (;;) {
    try { await inboxTick(); } catch (err) { log(`inbox tick failed: ${err.message}`); }
    try { await tick(browser); } catch (err) { log(`tick failed: ${err.message}`); }
    // 60-120 s between applications so employers aren't hit in bursts.
    await new Promise((r) => setTimeout(r, 60000 + Math.floor(Math.random() * 60000)));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
