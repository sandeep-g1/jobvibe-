// Link verification — §07 of the architecture.
//
// The critical nuance: a 403 or 429 from a source we trust means "bot-blocked",
// NOT "dead". Treating those as dead would silently delete good jobs.
import { mapLimit } from './lib/http.js';
import { setLinkStatus } from './db.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const STATUS = {
  OK: 'OK',
  UNVERIFIED: 'UNVERIFIED',
  DEAD: 'DEAD',
};

async function probeOnce(url, method, timeout) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ac.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    clearTimeout(timer);
    return { status: res.status, finalUrl: res.url };
  } catch (err) {
    clearTimeout(timer);
    return { status: 0, finalUrl: null, error: err.message };
  }
}

/** Verify one URL. `trusted` comes from the adapter's trustLink flag. */
export async function verifyLink(url, { trusted = false, timeout = 15000 } = {}) {
  // HEAD first (cheap); many job boards answer 405/403 to HEAD, so fall back to GET.
  let r = await probeOnce(url, 'HEAD', timeout);
  if (r.status === 405 || r.status === 403 || r.status === 0) {
    r = await probeOnce(url, 'GET', timeout);
  }

  if (r.status >= 200 && r.status < 300) {
    return { status: STATUS.OK, finalUrl: r.finalUrl || url, code: r.status };
  }
  if (r.status === 404 || r.status === 410) {
    return { status: STATUS.DEAD, finalUrl: null, code: r.status };
  }
  if (r.status === 403 || r.status === 429) {
    return {
      status: trusted ? STATUS.UNVERIFIED : STATUS.DEAD,
      finalUrl: r.finalUrl || url,
      code: r.status,
    };
  }
  // Timeouts, 5xx and anything else: keep it, but flag it.
  return { status: STATUS.UNVERIFIED, finalUrl: r.finalUrl || url, code: r.status };
}

/**
 * Verify many jobs, writing results back to the DB.
 * Returns { ok, unverified, dead }.
 */
export async function verifyJobs(jobs, trustBySource, { concurrency = 8, onProgress } = {}) {
  let done = 0;
  const counts = { ok: 0, unverified: 0, dead: 0 };

  await mapLimit(jobs, concurrency, async (job) => {
    const res = await verifyLink(job.apply_url, { trusted: !!trustBySource[job.source] });
    setLinkStatus(job.id, res.status, res.finalUrl);
    job.link_status = res.status;
    job.final_url = res.finalUrl;

    if (res.status === STATUS.OK) counts.ok++;
    else if (res.status === STATUS.DEAD) counts.dead++;
    else counts.unverified++;

    done++;
    if (onProgress && done % 10 === 0) onProgress(done, jobs.length);
  });

  return counts;
}
