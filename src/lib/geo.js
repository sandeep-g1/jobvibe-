// Geography for the 8 countries JobVibe serves. Two jobs:
//   1. Gate: resolve a posting to {cc, city, workMode} and keep it only if its
//      country is being searched this run.
//   2. Scope: turn a user's chosen locations into a hard filter. A user who
//      picks cities gets those cities only (plus remote in that country if they
//      add "Remote"); a country name opens that whole country; "All countries"
//      opens all 8. Nothing outside the user's choices reaches their report.
// India keeps its original, battle-tested rules (india.js); this extends them.
import { indiaGate, normalizeCity as indiaCity } from './india.js';

export const COUNTRY_NAMES = {
  IN: 'India', AE: 'UAE', DE: 'Germany', IE: 'Ireland',
  NL: 'Netherlands', AU: 'Australia', US: 'United States', GB: 'United Kingdom',
};
export const ALL_CC = Object.keys(COUNTRY_NAMES);

// Words that name the country itself (in a posting's location or a user choice).
const COUNTRY_WORDS = {
  IN: /\b(india|bharat)\b/i,
  AE: /\b(united arab emirates|uae|u\.a\.e\.?)\b/i,
  DE: /\b(germany|deutschland)\b/i,
  IE: /\b(ireland|éire)\b/i,
  NL: /\b(netherlands|nederland|holland)\b/i,
  AU: /\b(australia)\b/i,
  US: /\b(united states( of america)?|usa|u\.s\.a?\.?)\b/i,
  GB: /\b(united kingdom|uk|u\.k\.|great britain|england|scotland|wales)\b/i,
};

// ISO-ish codes and names that appear in structured `country` fields.
const COUNTRY_CODES = {
  IN: /^(in|ind|india)$/i, AE: /^(ae|are|uae|united arab emirates)$/i, DE: /^(de|deu|germany|deutschland)$/i,
  IE: /^(ie|irl|ireland)$/i, NL: /^(nl|nld|netherlands|the netherlands)$/i, AU: /^(au|aus|australia)$/i,
  US: /^(us|usa|united states|united states of america)$/i, GB: /^(gb|gbr|uk|united kingdom|great britain)$/i,
};

// canonical city -> aliases, for the non-India countries.
const FOREIGN_CITIES = {
  AE: { dubai: ['dubai'], 'abu dhabi': ['abu dhabi'], sharjah: ['sharjah'] },
  DE: { berlin: ['berlin'], munich: ['munich', 'münchen', 'muenchen'], frankfurt: ['frankfurt'],
    hamburg: ['hamburg'], cologne: ['cologne', 'köln', 'koeln'], stuttgart: ['stuttgart'],
    dusseldorf: ['düsseldorf', 'dusseldorf', 'duesseldorf'] },
  IE: { dublin: ['dublin'], cork: ['cork'], galway: ['galway'], limerick: ['limerick'] },
  NL: { amsterdam: ['amsterdam'], rotterdam: ['rotterdam'], 'the hague': ['the hague', 'den haag'],
    utrecht: ['utrecht'], eindhoven: ['eindhoven'] },
  AU: { sydney: ['sydney'], melbourne: ['melbourne'], brisbane: ['brisbane'], perth: ['perth'],
    adelaide: ['adelaide'], canberra: ['canberra'] },
  US: { 'new york': ['new york', 'nyc'], 'san francisco': ['san francisco'], 'san jose': ['san jose'],
    seattle: ['seattle'], austin: ['austin'], boston: ['boston'], chicago: ['chicago'],
    'los angeles': ['los angeles'], dallas: ['dallas'], houston: ['houston'], atlanta: ['atlanta'],
    denver: ['denver'], 'washington dc': ['washington, dc', 'washington dc', 'washington d.c.'] },
  GB: { london: ['london'], manchester: ['manchester'], edinburgh: ['edinburgh'], birmingham: ['birmingham'],
    glasgow: ['glasgow'], leeds: ['leeds'], bristol: ['bristol'], cambridge: ['cambridge'],
    oxford: ['oxford'], belfast: ['belfast'] },
};

const FOREIGN_ALIAS = [];
for (const [cc, cities] of Object.entries(FOREIGN_CITIES)) {
  for (const [canon, aliases] of Object.entries(cities)) {
    for (const a of aliases) FOREIGN_ALIAS.push({ re: new RegExp(`(^|[^a-z])${a.replace(/[.]/g, '\\.').replace(/ /g, '\\s+')}([^a-z]|$)`, 'i'), canon, cc, len: a.length });
  }
}
FOREIGN_ALIAS.sort((a, b) => b.len - a.len);

/** Every city the app knows, for the location picker. */
export const CITY_LIST = Object.fromEntries(
  Object.entries(FOREIGN_CITIES).map(([cc, c]) => [cc, Object.keys(c)])
);

function foreignCity(text) {
  for (const f of FOREIGN_ALIAS) if (f.re.test(text)) return { cc: f.cc, city: f.canon };
  return null;
}

