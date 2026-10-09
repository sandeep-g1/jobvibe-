// Which replies to recruiters may go out on their own, and which wait for the user's tap.
//
// Automatic (profile.autoReply on) only when ALL hold:
//   - a person wrote it (not automated or bulk mail), not from a no-reply address;
//   - it is linked to one of her applications (a sender we can place);
//   - it asks only for routine things the agent knows: her interest, CV, notice period,
//     location, experience;
//   - it is not an interview, assessment or offer (dates, deadlines and terms are hers to commit).
// Everything else with a draft goes to Telegram first, with the reasons.

const ROUTINE = new Set(['interest', 'cv', 'notice_period', 'location', 'experience']);
export const NO_REPLY = /no-?reply|donotreply|do-not-reply|mailer-daemon|notifications?@|alerts?@/i;

// Hiring systems that send recruiters' mail on the employer's behalf.
const ATS_MAIL = /(greenhouse(-mail)?\.io|lever\.co|hire\.lever\.co|ashbyhq\.com|workablemail\.com|workable\.com|recruitee\.com|myworkday(jobs)?\.com|smartrecruiters\.com|zohorecruit\.\w+|keka\.com|darwinbox\.\w+|successfactors\.\w+)$/i;

/**
 * Is the sender really from the employer of `app`? Their domain carries the company name
 * ("hr@practiceco.com" for "Practice Co") or is the employer's hiring system. A name in the
 * email text alone is not enough: anyone can write it.
 */
export function senderVerified(app, fromAddr) {
  if (!app) return false;
  const domain = String(fromAddr || '').toLowerCase().match(/@([a-z0-9.-]+)/)?.[1];
  if (!domain) return false;
  if (ATS_MAIL.test(domain)) return true;
  const squashed = String(app.company || '').toLowerCase()
    .replace(/\b(inc|ltd|llc|pvt|private|limited|group|technologies|corp(oration)?|india)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  return squashed.length >= 3 && domain.replace(/[^a-z0-9]/g, '').includes(squashed);
}

/**
 * @param {object} c        classifyEmail() result ({ category, draftReply, asks, realPerson })
 * @param {object} ctx      { app: the matched application or null, fromAddr, profile }
 * @returns {{ mode: 'none'|'confirm'|'auto', why?: string[] }}
 */
export function replyPolicy(c, { app, fromAddr, profile }) {
  if (!c.draftReply) return { mode: 'none' };
  if (NO_REPLY.test(fromAddr || '')) return { mode: 'none', why: ['no-reply address'] };
  const why = [];
  if (!profile?.autoReply) why.push('automatic replies are off');
  if (!c.realPerson) why.push('not written by a person');
  if (!app) why.push("I couldn't link it to one of your applications");
  else if (!senderVerified(app, fromAddr)) why.push(`I couldn't verify the sender is from ${app.company}`);
  const sensitive = (c.asks || []).filter((a) => !ROUTINE.has(a));
  if (sensitive.length) why.push(`it asks for ${sensitive.join(', ').replace(/_/g, ' ')}`);
  if (['interview', 'assessment', 'offer'].includes(c.category)) why.push(`it's ${c.category === 'offer' ? 'an offer' : `an ${c.category}`}`);
  return why.length ? { mode: 'confirm', why } : { mode: 'auto' };
}

/** Send the CV with the reply? When they ask for it, or a recruiter reaches out about a role. */
export const attachCv = (c) => (c.asks || []).includes('cv') || (c.category === 'other' && c.realPerson === true);
