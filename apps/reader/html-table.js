// Tables with merged cells in a Markdown document. Markdown's pipe tables cannot merge cells,
// so office.js writes such a table as a small HTML <table> with rowspan / colspan, its cells
// holding Markdown text (HTML-escaped). The Rust core shows raw HTML as text, never as markup;
// so before rendering, renderMarkdown (rich-text.js) turns each such block back into a pipe
// table with a marker before it (htmlTablesToPipes), lets the core render the cells as usual,
// and then gives the rendered table its spans (applyTableMerges). Nothing but table structure
// and the two span attributes is ever read from the HTML: other tags are dropped, their text kept.

const LIMIT_ROWS = 5000, LIMIT_COLUMNS = 200;

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const hex = e[1] === 'x' || e[1] === 'X', code = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

// Merges [row, col, rows, cols] (as in table.js) that fit the grid, cover 2+ cells and do not
// overlap one another; the rest are dropped.
export function cleanMerges(merges, rowCount, columnCount) {
  const taken = new Set(), out = [];
  for (const m of merges || []) {
    const [r, c] = m.map(Number), rs = Math.min(Number(m[2]) || 1, rowCount - r), cs = Math.min(Number(m[3]) || 1, columnCount - c);
    if (!(r >= 0 && c >= 0 && r < rowCount && c < columnCount) || rs * cs < 2) continue;
    const cells = [];
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) cells.push(i * LIMIT_COLUMNS * 10 + j);
    if (cells.some((k) => taken.has(k))) continue;
    cells.forEach((k) => taken.add(k));
    out.push([r, c, rs, cs]);
  }
  return out;
}

// How many rows from the top are the header: the first row, and every row a header cell
// reaches down to.
export function headerRows(merges) {
  let head = 1;
  for (let grown = true; grown;) {
    grown = false;
    for (const [r, , rs] of merges) if (r < head && r + rs > head) { head = r + rs; grown = true; }
  }
  return head;
}

// rows: arrays of cell Markdown (covered cells may hold anything; they are left out). One line
// per row, no blank lines, so the whole table stays one HTML block for any Markdown reader.
export function mergedTableHtml(rows, merges) {
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  if (!width) return '';
  const spans = new Map(), covered = new Set();
  for (const [r, c, rs, cs] of merges) {
    spans.set(`${r},${c}`, [rs, cs]);
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (i !== r || j !== c) covered.add(`${i},${j}`);
  }
  const head = headerRows(merges);
  const line = (row, r) => {
    const tag = r < head ? 'th' : 'td';
    let out = '<tr>';
    for (let c = 0; c < width; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const [rs, cs] = spans.get(`${r},${c}`) || [1, 1];
      const attrs = (rs > 1 ? ` rowspan="${rs}"` : '') + (cs > 1 ? ` colspan="${cs}"` : '');
      out += `<${tag}${attrs}>${escapeHtml(String(row[c] ?? '').replace(/\s*\n\s*/g, ' ').trim())}</${tag}>`;
    }
    return `${out}</tr>`;
  };
  return ['<table>', '<thead>', ...rows.slice(0, head).map(line), '</thead>', ...(rows.length > head ? ['<tbody>', ...rows.slice(head).map((row, i) => line(row, i + head)), '</tbody>'] : []), '</table>'].join('\n');
}

