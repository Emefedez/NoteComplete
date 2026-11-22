// Word, OpenDocument, PowerPoint, spreadsheet, RTF, EPUB, Jupyter notebook and CSV/TSV files
// turned into Markdown for the text view, as the "jimmy" note converter does. Fidelity is not
// the aim: headings, paragraphs, lists, tables, links, bold, italic, slides, notes and pictures
// (kept as files in a folder beside the Markdown) come through; layout does not.
// Most formats are read directly here; .docx prefers mammoth (with a built-in OOXML fallback)
// and spreadsheets (.xlsx/.xlsm/.xlsb/.xls/.ods/.fods) use SheetJS. Both libraries (vendor/)
// and this module are fetched only when such a file is opened.
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
const fromBase64 = (b64) => Uint8Array.from(atob(String(b64).replace(/\s+/g, '')), (c) => c.charCodeAt(0));

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
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', times: '\u00d7', divide: '\u00f7', bull: '\u2022', middot: '\u00b7' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [] }, stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = token.exec(text))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) {
      const at = stack.findLastIndex((n) => n.name === m[2] || n.name.toLowerCase() === m[2].toLowerCase());
      if (at > 0) stack.length = at;
    } else if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        attrs[a[1]] = a[2] !== undefined ? decodeEntities(a[2]) : a[3] !== undefined ? decodeEntities(a[3]) : a[4] !== undefined ? decodeEntities(a[4]) : '';
      }
      const node = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (!m[5] && !/^(br|hr|img|meta|link|input|area|base|col|embed|param|source|track|wbr)$/i.test(m[3])) stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
    else if (m[0] === '<') top.children.push('<');
  }
  return root;
}
const find = (node, name) => node?.children.find((c) => c.name === name);
const localName = (name) => { const i = String(name || '').indexOf(':'); return i >= 0 ? name.slice(i + 1) : String(name || ''); };
const findLocal = (node, local) => node?.children.find((c) => typeof c !== 'string' && localName(c.name) === local);
const descendants = function* (node, name) {
  for (const c of node?.children || []) if (typeof c !== 'string') { if (c.name === name) yield c; yield* descendants(c, name); }
};
const descendantsLocal = function* (node, local) {
  for (const c of node?.children || []) if (typeof c !== 'string') { if (localName(c.name) === local) yield c; yield* descendantsLocal(c, local); }
};
const plainTextOf = (node) => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  return (node.children || []).map(plainTextOf).join('');
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

// ---- Zip (for .odt, .docx, .pptx, .odp, .epub) -------------------------------------------

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function zipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('Not a zip archive.');
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const entries = [];
  for (let n = count; n > 0 && at + 46 <= bytes.length; n--) {
    if (view.getUint32(at, true) !== 0x02014b50) throw Error('Damaged zip archive.');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true), offset = view.getUint32(at + 42, true);
    const nameLength = view.getUint16(at + 28, true), entry = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name: entry, method, size, offset });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}
export function zipList(bytes) {
  return zipDirectory(bytes).map((e) => e.name);
}
// One file of a zip archive, or null when it has none by that name.
export async function zipEntry(bytes, name) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const target = String(name || '').replace(/^\.\//, '');
  const entries = zipDirectory(bytes);
  const hit = entries.find((e) => e.name === target) || entries.find((e) => e.name.toLowerCase() === target.toLowerCase());
  if (!hit) return null;
  const start = hit.offset + 30 + view.getUint16(hit.offset + 26, true) + view.getUint16(hit.offset + 28, true);
  const data = bytes.subarray(start, start + hit.size);
  if (hit.method === 0) return data;
  if (hit.method === 8) return inflate(data);
  throw Error('Unsupported zip compression.');
}

