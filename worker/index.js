// JobVibe worker: applies to jobs users approved in Telegram.
//
//   npm --prefix worker start            loop forever (checks every minute)
//   npm --prefix worker start -- --once  process what's queued, then exit
//   --dry-run   fill forms but never submit (testing)
//   --headed    show the browser window
//
// Per approved job: still approved? answer bank complete? under the daily cap?
// supported form? → tailor the CV → fill → submit → Telegram receipt. Anything
// it can't do alone goes back to the user on Telegram.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initDB, enqueueApproved, nextQueued, updateQueueItem, submittedToday, defaultResume, markApplied,
} from '../src/db.js';
import { db } from '../src/db/driver.js';
import { loadSecretsIntoEnv } from '../src/lib/secrets.js';
import { loadProfileAsync } from '../src/lib/profile.js';
import { answerBankStatus } from '../src/lib/answers.js';
import { tailorResume } from '../src/lib/tailor.js';
import { extractText } from '../src/lib/resume.js';
import { telegramConfigured, send, sendFile, askUser, h } from '../src/lib/telegram.js';
import { applyOne } from './apply/run.js';
import { atsOf } from './apply/forms.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const DRY = argv.includes('--dry-run');
const HEADED = argv.includes('--headed');
const SUPPORTED = new Set(['greenhouse', 'lever', 'ashby']);
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
    `SELECT m.id AS match_id, m.decision, j.title, j.company, j.country, j.jd_text, j.source, j.source_job_id,
            j.apply_url, j.final_url, j.skills_required, c.ats_slug
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
  const cvName = `${safe(profile.name || 'Resume')}_CV.${ext}`;
  const cvText = (await extractText(original, cvRow.filename || cvName, '')).text || '';

  const ats = atsOf(job.url);
  const generic = process.env.WORKER_ALLOW_GENERIC === '1' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(job.url);
  if (!SUPPORTED.has(ats) && !generic) {
    await notify(profile, `📝 Please apply to ${label} yourself: this site (${h(ats || new URL(job.url).hostname)}) needs an account or its own flow, which I can't do yet.\n<a href="${h(job.url)}">Open the application</a>. Your ${tailored ? 'tailored ' : ''}CV is attached.`);
    await notifyFile(profile, { kind: 'document', buffer: cv, filename: cvName, caption: `CV for ${h(job.title)} at ${h(job.company)}` });
    return save('manual', `unsupported form: ${ats || 'unknown'}`);
  }

  log(`${item.user_id}: applying to ${job.title} @ ${job.company} (${ats || 'generic'})${DRY ? ' [dry run]' : ''}`);
  const r = await applyOne({ browser, job, profile, cv, cvName, cvText, dryRun: DRY });
  const filled = (r.filled || []).map((f) => ({ label: f.label, value: f.value, source: f.source }));

  if (r.status === 'needs_user') {
    const asked = new Set(detail.asked || []);
    for (const q of r.questions) {
      if (asked.has(q.label)) continue;
      profile = await loadProfileAsync(item.user_id); // askUser stores pending questions on the profile
      const a = await askUser(item.user_id, profile, q.label, { context: `${job.title} at ${job.company}` });
      if (a.ok) asked.add(q.label);
    }
    return save('needs_user', r.questions.map((q) => q.label).join(' | '), { asked: [...asked] });
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
    return save('submitted', null, { filled, tailored });
  }
  if (r.status === 'captcha') {
    await notify(profile, `🧩 Almost done: ${label} asked for a human check (CAPTCHA), which only you can do.\n<a href="${h(job.url)}">Open the application</a> and submit. Your ${tailored ? 'tailored ' : ''}CV is attached.`);
    await notifyFile(profile, { kind: 'document', buffer: cv, filename: cvName, caption: `CV for ${h(job.title)}` });
    return save('captcha', 'human check required', { filled });
  }
  // failed: one retry later, then hand it over.
  const attempts = (item.attempts || 0) + 1;
  if (attempts < 2) return save('queued', r.reason, { lastError: r.reason }, attempts);
  await notify(profile, `⚠️ I couldn't apply to ${label}: ${h(r.reason || 'unknown error')}.\n<a href="${h(job.url)}">Open the application</a> to apply yourself.`);
  return save('failed', r.reason, { filled }, attempts);
}

/* ---------------- loop ---------------- */
async function unblockReady() {
  const d = await db();
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
  const browser = await chromium.launch({ headless: !HEADED });
  log(`worker started${DRY ? ' (dry run: nothing is submitted)' : ''}${ONCE ? ', single pass' : ''}`);
  if (ONCE) { await tick(browser); await browser.close(); return; }
  for (;;) {
    try { await tick(browser); } catch (err) { log(`tick failed: ${err.message}`); }
    // 60-120 s between applications so employers aren't hit in bursts.
    await new Promise((r) => setTimeout(r, 60000 + Math.floor(Math.random() * 60000)));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
