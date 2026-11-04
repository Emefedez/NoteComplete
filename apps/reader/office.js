// Word, OpenDocument and spreadsheet files, and CSV/TSV tables, turned into Markdown for
// the text view, as the "jimmy" note converter does. Fidelity is not the aim: headings,
// paragraphs, lists, tables, links, bold, italic and pictures (kept as files in a folder beside
// the Markdown) come through; layout does not. .odt is read here from its content.xml; .docx goes through mammoth (to HTML, then
// Markdown here) and .xlsx/.ods through SheetJS. Both libraries (vendor/) and this module
// are fetched only when such a file is opened.
import { decodeText } from './text-types.js';

// Big sheets are cut, so the view stays responsive.
export const MAX_ROWS = 1000, MAX_COLUMNS = 50;

// ---- Markdown text -------------------------------------------------------------------

// Characters the notes renderer would read as formatting ($ is math there).
export const escapeText = (text) => String(text).replace(/[\\`*_[\]<$~]/g, '\\$&');
// A paragraph must not start a heading, quote or list by accident.
const blockStart = (text) => text.replace(/^([#>+-])/, '\\$1').replace(/^(\d+)([.)])/, '$1\\$2');
// ---- Pictures --------------------------------------------------------------------------

// Pictures found in a document are kept as files in a folder beside the Markdown, "<name>_files",
// and linked from it, so they show in the text view and travel with a saved copy.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
const MAX_IMAGES = 300, MAX_IMAGE_BYTES = 25 * 1048576;
// The extension for a content type or a file name; null for pictures a browser cannot show (EMF, WMF, TIFF).
export function imageExtension(typeOrName) {
  const text = String(typeOrName || '').toLowerCase();
  const byType = Object.entries(IMAGE_TYPES).find(([, type]) => type === text.split(';')[0].trim());
  if (byType) return byType[0] === 'jpeg' ? 'jpg' : byType[0];
  const ext = text.match(/\.([a-z0-9]+)$/)?.[1];
  return ext && IMAGE_TYPES[ext] ? (ext === 'jpeg' ? 'jpg' : ext) : null;
}
export const imageType = (name) => IMAGE_TYPES[String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]] || 'application/octet-stream';
// The folder for a document's pictures: its name without extension, with nothing a file system dislikes.
export const imageFolder = (name) => `${String(name).replace(/\.[^./\\]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'document'}_files`;
// A path inside a Markdown link: spaces and brackets encoded, slashes kept.
export const linkPath = (path) => path.split('/').map((part) => encodeURIComponent(part).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
const imageMarkdown = (alt, path) => `![${escapeText(alt || '').replace(/[\]\n]/g, ' ')}](${linkPath(path)})`;
// Pictures collected while converting: numbered, the same bytes stored once.
function imageCollector(folder) {
  const images = [], seen = new Map();
  return {
    images,
    add(bytes, extension, key = '') {
      if (!extension || !bytes?.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;
      const id = key || `${extension}:${bytes.byteLength}:${Array.from(bytes.subarray(0, 64)).join(',')}:${Array.from(bytes.subarray(-64)).join(',')}`;
      if (seen.has(id)) return seen.get(id);
      if (images.length >= MAX_IMAGES) return null;
      const name = `image${images.length + 1}.${extension}`, path = `${folder}/${name}`;
      images.push({ name, path, bytes, type: IMAGE_TYPES[extension === 'jpg' ? 'jpeg' : extension] });
      seen.set(id, path);
      return path;
    },
  };
}
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const cellText = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();

// Runs of text with their style become Markdown; neighbouring runs styled alike are
// joined first, so "**a****b**" never happens.
function inlineMarkdown(runs) {
  const groups = [];
  for (const run of runs) {
    const last = groups.at(-1);
    if (run.t !== undefined && last?.t !== undefined && last.b === run.b && last.i === run.i && last.s === run.s && last.href === run.href) last.t += run.t;
    else groups.push({ ...run });
  }
  let out = '';
  for (const g of groups) {
    if (g.br) { out += '\\\n'; continue; }
    if (g.raw) { out += g.raw; continue; }
    const text = g.t.replace(/\s+/g, ' ');
    if (!text.trim()) { out += text; continue; }
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    let body = escapeText(text.trim());
    if (g.s) body = `~~${body}~~`;
    if (g.i) body = `*${body}*`;
    if (g.b) body = `**${body}**`;
    if (g.href) body = `[${body}](${g.href.replace(/[()\s]/g, encodeURIComponent)})`;
    out += lead + body + trail;
  }
  // A hard break at the very start or end of a paragraph means nothing.
  return out.replace(/^(\s|\\\n)+|(\s|\\\n)+$/g, '').replace(/ +/g, ' ');
}

// rows: arrays of cell Markdown. The first row is the header, as in a spreadsheet.
export function tableMarkdown(rows) {
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (!width) return '';
  const line = (row) => `| ${Array.from({ length: width }, (_, i) => cellText(row[i]).replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}

// rows: plain cell values (a spreadsheet or CSV). Empty rows and columns at the end are
// dropped, the rest is cut to MAX_ROWS × MAX_COLUMNS with a note saying so.
export function gridMarkdown(rows, { totalRows, totalColumns } = {}) {
  // Loops rather than Math.max(...rows): a CSV can have a million rows.
  const filled = (v) => cellText(v) !== '';
  let count = rows.length, width = 0;
  while (count && !rows[count - 1].some(filled)) count--;
  for (let r = 0; r < count; r++) for (let c = rows[r].length; c > width; c--) if (filled(rows[r][c - 1])) { width = c; break; }
  if (!count || !width) return '*Empty sheet.*';
  const allRows = Math.max(totalRows || 0, count), allColumns = Math.max(totalColumns || 0, width);
  const shown = rows.slice(0, Math.min(count, MAX_ROWS)).map((r) => Array.from({ length: Math.min(width, MAX_COLUMNS) }, (_, c) => escapeText(cellText(r[c]))));
  const cut = [];
  // A sheet's stated size can count formatted but empty cells: only a full cut is a cut.
  if (allRows > MAX_ROWS && count >= MAX_ROWS) cut.push(`the first ${MAX_ROWS} of ${allRows} rows`);
  if (allColumns > MAX_COLUMNS && width >= MAX_COLUMNS) cut.push(`the first ${MAX_COLUMNS} of ${allColumns} columns`);
  const table = tableMarkdown(shown);
  return cut.length ? `${table}\n\n*Showing ${cut.join(' and ')}.*` : table;
}

// ---- CSV and TSV -----------------------------------------------------------------------

// RFC 4180: quoted fields may hold the separator, newlines and doubled quotes.
export function parseDelimited(text, separator = ',') {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const s = String(text).replace(/^\uFEFF/, '');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === separator) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      if (c === '\r' && s[i + 1] === '\n') i++;
    } else field += c;
    i++;
  }
  if (field !== '' || row.length || quoted) { row.push(field); rows.push(row); }
  return rows;
}
// Excel in many languages writes ";" between fields; the first line tells.
export function guessSeparator(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of String(text).slice(0, 10000)) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]++;
  }
  return Object.keys(counts).reduce((best, c) => (counts[c] > counts[best] ? c : best));
}
export function delimitedMarkdown(text, separator = guessSeparator(text)) {
  return gridMarkdown(parseDelimited(text, separator));
}

