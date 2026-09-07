// Push secrets from .env to Vercel and GitHub Actions in one step.
//
//   node src/tools/push-secrets.js RESEND_API_KEY
//   node src/tools/push-secrets.js RESEND_API_KEY EMAIL_FROM --vercel-only
//
// Values are read from .env and streamed through a temp file, never through
// argv (which would land in shell history) and never printed. The temp file is
// written without a BOM and deleted afterwards — a BOM in a piped value is what
// previously broke DATABASE_URL in production.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, cleanEnv } from '../db/driver.js';
import sodiumLib from 'libsodium-wrappers';

const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith('--'));
const vercelOnly = args.includes('--vercel-only');
const githubOnly = args.includes('--github-only');

const REPO = process.env.GITHUB_REPO || 'sandeep-g1/jobvibe-';
const SCOPE = process.env.VERCEL_SCOPE || 'voiceassistsan';
const VERCEL = join(process.env.APPDATA || '', 'npm', 'vercel.cmd');

if (!names.length) {
  console.error('usage: node src/tools/push-secrets.js NAME [NAME...] [--vercel-only|--github-only]');
  process.exit(1);
}

function envValue(key) {
  const txt = readFileSync(join(ROOT, '.env'), 'utf8').replace(/^﻿/, '');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
    if (m) return cleanEnv(m[1]);
  }
  return null;
}

function githubToken() {
  const r = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  for (const line of r.stdout.split(/\r?\n/)) {
    if (line.startsWith('password=')) return line.slice(9).trim();
  }
  return null;
}

/** cmd.exe input redirection: PowerShell's pipe prepends a BOM, this does not. */
function pushToVercel(name, value) {
  if (!existsSync(VERCEL)) return 'vercel CLI not found';
  const tmp = join(tmpdir(), `jv-${name}-${Date.now()}.txt`);
  writeFileSync(tmp, value, { encoding: 'utf8' });
  try {
    for (const env of ['production', 'preview', 'development']) {
      // shell:true so Windows handles the quoting and the < redirection itself;
      // passing this through an args array had cmd.exe mangle the quotes.
      const r = spawnSync(
        `"${VERCEL}" env add ${name} ${env} --scope ${SCOPE} --force < "${tmp}"`,
        { encoding: 'utf8', shell: true }
      );
      if (r.status !== 0) {
        const last = String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop();
        return `vercel ${env} failed (${last || 'exit ' + r.status})`;
      }
    }
    return 'ok';
  } finally {
    try { unlinkSync(tmp); } catch { /* best effort */ }
  }
}

async function pushToGitHub(name, value, token) {
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jobvibe' };
  const keyRes = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers: head });
  if (!keyRes.ok) return `public-key HTTP ${keyRes.status}`;
  const { key, key_id: keyId } = await keyRes.json();

  await sodiumLib.ready;
  const sealed = sodiumLib.crypto_box_seal(
    sodiumLib.from_string(value),
    sodiumLib.from_base64(key, sodiumLib.base64_variants.ORIGINAL)
  );
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { ...head, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encrypted_value: sodiumLib.to_base64(sealed, sodiumLib.base64_variants.ORIGINAL),
      key_id: keyId,
    }),
  });
  return res.status === 201 || res.status === 204 ? 'ok' : `PUT HTTP ${res.status}`;
}

const token = githubOnly || !vercelOnly ? githubToken() : null;

for (const name of names) {
  const value = envValue(name);
  if (!value) {
    console.log(`  ${name.padEnd(18)} not in .env — skipped`);
    continue;
  }
  const parts = [`${value.length} chars`];
  if (!githubOnly) parts.push(`vercel: ${pushToVercel(name, value)}`);
  if (!vercelOnly) {
    parts.push(token ? `github: ${await pushToGitHub(name, value, token)}` : 'github: no credential');
  }
  console.log(`  ${name.padEnd(18)} ${parts.join(' · ')}`);
}
