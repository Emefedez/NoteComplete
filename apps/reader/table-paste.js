// Cells from the clipboard for the table editor (compound-dialogs.js): an HTML table (what
// spreadsheets, web pages and documents copy) with its merged cells, or text with tabs (TSV,
// what spreadsheets copy as text) or commas (CSV). The result is a block for table.js pasteBlock:
// { cells: rows of strings, merges: [[row, column, rows, columns], …] }, or null when the text is
// just text for one cell (the field takes it as usual).

// Fields split by `delimiter`, rows by line ends; "quoted" fields may hold the delimiter, line
// ends and "" for a quote (RFC 4180, which spreadsheets also follow for tab-separated text).
export function parseDelimited(text, delimiter = '\t') {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  const s = String(text).replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const cols = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', euro: '€', copy: '©', deg: '°' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n === 160 ? 32 : n) : ''; }
  return ENTITIES[e.toLowerCase()] ?? all;
});
// A cell's HTML as text: the page's own spacing is one space, <br> and the ends of paragraphs
// are line breaks.
function cellText(html) {
  const text = html.replace(/\s+/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decode(text).split('\n').map((l) => l.replace(/[  ]+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
}
const spanOf = (attrs, name) => { const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs); return m ? Math.max(1, Math.min(100, +m[1])) : 1; };
// The first table in some HTML: its rows and cells, with colspan / rowspan as merges.
export function parseHtmlTable(html) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '');
  const table = /<table\b[^>]*>([\s\S]*?)<\/table\s*>/i.exec(source);
  if (!table) return null;
  const cells = [], merges = [], taken = new Set();
  const trs = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody|<\/thead|<\/tfoot|$)/gi)];
  trs.forEach((tr, r) => {
    let c = 0;
    for (const td of tr[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)(?=<\/t[dh]\s*>|<t[dh]\b|<\/tr\s*>|$)/gi)) {
      while (taken.has(`${r},${c}`)) c++;
      const rs = spanOf(td[2], 'rowspan'), cs = spanOf(td[2], 'colspan');
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) taken.add(`${i},${j}`);
      (cells[r] ||= [])[c] = cellText(td[3]);
      if (rs * cs > 1) merges.push([r, c, rs, cs]);
      c += cs;
    }
  });
  const rows = trs.length;
  if (!rows) return null;
  const cols = Math.max(1, ...[...taken].map((k) => +k.split(',')[1] + 1));
  return {
    cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? '')),
    merges: merges.map(([r, c, rs, cs]) => [r, c, Math.min(rs, rows - r), cs]).filter(([, , rs, cs]) => rs * cs > 1),
  };
}
// What the clipboard holds, as a block of cells: its HTML table first (it keeps merges), then
// tab-separated text, then comma-separated text of two or more lines that all have the same
// number of commas. Anything else (a word, a sentence, lines of text) is null.
export function clipboardBlock({ html = '', text = '' } = {}) {
  const fromHtml = html && parseHtmlTable(html);
  if (fromHtml && (fromHtml.cells.length > 1 || fromHtml.cells[0].length > 1)) return fromHtml;
  const plain = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!plain) return fromHtml || null;
  if (plain.includes('\t')) return { cells: parseDelimited(plain, '\t'), merges: [] };
  const lines = plain.split('\n');
  if (lines.length > 1) {
    const csv = parseDelimited(plain, ',');
    const counts = plain.split('\n').filter((l) => l.trim()).map((l) => (l.match(/,/g) || []).length);
    if (csv.length > 1 && csv[0].length > 1 && counts.every((n) => n === counts[0])) return { cells: csv, merges: [] };
  }
  return fromHtml || null;
}