// ---- XML ---------------------------------------------------------------------------------

// A small XML reader (no DOMParser in workers or Node): elements as { name, attrs,
// children }, text as strings. Lenient with unbalanced closing tags.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : ENTITIES[e.toLowerCase()] ?? m);
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [] }, stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = token.exec(text))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) {
      const at = stack.findLastIndex((n) => n.name === m[2]);
      if (at > 0) stack.length = at;
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
      const node = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
    else if (m[0] === '<') top.children.push('<');
  }
  return root;
}
const find = (node, name) => node?.children.find((c) => c.name === name);
const descendants = function* (node, name) {
  for (const c of node.children) if (typeof c !== 'string') { if (c.name === name) yield c; yield* descendants(c, name); }
};

// ---- Documents: a shared walk -----------------------------------------------------------

// A dialect says what each element is: kind(node) is 'heading', 'para', 'list', 'table',
// 'skip', 'block' (a container of blocks) or 'inline'; inline(node, style) gives the style
// inside an inline element, or { br }, { text }, { note }, { image }, { skip }.
function documentMarkdown(root, dialect) {
  const notes = [];
  function runs(nodes, style, out) {
    for (const n of nodes) {
      if (typeof n === 'string') { out.push({ ...style, t: n }); continue; }
      const kind = dialect.kind(n);
      if (kind === 'skip') continue;
      if (kind !== 'inline') { out.push({ ...style, t: ' ' }); runs(n.children, style, out); out.push({ ...style, t: ' ' }); continue; }
      const r = dialect.inline(n, style);
      if (r.skip) continue;
      if (r.br) out.push({ br: true });
      else if (r.text !== undefined) out.push({ ...style, t: r.text });
      else if (r.image !== undefined && r.src) out.push({ raw: imageMarkdown(r.image, r.src) });
      else if (r.image !== undefined) out.push({ ...style, t: r.image ? `[Image: ${r.image}]` : '[Image]' });
      else if (r.note) {
        const text = inlineMarkdown(runs(r.note, {}, []));
        if (text) { notes.push(text); out.push({ raw: `[^${notes.length}]` }); }
      } else runs(n.children, r.style || style, out);
    }
    return out;
  }
  const inline = (node, style = dialect.paraStyle?.(node) || {}) => inlineMarkdown(runs(node.children, style, []));
  function list(node, depth) {
    const ordered = dialect.ordered(node, depth);
    return dialect.items(node).map((item, n) => {
      const marker = ordered ? `${n + 1}. ` : '- ', pad = ' '.repeat(marker.length);
      const body = blocks(item, depth + 1).join('\n');
      return body && marker + body.split('\n').map((l, j) => (j && l ? pad + l : l)).join('\n');
    }).filter(Boolean).join('\n');
  }
  function blocks(node, depth = 0) {
    const out = [], pending = [];
    const flush = () => {
      const text = inlineMarkdown(runs(pending.splice(0), {}, []));
      if (text) out.push(blockStart(text));
    };
    for (const n of node.children) {
      // Spaces count between inline elements only.
      const kind = typeof n === 'string' ? (n.trim() || pending.length ? 'inline' : 'skip') : dialect.kind(n);
      if (kind === 'inline') { pending.push(n); continue; }
      flush();
      // A heading keeps to one line, without its style's bold.
      if (kind === 'heading') { const text = inline(n, {}).replace(/\\\n/g, ' '); if (text) out.push(`${'#'.repeat(dialect.level(n))} ${text}`); }
      else if (kind === 'para') { const text = inline(n); if (text) out.push(blockStart(text)); }
      else if (kind === 'list') { const text = list(n, depth); if (text) out.push(text); }
      else if (kind === 'table') {
        const rows = dialect.rows(n).map((row) => row.map((cell) => (cell ? inline(cell, {}).replace(/\\\n/g, ' ') : '')));
        while (rows.length && rows.at(-1).every((c) => !c)) rows.pop();
        // Trailing empty cells, often repeated to the page's edge, are not columns.
        let width = rows.reduce((w, r) => Math.max(w, r.length), 0);
        while (width && rows.every((r) => !r[width - 1])) width--;
        const text = tableMarkdown(rows.map((r) => r.slice(0, width)));
        if (text) out.push(text);
      } else if (kind === 'block') for (const b of blocks(n, depth)) out.push(b);
    }
    flush();
    return out;
  }
  const body = blocks(root).join('\n\n') || '*This document has no text.*';
  return (body + (notes.length ? `\n\n${notes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n')}` : '')).trim() + '\n';
}

