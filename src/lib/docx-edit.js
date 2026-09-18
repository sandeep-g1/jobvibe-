// Edit a .docx in place: read its paragraphs, replace the text of chosen ones,
// and leave every other paragraph — and all formatting — byte-identical.
//
// A .docx is a ZIP whose word/document.xml holds the body. Text sits in
// <w:t> nodes inside <w:r> runs inside <w:p> paragraphs. To change a paragraph
// without disturbing its formatting, we put the new text into its FIRST run's
// <w:t> and blank the remaining runs' <w:t> — the paragraph keeps its bullet,
// indent and the first run's font. Paragraphs we are not asked to change are
// never touched.
import JSZip from 'jszip';

const DOC = 'word/document.xml';

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function xmlUnescape(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Plain text of one paragraph chunk (all <w:t> concatenated). */
function paragraphText(chunk) {
  const parts = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => xmlUnescape(m[1]));
  return parts.join('');
}

/** Split document.xml into ordered paragraph chunks with their text. */
function splitParagraphs(xml) {
  // Match each <w:p ...>...</w:p> (paragraphs are not nested in each other).
  const chunks = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  return chunks.map((m, i) => ({
    index: i,
    start: m.index,
    end: m.index + m[0].length,
    xml: m[0],
    text: paragraphText(m[0]),
  }));
}

/** Rewrite one paragraph's visible text into its first run, blanking the rest. */
function rewriteParagraph(pXml, newText) {
  const runs = [...pXml.matchAll(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g)];
  if (!runs.length) return pXml; // nothing to replace (e.g. empty bullet) — leave as is
  let out = pXml;
  // First <w:t> gets the new text (preserve xml:space to keep leading/trailing spaces).
  const first = runs[0][0];
  const firstReplaced = first.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/,
    (_, open, close) => `${open.includes('xml:space') ? open : open.replace('>', ' xml:space="preserve">')}${xmlEscape(newText)}${close}`);
  out = out.replace(first, firstReplaced);
  // Remaining <w:t> nodes get emptied.
  for (let k = 1; k < runs.length; k++) {
    const r = runs[k][0];
    out = out.replace(r, r.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/, '$1$2'));
  }
  return out;
}

/** Load a docx buffer and return its paragraphs (index + text) for the model. */
export async function readParagraphs(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(DOC);
  if (!file) throw new Error('not a Word .docx (no document.xml)');
  const xml = await file.async('string');
  const paragraphs = splitParagraphs(xml).map((p) => ({ index: p.index, text: p.text }));
  return { paragraphs };
}

/**
 * Apply {index: newText} edits to a docx buffer, changing only those paragraphs.
 * @returns {{ buffer:Buffer, changed:number }}
 */
export async function applyEdits(buffer, edits) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(DOC);
  if (!file) throw new Error('not a Word .docx (no document.xml)');
  let xml = await file.async('string');

  const paras = splitParagraphs(xml);
  // Apply from the end so earlier offsets stay valid as we splice.
  const targets = Object.keys(edits)
    .map(Number)
    .filter((i) => Number.isInteger(i) && paras[i])
    .sort((a, b) => b - a);

  let changed = 0;
  for (const i of targets) {
    const p = paras[i];
    const newText = String(edits[i] ?? '');
    if (newText === p.text) continue; // no-op
    const rewritten = rewriteParagraph(p.xml, newText);
    if (rewritten === p.xml) continue;
    xml = xml.slice(0, p.start) + rewritten + xml.slice(p.end);
    changed++;
  }

  zip.file(DOC, xml);
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer: out, changed };
}
