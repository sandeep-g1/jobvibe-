// npm run match -- <userId>   score one user against the current pool (no crawl).
import { initDB, closeDB } from './db.js';
import { loadSecretsIntoEnv } from './lib/secrets.js';
import { runMatch } from './match.js';
const userId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'local';
const email = !process.argv.includes('--no-email');
await initDB();
await loadSecretsIntoEnv();
const r = await runMatch(userId, { email });
console.log(`\n  match ${userId}: run #${r.runId} · ${r.reported} jobs${r.emailed ? ' · emailed' : ''}\n`);
await closeDB();
