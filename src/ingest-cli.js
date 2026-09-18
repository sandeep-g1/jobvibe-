// npm run ingest — run the shared crawl once, no matching.
import { initDB, closeDB } from './db.js';
import { loadSecretsIntoEnv } from './lib/secrets.js';
import { loadProfileAsync } from './lib/profile.js';
import { runIngest } from './ingest.js';
await initDB();
await loadSecretsIntoEnv();
const profile = await loadProfileAsync('local');
const r = await runIngest({ profile });
console.log(`\n  ingest #${r.id}: ${r.fetched} fetched · ${r.afterIndia} India · ${r.newJobs} new · ${r.seconds.toFixed(0)}s\n`);
await closeDB();