// Resolve a relative path inside a zip archive (e.g. from "ppt/slides/slide1.xml" to "../media/image1.png").
function resolveZipPath(baseFile, relative) {
  const rel = String(relative || '').replace(/\\/g, '/');
  if (!rel) return '';
  if (rel.startsWith('/')) return rel.replace(/^\/+/, '');
  const parts = baseFile.includes('/') ? baseFile.split('/').slice(0, -1) : [];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function parseRels(xml) {
  const map = new Map();
  if (!xml) return map;
  for (const r of descendantsLocal(parseXml(xml), 'Relationship')) {
    const id = r.attrs.Id || r.attrs.id;
    if (id) map.set(id, { target: r.attrs.Target || '', type: r.attrs.Type || '', mode: r.attrs.TargetMode || '' });
  }
  return map;
}

// ---- OpenDocument text (.odt, .fodt) & presentations (.odp) ------------------------------

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

function odfDialect(styles, pictures = new Map()) {
  const listStyle = new Map();
  const SKIP = new Set(['text:tracked-changes', 'text:sequence-decls', 'text:variable-decls', 'text:user-field-decls', 'office:forms', 'office:annotation',
    'office:annotation-end', 'text:soft-page-break', 'text:bookmark', 'text:bookmark-start', 'text:bookmark-end', 'text:reference-mark', 'text:reference-mark-start',
    'text:reference-mark-end', 'text:alphabetical-index-mark', 'text:toc-mark', 'text:change', 'text:change-start', 'text:change-end', 'table:table-columns',
    'table:table-column', 'table:table-column-group', 'text:index-title-template', 'text:table-of-content-source', 'text:alphabetical-index-source',
    'svg:title', 'svg:desc', 'draw:image', 'text:note-citation', 'office:event-listeners', 'presentation:notes', 'draw:page-thumbnail']);
  return {
    kind(n) {
      if (SKIP.has(n.name)) return 'skip';
      if (n.name === 'text:h') return 'heading';
      if (n.name === 'text:p') return 'para';
      if (n.name === 'text:list') return 'list';
      if (n.name === 'table:table') return 'table';
      if (/^(text:(section|list-item|list-header|index-body|table-of-content|illustration-index|table-index|alphabetical-index|bibliography|user-index|object-index)|office:text|draw:(text-box|g|page))$/.test(n.name)) return 'block';
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
}

export function odfToMarkdown(contentXml, stylesXml = '', pictures = new Map()) {
  const content = parseXml(contentXml);
  const styles = odfStyles(content, parseXml(stylesXml));
  const docRoot = find(content, 'office:document-content') || find(content, 'office:document');
  const body = find(find(docRoot, 'office:body'), 'office:text');
  if (!body) throw Error('This file has no text.');
  return documentMarkdown(body, odfDialect(styles, pictures));
}

async function extractOdfPictures(bytes, xml, folder) {
  const collector = imageCollector(folder), pictures = new Map();
  for (const m of xml.matchAll(/<draw:image\b[^>]*?xlink:href\s*=\s*"([^"]+)"/g)) {
    const href = decodeEntities(m[1]);
    if (pictures.has(href) || /^[a-z]+:/i.test(href)) continue;
    const data = await zipEntry(bytes, href).catch(() => null);
    const path = data && collector.add(data, imageExtension(href));
    if (path) pictures.set(href, path);
  }
  return { collector, pictures };
}

// { markdown, images }: the pictures of the text, as files under `folder`.
export async function odtDocument(bytes, folder = 'document_files') {
  const content = await zipEntry(bytes, 'content.xml');
  if (!content) throw Error('This file has no text.');
  const styles = await zipEntry(bytes, 'styles.xml');
  const decode = (b) => new TextDecoder().decode(b);
  const xml = decode(content);
  const { collector, pictures } = await extractOdfPictures(bytes, xml, folder);
  return { markdown: odfToMarkdown(xml, styles ? decode(styles) : '', pictures), images: collector.images };
}
export async function odtMarkdown(bytes) { return (await odtDocument(bytes)).markdown; }

export async function odpDocument(bytes, folder = 'document_files') {
  const content = await zipEntry(bytes, 'content.xml');
  if (!content) throw Error('This presentation has no slides.');
  const stylesBytes = await zipEntry(bytes, 'styles.xml');
  const decode = (b) => new TextDecoder().decode(b);
  const xml = decode(content);
  const tree = parseXml(xml);
  const styles = odfStyles(tree, parseXml(stylesBytes ? decode(stylesBytes) : ''));
  const docRoot = find(tree, 'office:document-content') || find(tree, 'office:document');
  const pres = find(find(docRoot, 'office:body'), 'office:presentation');
  if (!pres) throw Error('This presentation has no slides.');
  const { collector, pictures } = await extractOdfPictures(bytes, xml, folder);
  const dialect = odfDialect(styles, pictures);
  const pages = pres.children.filter((c) => typeof c !== 'string' && c.name === 'draw:page');
  if (!pages.length) throw Error('This presentation has no slides.');
  const slides = [];
  pages.forEach((page, idx) => {
    const parts = [];
    let title = '';
    const bodyFrames = [];
    for (const child of page.children) {
      if (typeof child === 'string' || child.name === 'presentation:notes') continue;
      if (child.name === 'draw:frame' && child.attrs['presentation:class'] === 'title' && !title) {
        const text = plainTextOf(child).replace(/\s+/g, ' ').trim();
        if (text) { title = text; continue; }
      }
      bodyFrames.push(child);
    }
    parts.push(title ? `## Slide ${idx + 1}: ${escapeText(title)}` : `## Slide ${idx + 1}`);
    const bodyMd = documentMarkdown({ name: 'draw:page', attrs: {}, children: bodyFrames }, dialect).trim();
    if (bodyMd && bodyMd !== '*This document has no text.*') parts.push(bodyMd);
    const notesNode = find(page, 'presentation:notes');
    if (notesNode) {
      const notesFrames = notesNode.children.filter((c) => typeof c !== 'string' && c.name === 'draw:frame' && c.attrs['presentation:class'] !== 'page');
      const notesMd = documentMarkdown({ name: 'draw:page', attrs: {}, children: notesFrames }, dialect).trim();
      if (notesMd && notesMd !== '*This document has no text.*') {
        parts.push(notesMd.split('\n').map((l, i) => (i === 0 ? `> **Notes:** ${l}` : `> ${l}`)).join('\n'));
      }
    }
    slides.push(parts.join('\n\n'));
  });
  return { markdown: slides.join('\n\n---\n\n') + '\n', images: collector.images };
}
export async function odpToMarkdown(bytes) { return (await odpDocument(bytes)).markdown; }

// ---- HTML -> Markdown (used by mammoth .docx, .epub, HTML-disguised .doc) ----------------

export function htmlToMarkdown(html) {
  const BLOCK = /^(p|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|div|blockquote|pre|body|html|section|article|header|footer|figure|figcaption|dl|dt|dd|hr|main|nav|aside)$/i;
  const root = parseXml(html), notes = new Map();
  // mammoth lists footnotes and endnotes at the end; they become Markdown footnotes, as in .odt.
  const NOTE = /^(foot|end)note-\d+$/;
  (function collect(node) {
    node.children = node.children.filter((c) => {
      if (typeof c === 'string') return true;
      if (c.name.toLowerCase() === 'ol' && c.children.some((li) => NOTE.test(li.attrs?.id || ''))) {
        for (const li of c.children) if (NOTE.test(li.attrs?.id || '')) notes.set(li.attrs.id, li.children);
        return false;
      }
      collect(c);
      return true;
    });
  })(root);
  const tag = (n) => String(n?.name || '').toLowerCase();
  const rowsOf = (node) => node.children.flatMap((c) => tag(c) === 'tr' ? [c.children.filter((d) => tag(d) === 'td' || tag(d) === 'th')] : typeof c !== 'string' && /^(thead|tbody|tfoot)$/i.test(c.name) ? rowsOf(c) : []);
  const dialect = {
    kind(n) {
      const t = tag(n);
      if (/^(script|style|head|title|noscript)$/.test(t)) return 'skip';
      if (/^h[1-6]$/.test(t)) return 'heading';
      if (t === 'p' || t === 'dt' || t === 'dd' || t === 'figcaption') return 'para';
      if (t === 'ul' || t === 'ol') return 'list';
      if (t === 'table') return 'table';
      return BLOCK.test(t) ? 'block' : 'inline';
    },
    level: (n) => Number(n.name[1]),
    ordered: (n) => tag(n) === 'ol',
    items: (n) => n.children.filter((c) => tag(c) === 'li'),
    rows(n) {
      const rows = rowsOf(n);
      // Merged cells (colspan) take their columns, empty after the first.
      return rows.map((r) => r.flatMap((c) => [c, ...Array(Math.min(Math.max(0, (Number(c.attrs.colspan) || 1) - 1), MAX_COLUMNS)).fill(null)]));
    },
    inline(n, style) {
      switch (tag(n)) {
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

// ---- Word (.docx, .docm, .dotx): mammoth + built-in OOXML fallback -----------------------

// mammoth: the library (window.mammoth, or require('mammoth') in tests); input as it takes
// it ({ arrayBuffer } in the browser, { buffer } in Node). Pictures are saved as files under
// `folder` and linked; { markdown, images }.
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

// Pure-JS OOXML Word reader: works without mammoth (Strict OOXML, workers, Node, or fallback
// when mammoth rejects a quirk). Reads word/document.xml, styles, numbering, footnotes and media.
export async function docxXmlDocument(bytes, folder = 'document_files') {
  const decode = (b) => new TextDecoder().decode(b);
  const rootRels = parseRels((await zipEntry(bytes, '_rels/.rels')) ? decode(await zipEntry(bytes, '_rels/.rels')) : '');
  let docPath = 'word/document.xml';
  for (const rel of rootRels.values()) {
    if (/officeDocument$/i.test(rel.type) && rel.target) { docPath = rel.target.replace(/^\/+/, ''); break; }
  }
  const docBytes = await zipEntry(bytes, docPath) || await zipEntry(bytes, 'word/document.xml');
  if (!docBytes) throw Error('This Word document has no body.');
  const relsPath = docPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = parseRels((await zipEntry(bytes, relsPath)) ? decode(await zipEntry(bytes, relsPath)) : '');
  const stylesBytes = await zipEntry(bytes, resolveZipPath(docPath, 'styles.xml'));
  const numBytes = await zipEntry(bytes, resolveZipPath(docPath, 'numbering.xml'));
  const fnBytes = await zipEntry(bytes, resolveZipPath(docPath, 'footnotes.xml'));

  // Style ID -> heading level (1..6)
  const headingLevel = new Map();
  if (stylesBytes) {
    for (const s of descendantsLocal(parseXml(decode(stylesBytes)), 'style')) {
      const id = s.attrs['w:styleId'] || s.attrs.styleId;
      const name = (findLocal(s, 'name')?.attrs['w:val'] || findLocal(s, 'name')?.attrs.val || '').toLowerCase();
      const m = name.match(/^(?:heading|t[ií]tulo|encabezado|titre|überschrift)\s*([1-6])$/i) || (id || '').match(/^Heading([1-6])$/i);
      if (id && m) headingLevel.set(id, Number(m[1]));
      else if (id && (name === 'title' || name === 'título')) headingLevel.set(id, 1);
      else {
        const lvl = findLocal(findLocal(s, 'pPr'), 'outlineLvl')?.attrs['w:val'];
        if (id && lvl !== undefined && Number(lvl) >= 0 && Number(lvl) <= 5) headingLevel.set(id, Number(lvl) + 1);
      }
    }
  }
  // Numbering numId -> level -> ordered?
  const abstractFmt = new Map(), numToAbstract = new Map();
  if (numBytes) {
    const numTree = parseXml(decode(numBytes));
    for (const a of descendantsLocal(numTree, 'abstractNum')) {
      const aid = a.attrs['w:abstractNumId'];
      const lvls = new Map();
      for (const l of descendantsLocal(a, 'lvl')) {
        const fmt = findLocal(l, 'numFmt')?.attrs['w:val'] || '';
        lvls.set(Number(l.attrs['w:ilvl'] || 0), fmt !== 'bullet' && fmt !== 'none');
      }
      abstractFmt.set(aid, lvls);
    }
    for (const n of descendantsLocal(numTree, 'num')) {
      const nid = n.attrs['w:numId'], aid = findLocal(n, 'abstractNumId')?.attrs['w:val'];
      if (nid && aid) numToAbstract.set(nid, aid);
    }
  }
  const isOrderedNum = (numId, ilvl) => abstractFmt.get(numToAbstract.get(numId))?.get(ilvl) ?? false;

  // Footnotes map
  const footnotes = new Map();
  if (fnBytes) {
    for (const fn of descendantsLocal(parseXml(decode(fnBytes)), 'footnote')) {
      const id = fn.attrs['w:id'];
      if (id && Number(id) > 0) footnotes.set(id, plainTextOf(fn).replace(/\s+/g, ' ').trim());
    }
  }

  // Extract linked images lazily on demand
  const collector = imageCollector(folder);
  const picturePaths = new Map();
  for (const [rid, rel] of rels) {
    if (!/\/image$/i.test(rel.type) || rel.mode === 'External') continue;
    const target = resolveZipPath(docPath, rel.target);
    const data = await zipEntry(bytes, target).catch(() => null);
    const path = data && collector.add(data, imageExtension(target));
    if (path) picturePaths.set(rid, path);
  }

  const body = findLocal(findLocal(parseXml(decode(docBytes)), 'document'), 'body');
  if (!body) throw Error('This Word document has no body.');

  const notes = [];
  const boolProp = (rPr, name) => {
    const el = findLocal(rPr, name);
    if (!el) return false;
    const v = el.attrs['w:val'];
    return v !== '0' && v !== 'false' && v !== 'none';
  };

  function paragraphRuns(node, style, out) {
    for (const c of node.children || []) {
      if (typeof c === 'string') continue;
      const ln = localName(c.name);
      if (ln === 'pPr' || ln === 'rPr' || ln === 'del' || ln === 'moveFrom') continue;
      if (ln === 'r') {
        const rPr = findLocal(c, 'rPr');
        const next = {
          ...style,
          b: style.b || boolProp(rPr, 'b'),
          i: style.i || boolProp(rPr, 'i'),
          s: style.s || boolProp(rPr, 'strike') || boolProp(rPr, 'dstrike'),
        };
        for (const rc of c.children) {
          if (typeof rc === 'string') continue;
          const rln = localName(rc.name);
          if (rln === 't' || rln === 'instrText') {
            if (rln === 't') out.push({ ...next, t: plainTextOf(rc) });
          } else if (rln === 'tab') out.push({ ...next, t: ' ' });
          else if (rln === 'br' || rln === 'cr') out.push({ br: true });
          else if (rln === 'footnoteReference') {
            const fnText = footnotes.get(rc.attrs['w:id']);
            if (fnText) { notes.push(fnText); out.push({ raw: `[^${notes.length}]` }); }
          } else if (rln === 'drawing' || rln === 'pict') {
            const blip = [...descendantsLocal(rc, 'blip')][0];
            const imgData = [...descendantsLocal(rc, 'imagedata')][0];
            const rid = blip?.attrs['r:embed'] || blip?.attrs['r:link'] || imgData?.attrs['r:id'];
            const docPr = [...descendantsLocal(rc, 'docPr')][0];
            const alt = docPr?.attrs.descr || docPr?.attrs.title || docPr?.attrs.name || '';
            const src = rid ? picturePaths.get(rid) : '';
            if (src) out.push({ raw: imageMarkdown(alt, src) });
            else if (rid) out.push({ ...next, t: alt ? `[Image: ${alt}]` : '[Image]' });
          }
        }
      } else if (ln === 'hyperlink') {
        const rel = rels.get(c.attrs['r:id']);
        const href = rel?.target && !rel.target.startsWith('#') ? rel.target : '';
        paragraphRuns(c, href ? { ...style, href } : style, out);
      } else {
        paragraphRuns(c, style, out);
      }
    }
    return out;
  }

  function renderPara(p, asHeading = false) {
    return inlineMarkdown(paragraphRuns(p, {}, [])).replace(asHeading ? /\\\n/g : /(?!)/, ' ');
  }

  function renderTable(tbl) {
    const rows = [];
    for (const tr of tbl.children) {
      if (typeof tr === 'string' || localName(tr.name) !== 'tr') continue;
      const cells = [];
      for (const tc of tr.children) {
        if (typeof tc === 'string' || localName(tc.name) !== 'tc') continue;
        const span = Math.min(Math.max(1, Number(findLocal(findLocal(tc, 'tcPr'), 'gridSpan')?.attrs['w:val']) || 1), MAX_COLUMNS);
        const text = tc.children
          .filter((c) => typeof c !== 'string' && localName(c.name) === 'p')
          .map((p) => renderPara(p, true))
          .filter(Boolean)
          .join(' ');
        cells.push(text);
        for (let k = 1; k < span; k++) cells.push('');
      }
      if (cells.length) rows.push(cells);
    }
    return tableMarkdown(rows);
  }

  const out = [];
  let listBuf = [], listCounters = new Map();
  const flushList = () => {
    if (!listBuf.length) return;
    out.push(listBuf.join('\n'));
    listBuf = [];
    listCounters.clear();
  };

  for (const child of body.children) {
    if (typeof child === 'string') continue;
    const ln = localName(child.name);
    if (ln === 'p') {
      const pPr = findLocal(child, 'pPr');
      const styleId = findLocal(pPr, 'pStyle')?.attrs['w:val'] || '';
      const lvlAttr = findLocal(pPr, 'outlineLvl')?.attrs['w:val'];
      const hLevel = headingLevel.get(styleId) || (lvlAttr !== undefined && Number(lvlAttr) >= 0 && Number(lvlAttr) <= 5 ? Number(lvlAttr) + 1 : 0);
      const numPr = findLocal(pPr, 'numPr');
      if (hLevel) {
        flushList();
        const t = renderPara(child, true);
        if (t) out.push(`${'#'.repeat(hLevel)} ${t}`);
      } else if (numPr) {
        const ilvl = Math.min(6, Math.max(0, Number(findLocal(numPr, 'ilvl')?.attrs['w:val']) || 0));
        const numId = findLocal(numPr, 'numId')?.attrs['w:val'] || '0';
        const t = renderPara(child);
        if (t) {
          const ordered = isOrderedNum(numId, ilvl);
          const key = `${numId}:${ilvl}`;
          const n = (listCounters.get(key) || 0) + 1;
          listCounters.set(key, n);
          const pad = '  '.repeat(ilvl);
          listBuf.push(`${pad}${ordered ? `${n}. ` : '- '}${t}`);
        }
      } else {
        flushList();
        const t = renderPara(child);
        if (t) out.push(blockStart(t));
      }
    } else if (ln === 'tbl') {
      flushList();
      const t = renderTable(child);
      if (t) out.push(t);
    } else if (ln === 'sdt') {
      flushList();
      const content = findLocal(child, 'sdtContent');
      if (content) {
        for (const p of descendantsLocal(content, 'p')) {
          const t = renderPara(p);
          if (t) out.push(blockStart(t));
        }
      }
    }
  }
  flushList();
  const bodyMd = out.join('\n\n') || '*This document has no text.*';
  const suffix = notes.length ? `\n\n${notes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n')}` : '';
  return { markdown: (bodyMd + suffix).trim() + '\n', images: collector.images };
}

// ---- OLE2 Compound File Binary (for legacy .doc and .ppt) --------------------------------

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const isCfb = (bytes) => bytes?.length >= 512 && CFB_MAGIC.every((b, i) => bytes[i] === b);

export function parseCfb(bytes) {
  if (!isCfb(bytes)) throw Error('Not an OLE2 document.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  const miniSectorShift = view.getUint16(32, true);
  if (sectorShift !== 9 && sectorShift !== 12) throw Error('Unsupported OLE2 sector size.');
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << (miniSectorShift || 6);
  const firstDirSector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true) || 4096;
  const firstMiniFat = view.getUint32(60, true);
  const firstDifat = view.getUint32(68, true);
  const difatCount = view.getUint32(72, true);
  const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;
  const sectorAt = (s) => (s + 1) * sectorSize;

  // Build FAT sector list from header DIFAT (109 entries) + DIFAT chain
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = view.getUint32(76 + i * 4, true);
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
  }
  let difat = firstDifat;
  for (let n = 0; n < difatCount && difat !== FREESECT && difat !== ENDOFCHAIN && n < 1024; n++) {
    const off = sectorAt(difat);
    if (off + sectorSize > bytes.length) break;
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = view.getUint32(off + i * 4, true);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
    }
    difat = view.getUint32(off + per * 4, true);
  }

  // Read FAT
  const entriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * entriesPerSector);
  for (let i = 0; i < fatSectors.length; i++) {
    const off = sectorAt(fatSectors[i]);
    if (off + sectorSize > bytes.length) continue;
    for (let j = 0; j < entriesPerSector; j++) fat[i * entriesPerSector + j] = view.getUint32(off + j * 4, true);
  }

  const readChain = (start, limit = bytes.length) => {
    const chunks = [], seen = new Set();
    let s = start, total = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && !seen.has(s) && total < limit + sectorSize) {
      seen.add(s);
      const off = sectorAt(s);
      if (off < 0 || off >= bytes.length) break;
      const chunk = bytes.subarray(off, Math.min(bytes.length, off + sectorSize));
      chunks.push(chunk);
      total += chunk.length;
      s = s < fat.length ? fat[s] : ENDOFCHAIN;
    }
    const out = new Uint8Array(Math.min(total, limit));
    let at = 0;
    for (const c of chunks) {
      const take = Math.min(c.length, out.length - at);
      if (take <= 0) break;
      out.set(c.subarray(0, take), at);
      at += take;
    }
    return out;
  };

  // Directory stream
  const dirBytes = readChain(firstDirSector, bytes.length);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const dirs = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = dirView.getUint16(off + 64, true);
    const type = dirBytes[off + 66];
    if (type === 0 || nameLen < 2 || nameLen > 64) continue;
    let name = '';
    for (let i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(dirView.getUint16(off + i, true));
    const start = dirView.getUint32(off + 116, true);
    const size = dirView.getUint32(off + 120, true);
    dirs.push({ name, type, start, size });
  }

  const root = dirs.find((d) => d.type === 5);
  const miniStream = root && root.size > 0 ? readChain(root.start, root.size) : new Uint8Array(0);
  const miniFatRaw = firstMiniFat !== ENDOFCHAIN && firstMiniFat !== FREESECT ? readChain(firstMiniFat, bytes.length) : new Uint8Array(0);
  const miniFat = new Uint32Array(Math.floor(miniFatRaw.length / 4));
  const mfView = new DataView(miniFatRaw.buffer, miniFatRaw.byteOffset, miniFatRaw.byteLength);
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mfView.getUint32(i * 4, true);

  const readMini = (start, size) => {
    const out = new Uint8Array(size), seen = new Set();
    let s = start, at = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && !seen.has(s) && at < size) {
      seen.add(s);
      const off = s * miniSectorSize;
      if (off >= miniStream.length) break;
      const take = Math.min(miniSectorSize, miniStream.length - off, size - at);
      out.set(miniStream.subarray(off, off + take), at);
      at += take;
      s = s < miniFat.length ? miniFat[s] : ENDOFCHAIN;
    }
    return out;
  };

  const streams = new Map();
  for (const d of dirs) {
    if (d.type !== 2) continue;
    streams.set(d.name.toLowerCase(), () => (d.size < miniCutoff && miniStream.length ? readMini(d.start, d.size) : readChain(d.start, d.size)));
  }
  return {
    names: () => [...streams.keys()],
    get(name) { const fn = streams.get(String(name || '').toLowerCase()); return fn ? fn() : null; },
  };
}
export function cfbStream(bytes, name) { return parseCfb(bytes).get(name); }

// ---- Legacy Word (.doc) ------------------------------------------------------------------

function cleanDocText(raw) {
  // Strip Word field codes: \x13 <instruction> [\x14 <visible>] \x15 (nested-safe).
  let out = '';
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\x13') { stack.push(false); continue; }
    if (ch === '\x14') { if (stack.length) stack[stack.length - 1] = true; continue; }
    if (ch === '\x15') { stack.pop(); continue; }
    if (stack.length && !stack.every(Boolean)) continue;
    out += ch;
  }
  // Convert paragraphs and Word table rows (\x07 separates cells; \x07\x07 ends a row).
  const blocks = [];
  let tableRows = [];
  const flushTable = () => {
    if (!tableRows.length) return;
    const t = tableMarkdown(tableRows);
    if (t) blocks.push(t);
    tableRows = [];
  };
  for (const seg of out.split(/[\r\x0c]+/)) {
    if (seg.includes('\x07')) {
      const cells = seg.split('\x07').map((c) => escapeText(c.replace(/[\x00-\x08\x0e-\x1f]/g, '').replace(/\x0b/g, ' ').replace(/\t+/g, ' ').trim()));
      // Drop trailing empty cell markers from row terminator.
      while (cells.length && cells.at(-1) === '') cells.pop();
      if (cells.length) tableRows.push(cells);
      continue;
    }
    flushTable();
    const lines = seg.split('\x0b').map((l) => escapeText(l.replace(/[\x00-\x08\x0e-\x1f]/g, '').replace(/\t+/g, ' ').trim())).filter(Boolean);
    if (lines.length) blocks.push(blockStart(lines.join('\\\n')));
  }
  flushTable();
  return (blocks.join('\n\n') || '*This document has no text.*') + '\n';
}

