// Clear jobs, matches and runs so the next run treats everything as new again.
// The verified company registry is preserved — re-seeding is the slow part.
// Applied history is preserved too, unless you pass --all.
import { getDB } from './db.js';

const all = process.argv.includes('--all');
const d = getDB();

const before = {
  jobs: d.prepare('SELECT COUNT(*) c FROM jobs').get().c,
  matches: d.prepare('SELECT COUNT(*) c FROM job_matches').get().c,
  runs: d.prepare('SELECT COUNT(*) c FROM runs').get().c,
};

d.exec('DELETE FROM job_matches');
d.exec('DELETE FROM jobs');
d.exec('DELETE FROM runs');
if (all) d.exec('DELETE FROM applications');

console.log(`\n  cleared ${before.matches} matches, ${before.jobs} jobs, ${before.runs} runs`);
console.log(`  registry kept: ${d.prepare("SELECT COUNT(*) c FROM companies WHERE board_status='live'").get().c} live boards`);
console.log(`  applied history: ${all ? 'cleared' : `${d.prepare('SELECT COUNT(*) c FROM applications').get().c} kept`}\n`);
