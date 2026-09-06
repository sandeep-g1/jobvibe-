// Daily digest email.
//
// Table-based HTML, inline styles, no external CSS or images — Gmail and
// Outlook still require that. Sends through Resend; skips cleanly with a clear
// message when RESEND_API_KEY is absent, so a run never fails because of mail.
import { cleanEnv } from './db/driver.js';
import { logDigest } from './db.js';

const API = 'https://api.resend.com/emails';

/** Resend's shared sender works without owning a domain. */
const DEFAULT_FROM = 'JobVibe <onboarding@resend.dev>';

export function emailConfigured() {
  return !!cleanEnv(process.env.RESEND_API_KEY);
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function scoreColour(score) {
  if (score >= 75) return ['#dcfce7', '#15803d'];
  if (score >= 65) return ['#dbeafe', '#1e40af'];
  if (score >= 50) return ['#fef3c7', '#92400e'];
  return ['#fee2e2', '#991b1b'];
}

export function buildSubject(rows, profile) {
  if (!rows.length) return 'JobVibe — nothing new today';
  const strong = rows.filter((r) => r.score >= 75).length;
  const today = rows.filter((r) => r.postedDays === 0).length;
  const where = (profile.preferredLocations || [])[0] || 'India';
  const bits = [`${rows.length} new roles in ${where}`];
  if (strong) bits.push(`${strong} at 75%+`);
  if (today) bits.push(`${today} posted today`);
  return `JobVibe — ${bits.join(' · ')}`;
}

function jobRow(r, siteUrl) {
  const [bg, fg] = scoreColour(r.score);
  const missing = (r.missing || []).slice(0, 4);
  const matched = (r.matched || []).slice(0, 4);

  return `
<tr><td style="padding:0 0 12px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="border:1px solid #e4e8ef;border-radius:8px;background:#ffffff;">
    <tr><td style="padding:14px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:600 15px/1.35 -apple-system,Segoe UI,Arial,sans-serif;color:#16181d;">
          ${esc(r.title)}
        </td>
        <td align="right" style="white-space:nowrap;padding-left:10px;">
          <span style="display:inline-block;background:${bg};color:${fg};border-radius:11px;
                       padding:3px 10px;font:700 12px -apple-system,Segoe UI,Arial,sans-serif;">
            ${r.score}%
          </span>
        </td>
      </tr></table>

      <div style="font:13px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#0a66c2;padding-top:3px;">
        ${esc(r.company)}
      </div>
      <div style="font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#6b7280;padding-top:2px;">
        ${esc(r.city)} · ${esc(r.mode)} · ${esc(r.exp)} · posted ${esc(r.posted)} · ${esc(r.sourceLabel)}
      </div>

      ${matched.length || missing.length ? `
      <div style="padding-top:8px;font:11px -apple-system,Segoe UI,Arial,sans-serif;">
        ${matched.map((s) => `<span style="display:inline-block;background:#e3f5ea;color:#0d6e3c;
          border-radius:8px;padding:2px 7px;margin:0 4px 4px 0;">${esc(s)}</span>`).join('')}
        ${missing.map((s) => `<span style="display:inline-block;background:#fbe6e7;color:#a81f27;
          border-radius:8px;padding:2px 7px;margin:0 4px 4px 0;">${esc(s)}</span>`).join('')}
      </div>` : ''}

      <div style="padding-top:11px;">
        <a href="${esc(r.url)}" style="display:inline-block;background:#0a66c2;color:#ffffff;
           text-decoration:none;border-radius:6px;padding:8px 16px;
           font:600 13px -apple-system,Segoe UI,Arial,sans-serif;">Apply &rarr;</a>
        <a href="${esc(siteUrl)}/reports/latest" style="display:inline-block;color:#6b7280;
           text-decoration:none;padding:8px 10px;
           font:13px -apple-system,Segoe UI,Arial,sans-serif;">Details</a>
      </div>
    </td></tr>
  </table>
</td></tr>`;
}

export function buildHtml(rows, { profile, runId, siteUrl, topN = 10 }) {
  const top = rows.slice(0, topN);
  const rest = rows.length - top.length;
  const strong = rows.filter((r) => r.score >= 75).length;

  const empty = `
    <tr><td style="padding:18px 0;font:14px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#4b5563;">
      No new roles cleared your score floor today. Nothing was missed — the search ran and
      everything it found had already been shown to you.
    </td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;">
<tr><td align="center" style="padding:22px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;">

  <tr><td style="background:#0a66c2;border-radius:10px 10px 0 0;padding:20px 22px;">
    <div style="font:700 18px -apple-system,Segoe UI,Arial,sans-serif;color:#ffffff;">
      ${esc(profile.name || 'Your')} — today's shortlist
    </div>
    <div style="font:13px -apple-system,Segoe UI,Arial,sans-serif;color:#d6e6f8;padding-top:5px;">
      ${rows.length} new · ${strong} rated apply · report #${runId}
    </div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:18px 16px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${rows.length ? top.map((r) => jobRow(r, siteUrl)).join('') : empty}
    </table>

    ${rest > 0 ? `
    <div style="padding:4px 4px 14px;font:13px -apple-system,Segoe UI,Arial,sans-serif;color:#6b7280;">
      ${rest} more in the full report.
    </div>` : ''}

    <div style="padding:6px 4px 18px;">
      <a href="${esc(siteUrl)}/reports/${runId}"
         style="display:inline-block;border:1.5px solid #0a66c2;color:#0a66c2;text-decoration:none;
                border-radius:6px;padding:9px 18px;
                font:600 13px -apple-system,Segoe UI,Arial,sans-serif;">Open the full report</a>
    </div>
  </td></tr>

  <tr><td style="background:#ffffff;border-radius:0 0 10px 10px;border-top:1px solid #eef1f5;
                 padding:14px 20px;font:11px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#9aa3b2;">
    Every apply link above was checked before this email was sent.
    Match score = skills 35 · semantic 25 · experience 15 · title 10 · location 10.
    <br>Change what is searched at <a href="${esc(siteUrl)}/settings"
      style="color:#0a66c2;text-decoration:none;">Search Settings</a>.
  </td></tr>

</table></td></tr></table></body></html>`;
}

/**
 * Send the digest. Never throws — a mail failure must not fail the pipeline,
 * because the report itself is already saved by this point.
 */
export async function sendDigest(rows, { profile, runId, siteUrl }) {
  const to = (profile.emailTo || []).filter(Boolean);
  const cc = (profile.emailCc || []).filter(Boolean);

  if (profile.emailEnabled === false) {
    return { sent: false, reason: 'email is switched off in Search Settings' };
  }
  if (!to.length) {
    return { sent: false, reason: 'no recipient set in Search Settings' };
  }
  if (!emailConfigured()) {
    return { sent: false, reason: 'RESEND_API_KEY is not set' };
  }

  const payload = {
    from: cleanEnv(process.env.EMAIL_FROM) || DEFAULT_FROM,
    to,
    subject: buildSubject(rows, profile),
    html: buildHtml(rows, { profile, runId, siteUrl }),
  };
  if (cc.length) payload.cc = cc;

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanEnv(process.env.RESEND_API_KEY)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const reason = body?.message || `HTTP ${res.status}`;
      await logDigest({ runId, to, cc, providerId: null, error: reason, n: rows.length });
      return { sent: false, reason };
    }

    await logDigest({ runId, to, cc, providerId: body.id || null, error: null, n: rows.length });
    return { sent: true, id: body.id, to, cc };
  } catch (err) {
    await logDigest({ runId, to, cc, providerId: null, error: err.message, n: rows.length });
    return { sent: false, reason: err.message };
  }
}
