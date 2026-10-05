// Telegram: alerts, one-tap Approve/Skip on matches, and the channel the
// agent uses to ask a user something it can't answer itself.
//
//   Linking   Dashboard → "Connect Telegram" opens t.me/<bot>?start=<code>; the
//             one-time code (30 min) ties that chat to the account.
//   Digest    after each match run: top jobs, one message each, with
//             ✅ Approve · ❌ Skip · 🔗 View. Decisions land on job_matches.
//   Ask       askUser() sends a question the user just replies to; the reply is
//             saved to their answer bank (answers.custom) and reused after.
//
// Security: Telegram signs every webhook call with our secret header; a button
// only works from the chat linked to the match's owner.
import { createHash, randomBytes } from 'node:crypto';
import { cleanEnv } from '../db/driver.js';
import { allProfiles, saveProfileRow, setDecision, matchWithJob, requeueNeedsUser, inboxEvent, setReplyStatus } from '../db.js';

const token = () => cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
export const telegramConfigured = () => !!token();
const apiBase = () => `${cleanEnv(process.env.TELEGRAM_API_BASE) || 'https://api.telegram.org'}/bot${token()}`;
const siteUrl = () => (cleanEnv(process.env.SITE_URL) || 'https://jobvibe.evergreenskill.com').replace(/\/+$/, '');