// ---- OpenDocument text (.odt) -------------------------------------------------------------

// Bold, italic and struck-through text styles, and numbered or bulleted list levels, from
// content.xml's automatic styles and styles.xml's named ones.
function odfStyles(...trees) {
  const text = new Map(), lists = new Map();
  for (const tree of trees) {
    for (const s of descendants(tree, 'style:style')) {
      const p = find(s, 'style:text-properties')?.attrs || {};
      // Set when the style says, so "normal" undoes a bold parent.
      const style = {}, weight = p['fo:font-weight'], slant = p['fo:font-style'], strike = p['style:text-line-through-style'];
      if (weight) style.b = weight === 'bold' || Number(weight) >= 600;
      if (slant) style.i = slant === 'italic' || slant === 'oblique';
      if (strike) style.s = strike !== 'none';
      text.set(s.attrs['style:name'], { style, parent: s.attrs['style:parent-style-name'] });
    }
    for (const l of descendants(tree, 'text:list-style')) {
      const levels = {};
      for (const level of l.children) if (typeof level !== 'string') levels[level.attrs['text:level']] = level.name === 'text:list-level-style-number';
      lists.set(l.attrs['style:name'], levels);
    }
  }
  const resolve = (name, seen = 0) => {
    const entry = text.get(name);
    if (!entry || seen > 10) return {};
    return { ...resolve(entry.parent, seen + 1), ...entry.style };
  };
  return { text: (name) => resolve(name), list: (name, depth) => lists.get(name)?.[depth + 1] ?? false };
}

