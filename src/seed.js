// Verify every candidate ATS board and store the live ones.
// This is the "curated, not guessed" rule from the architecture: a slug only
// enters the registry after it answers, and we record how many India jobs it has.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS } from './adapters/index.js';
import { getDB, upsertCompany, ROOT, now } from './db.js';
import { normCompany } from './lib/normalize.js';
import { indiaGate } from './lib/india.js';
import { mapLimit } from './lib/http.js';

const CONCURRENCY = 8;

function countIndia(adapterId, jobs) {
  if (!Array.isArray(jobs)) return 0;
  let n = 0;
  for (const j of jobs) {
    let location = '';
    let isRemote = false;
    let country = null;
    if (adapterId === 'greenhouse') location = j.location?.name || '';
    else if (adapterId === 'lever') location = j.categories?.location || '';
    else if (adapterId === 'ashby') { location = j.location || ''; isRemote = j.isRemote === true; }
    else if (adapterId === 'smartrecruiters') {
      location = j.location?.fullLocation || '';
      country = j.location?.country || 'in';
    }
    if (indiaGate({ location, isRemote, country }).isIndia) n++;
  }
  return n;
}

async function main() {
  getDB();
  const candidates = JSON.parse(readFileSync(join(ROOT, 'data', 'companies.json'), 'utf8'));

  const tasks = [];
  for (const [adapterId, list] of Object.entries(candidates)) {
    if (adapterId.startsWith('_') || !ADAPTERS[adapterId]) continue;
    for (const c of list) tasks.push({ adapterId, ...c });
  }

  console.log(`Probing ${tasks.length} candidate boards across ${Object.keys(ADAPTERS).length} ATS types...\n`);

  let live = 0;
  let indiaTotal = 0;
  const liveRows = [];

  await mapLimit(tasks, CONCURRENCY, async (t) => {
    const adapter = ADAPTERS[t.adapterId];
    let res;
    try {
      res = await adapter.probe(t.slug);
    } catch (err) {
      res = { live: false, status: 0, total: 0, error: err.message };
    }

    const india = res.live
      ? (t.adapterId === 'smartrecruiters' ? (res.indiaTotal ?? 0) : countIndia(t.adapterId, res.jobs))
      : 0;

    upsertCompany({
      name: t.name,
      normalized_name: normCompany(t.name),
      ats_type: t.adapterId,
      ats_slug: t.slug,
      board_status: res.live ? 'live' : 'dead',
      board_last_ok_at: res.live ? now() : null,
      last_total: res.total || 0,
      last_india: india,
      checked_at: now(),
    });

    if (res.live) {
      live++;
      indiaTotal += india;
      liveRows.push({ ats: t.adapterId, name: t.name, total: res.total, india });
    }
  });

  liveRows.sort((a, b) => b.india - a.india || b.total - a.total);

  console.log('LIVE BOARDS (sorted by India jobs)\n');
  console.log('  ' + 'ATS'.padEnd(17) + 'Company'.padEnd(26) + 'Total'.padStart(7) + 'India'.padStart(8));
  console.log('  ' + '-'.repeat(58));
  for (const r of liveRows) {
    console.log(
      '  ' + r.ats.padEnd(17) + r.name.slice(0, 25).padEnd(26) +
      String(r.total).padStart(7) + String(r.india).padStart(8)
    );
  }

  console.log(`\n  ${live}/${tasks.length} boards live · ${indiaTotal} India jobs visible`);
  console.log(`  ${liveRows.filter((r) => r.india > 0).length} boards actually carry India roles\n`);
  console.log('Registry saved. Next:  npm run run\n');
}

main().catch((e) => {
  console.error('seed failed:', e);
  process.exit(1);
});
