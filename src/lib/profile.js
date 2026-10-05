// Profile loading.
//
// The repo is public, so personal details live in profile.local.json, which is
// gitignored. profile.example.json is committed as a template. Resolution order:
//   1. profile.local.json   — yours, never committed
//   2. profile.json         — legacy path, still honoured if present
//   3. profile.example.json — template, so a fresh clone runs out of the box
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, cleanEnv } from '../db/driver.js';
import { getProfileRow } from '../db.js';
import { resolveChoice, displayChoice } from './geo.js';

/** A typed place with an obvious typo comes back as the real city name; anything else unchanged. */
export const fixCity = (v) => { const r = resolveChoice(v); return r?.corrected ? displayChoice(r) : v; };

const CANDIDATES = ['profile.local.json', 'profile.json', 'profile.example.json'];

/**
 * On a hosted deployment there is no local file — profile.local.json is
 * gitignored precisely so it stays out of the public repo. PROFILE_JSON carries
 * it instead, set as an environment variable alongside DATABASE_URL.
 */
function fromEnv() {
  const raw = cleanEnv(process.env.PROFILE_JSON);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    p._source = 'PROFILE_JSON';
    return p;
  } catch (err) {
    console.warn(`PROFILE_JSON is set but not valid JSON (${err.message}) — falling back to a file`);
    return null;
  }
}

export function profilePath() {
  for (const name of CANDIDATES) {
    const p = join(ROOT, name);
    if (existsSync(p)) return p;
  }
  throw new Error(
    'No profile found. Copy profile.example.json to profile.local.json and edit it.'
  );
}

export function loadProfile() {
  const fromEnvironment = fromEnv();
  if (fromEnvironment) return fromEnvironment;

  const path = profilePath();
  const p = JSON.parse(readFileSync(path, 'utf8'));
  p._source = path.split(/[\\/]/).pop();
  return p;
}

/**
 * Full chain, database first. The Settings page writes to the database, so a
 * profile edited in the browser takes effect on the very next run — no
 * redeploy, no file edit.
 *
 *   1. profiles table   — edited in the app
 *   2. PROFILE_JSON     — deployment bootstrap
 *   3. profile.local.json / profile.json / profile.example.json
 */
export async function loadProfileAsync(userId = 'local') {
  try {
    const { getProfileRow } = await import('../db.js');
    const row = await getProfileRow(userId);
    if (row && row.data) {
      const p = row.data;
      p._source = 'database';
      p._updatedAt = row.updatedAt;
      return p;
    }
  } catch (err) {
    console.warn(`profile lookup failed (${err.message}) — falling back to file/env`);
  }
  return loadProfile();
}

/** Fields the Settings form owns. Single source of truth for render and save. */
export const FIELDS = [
  { key: 'name', type: 'text', label: 'Full name' },
  { key: 'totalExpYears', type: 'number', label: 'Years of experience' },
  { key: 'baseCity', type: 'text', label: 'Base city' },
  { key: 'jobTitles', type: 'tags', label: 'Job titles to search',
    placeholder: 'e.g. Claims Analyst, then Enter',
    help: 'The roles you want. These are what we search for and what the match score checks. Add 3-6 close variations.' },
  { key: 'preferredLocations', type: 'tags', label: 'Preferred locations', suggest: 'cities', split: true,
    placeholder: 'Type a city and press Enter…',
    help: 'Jobs come only from the cities you add. Add "Remote" for remote roles, a country (e.g. Germany) for that whole country, or "All countries" for everywhere we search: India, UAE, Germany, Ireland, Netherlands, Australia, US, UK.' },
  { key: 'workModes', type: 'modes', label: 'Work modes you accept' },
  { key: 'sources', type: 'sources', label: 'Job portals to search' },
  { key: 'skillBank', type: 'list', label: 'Your skills',
    help: 'One per line. Resume tailoring may only ever use skills listed here.' },
  { key: 'stretchSkills', type: 'toggle', label: 'Let CV tailoring add close-equivalent skills',
    help: 'E.g. adds AWS for an AWS job when your CV shows Azure. Never adds employers, titles, degrees, certifications or numbers. Every added skill is listed for you to prepare before interviews.' },
  { key: 'resumeText', type: 'area', label: 'Resume summary',
    help: 'Plain text. Feeds the semantic match score — richer and more honest scores better.' },
  { key: 'minScore', type: 'number', label: 'Minimum match score' },
  { key: 'dailyLimit', type: 'number', label: 'Jobs per report' },
  { key: 'excludeKeywords', type: 'list', label: 'Exclude titles containing',
    help: 'One per line. Matched against the job title only.' },
  { key: 'excludeCompanies', type: 'list', label: 'Exclude these companies' },
  { key: 'scheduleActive', type: 'toggle', label: 'Run my search automatically every day',
    help: 'Off by default. When on, the daily 08:00 IST run scores new jobs for you and emails your report.' },
  { key: 'emailEnabled', type: 'toggle', label: 'Email me the daily report' },
  { key: 'emailTo', type: 'list', label: 'Send report to',
    help: 'One address per line. These are the main recipients.' },
  { key: 'emailCc', type: 'list', label: 'Copy to',
    help: 'One per line. Copied on every report.' },
];

/** Coerce submitted form values into the profile shape. */
export function normaliseProfile(input, previous = {}, only = null) {
  const out = { ...previous };
  const lines = (v) => String(v || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

  // `only`: a form that shows a subset of fields must not reset the rest
  // (a missing checkbox would otherwise read as "off").
  for (const f of only ? FIELDS.filter((x) => only.includes(x.key)) : FIELDS) {
    let raw = input[f.key];
    // An unticked checkbox submits nothing at all.
    if (f.type === 'toggle' && raw === undefined) raw = 'off';
    if (raw === undefined) continue;
    if (f.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'list') {
      out[f.key] = lines(raw);
    } else if (f.type === 'tags') {
      // Chips submit newline-joined; fields that allow it (locations) also split on commas.
      out[f.key] = String(raw || '').split(f.split ? /[\r\n,]+/ : /[\r\n]+/).map((x) => x.trim()).filter(Boolean);
      // Locations: store the corrected spelling ("bengalore" → "Bengaluru").
      if (f.suggest === 'cities') out[f.key] = [...new Set(out[f.key].map(fixCity))];
    } else if (f.type === 'modes' || f.type === 'sources') {
      out[f.key] = Array.isArray(raw) ? raw.filter(Boolean) : lines(raw);
    } else if (f.type === 'toggle') {
      out[f.key] = raw === 'on' || raw === 'true' || raw === true;
    } else {
      out[f.key] = String(raw).trim();
    }
  }
  out.userId = previous.userId || 'local';
  delete out._source;
  delete out._updatedAt;
  return out;
}

/**
 * What a profile still needs before matching can work. Empty array = complete.
 * @param {object} p       profile
 * @param {boolean} hasCv  whether a CV file is on record
 */
export function missingProfile(p = {}, hasCv = false) {
  const miss = [];
  if (!hasCv) miss.push('your CV');
  if (!(p.jobTitles || []).filter(Boolean).length) miss.push('job titles to search');
  if (p.totalExpYears == null || p.totalExpYears === '') miss.push('years of experience');
  if (!(p.preferredLocations || []).filter(Boolean).length) miss.push('where you want to work');
  return miss;
}
