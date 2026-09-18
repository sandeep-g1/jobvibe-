// Web app: dashboard, reports index, and any past report rebuilt live from the
// database. Also persists the Applied toggle (localStorage dies with the browser).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, initDB, toggleApplied, latestRun, allRuns, runById, matchesForRun,
  appliedSet, isPostgres, saveProfileRow,
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

/** Start the pipeline locally as a detached child, or dispatch the GitHub workflow. */
async function startRun() {
  if (running) return { started: false, message: 'A search is already running.' };

  if (RUNNER === 'local') {
    running = true;
    // Manual "Search jobs now" runs for everyone present regardless of the daily
    // schedule flag — the whole point of the button is on-demand.
    const child = spawn(process.execPath, ['--no-warnings', join(ROOT, 'src', 'run.js'), '--all-users'], {
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
        body: JSON.stringify({ ref: 'main' }),
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

export async function handler(req, res) {
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
    return send(res, 200, 'text/html; charset=utf-8', signupPage());
  }
  if (path === '/login' && req.method === 'POST') {
    const form = await readForm(req);
    const r = await login({ email: form.email, password: form.password });
    if (!r.ok) return send(res, 401, 'text/html; charset=utf-8', loginPage({ error: r.error, email: form.email }));
    const { token, expires } = await startSession(r.userId);
    res.writeHead(303, { Location: '/', 'Set-Cookie': sessionCookie(token, expires) });
    return res.end();
  }
  if (path === '/signup' && req.method === 'POST') {
    const form = await readForm(req);
    const r = await signup({ email: form.email, password: form.password, name: form.name });
    if (!r.ok) return send(res, 400, 'text/html; charset=utf-8', signupPage({ error: r.error, email: form.email, name: form.name }));
    const { token, expires } = await startSession(r.userId);
    res.writeHead(303, { Location: '/settings?welcome=1', 'Set-Cookie': sessionCookie(token, expires) });
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

    if (path === '/api/run' && req.method === 'POST') {
      const knownRuns = (await allRuns(uid)).length;
      const out = await startRun();
      return send(res, out.started ? 202 : 409, 'application/json',
        JSON.stringify({ ...out, knownRuns, runner: RUNNER }));
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
