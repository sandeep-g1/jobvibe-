// Send one real digest to the configured recipients, using the latest report.
//
//   npm run email:test
//
// Use this to confirm delivery after setting RESEND_API_KEY, without waiting
// for a scheduled run.
import { initDB, closeDB, latestRun, matchesForRun, appliedSet, recentDigests } from '../db.js';
import { buildRows } from '../report.js';
import { sendDigest, emailConfigured, buildSubject } from '../email.js';
import { loadProfileAsync } from '../lib/profile.js';

await initDB();

const profile = await loadProfileAsync();
const run = await latestRun();

console.log('');
if (!run) {
  console.log('  No completed run yet. Run `npm run run` first.');
  console.log('');
  await closeDB();
  process.exit(1);
}

const rows = buildRows(await matchesForRun(run.id), await appliedSet());

console.log(`  report      : #${run.id} · ${rows.length} jobs`);
console.log(`  to          : ${(profile.emailTo || []).join(', ') || '(none set)'}`);
console.log(`  cc          : ${(profile.emailCc || []).join(', ') || '(none)'}`);
console.log(`  enabled     : ${profile.emailEnabled !== false}`);
console.log(`  provider    : ${emailConfigured() ? 'RESEND_API_KEY present' : 'RESEND_API_KEY missing'}`);
console.log(`  subject     : ${buildSubject(rows, profile)}`);
console.log('');

const siteUrl = (process.env.SITE_URL || 'https://jobvibe-green.vercel.app').replace(/\/+$/, '');
const res = await sendDigest(rows, { profile, runId: run.id, siteUrl });

if (res.sent) {
  console.log(`  SENT — provider id ${res.id}`);
  console.log(`  delivered to ${res.to.join(', ')}${res.cc?.length ? ` (cc ${res.cc.join(', ')})` : ''}`);
} else {
  console.log(`  NOT SENT — ${res.reason}`);
}

const log = await recentDigests(3);
if (log.length) {
  console.log('');
  console.log('  recent digest log:');
  for (const d of log) {
    console.log(`    run ${d.run_id} · ${d.n_jobs} jobs · ${d.error ? 'ERROR: ' + d.error : 'id ' + d.provider_id} · ${d.sent_at}`);
  }
}
console.log('');

await closeDB();
