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
import { allProfiles, saveProfileRow, setDecision, matchWithJob, requeueNeedsUser, inboxEvent, setReplyStatus, overrideIneligible, followup, setFollowupStatus } from '../db.js';
import { DECLARATIONS } from './answers.js';
import { parseAddress, parseSkillYears, missingItems, skillsToAsk } from './questionnaire.js';

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

/** "📄 ATS 44% → 78% with your tailored CV": the score of the exact CV the agent will send. */
const atsLine = (m) => (m.ats_after != null ? `
📄 ATS ${m.ats_before ?? '?'}% → <b>${m.ats_after}%</b> with your tailored CV` : '');

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
  return send(chatId, `${note ? `${h(note)}\n\n` : ''}${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${atsLine(m)}${why}`, { buttons: jobButtons(m) });
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
    const r = await send(chatId, `${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${atsLine(m)}${why}`, { buttons: jobButtons(m) });
    if (r.ok) sent++;
  }
  return { sent };
}

/**
 * Ask a user something the agent can't answer itself. Their reply is saved to
 * their answer bank under this question.
 */
export async function askUser(userId, profile, question, { context, options = [] } = {}) {
  const chatId = profile?.telegram?.chatId;
  if (!chatId) return { ok: false, error: 'telegram not connected' };
  // Multiple choice with a few short options: tap buttons, so an answer can't land on the wrong question.
  const opts = (options || []).map(String).filter(Boolean);
  const buttons = opts.length >= 2 && opts.length <= 8 && opts.every((o) => o.length <= 40)
    ? opts.map((o, i) => [{ text: o, callback_data: `qa:${i}` }]) : null;
  const head = `❓ <b>The agent needs you</b>${context ? `\n${h(context)}` : ''}\n\n${h(question)}\n\n`;
  const r = buttons
    ? await send(chatId, `${head}<i>Tap your answer. It's saved and reused next time.</i>`, { buttons })
    : await send(chatId, `${head}<i>Reply to this message with your answer. It's saved and reused next time.</i>`, { forceReply: true });
  if (!r.ok) return { ok: false, error: r.description };
  const pending = [...(profile.telegram.pending || []), { id: r.result.message_id, q: question, at: Date.now(), ...(buttons ? { options: opts } : {}) }].slice(-20);
  await save(userId, { ...profile, telegram: { ...profile.telegram, pending } });
  return { ok: true, messageId: r.result.message_id };
}

/**
 * Send the one-time questionnaire: only what's missing. Declarations as tap buttons,
 * address and years per skill as replies. Returns how many questions were sent.
 */
