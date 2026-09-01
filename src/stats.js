// Run transparency — §17 of the architecture. A thin report should be
// explainable, not suspicious.
import { getDB } from './db.js';

const d = getDB();
const runs = d.prepare('SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 10').all();

if (!runs.length) {
  console.log('\n  No completed runs yet. Try: npm run run\n');
  process.exit(0);
}

console.log('\nRUN HISTORY\n');
console.log('  ' + 'Run'.padEnd(6) + 'When'.padEnd(20) + 'Fetched'.padStart(9) +
  'India'.padStart(8) + 'New'.padStart(7) + 'Dead'.padStart(7) + 'Report'.padStart(8));
console.log('  ' + '-'.repeat(65));
for (const r of runs) {
  console.log('  ' + ('#' + r.id).padEnd(6) +
    new Date(r.started_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }).padEnd(20) +
    String(r.n_fetched).padStart(9) + String(r.n_after_india).padStart(8) +
    String(r.n_new).padStart(7) + String(r.n_links_dead).padStart(7) +
    String(r.n_reported).padStart(8));
}

const latest = runs[0];
console.log(`\n  Latest run #${latest.id} per source:`);
for (const [s, n] of Object.entries(JSON.parse(latest.per_source || '{}'))) {
  console.log(`    ${s.padEnd(18)} ${String(n).padStart(5)} postings`);
}

const errs = JSON.parse(latest.errors || '[]');
if (errs.length) {
  console.log(`\n  ${errs.length} source warnings:`);
  for (const e of errs.slice(0, 12)) console.log(`    · ${e}`);
  if (errs.length > 12) console.log(`    … ${errs.length - 12} more`);
}

const reg = d.prepare(
  `SELECT ats_type, COUNT(*) live, SUM(last_india) india
     FROM companies WHERE board_status='live' GROUP BY ats_type ORDER BY india DESC`
).all();
console.log('\n  Registry health:');
for (const r of reg) {
  console.log(`    ${r.ats_type.padEnd(18)} ${String(r.live).padStart(3)} boards · ${String(r.india).padStart(5)} India jobs`);
}
const dead = d.prepare("SELECT COUNT(*) c FROM companies WHERE board_status='dead'").get().c;
console.log(`    ${'unreachable'.padEnd(18)} ${String(dead).padStart(3)} candidates filtered out`);

const totals = d.prepare('SELECT COUNT(*) jobs FROM jobs').get();
const seen = d.prepare('SELECT COUNT(*) c FROM job_matches').get();
const applied = d.prepare('SELECT COUNT(*) c FROM applications').get();
console.log(`\n  Database: ${totals.jobs} jobs · ${seen.c} matches shown · ${applied.c} marked applied\n`);