export function ccFromCountry(country) {
  const s = String(country || '').trim();
  if (!s) return null;
  for (const [cc, re] of Object.entries(COUNTRY_CODES)) if (re.test(s)) return cc;
  return null;
}

function workModeOf(lower, workplaceType = '', isRemote) {
  if (isRemote === true || /^remote/i.test(workplaceType) || /\bremote\b/.test(lower)) return 'Remote';
  if (/hybrid/.test(lower) || /hybrid/i.test(workplaceType)) return 'Hybrid';
  return 'On-site';
}

/**
 * Resolve a posting's location. Returns { cc, city, workMode } (cc null = unknown).
 */
export function resolveJob({ location, isRemote, workplaceType, country, jdText = '' }) {
  const loc = String(location || '');
  const lower = loc.toLowerCase();
  const workMode = workModeOf(lower, workplaceType || '', isRemote);

  // India: the original gate, unchanged.
  const ig = indiaGate({ location, isRemote, workplaceType, country, jdText });
  if (ig.isIndia) return { cc: 'IN', city: ig.city, workMode: ig.workMode };

  const fromField = ccFromCountry(country);
  const fc = foreignCity(loc);
  if (fromField) return { cc: fromField, city: fc && fc.cc === fromField ? fc.city : null, workMode };
  if (fc) return { cc: fc.cc, city: fc.city, workMode };
  for (const [cc, re] of Object.entries(COUNTRY_WORDS)) if (cc !== 'IN' && re.test(loc)) return { cc, city: null, workMode };
  // Bare "US" / "UAE" in a location field ("Remote - US"): uppercase only, so the word "us" never matches.
  if (/(^|[\s,(\-–/|])US([\s,)\-–/|]|$)/.test(loc)) return { cc: 'US', city: null, workMode };

  // Remote with no country: only if the JD scopes it to exactly one country.
  if (workMode === 'Remote') {
    const head = String(jdText).slice(0, 4000);
    const hit = Object.entries(COUNTRY_WORDS).filter(([cc, re]) => cc !== 'IN' && re.test(head)).map(([cc]) => cc);
    if (hit.length === 1) return { cc: hit[0], city: null, workMode };
  }
  return { cc: null, city: null, workMode };
}

/** Resolve one of the user's chosen locations. */
export function resolveChoice(choice) {
  const s = String(choice || '').trim().toLowerCase();
  if (!s) return null;
  if (/^(all|all countries|anywhere|worldwide|global)$/.test(s)) return { all: true };
  if (/^remote$/.test(s)) return { remote: true };
  const inCity = indiaCity(s);
  if (inCity) return { cc: 'IN', city: inCity };
  const fc = foreignCity(s);
  if (fc) return fc;
  const cc = ccFromCountry(s) || Object.entries(COUNTRY_WORDS).find(([, re]) => re.test(s))?.[0];
  if (cc) return { cc, wholeCountry: true };
  return { unknown: s };
}

/**
 * A user's search scope from their chosen locations.
 * @returns {{ all:boolean, remote:boolean, countries:Set<string>, cities:Map<string,string>, crawl:Set<string>, aliases:string[] }}
 */
export function userScope(profile = {}) {
  const scope = { all: false, remote: false, countries: new Set(), cities: new Map(), crawl: new Set(), aliases: [] };
  for (const c of profile.preferredLocations || []) {
    const r = resolveChoice(c);
    if (!r) continue;
    if (r.all) scope.all = true;
    else if (r.remote) scope.remote = true;
    else if (r.wholeCountry) { scope.countries.add(r.cc); scope.crawl.add(r.cc); }
    else if (r.city) { scope.cities.set(r.city, r.cc); scope.crawl.add(r.cc); scope.aliases.push(String(c).toLowerCase().trim()); }
  }
  if (scope.all) ALL_CC.forEach((cc) => scope.crawl.add(cc));
  // Remote with no city/country chosen: remote roles in the base city's country (default India).
  if (!scope.crawl.size) {
    const home = resolveChoice(profile.baseCity);
    const cc = home?.cc || 'IN';
    scope.crawl.add(cc);
    if (!scope.remote) scope.countries.add(cc); // nothing chosen at all: whole home country
  }
  return scope;
}

/** Is this stored job inside the user's scope? job: { country, city, work_mode, location_raw } */
export function inScope(job, scope) {
  const cc = job.country || 'IN'; // rows from before multi-country are all India
  if (scope.all) return true;
  if (!scope.crawl.has(cc)) return false;
  if (scope.countries.has(cc)) return true;
  if (scope.remote && String(job.work_mode).toLowerCase() === 'remote') return true;
  if (job.city && scope.cities.get(job.city) === cc) return true;
  // Multi-city postings ("Bengaluru; Pune; Hyderabad") resolve to one city —
  // still count them if any chosen city appears in the raw location.
  const raw = String(job.location_raw || '').toLowerCase();
  for (const [city, ccc] of scope.cities) {
    if (ccc === cc && raw.includes(city)) return true;
  }
  return scope.aliases.some((a) => a.length > 2 && raw.includes(a));
}