export async function sendQuestionnaire(userId, profile) {
  const chatId = profile?.telegram?.chatId;
  if (!chatId) return { ok: false, error: 'telegram not connected' };
  const miss = missingItems(profile);
  const total = miss.declarations.length + (miss.address ? 1 : 0) + (miss.skillYears ? 1 : 0);
  if (!total) return { ok: true, sent: 0 };
  await send(chatId, `📝 <b>${total} quick question${total === 1 ? '' : 's'}, asked once</b>\nEmployers keep asking these, and each one pauses an application until you answer. Answer here once and I'll reuse it for every application. Tap <b>Ask me each time</b> for anything you'd rather decide per job.`);
  let sent = 0;
  for (const i of miss.declarations) {
    const r = await send(chatId, h(DECLARATIONS[i].ask), { buttons: [[
      { text: 'Yes', callback_data: `dq:${i}:y` }, { text: 'No', callback_data: `dq:${i}:n` }, { text: 'Ask me each time', callback_data: `dq:${i}:a` },
    ]] });
    if (r.ok) sent++;
  }
  let pending = [...(profile.telegram.pending || [])];
  if (miss.address) {
    const r = await send(chatId, '🏠 <b>Your home address</b> (some forms, like Workday, require it)\nReply to this message, e.g.:\n<i>Flat 4B, 12 MG Road, Indiranagar, Bengaluru, Karnataka 560038</i>', { forceReply: true });
    if (r.ok) { sent++; pending.push({ id: r.result.message_id, q: 'Home address', field: 'address', at: Date.now() }); }
  }
  if (miss.skillYears) {
    const skills = skillsToAsk(profile);
    const r = await send(chatId, `🧮 <b>Years of experience per skill</b> (forms ask "How many years of X?")\nReply with your own numbers, e.g.:\n<i>${h(skills.slice(0, 3).map((s, k) => `${s} ${[3, 4, 2][k]}`).join(', '))}</i>\n\nYour skills: ${h(skills.join(', '))}. Add any others you want, like SQL.`, { forceReply: true });
    if (r.ok) { sent++; pending.push({ id: r.result.message_id, q: 'Years per skill', field: 'skillYears', at: Date.now() }); }
  }
  pending = pending.slice(-20);
  await save(userId, { ...profile, telegram: { ...profile.telegram, pending } });
  return { ok: true, sent };
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
  let replyTo = msg.reply_to_message?.message_id;
  const open = p.telegram.pending || [];
  // A plain message (not a reply) while questions are open: with one question it's the answer;
  // with several, ask them again so each can be answered with a reply. Never drop it silently.
  if (!replyTo && text && !text.startsWith('/') && open.length) {
    if (open.length === 1) replyTo = open[0].id;
    else {
      await send(chatId, `I have ${open.length} open questions and can't tell which one that answers. I'll send them again: <b>swipe left on a question</b> (or tap Reply) and type the answer.`);
      const again = [];
      for (const x of open) {
        const r = await send(chatId, `❓ ${h(x.q)}`, { forceReply: true });
        again.push(r?.ok ? { ...x, id: r.result.message_id } : x);
      }
      await save(owner.userId, { ...p, telegram: { ...p.telegram, pending: again } });
      return;
    }
  }
  const pending = open.find((x) => x.id === replyTo);
  // Questionnaire replies (address, years per skill) go to their own fields.
  if (pending?.field && text) {
    const answers = { ...(p.answers || {}) };
    let saved;
    if (pending.field === 'address') { answers.address = parseAddress(text); saved = answers.address.full; }
    if (pending.field === 'skillYears') {
      answers.skillYears = { ...(answers.skillYears || {}), ...parseSkillYears(text) };
      saved = Object.entries(answers.skillYears).map(([k, v]) => `${k} ${v}`).join(', ');
    }
    await save(owner.userId, { ...p, answers, telegram: { ...p.telegram, pending: p.telegram.pending.filter((x) => x.id !== replyTo) } });
    await requeueNeedsUser(owner.userId);
    await send(chatId, saved ? `Saved ✓ <b>${h(saved)}</b>. I'll use it on every application that asks.` : 'I couldn\'t read that. Please reply again in the format shown.');
    return;
  }
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

  // Answer buttons on an agent question: save the tapped option to the answer bank.
  if (kind === 'qa') {
    const owner = await profileByChat(chatId);
    if (!owner || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    const p = owner.data;
    const pend = (p.telegram?.pending || []).find((x) => x.id === cb.message?.message_id);
    const choice = pend?.options?.[Number(idStr)];
    if (!pend || choice == null) return answer('This question was already answered.');
    const answers = { ...(p.answers || {}) };
    answers.custom = [...(answers.custom || []).filter((c) => c.q !== pend.q), { q: pend.q, a: choice, updatedAt: new Date().toISOString() }];
    await save(owner.userId, { ...p, answers, telegram: { ...p.telegram, pending: p.telegram.pending.filter((x) => x.id !== pend.id) } });
    await requeueNeedsUser(owner.userId);
    await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
      text: `✅ <b>${h(pend.q)}</b>\n${h(choice)}\n<i>Saved. I'll use this from now on.</i>` });
    return answer('Saved');
  }

  // Questionnaire buttons: dq:<declaration index>:<y|n|a> → a standing answer.
  if (kind === 'dq') {
    const owner = await profileByChat(chatId);
    if (!owner || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    const [, idx, choice] = String(cb.data).split(':');
    const decl = DECLARATIONS[Number(idx)];
    const value = { y: 'yes', n: 'no', a: 'ask' }[choice];
    if (!decl || !value) return answer('Unknown answer.');
    const p = owner.data;
    const answers = { ...(p.answers || {}), declarations: { ...(p.answers?.declarations || {}), [decl.key]: value } };
    await save(owner.userId, { ...p, answers });
    await requeueNeedsUser(owner.userId);
    await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, parse_mode: 'HTML',
      text: `✅ ${h(decl.ask)}\n<b>${value === 'ask' ? 'Ask me each time' : value === 'yes' ? 'Yes' : 'No'}</b>` });
    return answer('Saved');
  }

  // "Apply anyway" on a job the agent found the user isn't eligible for.
  if (kind === 'ov') {
    const owner = await profileByChat(chatId);
    if (!owner || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    if (!(await overrideIneligible(id, owner.userId))) return answer('Already handled.');
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await send(chatId, '👍 Okay, the agent will apply anyway and answer those questions truthfully.');
    return answer('Will apply');
  }

  // Reply buttons on inbox alerts: rs = send the drafted reply, rd = user handles it.
  if (kind === 'rs' || kind === 'rd') {
    const ev = Number.isInteger(id) ? await inboxEvent(id) : null;
    if (!ev) return answer('That email is no longer available.');
    const owner = (await allProfiles()).find((p) => p.userId === ev.user_id);
    if (!owner || owner.data?.telegram?.chatId !== chatId || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    if (ev.reply_status === 'sent') return answer('Already sent.');
    // Only a current draft can be sent: an older one may have been replaced by a newer draft.
    if (ev.reply_status !== 'drafted') return answer('This draft was replaced or already handled.');
    await setReplyStatus(ev.id, ev.user_id, kind === 'rs' ? 'approved' : 'dismissed');
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await send(chatId, kind === 'rs' ? `✉️ Sending your reply to ${h(ev.from_addr)} in the next minute.` : '✋ Okay, you\'ll reply yourself.');
    return answer(kind === 'rs' ? 'Queued to send' : 'Noted');
  }

  // Follow-up buttons: fs = send the follow-up, fd = skip it.
  if (kind === 'fs' || kind === 'fd') {
    const f = Number.isInteger(id) ? await followup(id) : null;
    if (!f) return answer('That follow-up is no longer available.');
    const owner = (await allProfiles()).find((p) => p.userId === f.user_id);
    if (!owner || owner.data?.telegram?.chatId !== chatId || cb.from?.id !== chatId) return answer('This button belongs to another account.');
    if (!(await setFollowupStatus(f.id, f.user_id, kind === 'fs' ? 'approved' : 'dismissed'))) return answer('Already handled.');
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    await send(chatId, kind === 'fs' ? `📨 Sending the follow-up to ${h(f.to_addr)} in the next minute.` : '✋ Okay, no follow-up.');
    return answer(kind === 'fs' ? 'Queued to send' : 'Noted');
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
    text: `${jobLine(m)}\n<b>${Math.round(m.score)}% match</b>${atsLine(m)}${status}`,
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
