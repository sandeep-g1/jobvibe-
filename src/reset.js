// Clear jobs, matches and runs so the next run treats everything as new again.
// The verified company registry is preserved — re-seeding is the slow part.
// Applied history is preserved too, unless you pass --all.
import { initDB, closeDB, clearRuns, registryHealth, isPostgres } from './db.js';

const all = process.argv.includes('--all');

await initDB();
const before = await clearRuns({ includeApplications: all });
const health = await registryHealth();
const live = health.byAts.reduce((a, r) => a + Number(r.live), 0);

console.log('');
console.log(`  storage: ${isPostgres ? 'Postgres (Supabase)' : 'SQLite (local)'}`);
console.log(`  cleared ${before.matches} matches, ${before.jobs} jobs, ${before.runs} runs`);
console.log(`  registry kept: ${live} live boards`);
console.log(`  applied history: ${all ? 'cleared' : 'kept'}`);
console.log('');

await closeDB();