export function odfToMarkdown(contentXml, stylesXml = '', pictures = new Map()) {
  const content = parseXml(contentXml);
  const styles = odfStyles(content, parseXml(stylesXml));
  const body = find(find(find(content, 'office:document-content'), 'office:body'), 'office:text');
  if (!body) throw Error('This file has no text.');
  // A nested list without a style follows the list around it.
  const listStyle = new Map();
  const SKIP = new Set(['text:tracked-changes', 'text:sequence-decls', 'text:variable-decls', 'text:user-field-decls', 'office:forms', 'office:annotation',
    'office:annotation-end', 'text:soft-page-break', 'text:bookmark', 'text:bookmark-start', 'text:bookmark-end', 'text:reference-mark', 'text:reference-mark-start',
    'text:reference-mark-end', 'text:alphabetical-index-mark', 'text:toc-mark', 'text:change', 'text:change-start', 'text:change-end', 'table:table-columns',
    'table:table-column', 'table:table-column-group', 'text:index-title-template', 'text:table-of-content-source', 'text:alphabetical-index-source',
    'svg:title', 'svg:desc', 'draw:image', 'text:note-citation', 'office:event-listeners']);
  const dialect = {
    kind(n) {
      if (SKIP.has(n.name)) return 'skip';
      if (n.name === 'text:h') return 'heading';
      if (n.name === 'text:p') return 'para';
      if (n.name === 'text:list') return 'list';
      if (n.name === 'table:table') return 'table';
      if (/^(text:(section|list-item|list-header|index-body|table-of-content|illustration-index|table-index|alphabetical-index|bibliography|user-index|object-index)|office:text)$/.test(n.name)) return 'block';
      return 'inline';
    },
    level: (n) => Math.min(6, Math.max(1, Number(n.attrs['text:outline-level']) || 1)),
    paraStyle: (n) => styles.text(n.attrs['text:style-name']),
    ordered(n, depth) {
      const name = n.attrs['text:style-name'] || listStyle.get(n);
      for (const c of descendants(n, 'text:list')) if (!listStyle.has(c)) listStyle.set(c, name);
      return styles.list(name, depth);
    },
    items: (n) => n.children.filter((c) => c.name === 'text:list-item' || c.name === 'text:list-header'),
    rows(n) {
      const rows = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (c.name === 'table:table-row') {
            const cells = [];
            for (const cell of c.children) {
              if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue;
              const repeat = Math.min(Number(cell.attrs['table:number-columns-repeated']) || 1, MAX_COLUMNS);
              for (let i = 0; i < repeat && cells.length < MAX_COLUMNS; i++) cells.push(cell.name === 'table:table-cell' ? cell : null);
            }
            const repeat = Math.min(Number(c.attrs['table:number-rows-repeated']) || 1, MAX_ROWS);
            for (let i = 0; i < repeat && rows.length < MAX_ROWS; i++) rows.push(cells);
          } else if (typeof c !== 'string' && /^table:table-(header-rows|rows|row-group)$/.test(c.name)) walk(c);
        }
      };
      walk(n);
      return rows;
    },
    inline(n, style) {
      switch (n.name) {
        case 'text:s': return { text: ' '.repeat(Math.min(Number(n.attrs['text:c']) || 1, 100)) };
        case 'text:tab': return { text: ' ' };
        case 'text:line-break': return { br: true };
        case 'text:note': return { note: find(n, 'text:note-body')?.children || [] };
        case 'text:span': return { style: { ...style, ...styles.text(n.attrs['text:style-name']) } };
        case 'text:a': return { style: { ...style, href: n.attrs['xlink:href'] } };
        case 'draw:frame': {
          // Text boxes keep their text; a picture is named by its title or description.
          if (find(n, 'draw:text-box')) return { style };
          const picture = find(n, 'draw:image');
          if (!picture) return { style };
          const label = (find(n, 'svg:title') || find(n, 'svg:desc'))?.children.filter((c) => typeof c === 'string').join('').trim();
          return { image: label || '', src: pictures.get(picture.attrs['xlink:href']) };
        }
        default: return { style };
      }
    },
  };
  return documentMarkdown(body, dialect);
}

