// Profile loading.
//
// The repo is public, so personal details live in profile.local.json, which is
// gitignored. profile.example.json is committed as a template. Resolution order:
//   1. profile.local.json   — yours, never committed
//   2. profile.json         — legacy path, still honoured if present
//   3. profile.example.json — template, so a fresh clone runs out of the box
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db/driver.js';

const CANDIDATES = ['profile.local.json', 'profile.json', 'profile.example.json'];

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
  const path = profilePath();
  const p = JSON.parse(readFileSync(path, 'utf8'));
  p._source = path.split(/[\\/]/).pop();
  return p;
}
