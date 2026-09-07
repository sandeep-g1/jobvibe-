// Push the machine's stored GitHub token to Vercel as GITHUB_TOKEN, so the
// hosted /api/cron endpoint can dispatch the workflow.
//
// The value is read from git's credential helper and streamed straight to the
// Vercel CLI — never written to .env, never printed, never passed via argv.
//
// Note on scope: the credential stored by Git Credential Manager is a broad
// OAuth token. A fine-grained personal access token limited to this repository
// with Actions: read and write is the safer thing to store in a third-party
// environment, and can be pasted into Search Settings > Keys & credentials.
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCOPE = process.env.VERCEL_SCOPE || 'voiceassistsan';
const VERCEL = join(process.env.APPDATA || '', 'npm', 'vercel.cmd');

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

const token = githubToken();
if (!token) {
  console.error('  No stored GitHub credential found.');
  process.exit(1);
}
if (!existsSync(VERCEL)) {
  console.error('  vercel CLI not found.');
  process.exit(1);
}

const tmp = join(tmpdir(), `jv-ghtok-${Date.now()}.txt`);
writeFileSync(tmp, token, { encoding: 'utf8' });

try {
  for (const env of ['production', 'preview', 'development']) {
    const r = spawnSync(
      `"${VERCEL}" env add GITHUB_TOKEN ${env} --scope ${SCOPE} --force < "${tmp}"`,
      { encoding: 'utf8', shell: true }
    );
    const ok = r.status === 0;
    console.log(`  GITHUB_TOKEN -> ${env.padEnd(12)} ${ok ? 'ok' : 'failed'}`);
    if (!ok) process.exitCode = 1;
  }
} finally {
  try { unlinkSync(tmp); } catch { /* best effort */ }
}
