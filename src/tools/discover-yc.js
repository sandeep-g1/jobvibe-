// Discover job boards for India-based Y Combinator companies.
//
// Y Combinator's company directory is public and mirrored as open JSON. YC
// companies mostly hire through Ashby, Greenhouse or Lever, which this project
// already reads through their official APIs. So rather than scraping YC's job
// pages, this finds each India-based hiring company's own board and adds it to
// the verified registry — the jobs then arrive with full descriptions and a
// direct apply link, like every other board.
//
//   node src/tools/discover-yc.js            probe and print
//   node src/tools/discover-yc.js --write    also add the hits to companies.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db/driver.js';
import { getJSON, mapLimit } from '../lib/http.js';
import { ADAPTERS } from '../adapters/index.js';

const SOURCE = 'https://yc-oss.github.io/api/companies/hiring.json';
const INDIA = /india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur/i;
const ATS = ['ashby', 'greenhouse', 'lever'];
const write = process.argv.includes('--write');

/** A few plausible board slugs for one company, most likely first. */
function slugCandidates(c) {
  const out = new Set();
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const dashed = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (c.slug) out.add(clean(c.slug)).add(dashed(c.slug));
  out.add(clean(c.name));
  try {
    const host = new URL(c.website.startsWith('http') ? c.website : `https://${c.website}`).hostname;
    out.add(host.replace(/^www\./, '').split('.')[0]);
  } catch { /* no usable website */ }
  return [...out].filter((s) => s.length >= 3).slice(0, 3);
}

const res = await getJSON(SOURCE, { timeout: 60000 });
if (!res.ok || !Array.isArray(res.data)) {
  console.error(`  could not load the YC directory (HTTP ${res.status})`);
  process.exit(1);
}

const india = res.data.filter((c) => INDIA.test(`${c.all_locations || ''} ${(c.regions || []).join(' ')}`));
console.log('');
console.log(`  ${res.data.length} hiring YC companies · ${india.length} based in India`);
console.log(`  probing ${ATS.join(', ')} for each...`);
console.log('');

const tasks = [];
for (const c of india) {
  for (const slug of slugCandidates(c)) {
    for (const ats of ATS) tasks.push({ company: c, slug, ats });
  }
}

const hits = new Map(); // company name -> first working board
await mapLimit(tasks, 8, async ({ company, slug, ats }) => {
  if (hits.has(company.name)) return;
  try {
    const r = await ADAPTERS[ats].probe(slug);
    if (r.live && r.total > 0 && !hits.has(company.name)) {
      hits.set(company.name, { name: company.name, ats, slug, total: r.total });
    }
  } catch { /* unreachable slug */ }
});

const found = [...hits.values()].sort((a, b) => b.total - a.total);
for (const h of found) {
  console.log(`  ${h.ats.padEnd(11)} ${h.name.slice(0, 28).padEnd(30)} ${h.slug.padEnd(20)} ${String(h.total).padStart(4)} open roles`);
}
console.log('');
console.log(`  found boards for ${found.length} of ${india.length} companies`);

if (write && found.length) {
  const file = join(ROOT, 'data', 'companies.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  let added = 0;
  for (const h of found) {
    if (!cfg[h.ats]) cfg[h.ats] = [];
    if (cfg[h.ats].some((x) => x.slug.toLowerCase() === h.slug.toLowerCase())) continue;
    cfg[h.ats].push({ name: h.name, slug: h.slug });
    added++;
  }
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`  added ${added} new boards to companies.json — run npm run seed to verify them`);
} else if (!write) {
  console.log('  (dry run — pass --write to add them to the registry)');
}
console.log('');