// An HTML table as a grid: { rows: Markdown per cell (covered cells ''), merges, head }, or
// null when there is no row. Header rows are the <thead> rows (or the first row).
export function parseHtmlTable(html) {
  const rows = [], spans = [], heads = [];
  let row = null, cell = null, section = '';
  const finishCell = () => { if (cell && row) row.push(cell); cell = null; };
  const finishRow = () => { finishCell(); if (row) { rows.push(row); heads.push(section === 'thead'); } row = null; };
  for (const m of String(html).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g)) {
    if (m[4] !== undefined || m[0] === '<') { if (cell) cell.text += m[4] ?? '<'; continue; }
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') { finishRow(); section = close ? '' : tag; }
    else if (tag === 'tr') { finishRow(); if (!close) row = []; }
    else if (tag === 'td' || tag === 'th') {
      finishCell();
      if (close) continue;
      if (!row) row = [];
      const span = (name) => Math.max(1, Math.min(Number(m[3].match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i'))?.[1]) || 1, LIMIT_ROWS));
      cell = { text: '', rs: span('rowspan'), cs: span('colspan') };
    } else if (tag === 'br' && cell) cell.text += ' ';
    else if (tag === 'table' && close) break;
  }
  finishRow();
  if (!rows.length) return null;
  // Cells go to the next spot not taken by a span from a row above.
  const grid = [], taken = [];
  for (let r = 0; r < rows.length && r < LIMIT_ROWS; r++) {
    grid[r] ||= [];
    let c = 0;
    for (const { text, rs, cs } of rows[r]) {
      while (taken[r]?.has(c)) c++;
      if (c >= LIMIT_COLUMNS) break;
      const h = Math.min(rs, rows.length - r), w = Math.min(cs, LIMIT_COLUMNS - c);
      for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) (taken[i] ||= new Set()).add(j);
      grid[r][c] = decodeEntities(text).replace(/\s+/g, ' ').trim();
      if (h * w > 1) spans.push([r, c, h, w]);
      c += w;
    }
  }
  const width = taken.reduce((n, set) => Math.max(n, ...(set ? [...set].map((j) => j + 1) : [0])), 0);
  if (!width) return null;
  const table = grid.map((r) => Array.from({ length: width }, (_, c) => r?.[c] ?? ''));
  const merges = cleanMerges(spans, table.length, width);
  let head = 0;
  while (head < heads.length && heads[head]) head++;
  return { rows: table, merges, head: Math.max(head || 1, headerRows(merges)) };
}

const pipeCell = (text) => text.replace(/\\?\|/g, '\\|');
const pipeTable = (rows) => {
  const line = (r) => `| ${r.map(pipeCell).join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(rows[0].length)}`, ...rows.slice(1).map(line)].join('\n');
};

// Each HTML <table> block (outside fenced code) becomes a marker paragraph ("<marker>-<n>")
// and a pipe table with the same cells; tables[n] keeps its merges and header rows.
export function htmlTablesToPipes(markdown, marker) {
  const lines = String(markdown ?? '').split('\n'), out = [], tables = [];
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''; out.push(line); continue; }
    if (f) { fence = f[1]; out.push(line); continue; }
    if (!/^ {0,3}<table[\s>]/i.test(line)) { out.push(line); continue; }
    // The block runs to </table>, or to a blank line (an unfinished table stays text).
    let end = i;
    while (end < lines.length && lines[end].trim() && !/<\/table\s*>/i.test(lines[end])) end++;
    if (end >= lines.length || !lines[end].trim()) { out.push(line); continue; }
    const parsed = parseHtmlTable(lines.slice(i, end + 1).join('\n'));
    if (!parsed) { out.push(line); continue; }
    const block = ['', `${marker}-${tables.length}`, '', pipeTable(parsed.rows), ''];
    tables.push({ merges: parsed.merges, head: parsed.head });
    out.push(...block.join('\n').split('\n'));
    i = end;
  }
  return { text: out.join('\n'), tables };
}

// After rendering: each marker paragraph goes, and the table after it gets its spans (covered
// cells removed) and its header rows in <thead> as <th>.
export function applyTableMerges(root, marker, tables) {
  if (!tables.length) return;
  for (const p of [...root.querySelectorAll('p')]) {
    const n = p.textContent.trim().match(new RegExp(`^${marker}-(\\d+)$`))?.[1];
    if (n === undefined) continue;
    const table = p.nextElementSibling, info = tables[Number(n)];
    p.remove();
    if (table?.tagName !== 'TABLE' || !info) continue;
    const doc = table.ownerDocument, trs = [...table.querySelectorAll('tr')];
    const grid = trs.map((tr) => [...tr.children]);
    const drop = new Set();
    for (const [r, c, rs, cs] of info.merges) {
      const cell = grid[r]?.[c];
      if (!cell) continue;
      if (rs > 1) cell.rowSpan = rs;
      if (cs > 1) cell.colSpan = cs;
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if ((i !== r || j !== c) && grid[i]?.[j]) drop.add(grid[i][j]);
    }
    drop.forEach((cell) => cell.remove());
    let thead = table.querySelector('thead');
    if (!thead) { thead = doc.createElement('thead'); table.prepend(thead); }
    for (const tr of trs.slice(0, info.head)) {
      for (const td of [...tr.children]) {
        if (td.tagName === 'TH') continue;
        const th = doc.createElement('th');
        for (const a of [...td.attributes]) th.setAttribute(a.name, a.value);
        th.append(...td.childNodes);
        td.replaceWith(th);
      }
      thead.append(tr);
    }
    const tbody = table.querySelector('tbody');
    if (tbody && !tbody.children.length) tbody.remove();
    table.classList.add('md-merged-table');
  }
}
