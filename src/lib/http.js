// Shared HTTP helpers. Built-in fetch only — no dependencies.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * GET with timeout + retry on transient failures.
 * Returns { ok, status, body, error }. Never throws.
 */
export async function getText(url, { timeout = 20000, retries = 2, headers = {} } = {}) {
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/json, text/html, */*', ...headers },
      });
      const body = await res.text();
      clearTimeout(timer);
      // 5xx and 429 are worth retrying; 4xx are not.
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return { ok: res.ok, status: res.status, body, url: res.url };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, body: '', error: lastErr?.message || 'request failed' };
}

export async function getJSON(url, opts) {
  const res = await getText(url, opts);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, data: null };
  try {
    return { ok: true, status: res.status, data: JSON.parse(res.body) };
  } catch {
    return { ok: false, status: res.status, error: 'invalid json', data: null };
  }
}

/** Run tasks with bounded concurrency, preserving input order in the output. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Strip HTML to readable plain text — JD bodies arrive as HTML from several sources. */
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}