export async function tg(method, params = {}) {
  if (!telegramConfigured()) return { ok: false, description: 'TELEGRAM_BOT_TOKEN is not set' };
  try {
    const res = await fetch(`${apiBase()}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

/** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
export function webhookSecret() {
  return createHash('sha256')
    .update(`${token()}|${cleanEnv(process.env.APP_PASSWORD)}|jobvibe-telegram`).digest('hex').slice(0, 48);
}

let _username = null;
export async function botUsername() {
  if (_username) return _username;
  const r = await tg('getMe');
  if (r.ok) _username = r.result.username;
  return _username;
}

export const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function send(chatId, html, { buttons, forceReply, placeholder } = {}) {
  const p = { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true };
  if (buttons) p.reply_markup = { inline_keyboard: buttons };
  if (forceReply) p.reply_markup = { force_reply: true, input_field_placeholder: placeholder || 'Type your answer' };
  return tg('sendMessage', p);
}

/**
 * Send a file: a screenshot ('photo') or a document such as a tailored CV.
 * Telegram needs multipart for uploads, so this bypasses tg().
 */
export async function sendFile(chatId, { kind = 'document', buffer, filename, caption }) {
  if (!telegramConfigured()) return { ok: false, description: 'TELEGRAM_BOT_TOKEN is not set' };
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) { form.append('caption', caption.slice(0, 1000)); form.append('parse_mode', 'HTML'); }
  form.append(kind, new Blob([buffer]), filename);
  try {
    const res = await fetch(`${apiBase()}/${kind === 'photo' ? 'sendPhoto' : 'sendDocument'}`, { method: 'POST', body: form });
    return await res.json();
  } catch (err) {
    return { ok: false, description: err.message };
  }
}

/** Point Telegram at our webhook and register the command menu. */
export async function activate(baseUrl) {
  const set = await tg('setWebhook', {
    url: `${baseUrl.replace(/\/+$/, '')}/api/telegram/webhook`,
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  if (!set.ok) return { ok: false, error: set.description };
  await tg('setMyCommands', {
    commands: [
      { command: 'status', description: 'Your profile and today\'s matches' },
      { command: 'help', description: 'What this bot does' },
      { command: 'stop', description: 'Disconnect this chat' },
    ],
  });
  return { ok: true, username: await botUsername() };
}

/* ------------------------------------------------------------------ */
/*  Linking                                                            */
/* ------------------------------------------------------------------ */

/** Mint a one-time link code for a profile (caller saves the profile). */
export function newLinkCode() {
  return { code: randomBytes(9).toString('base64url'), exp: Date.now() + 30 * 60 * 1000 };
}

async function profileByChat(chatId) {
  return (await allProfiles()).find((p) => p.data?.telegram?.chatId === chatId) || null;
}

async function save(userId, data) {
  const next = { ...data, userId };
  delete next._source; delete next._updatedAt;
  await saveProfileRow(next, userId);
}

/* ------------------------------------------------------------------ */
/*  Outbound                                                           */
/* ------------------------------------------------------------------ */

/** ⚡ when the agent can apply by itself, ✋ when the user has to. */
export function routeTag(m) {
  let r = null;
  try { r = JSON.parse(m.apply_route || 'null'); } catch { /* none */ }
  if (!r) return '';
  return r.route === 'auto' ? '⚡ <b>Auto-apply</b>\n' : '✋ <b>You apply</b> (the agent can\'t reach this form)\n';
}

function jobLine(m) {
  const where = m.city ? m.city.replace(/\b\w/g, (c) => c.toUpperCase()) : (m.work_mode || '');
  return `${routeTag(m)}<b>${h(m.title)}</b>\n${h(m.company)}${where ? ` · ${h(where)}` : ''}${m.salary_raw ? ` · ${h(m.salary_raw)}` : ''}`;
}

const jobButtons = (m) => [
  [{ text: '✅ Approve', callback_data: `ap:${m.id}` }, { text: '❌ Skip', callback_data: `sk:${m.id}` }],
  ...(m.apply_url || m.final_url ? [[{ text: '🔗 View job', url: m.final_url || m.apply_url }]] : []),
];

/** One job card with Approve / Skip / View buttons. */
export function sendJobCard(chatId, m, { note } = {}) {
  const why = m.why_text ? `\n<i>${h(String(m.why_text).split('. ')[0].slice(0, 160))}</i>` : '';
  return send(chatId, `${note ? `${h(note)}\n\n` : ''}${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${why}`, { buttons: jobButtons(m) });
}

/**
 * Daily digest: a header, then one message per top match with buttons.
 * @param {number|string} chatId
 * @param {object[]} matches  rows from topMatchesForRun (id, title, company, score, why_text…)
 */
export async function sendDigest(chatId, matches, { total, runId } = {}) {
  if (!matches.length) return { sent: 0 };
  const n = total ?? matches.length;
  const head = await send(chatId,
    `🎯 <b>${n} new ${n === 1 ? 'match' : 'matches'} today.</b> ${matches.length === 1 ? 'Here it is.' : `Here are your top ${matches.length}.`}\n` +
    'Tap <b>Approve</b> on the ones you want the agent to apply to.\n' +
    `<a href="${siteUrl()}/reports/${runId ?? 'latest'}">Open the full report</a>`);
  if (!head.ok) return { sent: 0, error: head.description };
  let sent = 0;
  for (const m of matches) {
    const why = m.why_text ? `\n<i>${h(String(m.why_text).split('. ')[0].slice(0, 160))}</i>` : '';
    const r = await send(chatId, `${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${why}`, { buttons: jobButtons(m) });
    if (r.ok) sent++;
  }
  return { sent };
}

/**
 * Ask a user something the agent can't answer itself. Their reply is saved to
 * their answer bank under this question.
 */
export async function askUser(userId, profile, question, { context } = {}) {
  const chatId = profile?.telegram?.chatId;
  if (!chatId) return { ok: false, error: 'telegram not connected' };
  const r = await send(chatId,
    `❓ <b>The agent needs you</b>${context ? `\n${h(context)}` : ''}\n\n${h(question)}\n\n<i>Reply to this message with your answer. It's saved and reused next time.</i>`,
    { forceReply: true });
  if (!r.ok) return { ok: false, error: r.description };
  const pending = [...(profile.telegram.pending || []), { id: r.result.message_id, q: question, at: Date.now() }].slice(-20);
  await save(userId, { ...profile, telegram: { ...profile.telegram, pending } });
  return { ok: true, messageId: r.result.message_id };
}

/* ------------------------------------------------------------------ */
/*  Inbound                                                            */
/* ------------------------------------------------------------------ */

const HELP = 'I send your best job matches every day. Tap <b>Approve</b> on the ones you want the agent to apply to, ' +
  'or <b>Skip</b>. When the agent needs something only you know, I\'ll ask here; just reply.\n\n' +
  '/status: your profile and matches\n/stop: disconnect this chat';

async function onMessage(msg) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || '').trim();
  if (!chatId || msg.chat.type !== 'private') return;

  // /start <code>: link this chat to an account.
  const start = text.match(/^\/start(?:\s+(\S+))?/);
  if (start) {
    const code = start[1];
    const all = await allProfiles();
    const owner = code && all.find((p) => p.data?.telegramLink?.code === code && p.data.telegramLink.exp > Date.now());
    if (!owner) {
      await send(chatId, code ? 'That link has expired. Open JobVibe and tap <b>Connect Telegram</b> again.'
        : `Hi! To link your JobVibe account, open <a href="${siteUrl()}">JobVibe</a> and tap <b>Connect Telegram</b>.`);
      return;
    }
    // One chat belongs to one account.
    for (const p of all) {
      if (p.userId !== owner.userId && p.data?.telegram?.chatId === chatId) {
        const { telegram, ...rest } = p.data; await save(p.userId, rest); // eslint-disable-line no-unused-vars
      }
    }
    const { telegramLink, ...data } = owner.data; // eslint-disable-line no-unused-vars
    await save(owner.userId, { ...data, telegram: { chatId, username: msg.from?.username || '', linkedAt: new Date().toISOString(), pending: [] } });
    await send(chatId, `✅ <b>Connected, ${h(data.name || 'there')}.</b>\n\n${HELP}`);
    return;
  }

  const owner = await profileByChat(chatId);
  if (!owner) {
    await send(chatId, `I don't know this chat yet. Open <a href="${siteUrl()}">JobVibe</a> and tap <b>Connect Telegram</b>.`);
    return;
  }
  const p = owner.data;

  // A reply to one of the agent's questions: save it to the answer bank.
  const replyTo = msg.reply_to_message?.message_id;
  const pending = (p.telegram.pending || []).find((x) => x.id === replyTo);
  if (pending && text) {
    const answers = { ...(p.answers || {}) };
    const custom = (answers.custom || []).filter((c) => c.q !== pending.q);
    custom.push({ q: pending.q, a: text, updatedAt: new Date().toISOString() });
    answers.custom = custom;
    await save(owner.userId, { ...p, answers, telegram: { ...p.telegram, pending: p.telegram.pending.filter((x) => x.id !== replyTo) } });
    await requeueNeedsUser(owner.userId); // applications waiting on this can continue
    await send(chatId, `Saved ✓ I'll use <b>${h(text)}</b> for "${h(pending.q)}" from now on.`);
    return;
  }

  if (/^\/stop/.test(text)) {
    const { telegram, ...rest } = p; // eslint-disable-line no-unused-vars
    await save(owner.userId, rest);
    await send(chatId, 'Disconnected. You can reconnect any time from the JobVibe dashboard.');
    return;
  }
  if (/^\/status/.test(text)) {
    const { statusText } = await import('./telegram-status.js');
    await send(chatId, await statusText(owner.userId, p));
    return;
  }
  await send(chatId, HELP);
}

async function onCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const [kind, idStr] = String(cb.data || '').split(':');
  const id = Number(idStr);
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cb.id, text });

  // Reply buttons on inbox alerts: rs = send the drafted reply, rd = user handles it.
  if (kind === 'rs' || kind === 'rd') {
    const ev = Number.isInteger(id) ? await inboxEvent(id) : null;
    if (!ev) return answer('That email is no longer available.');
    const owner = (await allProfiles()).find((p) => p.userId === ev.user_id);
    if (!owner || owner.data?.telegram?.chatId !== chatId || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    if (ev.reply_status === 'sent') return answer('Already sent.');
    await setReplyStatus(ev.id, ev.user_id, kind === 'rs' ? 'approved' : 'dismissed');
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await send(chatId, kind === 'rs' ? `✉️ Sending your reply to ${h(ev.from_addr)} in the next minute.` : '✋ Okay, you\'ll reply yourself.');
    return answer(kind === 'rs' ? 'Queued to send' : 'Noted');
  }

  const m = Number.isInteger(id) ? await matchWithJob(id) : null;
  if (!m) return answer('That job is no longer available.');
  const owner = (await allProfiles()).find((p) => p.userId === m.user_id);
  if (!owner || owner.data?.telegram?.chatId !== chatId || cb.from?.id !== chatId) {
    return answer('This button belongs to another account.');
  }

  const decision = kind === 'ap' ? 'approved' : kind === 'sk' ? 'skipped' : kind === 'un' ? null : undefined;
  if (decision === undefined) return answer('Unknown action.');
  await setDecision(m.id, m.user_id, decision);

  const status = decision === 'approved' ? '\n\n✅ <b>Approved.</b> The agent will apply.'
    : decision === 'skipped' ? '\n\n❌ <b>Skipped.</b>' : '';
  const buttons = decision
    ? [[{ text: '↩ Undo', callback_data: `un:${m.id}` }], ...(m.final_url || m.apply_url ? [[{ text: '🔗 View job', url: m.final_url || m.apply_url }]] : [])]
    : jobButtons(m);
  await tg('editMessageText', {
    chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML', disable_web_page_preview: true,
    text: `${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${status}`,
    reply_markup: { inline_keyboard: buttons },
  });
  return answer(decision === 'approved' ? 'Approved ✓' : decision === 'skipped' ? 'Skipped' : 'Undone');
}

/** Entry point for one webhook update. Never throws. */
export async function handleUpdate(update) {
  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (err) {
    console.error('telegram update failed:', err.message);
  }
}
