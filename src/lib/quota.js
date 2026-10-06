// Budgets for metered job APIs, so a free tier lasts the whole month instead of
// running dry on day 20 and failing every run after.
//
//  - monthlyBudget (declared by the adapter): calls allowed per calendar month,
//    spread evenly over the days left, so each day gets its share.
//  - The same term + country is not searched again within 20 hours: the results
//    are already in the shared pool, whichever user's run fetched them.
//  - A 429 (quota used up) pauses the API until the 1st of next month; a 403
//    (refused: usually the subscription is not active) pauses it for a day.
//    The reason is kept for the logs instead of retrying on every run.
//  Keyless sources without a budget (Workday) are not tracked.
import { db } from '../db/driver.js';

const REPEAT_HOURS = 20;
const month = (d = new Date()) => d.toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const daysInMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
const firstOfNextMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

async function load(key) {
  const d = await db();
  let r = await d.one('SELECT * FROM api_usage WHERE adapter = ?', [key]);
  if (!r) {
    r = { adapter: key, period: month(), calls: 0, blocked_until: null, last_error: null, recent: '{}' };
    await d.run('INSERT INTO api_usage (adapter, period, calls, blocked_until, last_error, recent, updated_at) VALUES (?,?,?,?,?,?,?)',
      [key, r.period, 0, null, null, '{}', new Date().toISOString()]);
  }
  const recent = JSON.parse(r.recent || '{}');
  if (r.period !== month()) return { ...r, period: month(), calls: 0, recent: {} }; // new month: fresh budget
  return { ...r, calls: Number(r.calls) || 0, recent };
}

async function store(r) {
  const d = await db();
  await d.run('UPDATE api_usage SET period = ?, calls = ?, blocked_until = ?, last_error = ?, recent = ?, updated_at = ? WHERE adapter = ?',
    [r.period, r.calls, r.blocked_until, r.last_error, JSON.stringify(r.recent), new Date().toISOString(), r.adapter]);
}

const metered = (adapter) => !!adapter.monthlyBudget;

/** May this API be called for this term now? → { ok, why } */
export async function allow(key, adapter, { term, country }) {
  const r = await load(key);
  if (r.blocked_until && r.blocked_until > new Date().toISOString()) {
    return { ok: false, why: `${key} paused until ${r.blocked_until.slice(0, 10)}: ${r.last_error}` };
  }
  if (!metered(adapter)) return { ok: true };
  const at = r.recent[`${term}|${country}`];
  if (at && Date.now() - new Date(at).getTime() < REPEAT_HOURS * 3600000) return { ok: false, why: `${key} "${term}" already searched within ${REPEAT_HOURS}h`, quiet: true };
  const limit = adapter.monthlyBudget;
  if (r.calls >= limit) return { ok: false, why: `${key} monthly budget of ${limit} calls used` };
  const todayCalls = Object.values(r.recent).filter((t) => String(t).startsWith(today())).length;
  const daysLeft = daysInMonth() - new Date().getUTCDate() + 1;
  const share = Math.max(1, Math.floor((limit - (r.calls - todayCalls)) / daysLeft));
  if (todayCalls >= share) return { ok: false, why: `${key} used today's share (${share} of ${limit - r.calls + todayCalls} left this month)` };
  return { ok: true };
}

/** Count a call and react to quota/refusal errors. `error` is the adapter's error string, if any. */
export async function record(key, adapter, { term, country, error }) {
  const status = Number(String(error || '').match(/status[=: ]?(\d{3})/)?.[1]) || null;
  if (!metered(adapter) && status !== 429 && status !== 403) return;
  const r = await load(key);
  if (metered(adapter)) {
    r.calls += 1;
    r.recent[`${term}|${country}`] = new Date().toISOString();
    const keep = Date.now() - 2 * 86400000; // only today's count and the 20h repeat check need these
    r.recent = Object.fromEntries(Object.entries(r.recent).filter(([, t]) => new Date(t).getTime() > keep));
  }
  if (status === 429) { r.blocked_until = firstOfNextMonth(); r.last_error = 'quota used up (429)'; }
  else if (status === 403) { r.blocked_until = new Date(Date.now() + 86400000).toISOString(); r.last_error = 'refused (403): check the API subscription'; }
  await store(r);
}

/** For admin/status views: every tracked API this month. */
export async function usage() {
  const d = await db();
  return (await d.query('SELECT adapter, period, calls, blocked_until, last_error, updated_at FROM api_usage ORDER BY adapter'))
    .map((r) => ({ ...r, calls: r.period === month() ? Number(r.calls) : 0 }));
}
