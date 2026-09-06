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
