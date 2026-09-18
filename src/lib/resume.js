// Resume file handling: extract plain text from an uploaded .docx or .pdf.
// The raw bytes are kept (for later JD-tailoring, which edits the original
// .docx in place), and the extracted text feeds Gemini for autofill.
import mammoth from 'mammoth';

export const ACCEPTED = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

export function kindFromName(name = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.txt')) return 'txt';
  return null;
}

/**
 * Extract text from an uploaded resume buffer.
 * @returns {{ ok:boolean, text?:string, kind?:string, error?:string }}
 */
export async function extractText(buffer, filename, mime) {
  const kind = kindFromName(filename) || ACCEPTED[mime] || null;
  if (!kind) return { ok: false, error: 'Please upload a .docx, .pdf or .txt file.' };

  try {
    if (kind === 'txt') {
      return { ok: true, kind, text: buffer.toString('utf8') };
    }
    if (kind === 'docx') {
      const { value } = await mammoth.extractRawText({ buffer });
      return { ok: true, kind, text: (value || '').trim() };
    }
    if (kind === 'pdf') {
      // pdf-parse is loaded lazily: it is heavier and only needed for PDFs.
      const mod = await import('pdf-parse/lib/pdf-parse.js').catch(() => null);
      if (!mod) return { ok: false, kind, error: 'PDF parsing is unavailable — please upload a .docx.' };
      const pdf = mod.default || mod;
      const out = await pdf(buffer);
      return { ok: true, kind, text: (out.text || '').trim() };
    }
  } catch (err) {
    return { ok: false, kind, error: `Could not read the file (${err.message}).` };
  }
  return { ok: false, error: 'Unsupported file.' };
}