export async function docDocument(bytes, folder = 'document_files') {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64)).trimStart();
  // Many .doc files in the wild are actually RTF, DOCX (zip), HTML or plain text.
  if (head.startsWith('{\\rtf')) return { markdown: rtfToMarkdown(bytes), images: [] };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return docxXmlDocument(bytes, folder);
  if (/^(<!doctype\s+html|<html|<meta\b|<head\b|<\?xml[^>]*>[\s\S]*<(html|w:wordDocument))/i.test(head)) {
    return { markdown: htmlToMarkdown(decodeText(bytes)), images: [] };
  }
  if (!isCfb(bytes)) {
    if (!bytes.subarray(0, 4096).includes(0)) return { markdown: decodeText(bytes).trim() + '\n', images: [] };
    throw Error('Not a valid Word document.');
  }
  const cfb = parseCfb(bytes);
  const word = cfb.get('WordDocument');
  if (!word || word.length < 32) throw Error('Not a valid Word document.');
  const wv = new DataView(word.buffer, word.byteOffset, word.byteLength);
  const wIdent = wv.getUint16(0, true);
  if (wIdent !== 0xa5ec && wIdent !== 0xa5dc) throw Error('Not a valid Word document.');
  const nFib = wv.getUint16(2, true);
  const flags = wv.getUint16(10, true);
  if (flags & 0x0100) throw Error('This Word document is encrypted.');
  const cp1252 = new TextDecoder('windows-1252');
  const utf16 = new TextDecoder('utf-16le');

  // Word 97+ piece table (PlcPcd inside Clx in 0Table/1Table).
  if (nFib >= 0x00c1 && word.length >= 0x01aa) {
    const tableStream = cfb.get(flags & 0x0200 ? '1Table' : '0Table');
    const csw = wv.getUint16(32, true);
    const rgLwAt = 34 + csw * 2;
    const cslw = rgLwAt + 2 <= word.length ? wv.getUint16(rgLwAt, true) : 0;
    const ccpText = rgLwAt + 2 + 16 <= word.length ? wv.getUint32(rgLwAt + 2 + 12, true) : 0;
    const rgFcAt = rgLwAt + 2 + cslw * 4;
    const cbRgFcLcb = rgFcAt + 2 <= word.length ? wv.getUint16(rgFcAt, true) : 0;
    const clxOff = rgFcAt + 2 + 33 * 8;
    if (tableStream && cbRgFcLcb > 33 && clxOff + 8 <= word.length) {
      const fcClx = wv.getUint32(clxOff, true), lcbClx = wv.getUint32(clxOff + 4, true);
      if (lcbClx > 0 && fcClx + lcbClx <= tableStream.length) {
        const tv = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);
        let p = fcClx;
        const clxEnd = fcClx + lcbClx;
        while (p < clxEnd && tableStream[p] === 0x01) {
          if (p + 3 > clxEnd) break;
          p += 3 + tv.getUint16(p + 1, true);
        }
        if (p + 5 <= clxEnd && tableStream[p] === 0x02) {
          const pcdtLen = tv.getUint32(p + 1, true);
          const pcdStart = p + 5;
          const nPieces = Math.floor((pcdtLen - 4) / 12);
          if (nPieces > 0 && pcdStart + pcdtLen <= clxEnd) {
            const parts = [];
            for (let i = 0; i < nPieces; i++) {
              const cp0 = tv.getUint32(pcdStart + i * 4, true);
              const cp1 = tv.getUint32(pcdStart + (i + 1) * 4, true);
              if (ccpText && cp0 >= ccpText) break;
              const charCount = Math.min(cp1, ccpText || cp1) - cp0;
              if (charCount <= 0) continue;
              const pcdOff = pcdStart + (nPieces + 1) * 4 + i * 8;
              const fcRaw = tv.getUint32(pcdOff + 2, true);
              const compressed = (fcRaw & 0x40000000) !== 0;
              const byteOff = compressed ? ((fcRaw & 0x3fffffff) >>> 1) : (fcRaw & 0x3fffffff);
              const byteLen = compressed ? charCount : charCount * 2;
              if (byteOff < word.length) {
                const slice = word.subarray(byteOff, Math.min(word.length, byteOff + byteLen));
                parts.push(compressed ? cp1252.decode(slice) : utf16.decode(slice));
              }
            }
            if (parts.length) return { markdown: cleanDocText(parts.join('')), images: [] };
          }
        }
      }
    }
  }
  // Word 6/95 or fallback: raw text between fcMin and fcMac.
  const fcMin = wv.getUint32(0x18, true), fcMac = wv.getUint32(0x1c, true);
  if (fcMac > fcMin && fcMac <= word.length) {
    return { markdown: cleanDocText(cp1252.decode(word.subarray(fcMin, fcMac))), images: [] };
  }
  throw Error('This Word document has no readable text.');
}
export async function docToMarkdown(bytes) { return (await docDocument(bytes)).markdown; }

