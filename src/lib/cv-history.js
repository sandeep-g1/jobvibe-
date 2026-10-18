// Her work history and education, read from the CV text, for forms that ask for them field by
// field (Workday's "My Experience" page). No AI: the CV lays each role out as
//   "<Title>\t<Mon YYYY> – <Mon YYYY | Present>"  then  "<Company> | <City>"
// and each degree as "<Degree> — <School> | CGPA…\t<Mon YYYY>".
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{4})';
const RANGE = new RegExp(`${MON}\\s*[–—-]+\\s*(?:${MON}|(present|current|now|till date))`, 'i');
const ONE = new RegExp(`${MON}\\s*$`, 'i');

const mmyyyy = (mon, year) => `${String(MONTHS.indexOf(mon.toLowerCase().slice(0, 3)) + 1).padStart(2, '0')}/${year}`;
// "ENTERPRISE EVERGREEN GLOBALPRIVATE LIMITED" → "Enterprise Evergreen Global Private Limited"
const tidyCompany = (s) => {
  const t = s.replace(/([a-z])(private|pvt|limited|ltd)\b/gi, '$1 $2').trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t;
};

/** @returns {{ roles: {title,company,location,from,to,current}[], education: {degree,school,field,from,to}[] }} */
export function cvHistory(cvText) {
  const lines = String(cvText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const roles = [];
  const education = [];
  let inEdu = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^education\b/i.test(l)) { inEdu = true; continue; }
    if (inEdu && /^(certifications?|trainings?|languages|skills|projects|awards)\b/i.test(l)) inEdu = false;
    if (inEdu) {
      const d = l.match(ONE);
      const deg = l.match(/^(.+?)\s+[—–-]\s+(.+?)(\s*\|.*)?\s*\t?\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4})?\s*$/i);
      if (d && deg) {
        const degree = deg[1].trim();
        const field = degree.match(/\(([^)]+)\)/)?.[1] || (/commerce/i.test(degree) ? 'Commerce' : '');
        const to = Number(d[2]);
        // Start year isn't on the CV: a master's takes 2 years, a bachelor's 3 (Indian norm).
        const from = to - (/master|m\.?\s?com|mba|m\.?\s?sc/i.test(degree) ? 2 : 3);
        education.push({ degree, school: deg[2].replace(/\s*\|.*$/, '').trim(), field, from: String(from), to: String(to) });
      }
      continue;
    }
    const r = l.match(RANGE);
    if (!r || l.length > 140) continue;
    const title = l.slice(0, r.index).replace(/[\t|,–—-]+\s*$/, '').trim();
    const next = lines[i + 1] || '';
    if (!title || RANGE.test(next)) continue;
    const [company, location = ''] = next.split('|').map((s) => s.trim());
    const current = !!r[5];
    roles.push({ title, company: tidyCompany(company), location, from: mmyyyy(r[1], r[2]), to: current ? '' : mmyyyy(r[3], r[4]), current });
  }
  return { roles, education };
}