// ---- Zip (for .odt) -----------------------------------------------------------------------

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// One file of a zip archive, or null when it has none by that name.
export async function zipEntry(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('Not a zip archive.');
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) throw Error('Damaged zip archive.');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), offset = view.getUint32(at + 42, true);
    const nameLength = view.getUint16(at + 28, true), entry = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (entry === name) {
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw Error('Unsupported zip compression.');
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return null;
}
// { markdown, images }: the pictures of the text, as files under `folder`.
export async function odtDocument(bytes, folder = 'document_files') {
  const content = await zipEntry(bytes, 'content.xml');
  if (!content) throw Error('This file has no text.');
  const styles = await zipEntry(bytes, 'styles.xml');
  const decode = (b) => new TextDecoder().decode(b);
  const xml = decode(content), collector = imageCollector(folder), pictures = new Map();
  for (const m of xml.matchAll(/<draw:image\b[^>]*?xlink:href\s*=\s*"([^"]+)"/g)) {
    const href = decodeEntities(m[1]);
    if (pictures.has(href) || /^[a-z]+:/i.test(href)) continue;
    const data = await zipEntry(bytes, href).catch(() => null);
    const path = data && collector.add(data, imageExtension(href));
    if (path) pictures.set(href, path);
  }
  return { markdown: odfToMarkdown(xml, styles ? decode(styles) : '', pictures), images: collector.images };
}
export async function odtMarkdown(bytes) { return (await odtDocument(bytes)).markdown; }

// ---- Word (.docx), through mammoth's HTML ------------------------------------------------

export function htmlToMarkdown(html) {
  const BLOCK = /^(p|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|div|blockquote|pre|body|html|section|article|header|footer|figure|figcaption|dl|dt|dd|hr)$/;
  const root = parseXml(html), notes = new Map();
  // mammoth lists footnotes and endnotes at the end; they become Markdown footnotes, as in .odt.
  const NOTE = /^(foot|end)note-\d+$/;
  (function collect(node) {
    node.children = node.children.filter((c) => {
      if (typeof c === 'string') return true;
      if (c.name === 'ol' && c.children.some((li) => NOTE.test(li.attrs?.id || ''))) {
        for (const li of c.children) if (NOTE.test(li.attrs?.id || '')) notes.set(li.attrs.id, li.children);
        return false;
      }
      collect(c);
      return true;
    });
  })(root);
  const rowsOf = (node) => node.children.flatMap((c) => c.name === 'tr' ? [c.children.filter((d) => d.name === 'td' || d.name === 'th')] : typeof c !== 'string' && /^(thead|tbody|tfoot)$/.test(c.name) ? rowsOf(c) : []);
  const dialect = {
    kind(n) {
      if (/^(script|style|head|title)$/.test(n.name)) return 'skip';
      if (/^h[1-6]$/.test(n.name)) return 'heading';
      if (n.name === 'p' || n.name === 'dt' || n.name === 'dd' || n.name === 'figcaption') return 'para';
      if (n.name === 'ul' || n.name === 'ol') return 'list';
      if (n.name === 'table') return 'table';
      return BLOCK.test(n.name) ? 'block' : 'inline';
    },
    level: (n) => Number(n.name[1]),
    ordered: (n) => n.name === 'ol',
    items: (n) => n.children.filter((c) => c.name === 'li'),
    rows(n) {
      const rows = rowsOf(n);
      // Merged cells (colspan) take their columns, empty after the first.
      return rows.map((r) => r.flatMap((c) => [c, ...Array(Math.min(Math.max(0, (Number(c.attrs.colspan) || 1) - 1), MAX_COLUMNS)).fill(null)]));
    },
    inline(n, style) {
      switch (n.name) {
        case 'br': return { br: true };
        case 'img': return { image: n.attrs.alt || '', src: n.attrs.src && !/^(data:|[a-z]+:)/i.test(n.attrs.src) ? n.attrs.src : '' };
        case 'strong': case 'b': return { style: { ...style, b: true } };
        case 'em': case 'i': return { style: { ...style, i: true } };
        case 's': case 'del': case 'strike': return { style: { ...style, s: true } };
        case 'a': {
          const href = n.attrs.href || '';
          if (notes.has(href.slice(1))) return { note: notes.get(href.slice(1)) };
          if (/^#(foot|end)note-ref-/.test(href)) return { skip: true };
          // Other links within the document are kept as text.
          return { style: href && !href.startsWith('#') ? { ...style, href } : style };
        }
        default: return { style };
      }
    },
  };
  return documentMarkdown(root, dialect);
}
// mammoth: the library (window.mammoth, or require('mammoth') in tests); input as it takes
// it ({ arrayBuffer } in the browser, { buffer } in Node). Pictures are not read at all.
// Pictures are saved as files under `folder` and linked; { markdown, images }.
export async function docxDocument(mammoth, input, folder = 'document_files') {
  const collector = imageCollector(folder);
  const convertImage = mammoth.images.imgElement(async (image) => {
    try {
      const path = collector.add(fromBase64(await image.read('base64')), imageExtension(image.contentType));
      return path ? { src: path, alt: image.altText || '' } : { src: '' };
    } catch { return { src: '' }; }
  });
  const result = await mammoth.convertToHtml(input, { convertImage });
  return { markdown: htmlToMarkdown(result.value), images: collector.images };
}
export async function docxToMarkdown(mammoth, input) { return (await docxDocument(mammoth, input)).markdown; }

// ---- Spreadsheets (.xlsx, .ods), through SheetJS ------------------------------------------

// One "##" heading per sheet, then its cells as a table, as formatted in the file.
export function workbookMarkdown(XLSX, workbook) {
  const parts = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    parts.push(`## ${escapeText(name)}`);
    if (!sheet?.['!ref']) { parts.push('*Empty sheet.*'); continue; }
    const range = XLSX.utils.decode_range(sheet['!ref']), full = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    range.e.r = Math.min(range.e.r, range.s.r + MAX_ROWS - 1);
    range.e.c = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true, range });
    parts.push(gridMarkdown(rows, { totalRows: full.e.r - full.s.r + 1, totalColumns: full.e.c - full.s.c + 1 }));
  }
  return parts.join('\n\n') + '\n';
}
export function readWorkbook(XLSX, bytes) {
  // sheetRows stops reading a sheet after the rows shown; !fullref keeps its real size.
  return XLSX.read(bytes, { type: 'array', sheetRows: MAX_ROWS, cellFormula: false, cellHTML: false, cellStyles: false });
}

