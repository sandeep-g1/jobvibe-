// One-time questionnaire: the answers employers keep asking that only the user can
// give (legal declarations, address, years per skill). Asked once over Telegram;
// the answer engine (answers.js) then reuses them for every employer's wording.
import { DECLARATIONS } from './answers.js';

const STATES = /\b(andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|chandigarh|puducherry|jammu and kashmir|ladakh)\b/i;

/** "Flat 4B, 12 MG Road, Indiranagar, Bengaluru, Karnataka 560038" → { full, line1, state, pin }. */
export function parseAddress(text) {
  const full = String(text || '').replace(/\s+/g, ' ').trim();
  const pin = (full.match(/\b\d{6}\b/) || [])[0] || '';
  const state = ((full.match(STATES) || [])[0] || '').replace(/\b\w/g, (c) => c.toUpperCase());
  const parts = full.split(',').map((s) => s.trim()).filter(Boolean);
  // Street part: everything before the city/state/PIN tail (the last two parts), at least one part.
  const line1 = parts.slice(0, Math.max(1, parts.length - 2)).join(', ');
  return { full, line1, state, pin };
}

/** "SQL 3, Power BI 4 years, Jira: 6" → { SQL: 3, 'Power BI': 4, Jira: 6 }. */
export function parseSkillYears(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/([A-Za-z][A-Za-z0-9 .+#&/-]*?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)?\s*(?:,|;|\n|$)/g)) {
    const skill = m[1].trim().replace(/\s+/g, ' ');
    if (skill) out[skill] = Number(m[2]);
  }
  return out;
}

/** The skills to ask years for: her skill bank, most specific first, at most eight. */
export const skillsToAsk = (profile) => [...new Set((profile.skillBank || []).map(String))].slice(0, 8);

/** What's still missing: declaration indexes, and whether address / skill years are needed. */
export function missingItems(profile) {
  const a = profile.answers || {};
  const d = a.declarations || {};
  return {
    declarations: DECLARATIONS.map((x, i) => (d[x.key] ? null : i)).filter((i) => i != null),
    address: !a.address?.full,
    skillYears: !Object.keys(a.skillYears || {}).length && skillsToAsk(profile).length > 0,
  };
}
