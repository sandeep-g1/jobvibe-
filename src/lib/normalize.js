// Normalisation + fingerprinting. This is the core of the zero-duplicate guarantee.
import { createHash } from 'node:crypto';
import { normalizeCity } from './india.js';

const COMPANY_NOISE = [
  'private limited', 'pvt ltd', 'pvt. ltd.', 'pvt', 'private', 'limited', 'ltd',
  'incorporated', 'inc', 'llp', 'llc', 'corporation', 'corp', 'company', 'co',
  'technologies', 'technology', 'techologies', 'tech', 'solutions', 'services',
  'systems', 'software', 'labs', 'global', 'international', 'group', 'holdings',
  'consulting', 'consultancy', 'india', 'gmbh', 'plc', 'sa', 'ag', 'bv',
];

/** Collapse a company name to a stable comparison key. */
export function normCompany(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/[&/,.'"()\-—–_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip trailing corporate suffixes repeatedly ("Foo Technologies India Pvt Ltd").
  let changed = true;
  while (changed) {
    changed = false;
    for (const noise of COMPANY_NOISE) {
      const re = new RegExp(`(^|\\s)${noise}$`);
      if (re.test(s)) {
        s = s.replace(re, '').trim();
        changed = true;
      }
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Normalise a job title for fingerprinting.
 *
 * Deliberate deviation from the design doc: seniority words are KEPT.
 * Stripping them would collapse "Project Manager" and "Senior Project Manager"
 * at the same company + city into one row, silently discarding a real job.
 * Repost-with-added-seniority is handled instead by near-duplicate detection
 * (titleSimilarity below), which flags rather than merges.
 */
export function normTitle(title) {
  let s = String(title || '').toLowerCase();
  s = s.replace(/\((?:[^)]*(?:req|job|id|ref|posting)[^)]*)\)/gi, ' '); // "(Req 12345)"
  s = s.replace(/[-–—|,]\s*(?:req(?:uisition)?|job|ref)\.?\s*(?:id|no|#)?\s*[:#]?\s*[a-z0-9-]{3,}\s*$/i, ' ');
  s = s.replace(/\b[ivx]{1,4}\b/g, ' ');           // roman numerals
  s = s.replace(/\b(?:19|20)\d{2}\b/g, ' ');       // stray years
  s = s.replace(/[^a-z0-9+#. ]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function fingerprint({ company, title, city, sourceJobId }) {
  const key = [
    normCompany(company),
    normTitle(title),
    normalizeCity(city) || '',
    sourceJobId ? String(sourceJobId) : '',
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/** Trigram Dice coefficient, 0..1 — used for repost / near-duplicate detection. */
export function trigramSimilarity(a, b) {
  const grams = (s) => {
    const padded = `  ${s}  `;
    const set = new Set();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Two jobs are near-duplicates if same company + city and highly similar titles. */
export function isNearDuplicate(a, b, threshold = 0.9) {
  if (normCompany(a.company) !== normCompany(b.company)) return false;
  if ((normalizeCity(a.city) || '') !== (normalizeCity(b.city) || '')) return false;
  return trigramSimilarity(normTitle(a.title), normTitle(b.title)) >= threshold;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && t.length < 40);
}

const STOP = new Set(
  ('a an the and or but if then else for of to in on at by with from as is are was were be been being ' +
   'this that these those we you they it our your their i he she his her its will would shall should can ' +
   'could may might must do does did have has had not no yes all any some more most other such only own ' +
   'same so than too very just about into over under again further once here there when where why how ' +
   'work working works job role position candidate applicant company team years year experience please ' +
   'apply applying opportunity looking join us help make also across within while ensure using use used')
    .split(' ')
);

export function contentTokens(text) {
  return tokenize(text).filter((t) => !STOP.has(t) && !/^\d+$/.test(t));
}
