// Send (or preview) the daily applications report now.
//   node --env-file=.env src/tools/app-report.js            send to every active user (admin in CC)
//   node --env-file=.env src/tools/app-report.js --preview  write the emails to report-preview.html, send nothing
//   ... --user <id>                                           one user only
import { writeFileSync } from 'node:fs';
import { initDB } from '../db.js';
import { loadSecretsIntoEnv } from '../lib/secrets.js';
import { sendAppReports } from '../app-report.js';

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const only = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;
await initDB();
await loadSecretsIntoEnv();
const out = await sendAppReports({ only, dryRun: preview });
if (preview) {
  writeFileSync('report-preview.html', out.previews.map((p) => `<p><b>To:</b> ${p.to} · <b>CC:</b> ${p.cc.join(', ')}<br><b>Subject:</b> ${p.subject}</p>${p.html}<hr>`).join(''));
  console.log(`${out.previews.length} report(s) written to report-preview.html`);
} else {
  console.log(`sent ${out.sent}, skipped ${out.skipped}${out.errors.length ? `, errors: ${out.errors.join('; ')}` : ''}`);
}
process.exit(0);
