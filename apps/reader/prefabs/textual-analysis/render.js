// The Textual Analysis figure on the page (docs/PREFAB-MODULES-GUIDE.md): the problem
// statement with every candidate's occurrences in its colour, and/or the candidate table as
// Visual Paradigm shows it (No. | Candidate Class | Extracted Text | Type | Description |
// Occurrence | Highlight), as `show` says. Pure SVG, no DOM, so it also runs in Node (MCP
// add_prefab, the tests). Text is wrapped by an estimate of its width (no fonts here).
import { escapeHtml } from '../kit/svg.js';
import { highlightStyle } from '../../md-highlight.js';
import { KINDS, normalize, occurrences, textBlocks } from './model.js';

export { normalize };

const W = 760, PAD = 18, FONT = 14, INK = '#1f2733', MUTED = '#5b6573', RULE = '#d5dae1', HEAD = '#eef1f5';
const FAMILY = 'system-ui, -apple-system, Segoe UI, sans-serif';

// A sans-serif's widths, roughly, in ems.
const charWidth = (c) => (c === ' ' ? 0.32 : /[il.,:;'|!()[\]{}]/.test(c) ? 0.29 : /[mwMW@]/.test(c) ? 0.86 : /[A-Z]/.test(c) ? 0.66 : /[0-9]/.test(c) ? 0.56 : /[ftjr]/.test(c) ? 0.36 : /[\u3000-\u9fff]/.test(c) ? 1 : 0.53);
export const textWidth = (s, size = FONT, bold = false) => [...String(s)].reduce((w, c) => w + charWidth(c), 0) * size * (bold ? 1.07 : 1);

// Words (and the spaces between them) laid in lines of at most `width`; each piece keeps its run.
function layout(runs, width, size, boldAll = false, indent = 0) {
  const lines = [[]];
  let x = indent;
  runs.forEach((run, r) => {
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      const space = /^\s+$/.test(piece);
      const w = textWidth(space ? ' ' : piece, size, boldAll || run.bold);
      if (!space && x + w > width && lines.at(-1).some((p) => !p.space)) {
        while (lines.at(-1).at(-1)?.space) lines.at(-1).pop();
        lines.push([]);
        x = indent;
      }
      if (space && x === indent) continue;
      lines.at(-1).push({ text: space ? ' ' : piece, x, w, run: r, space });
      x += w;
    }
  });
  return lines.filter((l) => l.length);
}
const wrapPlain = (text, width, size) => layout([{ text: String(text ?? '') }], width, size).map((l) => l.map((p) => p.text).join(''));

// How a run looks: a candidate's colour, else its ==highlight=='s (fill, underline or text colour).
function look(model, run) {
  if (run.cand >= 0 && model.candidates[run.cand]) return { fill: model.candidates[run.cand].colour };
  if (run.tag === undefined) return {};
  const s = highlightStyle(run.tag);
  return s.text ? { ink: s.strong } : s.underline ? { underline: s.strong } : { fill: s.colour };
}

function drawText(model, top) {
  const parts = [];
  let y = top;
  for (const block of textBlocks(model)) {
    const size = block.heading ? FONT + 3 : FONT, indent = block.level * 18 + (block.bullet ? 18 : 0);
    const looks = block.runs.map((r) => look(model, r));
    const lines = layout(block.runs, W - 2 * PAD, size, block.heading, indent);
    if (block.bullet) parts.push(`<text x="${PAD + block.level * 18 + 3}" y="${y + size}" font-size="${size}" fill="${INK}">${escapeHtml(block.bullet)}</text>`);
    for (const line of lines) {
      // Bands first (behind the words): one per run on the line, its spaces included.
      const spans = [];
      for (const p of line) {
        const last = spans.at(-1);
        if (last && last.run === p.run) last.x1 = p.x + p.w; else spans.push({ run: p.run, x0: p.x, x1: p.x + p.w });
      }
      for (const s of spans) {
        const l = looks[s.run], x0 = PAD + s.x0 - 1.5, w = s.x1 - s.x0 + 3;
        if (l.fill) parts.push(`<rect x="${x0.toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${w.toFixed(1)}" height="${size + 5}" rx="3" fill="${l.fill}"/>`);
        if (l.underline) parts.push(`<rect x="${x0.toFixed(1)}" y="${(y + size + 3).toFixed(1)}" width="${w.toFixed(1)}" height="2" fill="${l.underline}"/>`);
      }
      // Each run's words start where the estimate put them, so a band stays under its words.
      for (const s of spans) {
        const run = block.runs[s.run], l = looks[s.run];
        const words = line.filter((p) => p.run === s.run).map((p) => p.text).join('');
        const weight = block.heading || run.bold ? ' font-weight="700"' : '';
        parts.push(`<text x="${(PAD + s.x0).toFixed(1)}" y="${y + size}" font-size="${size}"${weight}${run.italic ? ' font-style="italic"' : ''} fill="${l.ink || INK}" xml:space="preserve">${escapeHtml(words)}</text>`);
      }
      y += Math.round(size * 1.6);
    }
    y += block.bullet ? 2 : 8;
  }
  return { svg: parts.join(''), height: y - top };
}

// The type's little picture, as in Visual Paradigm's Type column: a class box, a stick
// figure, an ellipse, a field, a method, a dot.
export function kindIcon(kind, x, y) {
  const line = 'stroke="#4b5563" stroke-width="1.2"', s = `fill="none" ${line}`;
  switch (kind) {
    case 'class': return `<rect x="${x}" y="${y}" width="14" height="13" fill="#fdf3c6" ${line}/><line x1="${x}" y1="${y + 5}" x2="${x + 14}" y2="${y + 5}" ${s}/><line x1="${x}" y1="${y + 9}" x2="${x + 14}" y2="${y + 9}" ${s}/>`;
    case 'actor': return `<circle cx="${x + 7}" cy="${y + 2.5}" r="2.5" ${s}/><path d="M${x + 7} ${y + 5}v4M${x + 2} ${y + 7}h10M${x + 7} ${y + 9}l-4 4M${x + 7} ${y + 9}l4 4" ${s}/>`;
    case 'usecase': return `<ellipse cx="${x + 7}" cy="${y + 6.5}" rx="7" ry="5" fill="#e8f1fd" ${line}/>`;
    case 'attribute': return `<rect x="${x + 1}" y="${y + 3}" width="12" height="8" rx="1.5" fill="#eef9f0" ${line}/><line x1="${x + 4}" y1="${y + 7}" x2="${x + 10}" y2="${y + 7}" ${s}/>`;
    case 'operation': return `<path d="M${x + 2} ${y + 7}h8M${x + 7} ${y + 4}l3 3-3 3" ${s}/><circle cx="${x + 2}" cy="${y + 7}" r="1.5" ${s}/>`;
    default: return `<circle cx="${x + 7}" cy="${y + 6.5}" r="3.5" ${s}/>`;
  }
}

// Columns: their titles and widths (they fill the figure's width).
const COLUMNS = [['No.', 34], ['Candidate Class', 130], ['Extracted Text', 150], ['Type', 92], ['Description', 0], ['Occurrence', 74], ['Highlight', 62]];
COLUMNS[4][1] = W - 2 * PAD - COLUMNS.reduce((n, [, w]) => n + w, 0);

function drawTable(model, top) {
  const counts = occurrences(model);
  const size = 12.5, lineH = 17;
  const parts = [];
  let y = top, x = PAD;
  parts.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="26" fill="${HEAD}"/>`);
  for (const [label, w] of COLUMNS) { parts.push(`<text x="${x + 6}" y="${y + 17}" font-size="12" font-weight="700" fill="${MUTED}">${escapeHtml(label)}</text>`); x += w; }
  y += 26;
  if (!model.candidates.length) {
    parts.push(`<text x="${PAD + 6}" y="${y + 19}" font-size="${size}" fill="${MUTED}" font-style="italic">No candidates yet: select words in the text and classify them.</text>`);
    y += 28;
  }
  model.candidates.forEach((c, i) => {
    const kind = KINDS.find((k) => k.id === c.kind) || KINDS[0];
    const cells = [
      [String(i + 1)],
      wrapPlain(c.name, COLUMNS[1][1] - 12, size),
      wrapPlain([c.text, ...(c.aliases || [])].join(', '), COLUMNS[2][1] - 12, size),
      wrapPlain(kind.label, COLUMNS[3][1] - 32, size),
      wrapPlain(c.description, COLUMNS[4][1] - 12, size),
    ];
    const h = Math.max(...cells.map((l) => l.length), 1) * lineH + 10;
    parts.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${RULE}"/>`);
    let cx = PAD;
    cells.forEach((lines, col) => {
      const dx = col === 3 ? 26 : 6;
      if (col === 3) parts.push(kindIcon(c.kind, cx + 6, y + 7));
      parts.push(lines.map((t, j) => `<text x="${cx + dx}" y="${y + 18 + j * lineH}" font-size="${size}" fill="${col === 0 ? MUTED : INK}">${escapeHtml(t)}</text>`).join(''));
      cx += COLUMNS[col][1];
    });
    parts.push(`<text x="${cx + COLUMNS[5][1] - 14}" y="${y + 18}" font-size="${size}" fill="${INK}" text-anchor="end">${counts[i]}</text>`);
    cx += COLUMNS[5][1];
    parts.push(`<rect x="${cx + 8}" y="${y + 6}" width="${COLUMNS[6][1] - 22}" height="15" rx="3" fill="${c.colour}" stroke="#0000002e"/>`);
    y += h;
  });
  // Column rules and the frame.
  let rx = PAD;
  for (const [, w] of COLUMNS.slice(0, -1)) { rx += w; parts.push(`<line x1="${rx}" y1="${top}" x2="${rx}" y2="${y}" stroke="${RULE}"/>`); }
  parts.push(`<rect x="${PAD}" y="${top}" width="${W - 2 * PAD}" height="${y - top}" fill="none" stroke="${RULE}"/>`);
  return { svg: parts.join(''), height: y - top };
}

export function render(spec) {
  const model = normalize(spec);
  const parts = [];
  let y = PAD;
  if (model.title.trim()) {
    parts.push(`<text x="${PAD}" y="${y + 18}" font-size="18" font-weight="700" fill="${INK}">${escapeHtml(model.title)}</text>`);
    y += 32;
  }
  if (model.show !== 'table') {
    const t = drawText(model, y);
    parts.push(t.svg);
    y += t.height + 6;
  }
  if (model.show !== 'text') {
    const t = drawTable(model, y);
    parts.push(t.svg);
    y += t.height;
  }
  const height = Math.round(y + PAD);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="${FAMILY}"><rect width="${W}" height="${height}" fill="#fff"/>${parts.join('')}</svg>`,
    width: W,
    height,
  };
}

export const name = () => 'Textual analysis';
