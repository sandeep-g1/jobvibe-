// /status reply. Kept apart from telegram.js so the bot core doesn't pull in
// the profile/answer-bank modules on every webhook call.
import { h } from './telegram.js';
import { missingProfile } from './profile.js';
import { answerBankStatus } from './answers.js';
import { resumeMeta, latestRun } from '../db.js';
import { db } from '../db/driver.js';

export async function statusText(userId, p) {
  const miss = missingProfile(p, !!(await resumeMeta(userId)));
  const bank = answerBankStatus(p);
  const run = await latestRun(userId);
  const d = await db();
  const counts = await d.one(
    `SELECT SUM(CASE WHEN decision='approved' THEN 1 ELSE 0 END) AS a,
            SUM(CASE WHEN decision IS NULL THEN 1 ELSE 0 END) AS w
       FROM job_matches WHERE user_id = ?`, [userId]);
  return [
    `<b>${h(p.name || 'Your')} status</b>`,
    `Profile: ${miss.length ? `missing ${h(miss.join(', '))}` : 'complete ✓'}`,
    `Application answers: ${bank.pct}%${bank.ready ? ' ✓' : ''}`,
    `Daily search: ${p.scheduleActive ? 'on' : 'off'}`,
    `Latest report: ${run ? `#${run.id}, ${run.n_reported} job${Number(run.n_reported) === 1 ? '' : 's'}` : 'none yet'}`,
    `Approved for applying: ${Number(counts?.a || 0)} · awaiting your decision: ${Number(counts?.w || 0)}`,
  ].join('\n');
}
