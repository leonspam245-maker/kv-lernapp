// Word-Dateien (.docx) ohne Zusatzbibliothek lesen: ZIP entpacken, document.xml in Markdown umwandeln.
// Überschriften, Aufzählungen und Tabellen bleiben erhalten.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Eine Datei aus einem ZIP-Archiv lesen (unterstützt «stored» und «deflate»). */
async function readZipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist keine gültige Word-Datei (.docx).');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    if (name === wanted) {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = new Uint8Array(buffer, start, size);
      if (method === 0) return dec.decode(data);
      if (method !== 8) throw new Error('Diese Word-Datei verwendet eine nicht unterstützte Komprimierung.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('In der Datei wurde kein Word-Text gefunden.');
}

const kids = (el, name) => [...el.childNodes].filter((c) => c.nodeType === 1 && c.namespaceURI === W && c.localName === name);
const kid = (el, name) => kids(el, name)[0];

function runText(p) {
  let out = '';
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === W && c.localName === 't') out += c.textContent;
      else if (c.namespaceURI === W && c.localName === 'tab') out += ' ';
      else if (c.namespaceURI === W && (c.localName === 'br' || c.localName === 'cr')) out += ' ';
      else if (!(c.namespaceURI === W && c.localName === 'pPr')) walk(c);
    }
  };
  walk(p);
  return out.replace(/\s+/g, ' ').trim();
}

function paragraph(p) {
  const text = runText(p);
  if (!text) return '';
  const pPr = kid(p, 'pPr');
  const style = pPr && kid(pPr, 'pStyle')?.getAttributeNS(W, 'val') || '';
  const h = style.match(/^(?:Heading|berschrift|Überschrift)\s*(\d)$/i) || (/^(Title|Titel)$/i.test(style) ? [null, '1'] : null);
  if (h) return `${'#'.repeat(Math.min(Number(h[1]), 4))} ${text}`;
  const numPr = pPr && kid(pPr, 'numPr');
  if (numPr || /List/i.test(style)) {
    const lvl = Number(numPr && kid(numPr, 'ilvl')?.getAttributeNS(W, 'val')) || 0;
    return `${'  '.repeat(lvl)}- ${text}`;
  }
  return text;
}

function table(tbl) {
  const rows = kids(tbl, 'tr').map((tr) => kids(tr, 'tc').map((tc) => kids(tc, 'p').map(runText).filter(Boolean).join(' ').replace(/\|/g, '/')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
  return [`| ${norm[0].join(' | ')} |`, `| ${norm[0].map(() => '---').join(' | ')} |`, ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** .docx-Datei (ArrayBuffer) → Markdown-Text */
export async function docxToMarkdown(buffer) {
  const xml = await readZipEntry(buffer, 'word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Der Inhalt der Word-Datei ist beschädigt.');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('In der Datei wurde kein Word-Text gefunden.');
  const blocks = [];
  let prevList = false;
  for (const el of body.children) {
    if (el.namespaceURI !== W) continue;
    if (el.localName === 'p') {
      const line = paragraph(el);
      if (!line) { prevList = false; continue; }
      const isList = /^\s*- /.test(line);
      if (isList && prevList) blocks[blocks.length - 1] += '\n' + line; else blocks.push(line);
      prevList = isList;
    } else if (el.localName === 'tbl') { const t = table(el); if (t) blocks.push(t); prevList = false; }
  }
  return blocks.join('\n\n').trim();
}
