// Validate Workday career sites and record how many open jobs each has in the
// countries JobVibe serves. Input: data/workday-candidates.json (tenant/wd/site
// triples found in the Common Crawl index). Output: data/workday.json — only
// sites that answer and have jobs in at least one target country, with the
// facet ids needed to query each country directly.
//
//   node src/seed-workday.js
//
// One small POST per site to the same public endpoint the career page itself
// calls; robots.txt for these sites allows the career-site paths.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './db/driver.js';

export const COUNTRIES = {
  IN: [/^india$/i],
  AE: [/^united arab emirates$/i, /^uae$/i, /^dubai$/i],
  DE: [/^germany$/i, /^deutschland$/i],
  IE: [/^ireland$/i],
  NL: [/^netherlands$/i, /^the netherlands$/i, /^nederland$/i],
  AU: [/^australia$/i],
  US: [/^united states( of america)?$/i, /^usa$/i, /^us$/i],
  GB: [/^united kingdom$/i, /^uk$/i, /^great britain$/i, /^england$/i],
};

export function wdEndpoint({ tenant, wd, site }) {
  return `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
}

/** Walk Workday's facet tree; return {CC: {count, facet, id}} for target countries. */
export function countryFacets(facets) {
  const found = {};
  const walk = (list, param) => {
    for (const v of list || []) {
      const p = v.facetParameter || param;
      if (Array.isArray(v.values)) { walk(v.values, p); continue; }
      const name = String(v.descriptor || '').trim();
      for (const [cc, pats] of Object.entries(COUNTRIES)) {
        if (pats.some((re) => re.test(name)) && v.count > (found[cc]?.count || 0)) {
          found[cc] = { count: v.count, facet: p, id: v.id };
        }
      }
    }
  };
  walk(facets);
  return found;
}

async function probe(site) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(wdEndpoint(site), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'JobVibe/1.0' },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { total: j.total || 0, countries: countryFacets(j.facets) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  // Workday site paths are case-insensitive: "AccentureCareers" and
  // "accenturecareers" are the same board, so keep one of each.
  const seen = new Set();
  const cands = JSON.parse(readFileSync(join(ROOT, 'data', 'workday-candidates.json'), 'utf8'))
    .filter((s) => { const k = `${s.tenant}|${s.site.toLowerCase()}`; return !seen.has(k) && seen.add(k); });
  const out = [];
  let done = 0;
  const queue = cands.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      const r = await probe(s);
      done++;
      if (r && Object.keys(r.countries).length) out.push({ ...s, total: r.total, countries: r.countries });
      if (done % 100 === 0) console.log(`  ${done}/${cands.length} probed · ${out.length} useful`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  out.sort((a, b) => b.total - a.total);
  writeFileSync(join(ROOT, 'data', 'workday.json'), JSON.stringify(out, null, 1));

  const sum = {};
  for (const s of out) for (const [cc, v] of Object.entries(s.countries)) {
    sum[cc] = sum[cc] || { sites: 0, jobs: 0 };
    sum[cc].sites++; sum[cc].jobs += v.count;
  }
  console.log(`\n  ${out.length} useful Workday sites (of ${cands.length})`);
  for (const [cc, v] of Object.entries(sum)) console.log(`   ${cc}: ${v.sites} employers · ${v.jobs} open jobs`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('seed-workday.js')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