// ---- Opening a file ------------------------------------------------------------------------

const libraries = {};
// The UMD builds set a global; a script tag loads them as the Notes editor is loaded.
function library(file, global, what) {
  return libraries[file] ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`./vendor/${file}`, import.meta.url).href;
    script.onload = () => resolve(window[global]);
    script.onerror = () => { delete libraries[file]; script.remove(); reject(Error(`The ${what} reader could not be loaded. Check the connection and try again.`)); };
    document.head.append(script);
  });
}
const NAMES = { docx: 'Word document', odt: 'OpenDocument text', xlsx: 'Excel spreadsheet', ods: 'OpenDocument spreadsheet', csv: 'CSV table', tsv: 'TSV table' };

// The Markdown shown for an opened office file or CSV/TSV table, and its pictures as files
// under `imageFolder` ({ markdown, images, folder }).
export async function officeDocument(name, bytes) {
  const ext = String(name).toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (!NAMES[ext]) throw Error('This file type cannot be converted.');
  const folder = imageFolder(name);
  if (ext === 'csv' || ext === 'tsv') return { markdown: delimitedMarkdown(decodeText(bytes), ext === 'tsv' ? '\t' : undefined), images: [], folder };
  const lib = ext === 'docx' ? await library('mammoth/mammoth.browser.min.js', 'mammoth', 'Word')
    : ext === 'xlsx' || ext === 'ods' ? await library('sheetjs/xlsx.mini.min.js', 'XLSX', 'spreadsheet') : null;
  try {
    if (ext === 'odt') return { ...(await odtDocument(bytes, folder)), folder };
    if (ext === 'docx') return { ...(await docxDocument(lib, { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, folder)), folder };
    return { markdown: workbookMarkdown(lib, readWorkbook(lib, bytes)), images: [], folder };
  } catch {
    throw Error(`This ${NAMES[ext]} could not be read. It may be damaged or protected with a password.`);
  }
}
export async function officeMarkdown(name, bytes) { return (await officeDocument(name, bytes)).markdown; }