// ---- Rich Text Format (.rtf) -------------------------------------------------------------

const RTF_SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'xmlnstbl', 'mmathPr', 'generator', 'operator', 'creatim', 'revtim', 'printim', 'buptim', 'datafield', 'fldinst', 'nonshppict', 'shppict', 'bkmkstart', 'bkmkend', 'xe', 'tc', 'rxe']);

export function rtfToMarkdown(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input || ''));
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.trimStart().startsWith('{\\rtf')) throw Error('Not an RTF document.');
  const cp1252 = new TextDecoder('windows-1252');
  const decodeHexByte = (h) => cp1252.decode(new Uint8Array([parseInt(h, 16)]));

  const stack = [{ b: false, i: false, s: false, uc: 1, skip: false, fldinst: false, fldrslt: false, href: '' }];
  let cur = stack[0];
  let curRuns = [], pendingHref = '';
  const blocks = [];
  let rowCells = [], tableRows = [], inTable = false, inField = false, fieldInstText = '';

  const flushTable = () => {
    if (!tableRows.length) return;
    const md = tableMarkdown(tableRows);
    if (md) blocks.push(md);
    tableRows = [];
    inTable = false;
  };
  const flushPara = () => {
    if (inTable) {
      // Paragraphs inside cells just insert a space until \cell.
      if (curRuns.length) curRuns.push({ t: ' ' });
      return;
    }
    const line = inlineMarkdown(curRuns);
    curRuns = [];
    if (line) { flushTable(); blocks.push(blockStart(line)); }
  };
  const emit = (t) => {
    if (!t) return;
    if (cur.fldinst) { fieldInstText += t; return; }
    if (cur.skip) return;
    curRuns.push({ t, b: cur.b, i: cur.i, s: cur.s, href: cur.href || '' });
  };

  let idx = 0, skipChars = 0;
  while (idx < text.length) {
    const ch = text[idx];
    if (ch === '{') {
      const next = { ...cur };
      stack.push(next);
      cur = next;
      idx++;
      continue;
    }
    if (ch === '}') {
      const closed = stack.pop();
      cur = stack.at(-1) || { b: false, i: false, s: false, uc: 1, skip: false, fldinst: false, fldrslt: false, href: '' };
      if (closed?.fldinst) {
        const m = fieldInstText.match(/HYPERLINK\s+"([^"]+)"/i);
        if (m) pendingHref = m[1];
        fieldInstText = '';
      } else if (closed?.fldrslt) {
        pendingHref = '';
      }
      idx++;
      continue;
    }
    if (ch === '\r' || ch === '\n') { idx++; continue; }
    if (ch === '\\') {
      idx++;
      if (idx >= text.length) break;
      const c = text[idx];
      if (c === '\\' || c === '{' || c === '}') {
        if (skipChars > 0) skipChars--;
        else emit(c);
        idx++;
        continue;
      }
      if (c === '*') {
        // Ignorable destination unless it's \*\fldinst (hyperlinks).
        const ahead = text.slice(idx + 1, idx + 16);
        if (/^\\fldinst\b/.test(ahead)) { cur.fldinst = true; cur.skip = false; inField = true; }
        else cur.skip = true;
        idx++;
        continue;
      }
      if (c === '\'') {
        const hex = text.slice(idx + 1, idx + 3);
        idx += 3;
        if (skipChars > 0) { skipChars--; continue; }
        if (/^[0-9a-f]{2}$/i.test(hex)) emit(decodeHexByte(hex));
        continue;
      }
      if (c === '~') { idx++; emit('\u00a0'); continue; }
      if (c === '-') { idx++; continue; }
      if (c === '_') { idx++; emit('-'); continue; }
      if (c === '\r' || c === '\n') { idx++; flushPara(); continue; }
      const wm = text.slice(idx).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!wm) { idx++; continue; }
      const word = wm[1], param = wm[2] !== undefined ? Number(wm[2]) : null;
      idx += wm[0].length;
      if (word === 'fldinst') { cur.fldinst = true; cur.skip = false; inField = true; continue; }
      if (word === 'fldrslt') { cur.fldrslt = true; cur.skip = false; if (pendingHref) cur.href = pendingHref; continue; }
      if (word === 'field') { inField = true; continue; }
      if (RTF_SKIP_DEST.has(word)) { cur.skip = true; continue; }
      if (cur.skip && !cur.fldinst) continue;
      switch (word) {
        case 'b': cur.b = param !== 0; break;
        case 'i': cur.i = param !== 0; break;
        case 'strike': case 'striked': cur.s = param !== 0; break;
        case 'plain': cur.b = cur.i = cur.s = false; break;
        case 'uc': if (param !== null && param >= 0) cur.uc = param; break;
        case 'u': {
          if (param !== null) {
            const code = param < 0 ? param + 65536 : param;
            emit(String.fromCharCode(code));
            skipChars = cur.uc;
          }
          break;
        }
        case 'par': flushPara(); break;
        case 'line': curRuns.push({ br: true }); break;
        case 'tab': emit(' '); break;
        case 'emdash': emit('\u2014'); break;
        case 'endash': emit('\u2013'); break;
        case 'lquote': emit('\u2018'); break;
        case 'rquote': emit('\u2019'); break;
        case 'ldblquote': emit('\u201c'); break;
        case 'rdblquote': emit('\u201d'); break;
        case 'bullet': emit('\u2022'); break;
        case 'trowd': case 'intbl': inTable = true; break;
        case 'cell': {
          inTable = true;
          rowCells.push(inlineMarkdown(curRuns).replace(/\\\n/g, ' '));
          curRuns = [];
          break;
        }
        case 'row': {
          if (curRuns.length) { rowCells.push(inlineMarkdown(curRuns).replace(/\\\n/g, ' ')); curRuns = []; }
          if (rowCells.length) { tableRows.push(rowCells); rowCells = []; }
          break;
        }
        default: break;
      }
      continue;
    }
    if (skipChars > 0) { skipChars--; idx++; continue; }
    emit(ch);
    idx++;
  }
  if (rowCells.length) tableRows.push(rowCells);
  if (tableRows.length) flushTable();
  const tail = inlineMarkdown(curRuns);
  if (tail) blocks.push(blockStart(tail));
  return (blocks.join('\n\n') || '*This document has no text.*') + '\n';
}

