// Work out which lines of a CV may be edited for a job, in code — so the model
// is only ever shown (and only ever allowed to change) those lines.
//
//   header (name, contact)            locked
//   summary / profile                 editable
//   skills / competencies             editable
//   experience: role, company, dates  locked
//   experience: first 4 bullets/role  editable (later bullets locked)
//   projects: bullets                 editable (max 4)
//   education, certifications, rest   locked

const HEADING = /^(professional\s+|career\s+|executive\s+)?(summary|profile|objective|about( me)?|core\s+competencies|competencies|(technical\s+|key\s+|core\s+)?skills|skills?\s*(&|and)\s*\w+|areas of expertise|expertise|(professional\s+|work\s+|relevant\s+)?experience|employment( history)?|work history|career history|(key\s+|academic\s+)?projects|education|academic\s+\w+|qualifications|certifications?(\s*(&|and)\s*\w+)?|training|achievements|awards|accomplishments|languages|additional(\s+\w+)?|personal\s+(details|information)|declaration|interests|hobbies|references)\b/i;

const BULLET = /^\s*[•\-*▪●◦‣–·]\s*/;
const BULLETS_PER_ROLE = 4;
const PROJECT_BULLETS = 4;

function sectionOf(heading) {
  const h = heading.toLowerCase();
  if (/summary|profile|objective|about/.test(h)) return 'summary';
  if (/skill|competenc|expertise/.test(h)) return 'skills';
  if (/experience|employment|work history|career history/.test(h)) return 'experience';
  if (/project/.test(h)) return 'projects';
  return 'locked';
}

function isHeading(p) {
  const t = p.text.trim();
  if (!t || t.length > 48 || BULLET.test(t)) return false;
  if (/heading|title/i.test(p.style || '')) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const upper = letters.length >= 4 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.8;
  return upper ? HEADING.test(t) || t.split(/\s+/).length <= 4 : HEADING.test(t) && t.split(/\s+/).length <= 5;
}

/**
 * @param {{index:number,text:string,isList?:boolean,style?:string}[]} paragraphs
 * @returns {{index:number,text:string,section:string,kind:string,editable:boolean,role:number|null}[]}
 */
export function classify(paragraphs) {
  let section = 'header';
  let role = -1;
  let bulletsInRole = 0;
  let lastWasBullet = false;
  let projectBullets = 0;
  const out = [];

  for (const p of paragraphs) {
    const text = p.text || '';
    const blank = !text.trim();
    // Bullets come three ways: a typed bullet character, Word list numbering,
    // or a "List Bullet"-type paragraph style.
    const bullet = !blank && (BULLET.test(text) || p.isList === true || /list|bullet/i.test(p.style || ''));
    let kind = blank ? 'blank' : bullet ? 'bullet' : 'text';
    let editable = false;
    let myRole = null;

    if (!blank && isHeading(p)) {
      section = sectionOf(text);
      kind = 'heading';
      lastWasBullet = false;
    } else if (!blank) {
      if (section === 'summary') editable = true;
      else if (section === 'skills') editable = true;
      else if (section === 'experience') {
        if (bullet) {
          if (role < 0) { role = 0; bulletsInRole = 0; }
          bulletsInRole++;
          editable = bulletsInRole <= BULLETS_PER_ROLE;
          myRole = role;
        } else {
          // A non-bullet line after bullets starts the next role (title, company, dates).
          if (lastWasBullet || role < 0) { role++; bulletsInRole = 0; }
          kind = 'role';
          myRole = role;
        }
      } else if (section === 'projects' && bullet) {
        projectBullets++;
        editable = projectBullets <= PROJECT_BULLETS;
      }
      lastWasBullet = bullet;
    }
    out.push({ index: p.index, text, section, kind, editable, role: myRole });
  }
  return out;
}
