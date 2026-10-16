// "Application details": everything the agent knows about a candidate, laid out for copying into
// a job form or an autofill extension. Built from the profile and answer bank, so every answer
// saved later (Telegram, the questionnaire) appears here too.
import { getAnswers } from './answers.js';

const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const yesNo = (v) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'ask' ? 'Ask me each time' : v || '');

const DECLARATION_WORDS = {
  nonCompete: 'Bound by a non-compete / non-solicitation agreement', outsideBusiness: 'Outside business activities',
  exportControl: 'Export-control restrictions', government: 'Government official / employee', conflict: 'Conflict of interest',
  criminal: 'Criminal record', clearance: 'Security clearance held', shifts: 'Willing to work shifts', travel: 'Willing to travel',
};

/** @returns {string} Markdown */
export function buildDetailsSheet(profile = {}) {
  const a = getAnswers(profile);
  const addr = a.address || {};
  const rows = (pairs) => pairs.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '/')} |`).join('\n');
  const [first, ...rest] = String(profile.name || '').trim().split(/\s+/);
  const out = [];
  out.push(`# Application details: ${profile.name || ''}`);
  out.push(`_Updated automatically from JobVibe on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}. Copy into a job form or an autofill extension; new answers appear here as they are saved._\n`);
  out.push('## Contact\n| Field | Value |\n|---|---|');
  out.push(rows([
    ['First name', first], ['Last name', rest.join(' ')], ['Email', a.email], ['Phone', a.phone ? `+91 ${a.phone}` : ''],
    ['LinkedIn', String(a.linkedin || '').replace(/[?#].*$/, '')], ['Portfolio', a.portfolio],
  ]));
  out.push('\n## Address\n| Field | Value |\n|---|---|');
  out.push(rows([
    ['Address line 1', addr.line1], ['City', cap(profile.baseCity || 'Bengaluru')], ['State', addr.state], ['PIN code', addr.pin], ['Country', 'India'], ['Full address', addr.full],
  ]));
  out.push('\n## Work\n| Field | Value |\n|---|---|');
  out.push(rows([
    ['Current employer', a.currentEmployer], ['Current title', a.currentTitle], ['Total experience', profile.totalExpYears != null ? `${profile.totalExpYears} years` : ''],
    ['Current CTC', a.currentCtcLpa ? (Number(a.currentCtcLpa) > 1000 ? `₹${Number(a.currentCtcLpa).toLocaleString('en-IN')} / year` : `${a.currentCtcLpa} LPA`) : ''],
    ['Expected CTC', a.expectedCtcLpa], ['Notice period', a.noticePeriodDays === 0 || a.noticePeriodDays === '0' ? 'Immediate (0 days)' : a.noticePeriodDays !== '' ? `${a.noticePeriodDays} days` : ''],
    ['Willing to relocate', a.relocate], ['Languages', a.languages],
  ]));
  if (a.skillYears && Object.keys(a.skillYears).length) {
    out.push('\n## Years per skill\n| Skill | Years |\n|---|---|');
    out.push(Object.entries(a.skillYears).map(([k, v]) => `| ${k} | ${v} |`).join('\n'));
  }
  out.push('\n## Education\n| Field | Value |\n|---|---|');
  out.push(rows([['Degree', a.degree], ['Field of study', a.fieldOfStudy], ['University', a.school], ['Graduation year', a.graduationYear]]));
  const decl = Object.entries(a.declarations || {}).filter(([k]) => DECLARATION_WORDS[k]);
  if (decl.length) {
    out.push('\n## Standard declarations\n| Question | Answer |\n|---|---|');
    out.push(decl.map(([k, v]) => `| ${DECLARATION_WORDS[k]} | ${yesNo(v)} |`).join('\n'));
  }
  out.push('\n## Diversity questions (optional on most forms)\n| Field | Value |\n|---|---|');
  out.push(rows([['Gender', a.eeo?.gender], ['Disability', a.eeo?.disability], ['Veteran', a.eeo?.veteran]]));
  if (a.custom.length) {
    out.push('\n## Other answers given on applications\n| Question | Answer |\n|---|---|');
    out.push(a.custom.map((c) => `| ${String(c.q).replace(/\|/g, '/').slice(0, 160)} | ${String(c.a).replace(/\|/g, '/')} |`).join('\n'));
  }
  return `${out.join('\n')}\n`;
}
