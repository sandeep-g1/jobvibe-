// Verify the database connection and schema. Run this first after setting
// DATABASE_URL — it tells you exactly what is wrong if anything is.
import { initDB, closeDB, isPostgres } from '../db.js';
import { DATABASE_URL } from '../db/driver.js';

function redact(url) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

console.log('');
if (!isPostgres) {
  console.log('  DATABASE_URL is not set — using local SQLite.');
  console.log('  To use Supabase, create a .env file containing:');
  console.log('');
  console.log('    DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres');
  console.log('');
} else {
  console.log(`  Connecting to: ${redact(DATABASE_URL)}`);
}

try {
  const d = await initDB();
  console.log(`  Driver: ${d.kind}`);

  const tables = ['companies', 'runs', 'jobs', 'job_matches', 'applications'];
  console.log('');
  console.log('  Tables:');
  for (const t of tables) {
    const r = await d.one(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`    ${t.padEnd(14)} ${String(r.c).padStart(7)} rows`);
  }

  // Round-trip a write to prove the connection is not read-only.
  await d.run(
    `INSERT INTO applications (user_id, fingerprint, status, applied_at) VALUES (?,?,?,?)
     ON CONFLICT (user_id, fingerprint) DO NOTHING`,
    ['__healthcheck__', '__healthcheck__', 'test', new Date().toISOString()]
  );
  await d.run('DELETE FROM applications WHERE user_id = ?', ['__healthcheck__']);

  console.log('');
  console.log('  Read OK · Write OK · Schema OK');
  console.log('  Connection is healthy.');
  console.log('');
  await closeDB();
} catch (err) {
  console.log('');
  console.log(`  FAILED: ${err.message}`);
  console.log('');
  if (/ENOTFOUND|EAI_AGAIN/.test(err.message)) {
    console.log('  The hostname could not be resolved. Check the host in DATABASE_URL.');
  } else if (/password authentication failed/i.test(err.message)) {
    console.log('  Wrong password. Reset it in Supabase: Project Settings > Database.');
  } else if (/ENETUNREACH|ECONNREFUSED|timeout/i.test(err.message)) {
    console.log('  Could not reach the server. If you used port 5432 (direct connection),');
    console.log('  switch to the Transaction pooler string on port 6543 — the free tier');
    console.log('  does not serve direct connections over IPv4.');
  } else if (/self.signed|certificate/i.test(err.message)) {
    console.log('  TLS problem. The driver already sets rejectUnauthorized:false, so this');
    console.log('  is unusual — check for a corporate proxy.');
  }
  console.log('');
  process.exit(1);
}
