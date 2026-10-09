// Classify an email from a job-hunt inbox and, where useful, draft a reply.
//
// Cheap pre-filter first (keywords / a company the user applied to), so
// newsletters and personal mail never reach the model. Drafts only state
// facts the user has stored; anything needing a real decision (salary,
// dates, documents we don't hold) is left for the user.
import { generate, geminiConfigured } from './gemini.js';
import { humanize } from './tailor.js';

export const CATEGORIES = ['received', 'rejection', 'interview', 'assessment', 'info_request', 'offer', 'other'];
const JOBBY = /\b(application|applied|interview|position|role|candidate|candidacy|recruit\w*|hiring|talent acquisition|assessment|assignment|test link|offer|shortlisted|next steps?|your (cv|resume)|job|documents?|certificates?|payslips?|salary slips?|relieving letter|experience letter|background (check|verification)|onboarding|joining|before we proceed|notice period|ctc)\b/i;

const lc = (s) => String(s || '').toLowerCase();

/** Which of the user's applications this email is about (by company name). */
export function matchApplication(mail, applications) {
  const hay = lc(`${mail.from} ${mail.subject} ${String(mail.text).slice(0, 3000)}`);
  const sender = lc(mail.from).replace(/[^a-z0-9@.]/g, '');
  const STOP = new Set(['and', 'the', 'for', 'of', 'in', 'with', 'senior', 'junior', 'sr', 'jr', 'lead', 'associate', 'ii', 'iii']);
  let best = null;
  for (const a of applications) {
    const c = lc(a.company).replace(/\b(inc|ltd|llc|pvt|private|limited|group|technologies|corp(oration)?)\b\.?/g, '').trim();
    if (c.length < 3) continue;
    // Name in the text, or squashed into the sender's address ("Practice Co" -> hr@practiceco.com).
    const squashed = c.replace(/[^a-z0-9]/g, '');
    if (!(hay.includes(c) || (squashed.length >= 4 && sender.includes(squashed)))) continue;
    // Several applications at one company: prefer the one whose title the email mentions,
    // then a submitted one over one still pending.
    const words = lc(a.title).split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !STOP.has(w));
    const titleHits = words.filter((w) => hay.includes(w)).length / Math.max(1, words.length);
    const score = c.length + titleHits * 50 + (a.status === 'submitted' ? 5 : 0);
    if (!best || score > best.score) best = { app: a, score };
  }
  return best ? best.app : null;
}

// Senders that are never an employer replying (unless the mail names one of her applications).
const NOISE = /(youtube|accounts\.google|google\.com|googlemail|facebookmail|instagram|twitter|x\.com|amazon|flipkart|swiggy|zomato|paytm|phonepe|netflix|spotify|resend\.dev|jobvibe)/i;

export function looksJobRelated(mail, applications) {
  if (matchApplication(mail, applications)) return true;
  const ownDomain = (process.env.EMAIL_FROM || '').match(/@([a-z0-9.-]+)/i)?.[1];
  if (NOISE.test(mail.from) || (ownDomain && lc(mail.from).includes(ownDomain.toLowerCase()))) return false;
  if (/^jobvibe/i.test(String(mail.subject))) return false; // our own digest emails
  return JOBBY.test(`${mail.subject} ${String(mail.text).slice(0, 1500)}`);
}

function parse(text) {
  try { return JSON.parse(text); } catch { /* salvage */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/**
 * @param {{from:string, subject:string, text:string}} mail
 * @param {{ profile:object, application?:object }} ctx
 * @returns {Promise<{ ok:boolean, category?:string, company?:string, summary?:string, draftReply?:string|null, error?:string }>}
 */
export async function classifyEmail(mail, { profile = {}, application = null } = {}) {
  if (!geminiConfigured()) return { ok: false, error: 'GEMINI_API_KEY is not set' };
  const a = profile.answers || {};
  const facts = [
    `Name: ${profile.name || ''}`,
    a.noticePeriodDays !== '' && a.noticePeriodDays != null ? `Notice period: ${Number(a.noticePeriodDays) === 0 ? 'can join immediately' : `${a.noticePeriodDays} days`}` : '',
    profile.baseCity ? `Current city: ${String(profile.baseCity).replace(/\b\w/g, (ch) => ch.toUpperCase())}` : '',
    profile.totalExpYears != null ? `Total experience: ${profile.totalExpYears} years` : '',
    a.phone ? `Phone: ${a.phone}` : '',
    a.linkedin ? `LinkedIn: ${String(a.linkedin).replace(/[?#].*$/, '')}` : '',
    'CV: can be attached to the reply',
  ].filter(Boolean).join('\n');

  const prompt = `You read emails in a job seeker's inbox. Classify this one and, only if a reply is clearly expected, draft it.

Categories:
- received: automatic "we got your application"
- rejection: not moving forward
- interview: invitation to interview / schedule a call
- assessment: test, assignment, coding challenge, questionnaire
- info_request: asks the candidate for information or documents
- offer: job offer
- other: job-related but none of the above, or not about a job application

Draft rules (draft_reply):
- Only for interview, assessment, info_request or offer, or "other" when a recruiter writes personally about a
  role (then: thank them, say the candidate is interested, and that the CV is attached). Otherwise null.
- Short, polite, plain, from the candidate in first person, signed with their name.
- Use ONLY these facts:\n${facts}
- Never invent availability, dates, salary figures, or documents. For an interview, thank them and ask them to share
  slots so the candidate can confirm. For an offer, thank them and say the candidate will review and respond shortly.
  If the email asks for something not in the facts, set draft_reply to null and say what's needed in "needs".

${application ? `This is probably about the application for: ${application.title} at ${application.company}.` : ''}

EMAIL
From: ${mail.from}
Subject: ${mail.subject}
${String(mail.text || '').slice(0, 5000)}

Also report:
- "asks": what the email asks the candidate for, from this list only: interest (are you interested / still
  interested), cv, notice_period, location, experience, availability_dates (interview or call times), salary,
  documents (anything other than a CV), questions (anything else to answer), assessment, offer. [] if nothing.
- "real_person": true if a person wrote it to the candidate (a recruiter or hiring manager), false for automated
  or bulk mail.

Return ONLY JSON: {"category":"...","company":"employer name or null","summary":"one or two plain sentences, what they want and by when","draft_reply":"..." or null,"needs":"what the candidate must provide, or null","asks":[],"real_person":true}`;

  const r = await generate(prompt, { json: true, temperature: 0.2, maxTokens: 1200 });
  if (!r.ok) return { ok: false, error: r.error };
  const out = parse(r.text);
  if (!out || !CATEGORIES.includes(out.category)) return { ok: false, error: 'unusable classification' };
  const draft = out.draft_reply && (['interview', 'assessment', 'info_request', 'offer'].includes(out.category) || (out.category === 'other' && out.real_person === true))
    // Line by line: humanize() folds whitespace, and an email needs its line breaks.
    ? String(out.draft_reply).trim().split('\n').map((l) => humanize(l, { allowEmDash: false })).join('\n') : null;
  return {
    ok: true,
    category: out.category,
    company: out.company || application?.company || null,
    summary: String(out.summary || '').slice(0, 400),
    draftReply: draft,
    needs: out.needs || null,
    asks: (Array.isArray(out.asks) ? out.asks : []).map(String).filter((x) => ASKS.includes(x)),
    realPerson: out.real_person === true,
  };
}

const ASKS = ['interest', 'cv', 'notice_period', 'location', 'experience', 'availability_dates', 'salary', 'documents', 'questions', 'assessment', 'offer'];
