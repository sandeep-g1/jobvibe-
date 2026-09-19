// Web app: dashboard, reports index, and any past report rebuilt live from the
// database. Also persists the Applied toggle (localStorage dies with the browser).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, initDB, toggleApplied, markApplied, latestRun, allRuns, runById, matchesForRun,
  appliedSet, isPostgres, saveProfileRow, getProfileRow,
  saveResume, resumeMeta, defaultResume, jobByFingerprint,
} from './db.js';
import { cleanEnv } from './db/driver.js';
import { buildRows, renderReport } from './report.js';
import { dashboardPage, reportsPage, notFoundPage } from './web/pages.js';
import { settingsPage } from './web/settings.js';
import { emailConfigured } from './email.js';
import { secretStatus, saveSecret, loadSecretsIntoEnv, MANAGED } from './lib/secrets.js';
import { spawn } from 'node:child_process';
import { availableQueryAdapters, BOARD_ADAPTERS } from './adapters/index.js';
import { loadProfileAsync, FIELDS, normaliseProfile } from './lib/profile.js';
import {
  currentUser, signup, login, startSession, endSession,
  sessionCookie, clearCookie,
} from './lib/auth.js';
import { loginPage, signupPage } from './web/auth.js';
import { onboardingPage } from './web/onboarding.js';
import { extractText } from './lib/resume.js';
import { parseResume, geminiConfigured } from './lib/gemini.js';
import Busboy from 'busboy';
import { tailorResume } from './lib/tailor.js';

const PORT = Number(process.env.PORT || 3100);
const PASSWORD = cleanEnv(process.env.APP_PASSWORD);

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const profile = (userId = 'local') => loadProfileAsync(userId);

/** Where can a search actually be started from? */
const RUNNER = process.env.VERCEL
  ? (cleanEnv(process.env.GITHUB_TOKEN) ? 'github' : 'none')
  : 'local';

let running = false;

/** Read a urlencoded form body into an object, keeping repeated keys as arrays. */
function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
    req.on('error', reject);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const out = {};
      for (const key of new Set(params.keys())) {
        const all = params.getAll(key);
        out[key] = all.length > 1 ? all : all[0];
      }
      // Unticked checkbox groups submit nothing; treat them as empty, not absent.
      for (const f of FIELDS) {
        if ((f.type === 'modes' || f.type === 'sources') && out[f.key] === undefined) out[f.key] = [];
        else if ((f.type === 'modes' || f.type === 'sources') && !Array.isArray(out[f.key])) {
          out[f.key] = [out[f.key]];
        }
      }
      resolve(out);
    });
  });
}

/** Parse a multipart/form-data body: text fields + a single file (<=6MB). */
function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let file = null;
    let bb;
    try { bb = Busboy({ headers: req.headers, limits: { fileSize: 6 * 1024 * 1024, files: 1 } }); }
    catch (e) { return reject(e); }
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', (d) => chunks.push(d));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        if (info.filename) file = { field: name, filename: info.filename, mime: info.mimeType, buffer: Buffer.concat(chunks), truncated };
      });
    });
    bb.on('close', () => resolve({ fields, file }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

/** Start the pipeline locally as a detached child, or dispatch the GitHub workflow. */
async function startRun(uid = null) {
  if (running) return { started: false, message: 'A search is already running.' };

  if (RUNNER === 'local') {
    running = true;
    // Manual "Search jobs now" matches whoever clicked (or everyone, for the
    // scheduler) regardless of the daily schedule flag — that is the point of
    // the button.
    const args = ['--no-warnings', join(ROOT, 'src', 'run.js'), ...(uid ? ['--user', uid] : ['--all-users'])];
    const child = spawn(process.execPath, args, {
      cwd: ROOT, detached: true, stdio: 'ignore', env: process.env,
    });
    child.unref();
    child.on('exit', () => { running = false; });
    setTimeout(() => { running = false; }, 20 * 60 * 1000);
    return { started: true, message: 'Search started. It takes about five minutes.' };
  }

  if (RUNNER === 'github') {
    const repo = cleanEnv(process.env.GITHUB_REPO) || 'sandeep-g1/jobvibe-';
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/daily-run.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cleanEnv(process.env.GITHUB_TOKEN)}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'jobvibe',
        },
        body: JSON.stringify({ ref: 'main', inputs: { user: uid || '' } }),
      }
    );
    if (res.status === 204) {
      return { started: true, message: 'Search queued on GitHub Actions. About five minutes.' };
    }
    return { started: false, message: `GitHub refused the request (HTTP ${res.status}).` };
  }

  return {
    started: false,
    message: 'No runner available here. Run `npm run run` locally, or set GITHUB_TOKEN.',
  };
}

