// Orchestrator: one shared ingest, then a per-user match for whoever is due.
// The daily cron calls this. It preserves the existing single-user behaviour —
// the "local" user's schedule is on — while making the crawl shared.
//
//   npm run run                 ingest + match every schedule-active user
//   npm run run -- --user local match only that user (still ingests first)
//   npm run run -- --no-email   suppress the digest (tests)
//   npm run run -- --all-users  match every stored profile, active or not
import { initDB, closeDB, isPostgres, runCompletedToday, runInProgress, activeProfiles, allProfiles } from './db.js';
import { loadSecretsIntoEnv } from './lib/secrets.js';
import { loadProfileAsync } from './lib/profile.js';
import { runIngest } from './ingest.js';
import { runMatch } from './match.js';

async function main() {
  const t0 = Date.now();
  const argv = process.argv.slice(2);
  const email = !argv.includes('--no-email');
  const userArg = (argv.find((a) => a.startsWith('--user=')) || '').split('=')[1]
    || (argv.includes('--user') ? argv[argv.indexOf('--user') + 1] : null);
  const allUsers = argv.includes('--all-users');

  if (!isPostgres && (process.env.CI || process.env.GITHUB_ACTIONS)) {
    console.error('\n  DATABASE_URL is not set. Refusing to run against ephemeral storage.\n');
    process.exit(1);
  }

  await initDB();

  if (argv.includes('--once-per-day') && await runCompletedToday()) {
    console.log('\n  A run already completed today — nothing to do.\n');
    await closeDB();
    return;
  }
  const busy = await runInProgress();
  if (busy) {
    console.log(`\n  Run #${busy.id} is still in flight — not starting another.\n`);
    await closeDB();
    return;
  }

  await loadSecretsIntoEnv();

  // The crawl uses one representative profile to decide sources/terms. The
  // existing "local" user is that profile; its sources are the widest set.
  const lead = await loadProfileAsync('local');
  console.log(`\nJobVibe run · storage ${isPostgres ? 'Postgres' : 'SQLite'}`);

  // 1. Shared ingest.
  const ing = await runIngest({ profile: lead });
  console.log(`  ingest done: ${ing.fetched} fetched · ${ing.afterIndia} India · ${ing.newJobs} new · ${ing.seconds.toFixed(0)}s`);

  // 2. Decide whom to match.
  let targets;
  if (userArg) {
    targets = [userArg];
  } else if (allUsers) {
    targets = (await allProfiles()).map((p) => p.userId);
  } else {
    // Scheduled path: only users who turned their daily schedule on.
    targets = (await activeProfiles()).map((p) => p.userId);
  }
  if (!targets.length) {
    console.log('  no schedule-active users — pool refreshed, no reports sent');
    await closeDB();
    return;
  }

  // 3. Match each.
  let reported = 0;
  for (const userId of targets) {
    try {
      const r = await runMatch(userId, { email });
      reported += r.reported;
      console.log(`  ${userId}: ${r.reported} jobs${r.emailed ? ' · emailed' : r.emailReason ? ` · email skipped (${r.emailReason})` : ''}`);
    } catch (err) {
      console.error(`  ${userId}: match failed — ${err.message}`);
    }
  }

  console.log(`\n  ${targets.length} user(s) · ${reported} jobs total · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  await closeDB();
}

main().catch((e) => { console.error('\nrun failed:', e); process.exit(1); });
