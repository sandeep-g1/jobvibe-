// Set a GitHub Actions repository secret.
//
// Uses the git credential already stored on this machine (the same one that
// authorises `git push`) and libsodium sealed-box encryption, which is what the
// GitHub API requires. Nothing secret is ever printed.
//
//   node src/tools/set-gh-secret.js DATABASE_URL
//
// The value is read from .env, never from the command line, so it does not land
// in shell history.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, cleanEnv } from '../db/driver.js';
import sodiumLib from 'libsodium-wrappers';

const REPO = process.env.GITHUB_REPO || 'sandeep-g1/jobvibe-';
const NAME = process.argv[2];

if (!NAME) {
  console.error('usage: node src/tools/set-gh-secret.js <SECRET_NAME>');
  process.exit(1);
}

/** Ask git's credential helper for the stored github.com token. */
function githubToken() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('password=')) return line.slice('password='.length).trim();
  }
  return null;
}

/** Read one value out of .env without echoing it. */
function envValue(key) {
  const txt = readFileSync(join(ROOT, '.env'), 'utf8').replace(/^﻿/, '');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
    if (m) return cleanEnv(m[1]);
  }
  return null;
}

async function api(path, init = {}, token) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'jobvibe',
      ...(init.headers || {}),
    },
  });
}

const token = githubToken();
if (!token) {
  console.error('No stored GitHub credential found. Run `git push` once to create one.');
  process.exit(1);
}

const value = envValue(NAME);
if (!value) {
  console.error(`${NAME} is not set in .env`);
  process.exit(1);
}

const keyRes = await api('/actions/secrets/public-key', {}, token);
if (!keyRes.ok) {
  console.error(`Could not read the repo public key (HTTP ${keyRes.status}).`);
  console.error('The stored token may lack the "repo" scope.');
  process.exit(1);
}
const { key, key_id: keyId } = await keyRes.json();

await sodiumLib.ready;
const sodium = sodiumLib;
const sealed = sodium.crypto_box_seal(
  sodium.from_string(value),
  sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
);
const encrypted = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

const putRes = await api(`/actions/secrets/${NAME}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ encrypted_value: encrypted, key_id: keyId }),
}, token);

if (putRes.status !== 201 && putRes.status !== 204) {
  console.error(`Failed to set ${NAME} (HTTP ${putRes.status})`);
  console.error(await putRes.text());
  process.exit(1);
}

console.log(`  ${NAME} set on ${REPO} (${value.length} chars, encrypted client-side)`);

const list = await api('/actions/secrets', {}, token);
if (list.ok) {
  const j = await list.json();
  console.log('  secrets now:', j.secrets.map((s) => s.name).join(', ') || '(none)');
}