function sourceStatus(p) {
  const boards = Object.entries(BOARD_ADAPTERS)
    .filter(([k]) => (p.sources || []).includes(k))
    .map(([, a]) => ({ label: a.label, ready: true }));
  const queries = availableQueryAdapters(p.sources)
    .map((t) => ({ label: t.adapter.label, ready: t.ready }));
  return [...boards, ...queries];
}

/**
 * A deploy with no DATABASE_URL would otherwise fall over with a stack trace.
 * Say what is wrong and where to fix it instead.
 */
function setupPage(detail) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup needed — Shortlist India</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#f0f2f5;margin:0;padding:40px 20px;color:#1a1a2e}
.b{max-width:620px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;
box-shadow:0 2px 14px rgba(0,0,0,.08)}h1{font-size:1.25rem;color:#0a66c2;margin:0 0 6px}
p{color:#667085;font-size:.9rem;line-height:1.6}code{background:#f2f4f8;padding:2px 6px;
border-radius:4px;font-size:.85rem}ol{color:#667085;font-size:.9rem;line-height:1.9}
.e{background:#fee2e2;color:#991b1b;padding:10px 14px;border-radius:8px;font-size:.82rem;
margin-top:18px;font-family:monospace;word-break:break-all}</style></head>
<body><div class="b"><h1>Almost there</h1>
<p>The app is deployed but has no database to read from.</p>
<ol><li>Vercel &rarr; your project &rarr; <b>Settings &rarr; Environment Variables</b></li>
<li>Add <code>DATABASE_URL</code> — your Supabase <b>Transaction pooler</b> string (port 6543)</li>
<li>Add <code>APP_PASSWORD</code> — any password; it protects this dashboard</li>
<li>Tick Production, Preview and Development</li>
<li><b>Deployments &rarr; &ctdot; &rarr; Redeploy</b></li></ol>
<div class="e">${esc(detail)}</div></div></body></html>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _ready = false;
/** Load DB + decrypt secrets into env once per (cold) process. Gemini/Resend
 *  keys live encrypted in the DB, so the web process must hydrate them too. */
async function ensureReady() {
  if (_ready) return;
  try { await initDB(); await loadSecretsIntoEnv(); } catch { /* handler reports errors */ }
  _ready = true;
}

export async function handler(req, res) {
  await ensureReady();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Health check — reachable without the password so deploys can be diagnosed.
  if (path === '/api/health') {
    const out = { ok: false, storage: isPostgres ? 'postgres' : 'sqlite', databaseUrlSet: isPostgres };
    // Diagnostics only — host and lengths, never the credential itself.
    try {
      const raw = process.env.DATABASE_URL || '';
      out.dbUrlLen = raw.length;
      const u = new URL(raw);
      out.dbHost = u.hostname;
      out.dbPort = u.port;
      out.dbName = u.pathname;
      out.dbUser = u.username;
    } catch (e) {
      out.dbUrlParse = `unparseable: ${e.message}`;
      out.dbUrlHead = (process.env.DATABASE_URL || '').slice(0, 14);
    }
    out.appPasswordLen = PASSWORD.length;
    try {
      const run = await latestRun();
      out.ok = true;
      out.latestRun = run ? { id: run.id, jobs: run.n_reported, at: run.started_at } : null;
    } catch (err) {
      out.error = err.message;
    }
    return send(res, out.ok ? 200 : 503, 'application/json', JSON.stringify(out, null, 2));
  }

  // Vercel Cron hits this. GitHub's own scheduler is best-effort and has been
  // running ~4.7 hours late, so the punctual trigger lives here and dispatches
  // the workflow, which is where the five-minute run can actually execute.
  if (path === '/api/cron') {
    const secret = cleanEnv(process.env.CRON_SECRET);
    const auth = req.headers.authorization || '';
    const fromVercelCron = !!req.headers['x-vercel-cron'];
    const authorised = secret ? auth === `Bearer ${secret}` : fromVercelCron;

    if (!authorised) {
      return send(res, 401, 'application/json', JSON.stringify({ error: 'unauthorised' }));
    }
    const out = await startRun();
    return send(res, out.started ? 202 : 409, 'application/json',
      JSON.stringify({ ...out, at: new Date().toISOString(), runner: RUNNER }));
  }

  if (!isPostgres && process.env.VERCEL) {
    return send(res, 503, 'text/html; charset=utf-8',
      setupPage('DATABASE_URL is not set in this deployment.'));
  }

  // ---- public auth routes ----
  if (path === '/login' && req.method === 'GET') {
    return send(res, 200, 'text/html; charset=utf-8', loginPage());
  }
  if (path === '/signup' && req.method === 'GET') {
    return send(res, 200, 'text/html; charset=utf-8',
      signupPage({ email: url.searchParams.get('email') || '' }));
  }
  if (path === '/login' && req.method === 'POST') {
    const form = await readForm(req);
    const r = await login({ email: form.email, password: form.password });
    if (!r.ok) return send(res, 401, 'text/html; charset=utf-8',
      loginPage({ error: r.error, email: form.email, noAccount: r.noAccount }));
    const { token, expires } = await startSession(r.userId);
    res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie(token, expires) });
    return res.end();
  }
  if (path === '/signup' && req.method === 'POST') {
    const form = await readForm(req);
    const r = await signup({ email: form.email, password: form.password, name: form.name });
    if (!r.ok) return send(res, 400, 'text/html; charset=utf-8', signupPage({ error: r.error, email: form.email, name: form.name }));
    const { token, expires } = await startSession(r.userId);
    res.writeHead(303, { Location: '/onboarding', 'Set-Cookie': sessionCookie(token, expires) });
    return res.end();
  }
  if (path === '/logout') {
    const u = await currentUser(req).catch(() => null);
    const sid = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
    if (sid) await endSession(sid.slice(4));
    res.writeHead(303, { Location: '/login', 'Set-Cookie': clearCookie() });
    return res.end();
  }

  // ---- everything below requires a session ----
  const user = await currentUser(req);
  if (!user) {
    res.writeHead(303, { Location: '/login' });
    return res.end();
  }
  const uid = user.id;

  try {
    /* ---- API ---- */
    if (path === '/api/applied' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        try {
          const { fingerprint } = JSON.parse(body);
          if (!fingerprint) return send(res, 400, 'application/json', '{"error":"fingerprint required"}');
          toggleApplied(fingerprint, uid)
            .then((out) => send(res, 200, 'application/json', JSON.stringify(out)))
            .catch((e) => send(res, 500, 'application/json', JSON.stringify({ error: e.message })));
        } catch (e) {
          send(res, 400, 'application/json', JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (path === '/api/runs') {
      return send(res, 200, 'application/json', JSON.stringify(await allRuns(uid), null, 2));
    }

    /* ---- pages ---- */
    if (path === '/') {
      const p = await profile(uid);
      return send(res, 200, 'text/html; charset=utf-8', await dashboardPage(p, sourceStatus(p), uid, user));
    }

    if (path === '/settings' && req.method === 'GET') {
      const p = await profile(uid);
      return send(res, 200, 'text/html; charset=utf-8',
        settingsPage(p, FIELDS, {
          runner: RUNNER,
          lastRun: await latestRun(uid),
          emailNote: emailConfigured()
            ? 'Mail is configured. A digest is sent after every search.'
            : 'No mail provider yet — set RESEND_API_KEY and these addresses start receiving reports.',
          saved: url.searchParams.get('saved') === '1',
          welcome: url.searchParams.get('welcome') === '1',
          autofilled: url.searchParams.get('autofilled') === '1',
          autofillErr: url.searchParams.get('autofill') === 'err',
          resume: await resumeMeta(uid),
          isAdmin: !!user.is_admin,
          secrets: user.is_admin ? await secretStatus() : [],
        }));
    }

    if (path === '/settings' && req.method === 'POST') {
      const form = await readForm(req);
      const previous = await profile(uid);
      const merged = normaliseProfile(form, previous);
      merged.userId = uid;
      await saveProfileRow(merged, uid);
      res.writeHead(303, { Location: '/settings?saved=1' });
      return res.end();
    }

    if (path === '/settings/keys' && req.method === 'POST') {
      if (!user.is_admin) return send(res, 403, 'text/html; charset=utf-8', notFoundPage('Admins only.'));
      const form = await readForm(req);
      let changed = 0;
      for (const m of MANAGED) {
        const v = form[m.key];
        if (v === undefined || v === '') continue; // blank means "leave alone"
        await saveSecret(m.key, v.trim());
        changed++;
      }
      await loadSecretsIntoEnv();
      res.writeHead(303, { Location: `/settings?saved=1&keys=${changed}` });
      return res.end();
    }

    if (path === '/api/tailor' && req.method === 'POST') {
      const form = await readForm(req);
      const fp = form.fingerprint;
      const j = fp ? await jobByFingerprint(fp) : null;
      if (!j) return send(res, 404, 'application/json', '{"error":"job not found"}');

      const resume = await defaultResume(uid);
      if (!resume || !resume.content_b64) {
        return send(res, 400, 'application/json',
          JSON.stringify({ error: 'Upload your CV first (Settings → Your CV).' }));
      }
      if (resume.kind !== 'docx') {
        return send(res, 400, 'application/json',
          JSON.stringify({ error: 'Tailoring needs a .docx CV. Re-upload as .docx to enable it.' }));
      }
      const p = await profile(uid);
      const r = await tailorResume(Buffer.from(resume.content_b64, 'base64'), j, p.skillBank || []);
      if (!r.ok) return send(res, 502, 'application/json', JSON.stringify({ error: r.error }));

      const safe = (s2) => String(s2 || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      const fname = `${safe(p.name || 'Resume')}_${safe(j.company)}_${safe(j.title)}.docx`;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'X-Tailor-Changed': String(r.changed),
        'X-Tailor-Gaps': encodeURIComponent((r.gaps || []).join(', ')),
        'Cache-Control': 'no-store',
      });
      return res.end(r.buffer);
    }

    if (path === '/api/skills/add' && req.method === 'POST') {
      const form = await readForm(req);
      const skill = String(form.skill || '').trim();
      if (!skill) return send(res, 400, 'application/json', '{"error":"skill required"}');
      const prev = await profile(uid);
      const bank = Array.isArray(prev.skillBank) ? prev.skillBank.slice() : [];
      const exists = bank.some((s) => s.toLowerCase() === skill.toLowerCase());
      if (!exists) bank.push(skill);
      const merged = { ...prev, skillBank: bank, userId: uid };
      delete merged._source; delete merged._updatedAt;
      await saveProfileRow(merged, uid);
      return send(res, 200, 'application/json',
        JSON.stringify({ ok: true, added: !exists, skillBank: bank }));
    }

    if (path === '/api/skills/remove' && req.method === 'POST') {
      const form = await readForm(req);
      const skill = String(form.skill || '').trim();
      if (!skill) return send(res, 400, 'application/json', '{"error":"skill required"}');
      const prev = await profile(uid);
      const bank = (Array.isArray(prev.skillBank) ? prev.skillBank : [])
        .filter((s) => s.toLowerCase() !== skill.toLowerCase());
      const merged = { ...prev, skillBank: bank, userId: uid };
      delete merged._source; delete merged._updatedAt;
      await saveProfileRow(merged, uid);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, skillBank: bank }));
    }

    if (path === '/api/apply' && req.method === 'POST') {
      const form = await readForm(req);
      const fp = String(form.fingerprint || '').trim();
      if (!fp) return send(res, 400, 'application/json', '{"error":"fingerprint required"}');
      const out = await markApplied(fp, uid);
      const p = await profile(uid);
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true, applied: out.applied, already: out.already,
        contact: { name: p.name || '', email: p.email || '', phone: p.phone || '' },
      }));
    }

    if (path === '/api/run' && req.method === 'POST') {
      const knownRuns = (await allRuns(uid)).length;
      const out = await startRun(uid);
      return send(res, out.started ? 202 : 409, 'application/json',
        JSON.stringify({ ...out, knownRuns, runner: RUNNER }));
    }

    if (path === '/onboarding' && req.method === 'GET') {
      const p = await profile(uid);
      return send(res, 200, 'text/html; charset=utf-8',
        onboardingPage({ profile: p, resume: await resumeMeta(uid), geminiOn: geminiConfigured() }));
    }

    if (path === '/onboarding' && req.method === 'POST') {
      const { fields, file } = await readMultipart(req);
      const prev = await profile(uid);
      // basic details the user typed
      const merged = { ...prev, userId: uid };
      if (fields.name) merged.name = fields.name.trim();
      if (fields.baseCity) merged.baseCity = fields.baseCity.trim().toLowerCase();
      if (fields.totalExpYears !== undefined && fields.totalExpYears !== '') {
        const n = Number(fields.totalExpYears); if (Number.isFinite(n)) merged.totalExpYears = n;
      }

      let autofillErr = null;
      if (file && file.buffer && file.buffer.length) {
        if (file.truncated) autofillErr = 'That file is over 6 MB — please upload a smaller CV.';
        else {
          const ext = await extractText(file.buffer, file.filename, file.mime);
          if (!ext.ok) autofillErr = ext.error;
          else {
            let parsed = null;
            if (geminiConfigured()) {
              const pr = await parseResume(ext.text);
              if (pr.ok) {
                parsed = pr.data;
                // Fill fields the user left blank; never overwrite what they typed.
                if (!merged.name && parsed.name) merged.name = parsed.name;
                if (!merged.baseCity && parsed.baseCity) merged.baseCity = parsed.baseCity;
                if (!merged.totalExpYears && parsed.totalExpYears) merged.totalExpYears = parsed.totalExpYears;
                if (parsed.jobTitles?.length) merged.jobTitles = parsed.jobTitles;
                if (parsed.skillBank?.length) merged.skillBank = parsed.skillBank;
                if (parsed.resumeText) merged.resumeText = parsed.resumeText;
                if (parsed.email && !(merged.emailTo || []).length) merged.emailTo = [parsed.email];
              } else {
                autofillErr = `Autofill could not read that CV (${pr.error}). Details saved; you can edit them next.`;
              }
            }
            await saveResume({
              userId: uid, filename: file.filename, kind: ext.kind,
              contentB64: file.buffer.toString('base64'), parsed,
            });
          }
        }
      }

      await saveProfileRow(merged, uid);
      const q = autofillErr ? `welcome=1&autofill=err` : `welcome=1&autofilled=1`;
      res.writeHead(303, { Location: `/settings?${q}` });
      return res.end();
    }

    if (path === '/reports') {
      return send(res, 200, 'text/html; charset=utf-8', await reportsPage(await profile(uid), uid));
    }

    const m = path.match(/^\/reports\/(latest|\d+)$/);
    if (m) {
      const run = m[1] === 'latest' ? await latestRun(uid) : await runById(Number(m[1]), uid);
      if (!run) {
        return send(res, 404, 'text/html; charset=utf-8',
          notFoundPage(`No report #${m[1]} exists yet.`));
      }
      const rows = buildRows(await matchesForRun(run.id), await appliedSet(uid));
      const html = renderReport(rows, {
        profile: await profile(uid),
        runId: run.id,
        errors: JSON.parse(run.errors || '[]'),
        perSource: JSON.parse(run.per_source || '{}'),
        date: new Date(run.started_at).toISOString().slice(0, 10),
      });
      // Give the standalone report a way back into the app.
      return send(res, 200, 'text/html; charset=utf-8',
        html.replace('<div class="header">',
          '<div style="background:#fff;border-bottom:1px solid #e2e6ee;padding:11px 40px;font-size:.85rem">' +
          '<a href="/" style="color:#0a66c2;text-decoration:none;font-weight:600">&larr; Dashboard</a>' +
          '<span style="color:#c8cfda;margin:0 10px">|</span>' +
          '<a href="/reports" style="color:#0a66c2;text-decoration:none;font-weight:600">All reports</a>' +
          '</div><div class="header">'));
    }

    // Static files previously written to reports/ still resolve.
    const file = join(ROOT, 'reports', path.replace(/^\/+/, ''));
    if (file.startsWith(join(ROOT, 'reports')) && existsSync(file) && file.endsWith('.html')) {
      return send(res, 200, 'text/html; charset=utf-8', readFileSync(file));
    }

    send(res, 404, 'text/html; charset=utf-8', notFoundPage(`Nothing at ${path}`));
  } catch (err) {
    send(res, 500, 'text/html; charset=utf-8', notFoundPage(err.message));
  }
}

export default handler;

// Only start a listening server when run directly (`npm run serve`).
// On Vercel the exported handler is invoked per request instead.
const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('serve.js');
if (RUN_DIRECTLY) {
  await initDB();
  const server = createServer(handler);
  server.listen(PORT, '0.0.0.0', async () => {
    const run = await latestRun();
    console.log('\n  Shortlist India');
    console.log(`  storage: ${isPostgres ? 'Postgres (Supabase)' : 'SQLite (local)'}`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  Dashboard · Reports · ${run ? `latest run #${run.id} (${run.n_reported} jobs)` : 'no runs yet'}`);
    if (!PASSWORD) console.log('  No APP_PASSWORD set — fine locally, required before hosting publicly.');
    console.log('');
  });
}