// ---- PowerPoint (.pptx, .pptm) -----------------------------------------------------------

export async function pptxDocument(bytes, folder = 'document_files') {
  const decode = (b) => new TextDecoder().decode(b);
  const presBytes = await zipEntry(bytes, 'ppt/presentation.xml');
  const presRelsBytes = await zipEntry(bytes, 'ppt/_rels/presentation.xml.rels');
  const slidePaths = [];
  if (presBytes && presRelsBytes) {
    const rels = parseRels(decode(presRelsBytes));
    for (const s of descendantsLocal(parseXml(decode(presBytes)), 'sldId')) {
      const rid = s.attrs['r:id'];
      const rel = rid && rels.get(rid);
      if (rel?.target) slidePaths.push(resolveZipPath('ppt/presentation.xml', rel.target));
    }
  }
  if (!slidePaths.length) {
    const names = zipList(bytes)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)[1]) - Number(b.match(/(\d+)\.xml$/i)[1]));
    slidePaths.push(...names);
  }
  if (!slidePaths.length) throw Error('This presentation has no slides.');

  const collector = imageCollector(folder);
  const slides = [];

  const drawPara = (pNode, rels) => {
    const runs = [];
    for (const c of pNode.children || []) {
      if (typeof c === 'string') continue;
      const ln = localName(c.name);
      if (ln === 'r' || ln === 'fld') {
        const rPr = findLocal(c, 'rPr');
        const hlink = rPr && findLocal(rPr, 'hlinkClick');
        const href = hlink?.attrs['r:id'] ? rels.get(hlink.attrs['r:id'])?.target || '' : '';
        const t = plainTextOf(findLocal(c, 't'));
        if (t) {
          runs.push({
            t,
            b: rPr?.attrs.b === '1' || rPr?.attrs.b === 'true',
            i: rPr?.attrs.i === '1' || rPr?.attrs.i === 'true',
            s: Boolean(rPr?.attrs.strike && rPr.attrs.strike !== 'noStrike'),
            href: href && !href.startsWith('#') ? href : '',
          });
        }
      } else if (ln === 'br') runs.push({ br: true });
    }
    return inlineMarkdown(runs);
  };

  for (let i = 0; i < slidePaths.length; i++) {
    const sp = slidePaths[i];
    const sBytes = await zipEntry(bytes, sp);
    if (!sBytes) continue;
    const relsPath = sp.replace(/([^/]+)$/, '_rels/$1.rels');
    const relsBytes = await zipEntry(bytes, relsPath);
    const rels = parseRels(relsBytes ? decode(relsBytes) : '');
    const tree = parseXml(decode(sBytes));

    let title = '';
    const blocks = [];

    // Shapes (text boxes & titles)
    for (const shape of descendantsLocal(tree, 'sp')) {
      const ph = [...descendantsLocal(shape, 'ph')][0];
      const phType = ph?.attrs.type || '';
      if (phType === 'sldNum' || phType === 'ftr' || phType === 'dt') continue;
      const txBody = findLocal(shape, 'txBody');
      if (!txBody) continue;
      const isTitle = phType === 'title' || phType === 'ctrTitle';
      const lines = [];
      for (const p of txBody.children) {
        if (typeof p === 'string' || localName(p.name) !== 'p') continue;
        const text = drawPara(p, rels);
        if (!text) continue;
        if (isTitle && !title) { title = text.replace(/\\\n/g, ' '); continue; }
        const pPr = findLocal(p, 'pPr');
        const lvl = Number(pPr?.attrs.lvl || 0);
        const noBullet = Boolean(pPr && findLocal(pPr, 'buNone'));
        const isBullet = !noBullet && (lvl > 0 || Boolean(pPr && (findLocal(pPr, 'buChar') || findLocal(pPr, 'buAutoNum'))) || phType === 'body' || !phType);
        const ordered = Boolean(pPr && findLocal(pPr, 'buAutoNum'));
        if (isBullet && !isTitle) lines.push(`${'  '.repeat(Math.min(lvl, 5))}${ordered ? '1. ' : '- '}${text}`);
        else lines.push(blockStart(text));
      }
      if (lines.length) blocks.push(lines.join('\n'));
    }

    // Tables
    for (const tbl of descendantsLocal(tree, 'tbl')) {
      const rows = [];
      for (const tr of tbl.children) {
        if (typeof tr === 'string' || localName(tr.name) !== 'tr') continue;
        const cells = [];
        for (const tc of tr.children) {
          if (typeof tc === 'string' || localName(tc.name) !== 'tc') continue;
          const cellLines = [...descendantsLocal(tc, 'p')].map((p) => drawPara(p, rels).replace(/\\\n/g, ' ')).filter(Boolean);
          cells.push(cellLines.join(' '));
        }
        if (cells.length) rows.push(cells);
      }
      const md = tableMarkdown(rows);
      if (md) blocks.push(md);
    }

    // Pictures
    for (const pic of descendantsLocal(tree, 'pic')) {
      const blip = [...descendantsLocal(pic, 'blip')][0];
      const rid = blip?.attrs['r:embed'] || blip?.attrs['r:link'];
      const rel = rid && rels.get(rid);
      if (!rel || rel.mode === 'External') continue;
      const target = resolveZipPath(sp, rel.target);
      const data = await zipEntry(bytes, target).catch(() => null);
      const path = data && collector.add(data, imageExtension(target));
      const cNvPr = [...descendantsLocal(pic, 'cNvPr')][0];
      const alt = cNvPr?.attrs.descr || cNvPr?.attrs.title || cNvPr?.attrs.name || '';
      if (path) blocks.push(imageMarkdown(alt, path));
    }

    // Speaker notes
    for (const rel of rels.values()) {
      if (!/notesSlide$/i.test(rel.type) || !rel.target) continue;
      const nBytes = await zipEntry(bytes, resolveZipPath(sp, rel.target)).catch(() => null);
      if (!nBytes) continue;
      const nTree = parseXml(decode(nBytes));
      const noteLines = [];
      for (const shape of descendantsLocal(nTree, 'sp')) {
        const phType = [...descendantsLocal(shape, 'ph')][0]?.attrs.type || '';
        if (phType === 'sldNum' || phType === 'sldImg') continue;
        for (const p of descendantsLocal(shape, 'p')) {
          const t = drawPara(p, rels);
          if (t) noteLines.push(t);
        }
      }
      if (noteLines.length) blocks.push(noteLines.map((l, j) => (j === 0 ? `> **Notes:** ${l}` : `> ${l}`)).join('\n'));
    }

    const head = title ? `## Slide ${i + 1}: ${title}` : `## Slide ${i + 1}`;
    slides.push([head, ...blocks].join('\n\n'));
  }

  return { markdown: (slides.join('\n\n---\n\n') || '*This presentation has no text.*') + '\n', images: collector.images };
}
export async function pptxToMarkdown(bytes) { return (await pptxDocument(bytes)).markdown; }

