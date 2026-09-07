// Credentials entered in the browser.
//
// Keys are stored in the database encrypted with AES-256-GCM, under a key
// derived from APP_PASSWORD via scrypt. A dump of the database alone therefore
// does not reveal them. The trade-off is explicit: change APP_PASSWORD and the
// stored keys can no longer be decrypted and must be entered again.
//
// Resolution order for every secret is environment variable first, then the
// database — so a local .env keeps working and always wins.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { cleanEnv } from '../db/driver.js';
import { getSecretRow, listSecretNames, saveSecretRow, deleteSecretRow } from '../db.js';

/** Secrets that can be supplied through the UI. DATABASE_URL cannot: it is
 *  needed to reach the database in the first place. */
export const MANAGED = [
  { key: 'RESEND_API_KEY', label: 'Resend API key',
    help: 'Sends the daily digest email. resend.com → API Keys.' },
  { key: 'EMAIL_FROM', label: 'Email "from" address', plain: true,
    help: 'Optional. Defaults to Resend’s shared sender.' },
  { key: 'GITHUB_TOKEN', label: 'GitHub token',
    help: 'Lets the "Search jobs now" button work on the hosted site. Needs the workflow scope.' },
  { key: 'RAPIDAPI_KEY', label: 'JSearch / RapidAPI key',
    help: 'Unlocks Naukri, LinkedIn, Indeed and Foundit listings via Google for Jobs.' },
  { key: 'ADZUNA_APP_ID', label: 'Adzuna app id', plain: true },
  { key: 'ADZUNA_APP_KEY', label: 'Adzuna app key' },
  { key: 'JOOBLE_API_KEY', label: 'Jooble API key' },
  { key: 'CAREERJET_AFFID', label: 'Careerjet affiliate id', plain: true },
];

const MANAGED_KEYS = new Set(MANAGED.map((m) => m.key));

function derive() {
  const pw = cleanEnv(process.env.APP_PASSWORD) || 'jobvibe-no-password-set';
  // Fixed salt: the database is per-user and the goal is encryption at rest,
  // not password storage.
  return scryptSync(pw, 'jobvibe.secrets.v1', 32);
}

export function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(stored) {
  const [ivB, tagB, dataB] = String(stored).split('.');
  if (!ivB || !tagB || !dataB) throw new Error('malformed stored secret');
  const decipher = createDecipheriv('aes-256-gcm', derive(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

export async function saveSecret(name, value) {
  if (!MANAGED_KEYS.has(name)) throw new Error(`${name} is not a managed secret`);
  const v = String(value || '').trim();
  if (!v) {
    await deleteSecretRow(name);
    return { name, cleared: true };
  }
  await saveSecretRow(name, encrypt(v));
  return { name, saved: true };
}

/**
 * Copy every stored secret into process.env, unless already set there.
 * Called once at startup so the rest of the code keeps reading process.env
 * and needs no knowledge of where a value came from.
 */
export async function loadSecretsIntoEnv() {
  const loaded = [];
  const failed = [];
  let names = [];
  try {
    names = await listSecretNames();
  } catch {
    return { loaded, failed }; // table may not exist yet
  }

  for (const name of names) {
    if (cleanEnv(process.env[name])) continue; // env var wins
    try {
      const row = await getSecretRow(name);
      if (!row) continue;
      process.env[name] = decrypt(row.value);
      loaded.push(name);
    } catch {
      // Wrong APP_PASSWORD, or the row predates a password change.
      failed.push(name);
    }
  }
  return { loaded, failed };
}

/** Which secrets are configured, and from where. Never returns a value. */
export async function secretStatus() {
  let stored = [];
  try {
    stored = await listSecretNames();
  } catch { /* table may not exist yet */ }
  const inDb = new Set(stored);

  return MANAGED.map((m) => ({
    ...m,
    fromEnv: !!cleanEnv(process.env[m.key]) && !inDb.has(m.key),
    inDb: inDb.has(m.key),
    set: !!cleanEnv(process.env[m.key]) || inDb.has(m.key),
  }));
}
