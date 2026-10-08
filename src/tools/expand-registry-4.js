// Fourth registry expansion: evidence first, then probe, then keep only live India boards.
//
// Candidates:
//   1. every employer in the job pool that came from somewhere else (Himalayas, Cutshort,
//      SmartRecruiters, Workday, JSearch…): they hire in India, so their own Greenhouse/
//      Lever/Ashby board is worth a try;
//   2. every company already listed, tried on the other two of those systems;
//   3. a short list of Bengaluru employers not listed yet.
// Each candidate slug is probed once per system; only boards that answer with at least
// one India job are appended to data/companies.json (then `npm run seed` stores them).
//
//   node --env-file=.env src/tools/expand-registry-4.js [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, initDB, closeDB } from '../db.js';
import { db } from '../db/driver.js';
import { ADAPTERS } from '../adapters/index.js';
import { indiaGate } from '../lib/india.js';
import { mapLimit } from '../lib/http.js';

const FILE = join(ROOT, 'data', 'companies.json');
const SYSTEMS = ['greenhouse', 'lever', 'ashby'];
const NEW_NAMES = ('byjus oyo makemytrip ixigo cleartax ather dhan polygon leena capillary netcore sprinto signzy decentro m2p niyo mobikwik vymo kredx '
  + 'snowflake intercom zendesk gojek booking robinhood chime remote clickup zoom docusign dynatrace globallogic vwo dailyhunt verse kukufm stockgro '
  + 'rupifi jiraaf grip junio oneassist servify citymall apnamart loginext rivigo waycool agrostar arya cropin').split(' ');

const SUFFIX = /\b(private|pvt|limited|ltd|inc|llc|corp|corporation|co|company|technologies|technology|tech|solutions|systems|services|group|labs|software|india|global|international)\b\.?/g;
/** Board names an employer is likely to use: "Tiger Analytics Pvt Ltd" → tigeranalytics, tiger-analytics. */
function slugsFor(name) {
  const base = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(SUFFIX, ' ').replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!base.length) return [];
  const out = new Set([base.join(''), base.join('-')]);
  if (base.length > 1 && base[0].length >= 4) out.add(base[0]); // "Mindtickle Technologies" → mindtickle
  return [...out].filter((s) => s.length >= 3 && s.length <= 40);
}

function countIndia(system, jobs) {
  let n = 0;
  for (const j of jobs || []) {
    const location = system === 'greenhouse' ? j.location?.name : system === 'lever' ? j.categories?.location : j.location;
    if (indiaGate({ location: location || '', isRemote: system === 'ashby' && j.isRemote === true }).isIndia) n++;
  }
  return n;
}

const dry = process.argv.includes('--dry');
await initDB();
const d = await db();
const reg = JSON.parse(readFileSync(FILE, 'utf8'));
const listed = new Set(SYSTEMS.flatMap((s) => reg[s].map((c) => `${s}:${String(c.slug).toLowerCase()}`)));

const names = new Map(); // slug -> display name
const pool = await d.query(`SELECT DISTINCT company FROM jobs WHERE source NOT IN ('greenhouse','lever','ashby') AND country = 'IN'`);
for (const r of pool) for (const s of slugsFor(r.company)) names.set(s, r.company);
for (const s of SYSTEMS) for (const c of reg[s]) names.set(String(c.slug).toLowerCase(), c.name);
for (const n of NEW_NAMES) names.set(n, n);

const tasks = [];
for (const [slug, name] of names) for (const system of SYSTEMS) if (!listed.has(`${system}:${slug}`)) tasks.push({ system, slug, name });
console.log(`${pool.length} pool employers + ${listed.size} listed boards + ${NEW_NAMES.length} new names → ${tasks.length} probes`);

const hits = [];
let done = 0;
await mapLimit(tasks, 10, async (t) => {
  try {
    const res = await ADAPTERS[t.system].probe(t.slug);
    if (res.live) {
      const india = countIndia(t.system, res.jobs);
      if (india > 0) { hits.push({ ...t, india, total: res.total ?? res.jobs?.length ?? 0 }); console.log(`  + ${t.system}:${t.slug} (${t.name}) ${india} India of ${res.total ?? res.jobs?.length}`); }
    }
  } catch { /* not there */ }
  if (++done % 500 === 0) console.log(`  … ${done}/${tasks.length}`);
});

console.log(`\n${hits.length} new live boards with India jobs (${hits.reduce((a, h) => a + h.india, 0)} India jobs)`);
if (!dry && hits.length) {
  for (const h of hits.sort((a, b) => b.india - a.india)) reg[h.system].push({ name: h.name.replace(/\b\w/g, (c) => c.toUpperCase()), slug: h.slug });
  writeFileSync(FILE, `${JSON.stringify(reg, null, 2)}\n`);
  console.log(`appended to data/companies.json; run \`npm run seed\` to store them`);
}
await closeDB();
process.exit(0);