// ---- Legacy PowerPoint (.ppt) ------------------------------------------------------------

export async function pptDocument(bytes, folder = 'document_files') {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return pptxDocument(bytes, folder);
  if (!isCfb(bytes)) throw Error('Not a valid PowerPoint file.');
  const stream = parseCfb(bytes).get('PowerPoint Document');
  if (!stream || stream.length < 8) throw Error('This PowerPoint file has no slides.');
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const utf16 = new TextDecoder('utf-16le'), cp1252 = new TextDecoder('windows-1252');
  const slides = [];
  let current = [];

  function walk(start, end, depth = 0) {
    if (depth > 32) return;
    let pos = start;
    while (pos + 8 <= end) {
      const verInst = view.getUint16(pos, true);
      const recType = view.getUint16(pos + 2, true);
      const recLen = view.getUint32(pos + 4, true);
      const bodyStart = pos + 8, bodyEnd = Math.min(end, bodyStart + recLen);
      if (bodyEnd < bodyStart) break;
      const isContainer = (verInst & 0x0f) === 0x0f;
      if (recType === 0x03ee && isContainer) { // Slide container
        if (current.length) { slides.push(current); current = []; }
        walk(bodyStart, bodyEnd, depth + 1);
        if (current.length) { slides.push(current); current = []; }
      } else if (recType === 0x0fa0) { // TextCharsAtom (UTF-16LE)
        const t = utf16.decode(stream.subarray(bodyStart, bodyEnd));
        if (t.trim()) current.push(t);
      } else if (recType === 0x0fa8) { // TextBytesAtom (CP1252)
        const t = cp1252.decode(stream.subarray(bodyStart, bodyEnd));
        if (t.trim()) current.push(t);
      } else if (isContainer) {
        walk(bodyStart, bodyEnd, depth + 1);
      }
      pos = bodyEnd;
    }
  }
  walk(0, stream.length);
  if (current.length) slides.push(current);
  if (!slides.length) return { markdown: '*This presentation has no text.*\n', images: [] };

  const out = slides.map((chunks, i) => {
    const lines = chunks.flatMap((c) => c.split(/[\r\n\x0b]+/).map((l) => l.replace(/[\x00-\x08\x0e-\x1f]/g, '').trim()).filter(Boolean));
    const [first, ...rest] = lines;
    const head = first ? `## Slide ${i + 1}: ${escapeText(first)}` : `## Slide ${i + 1}`;
    const body = rest.map((l) => `- ${escapeText(l)}`).join('\n');
    return body ? `${head}\n\n${body}` : head;
  });
  return { markdown: out.join('\n\n---\n\n') + '\n', images: [] };
}
export async function pptToMarkdown(bytes) { return (await pptDocument(bytes)).markdown; }

