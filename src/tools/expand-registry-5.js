// Fifth registry expansion: Keka and Zoho Recruit career sites of Indian employers.
//
// Candidates: every employer in the job pool and every company already listed on any
// system, as {name}.keka.com and {name}.zohorecruit.in / .com. A site is kept only if it
// answers with at least one India job; then `npm run seed` stores it.
//
//   node --env-file=.env src/tools/expand-registry-5.js [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, initDB, closeDB } from '../db.js';
import { db } from '../db/driver.js';
import * as keka from '../adapters/keka.js';
import * as zoho from '../adapters/zohorecruit.js';
import { indiaGate } from '../lib/india.js';
import { mapLimit } from '../lib/http.js';

const FILE = join(ROOT, 'data', 'companies.json');
const SUFFIX = /\b(private|pvt|limited|ltd|inc|llc|corp|corporation|co|company|technologies|technology|tech|solutions|systems|services|group|labs|software|india|global|international)\b\.?/g;
function slugsFor(name) {
  const base = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(SUFFIX, ' ').replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!base.length) return [];
  const out = new Set([base.join(''), base.join('-')]);
  if (base.length > 1 && base[0].length >= 4) out.add(base[0]);
  return [...out].filter((s) => s.length >= 3 && s.length <= 40);
}
const kekaIndia = (jobs) => jobs.filter((j) => (j.jobLocations || []).some((l) => l.countryCode === 'IN') || indiaGate({ location: (j.jobLocations || []).map((l) => l.city).join(', ') }).isIndia).length;
const zohoIndia = (jobs) => jobs.filter((j) => /india/i.test(j.Country || '') || indiaGate({ location: [j.City, j.Country].filter(Boolean).join(', ') }).isIndia).length;

const dry = process.argv.includes('--dry');
await initDB();
const d = await db();
const reg = JSON.parse(readFileSync(FILE, 'utf8'));
reg.keka ||= []; reg.zohorecruit ||= [];
const listed = new Set([...reg.keka.map((c) => `keka:${c.slug}`), ...reg.zohorecruit.map((c) => `zohorecruit:${c.slug}`)]);

const names = new Map();
for (const r of await d.query(`SELECT DISTINCT company FROM jobs WHERE country = 'IN'`)) for (const s of slugsFor(r.company)) names.set(s, r.company);
for (const sys of Object.keys(reg)) if (Array.isArray(reg[sys])) for (const c of reg[sys]) for (const s of slugsFor(c.name)) names.set(s, c.name);

const tasks = [];
for (const [slug, name] of names) {
  if (!listed.has(`keka:${slug}`)) tasks.push({ system: 'keka', slug, name });
  for (const host of [`${slug}.zohorecruit.in`, `${slug}.zohorecruit.com`]) if (!listed.has(`zohorecruit:${host}`)) tasks.push({ system: 'zohorecruit', slug: host, name });
}
console.log(`${names.size} employer names → ${tasks.length} probes`);

const hits = [];
let done = 0;
await mapLimit(tasks, 10, async (t) => {
  try {
    const res = t.system === 'keka' ? await keka.probe(t.slug) : await zoho.probe(t.slug);
    if (res.live) {
      const india = t.system === 'keka' ? kekaIndia(res.jobs) : zohoIndia(res.jobs);
      if (india > 0) { hits.push({ ...t, india, total: res.total }); console.log(`  + ${t.system}:${t.slug} (${t.name}) ${india} India of ${res.total}`); }
    }
  } catch { /* not there */ }
  if (++done % 500 === 0) console.log(`  … ${done}/${tasks.length}`);
});

// The same employer on .in and .com: keep the one with more jobs.
const best = new Map();
for (const h of hits) { const k = `${h.system}:${h.name}`; if (!best.has(k) || best.get(k).india < h.india) best.set(k, h); }
const keep = [...best.values()].sort((a, b) => b.india - a.india);
console.log(`\n${keep.length} live career sites with India jobs (${keep.reduce((a, h) => a + h.india, 0)} India jobs)`);
if (!dry && keep.length) {
  for (const h of keep) reg[h.system].push({ name: h.name.replace(/\b\w/g, (c) => c.toUpperCase()), slug: h.slug });
  writeFileSync(FILE, `${JSON.stringify(reg, null, 2)}\n`);
  console.log('appended to data/companies.json; run `npm run seed` to store them');
}
await closeDB();
process.exit(0);
