// Source adapters. Every adapter returns rows in one shape, and the single
// unbreakable rule is: apply_url comes from the provider payload. Nothing in
// this directory ever assembles a URL from parts.
//
// Two kinds:
//   kind 'board' — Tier B. Iterated per company from the verified registry.
//                  Keyless, unmetered, full JD text.
//   kind 'query' — Tier A. Iterated per search term. Needs a free API key.
//                  This is how Naukri / LinkedIn / Indeed listings are reached,
//                  via aggregators that already index them.
import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as smartrecruiters from './smartrecruiters.js';
import * as adzuna from './adzuna.js';
import * as jooble from './jooble.js';
import * as careerjet from './careerjet.js';
import * as jsearch from './jsearch.js';

export const ADAPTERS = {
  greenhouse, lever, ashby, smartrecruiters,
  adzuna, jooble, careerjet, jsearch,
};

export const ADAPTER_IDS = Object.keys(ADAPTERS);

export const BOARD_ADAPTERS = Object.fromEntries(
  Object.entries(ADAPTERS).filter(([, a]) => (a.kind || 'board') === 'board')
);
export const QUERY_ADAPTERS = Object.fromEntries(
  Object.entries(ADAPTERS).filter(([, a]) => a.kind === 'query')
);

/** Tier A adapters that actually have a usable key right now. */
export function availableQueryAdapters(enabled) {
  const out = [];
  for (const [key, a] of Object.entries(QUERY_ADAPTERS)) {
    if (enabled?.length && !enabled.includes(key)) continue;
    out.push({ key, adapter: a, ready: a.configured() });
  }
  return out;
}

/**
 * Shape every adapter must return:
 * {
 *   source, source_job_id, title, company, location_raw,
 *   apply_url,            // REQUIRED, provider-supplied
 *   jd_text, posted_at, employment_type_hint,
 *   is_remote, workplace_type, country,
 *   publisher?, salary_raw?
 * }
 * A row missing apply_url is dropped by the pipeline before it can reach the DB.
 */
export function isUsable(row) {
  return !!(row && row.title && row.company && typeof row.apply_url === 'string' &&
    /^https?:\/\//i.test(row.apply_url));
}