// ---- EPUB e-books (.epub) ----------------------------------------------------------------

export async function epubDocument(bytes, folder = 'document_files') {
  const decode = (b) => new TextDecoder().decode(b);
  const containerBytes = await zipEntry(bytes, 'META-INF/container.xml');
  if (!containerBytes) throw Error('Not a valid EPUB file.');
  const rootfile = [...descendantsLocal(parseXml(decode(containerBytes)), 'rootfile')][0];
  const opfPath = rootfile?.attrs['full-path'];
  if (!opfPath) throw Error('Not a valid EPUB file.');
  const opfBytes = await zipEntry(bytes, opfPath);
  if (!opfBytes) throw Error('Not a valid EPUB file.');
  const opf = parseXml(decode(opfBytes));

  const title = plainTextOf([...descendantsLocal(opf, 'title')][0]).trim();
  const creator = plainTextOf([...descendantsLocal(opf, 'creator')][0]).trim();
  const manifest = new Map();
  for (const item of descendantsLocal(opf, 'item')) {
    if (item.attrs.id && item.attrs.href) {
      let href = item.attrs.href;
      try { href = decodeURIComponent(href); } catch { /* keep raw */ }
      manifest.set(item.attrs.id, { path: resolveZipPath(opfPath, href), type: item.attrs['media-type'] || '' });
    }
  }
  const spine = [...descendantsLocal(opf, 'itemref')].map((r) => manifest.get(r.attrs.idref)).filter(Boolean);
  if (!spine.length) throw Error('This EPUB has no chapters.');

  const collector = imageCollector(folder);
  const sections = [];
  if (title) sections.push(`# ${escapeText(title)}${creator ? `\n\n*${escapeText(creator)}*` : ''}`);

  let totalChars = 0;
  const MAX_CHARS = 8 * 1024 * 1024;
  for (const ch of spine.slice(0, 500)) {
    if (totalChars >= MAX_CHARS) { sections.push('*Book truncated for display.*'); break; }
    const chBytes = await zipEntry(bytes, ch.path).catch(() => null);
    if (!chBytes) continue;
    let html = decode(chBytes);
    // Extract and rewrite local images referenced by the chapter.
    const imgTargets = new Map();
    for (const m of html.matchAll(/(?:src|xlink:href)\s*=\s*["']([^"']+)["']/gi)) {
      const raw = decodeEntities(m[1]).split('#')[0];
      if (!raw || /^(data:|https?:|mailto:)/i.test(raw) || imgTargets.has(m[1])) continue;
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
      const ext = imageExtension(decoded);
      if (!ext) continue;
      const target = resolveZipPath(ch.path, decoded);
      const data = await zipEntry(bytes, target).catch(() => null);
      const saved = data && collector.add(data, ext, target);
      if (saved) imgTargets.set(m[1], saved);
    }
    for (const [raw, saved] of imgTargets) html = html.replaceAll(`"${raw}"`, `"${saved}"`).replaceAll(`'${raw}'`, `'${saved}'`);
    const md = htmlToMarkdown(html).trim();
    if (md && md !== '*This document has no text.*') {
      sections.push(md);
      totalChars += md.length;
    }
  }
  return { markdown: (sections.join('\n\n---\n\n') || '*This e-book has no text.*') + '\n', images: collector.images };
}
export async function epubToMarkdown(bytes) { return (await epubDocument(bytes)).markdown; }

