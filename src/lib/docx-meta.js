// A CV sent to an employer carries its owner's name in its file properties, not
// whoever last edited it on some PC ("Last modified by: …") or "Un-named".
import JSZip from 'jszip';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Set author / last-modified-by to `name` and the modified date to now. Returns a new .docx buffer. */
export async function ownDocx(buffer, name) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file('docProps/core.xml');
    if (!f || !name) return buffer;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    let xml = await f.async('string');
    const set = (tag, value, attrs = '') => {
      const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>|<${tag}(\\s[^>]*)?/>`);
      const el = `<${tag}${attrs}>${value}</${tag}>`;
      xml = re.test(xml) ? xml.replace(re, el) : xml.replace('</cp:coreProperties>', `${el}</cp:coreProperties>`);
    };
    set('dc:creator', esc(name));
    set('cp:lastModifiedBy', esc(name));
    set('dcterms:modified', now, ' xsi:type="dcterms:W3CDTF"');
    zip.file('docProps/core.xml', xml);
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    return buffer; // never block an application over file properties
  }
}
