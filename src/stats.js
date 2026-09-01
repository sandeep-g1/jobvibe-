// Run transparency — a thin report should be explainable, not suspicious.
import { initDB, closeDB, allRuns, registryHealth, dashboardStats, isPostgres } from './db.js';

await initDB();
const runs = (await allRuns()).slice(0, 10);

console.log('');
console.log(`  storage: ${isPostgres ? 'Postgres (Supabase)' : 'SQLite (local)'}`);

if (!runs.length) {
  console.log('  No completed runs yet. Try: npm run run');
  console.log('');
  await closeDB();
  process.exit(0);
}

console.log('');
console.log('RUN HISTORY');
console.log('');
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
console.log('');
console.log(`  Latest run #${latest.id} per source:`);
for (const [s, n] of Object.entries(JSON.parse(latest.per_source || '{}'))) {
  console.log(`    ${s.padEnd(18)} ${String(n).padStart(5)} postings`);
}

const errs = JSON.parse(latest.errors || '[]');
if (errs.length) {
  console.log('');
  console.log(`  ${errs.length} source warnings:`);
  for (const e of errs.slice(0, 12)) console.log(`    - ${e}`);
  if (errs.length > 12) console.log(`    ... ${errs.length - 12} more`);
}

const health = await registryHealth();
console.log('');
console.log('  Registry health:');
for (const r of health.byAts) {
  console.log(`    ${r.ats_type.padEnd(18)} ${String(r.live).padStart(3)} boards - ${String(r.india).padStart(5)} India jobs`);
}
console.log(`    ${'unreachable'.padEnd(18)} ${String(health.dead).padStart(3)} candidates filtered out`);

const s = await dashboardStats();
console.log('');
console.log(`  Database: ${s.jobs} jobs - ${s.shown} matches shown - ${s.applied} marked applied`);
console.log('');

await closeDB();