// ---- Jupyter Notebooks (.ipynb) ----------------------------------------------------------

export function ipynbDocument(bytes, folder = 'document_files') {
  const nb = JSON.parse(decodeText(bytes));
  if (!nb || !Array.isArray(nb.cells)) throw Error('Not a valid Jupyter notebook.');
  const lang = String(nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || '').toLowerCase();
  const collector = imageCollector(folder);
  const joinLines = (v) => (Array.isArray(v) ? v.join('') : String(v || ''));
  const parts = [];

  for (const cell of nb.cells) {
    const src = joinLines(cell.source).trimEnd();
    if (cell.cell_type === 'markdown') {
      if (src.trim()) parts.push(src);
    } else if (cell.cell_type === 'code') {
      if (src.trim()) parts.push(`\`\`\`${lang}\n${src}\n\`\`\``);
      for (const out of cell.outputs || []) {
        const data = out.data || {};
        if (data['image/png']) {
          const p = collector.add(fromBase64(joinLines(data['image/png'])), 'png');
          if (p) parts.push(imageMarkdown('Output', p));
        } else if (data['image/jpeg']) {
          const p = collector.add(fromBase64(joinLines(data['image/jpeg'])), 'jpg');
          if (p) parts.push(imageMarkdown('Output', p));
        } else if (data['image/svg+xml']) {
          const p = collector.add(new TextEncoder().encode(joinLines(data['image/svg+xml'])), 'svg');
          if (p) parts.push(imageMarkdown('Output', p));
        } else if (data['text/markdown']) {
          const md = joinLines(data['text/markdown']).trim();
          if (md) parts.push(md);
        } else {
          const txt = joinLines(out.text || data['text/plain'] || (out.ename ? `${out.ename}: ${out.evalue || ''}` : '')).trimEnd();
          if (txt) parts.push(`\`\`\`\n${txt.slice(0, 8000)}${txt.length > 8000 ? '\n…' : ''}\n\`\`\``);
        }
      }
    } else if (src.trim()) {
      parts.push(`\`\`\`\n${src}\n\`\`\``);
    }
  }
  return { markdown: (parts.join('\n\n') || '*Empty notebook.*') + '\n', images: collector.images };
}
export function ipynbToMarkdown(bytes) { return ipynbDocument(bytes).markdown; }

// ---- Spreadsheets (.xlsx, .xlsm, .xlsb, .xls, .ods, .fods), through SheetJS --------------

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
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  if (typeof document === 'undefined') return Promise.reject(Error(`The ${what} reader is unavailable here.`));
  return libraries[file] ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`./vendor/${file}`, import.meta.url).href;
    script.onload = () => (globalThis[global] ? resolve(globalThis[global]) : reject(Error(`The ${what} reader did not initialize.`)));
    script.onerror = () => { delete libraries[file]; script.remove(); reject(Error(`The ${what} reader could not be loaded. Check the connection and try again.`)); };
    document.head.append(script);
  });
}

const SHEET_EXTS = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods']);
const WORD_XML_EXTS = new Set(['docx', 'docm', 'dotx']);
const NAMES = {
  docx: 'Word document', docm: 'Word document', dotx: 'Word template', doc: 'Word document',
  rtf: 'Rich Text document', odt: 'OpenDocument text', fodt: 'OpenDocument text',
  xlsx: 'Excel spreadsheet', xlsm: 'Excel spreadsheet', xlsb: 'Excel spreadsheet', xls: 'Excel spreadsheet',
  ods: 'OpenDocument spreadsheet', fods: 'OpenDocument spreadsheet',
  pptx: 'PowerPoint presentation', pptm: 'PowerPoint presentation', ppt: 'PowerPoint presentation',
  odp: 'OpenDocument presentation',
  epub: 'EPUB e-book', ipynb: 'Jupyter notebook',
  csv: 'CSV table', tsv: 'TSV table',
};

// The Markdown shown for an opened office file, e-book, notebook or CSV/TSV table, and its
// pictures as files under `imageFolder` ({ markdown, images, folder }).
export async function officeDocument(name, bytes) {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!NAMES[ext]) throw Error('This file type cannot be converted.');
  const folder = imageFolder(name);
  if (ext === 'csv' || ext === 'tsv') return { markdown: delimitedMarkdown(decodeText(bytes), ext === 'tsv' ? '\t' : undefined), images: [], folder };
  const sheetLib = SHEET_EXTS.has(ext) ? await library('sheetjs/xlsx.core.min.js', 'XLSX', 'spreadsheet') : null;
  try {
    if (ext === 'odt') return { ...(await odtDocument(bytes, folder)), folder };
    if (ext === 'fodt') return { markdown: odfToMarkdown(decodeText(bytes)), images: [], folder };
    if (ext === 'odp') return { ...(await odpDocument(bytes, folder)), folder };
    if (WORD_XML_EXTS.has(ext)) {
      // Prefer mammoth in the browser for richer HTML conversion, but fall back cleanly to
      // our built-in OOXML reader if mammoth fails to load or rejects a dialect (e.g. Strict OOXML).
      const mammothLib = await library('mammoth/mammoth.browser.min.js', 'mammoth', 'Word').catch(() => null);
      if (mammothLib) {
        try {
          return { ...(await docxDocument(mammothLib, { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, folder)), folder };
        } catch { /* Fall through to built-in OOXML reader. */ }
      }
      return { ...(await docxXmlDocument(bytes, folder)), folder };
    }
    if (ext === 'doc') return { ...(await docDocument(bytes, folder)), folder };
    if (ext === 'rtf') return { markdown: rtfToMarkdown(bytes), images: [], folder };
    if (ext === 'pptx' || ext === 'pptm') return { ...(await pptxDocument(bytes, folder)), folder };
    if (ext === 'ppt') return { ...(await pptDocument(bytes, folder)), folder };
    if (ext === 'epub') return { ...(await epubDocument(bytes, folder)), folder };
    if (ext === 'ipynb') return { ...ipynbDocument(bytes, folder), folder };
    return { markdown: workbookMarkdown(sheetLib, readWorkbook(sheetLib, bytes)), images: [], folder };
  } catch {
    throw Error(`This ${NAMES[ext]} could not be read. It may be damaged or protected with a password.`);
  }
}
export async function officeMarkdown(name, bytes) { return (await officeDocument(name, bytes)).markdown; }
