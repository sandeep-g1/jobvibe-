// Web app: dashboard, reports index, and any past report rebuilt live from the
// database. Also persists the Applied toggle (localStorage dies with the browser).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, getDB, toggleApplied, latestRun, allRuns, runById, matchesForRun,
} from './db.js';
import { buildRows, renderReport } from './report.js';
import { dashboardPage, reportsPage, notFoundPage } from './web/pages.js';
import { availableQueryAdapters, BOARD_ADAPTERS } from './adapters/index.js';

const PORT = Number(process.env.PORT || 3100);
const PASSWORD = process.env.APP_PASSWORD || '';

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function profile() {
  return JSON.parse(readFileSync(join(ROOT, 'profile.json'), 'utf8'));
}

function sourceStatus(p) {
  const boards = Object.entries(BOARD_ADAPTERS)
    .filter(([k]) => (p.sources || []).includes(k))
    .map(([, a]) => ({ label: a.label, ready: true }));
  const queries = availableQueryAdapters(p.sources)
    .map((t) => ({ label: t.adapter.label, ready: t.ready }));
  return [...boards, ...queries];
}

/** Optional password gate — required before this is exposed publicly. */
function authorised(req) {
  if (!PASSWORD) return true;
  const cookie = req.headers.cookie || '';
  if (cookie.includes(`sl_auth=${PASSWORD}`)) return true;
  const url = new URL(req.url, 'http://x');
  return url.searchParams.get('pw') === PASSWORD;
}

function loginPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Shortlist India</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#f0f2f5;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0}
form{background:#fff;padding:34px;border-radius:12px;box-shadow:0 2px 14px rgba(0,0,0,.08);width:320px}
h1{font-size:1.15rem;margin:0 0 6px;color:#0a66c2}p{color:#667085;font-size:.84rem;margin:0 0 18px}
input{width:100%;padding:10px 13px;border:1.5px solid #d0d5dd;border-radius:8px;font-size:.92rem;margin-bottom:12px}
button{width:100%;padding:10px;background:#0a66c2;color:#fff;border:0;border-radius:8px;
font-size:.9rem;font-weight:600;cursor:pointer}</style></head>
<body><form method="GET" action="/"><h1>Shortlist India</h1>
<p>This dashboard is private. Enter your password.</p>
<input type="password" name="pw" placeholder="Password" autofocus>
<button type="submit">Sign in</button></form></body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (!authorised(req)) return send(res, 401, 'text/html; charset=utf-8', loginPage());

  // Set the auth cookie once the password arrives as a query param.
  const pw = url.searchParams.get('pw');
  if (PASSWORD && pw === PASSWORD) {
    res.setHeader('Set-Cookie', `sl_auth=${PASSWORD}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
  }

  try {
    /* ---- API ---- */
    if (path === '/api/applied' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        try {
          const { fingerprint } = JSON.parse(body);
          if (!fingerprint) return send(res, 400, 'application/json', '{"error":"fingerprint required"}');
          send(res, 200, 'application/json', JSON.stringify(toggleApplied(fingerprint)));
        } catch (e) {
          send(res, 400, 'application/json', JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (path === '/api/runs') {
      return send(res, 200, 'application/json', JSON.stringify(allRuns(), null, 2));
    }

    /* ---- pages ---- */
    if (path === '/') {
      const p = profile();
      return send(res, 200, 'text/html; charset=utf-8', dashboardPage(p, sourceStatus(p)));
    }

    if (path === '/reports') {
      return send(res, 200, 'text/html; charset=utf-8', reportsPage(profile()));
    }

    const m = path.match(/^\/reports\/(latest|\d+)$/);
    if (m) {
      const run = m[1] === 'latest' ? latestRun() : runById(Number(m[1]));
      if (!run) {
        return send(res, 404, 'text/html; charset=utf-8',
          notFoundPage(`No report #${m[1]} exists yet.`));
      }
      const rows = buildRows(matchesForRun(run.id));
      const html = renderReport(rows, {
        profile: profile(),
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
});

getDB();
server.listen(PORT, '0.0.0.0', () => {
  const run = latestRun();
  console.log('\n  Shortlist India');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Dashboard · Reports · ${run ? `latest run #${run.id} (${run.n_reported} jobs)` : 'no runs yet'}`);
  if (!PASSWORD) console.log('  No APP_PASSWORD set — fine locally, required before hosting publicly.');
  console.log('');
});
