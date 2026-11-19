// Grids: a matrix (DP tables: rows × cols with row and column labels; marks by "r,c", a cell
// set in this step is marked "new" unless marked otherwise) and a board (N queens: a chess
// board, a queen drawn as ♛; marks by "r,c"). Also a single value and a line of text.
import { esc, markStyle, badge, changeText, keyed, r1, show, FONT, MONO, textWidth } from './theme.js';

const CH = 26;
function matrixGeometry(snap) {
  const rows = snap.rows || 0, cols = snap.cols || 0, cells = snap.cells || [];
  const cw = Math.max(32, ...cells.flat().map((v) => textWidth(show(v), 12, true) + 12), ...(snap.colLabels || []).map((l) => textWidth(show(l), 11, true) + 10));
  const lw = snap.rowLabels ? Math.max(30, ...snap.rowLabels.map((l) => textWidth(show(l), 11.5) + 14)) : 0;
  const top = snap.colLabels ? 20 : 0;
  return { rows, cols, cw, lw, top };
}
export function matrixSize(snap) {
  const g = matrixGeometry(snap);
  return { w: g.lw + g.cols * g.cw + 2, h: g.top + g.rows * CH + 2 };
}
export function drawMatrix(snap, { id, marks = {}, changes = [], c }) {
  const g = matrixGeometry(snap);
  const cells = snap.cells || [];
  const parts = [];
  const set = new Map(changes.filter((ch) => ch.op === 'set').map((ch) => [String(ch.path), ch]));
  (snap.colLabels || []).forEach((l, j) => parts.push(`<text x="${r1(g.lw + j * g.cw + g.cw / 2 + 1)}" y="14" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${c.muted}">${esc(show(l))}</text>`));
  (snap.rowLabels || []).forEach((l, i) => parts.push(`<text x="${r1(g.lw - 6)}" y="${r1(g.top + i * CH + 17.5)}" text-anchor="end" font-family="${FONT}" font-size="11.5" fill="${c.muted}">${esc(show(l))}</text>`));
  const raised = [];
  for (let i = 0; i < g.rows; i++) {
    for (let j = 0; j < g.cols; j++) {
      const key = `${i},${j}`, v = cells[i]?.[j];
      const mark = marks[key] || (set.has(key) ? 'new' : '');
      const st = markStyle(mark, c);
      const x = g.lw + 1 + j * g.cw, y = g.top + 1 + i * CH;
      const rect = `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(g.cw)}" height="${CH}" fill="${st.fill}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1}"/>`;
      const label = v === '' || v === undefined || v === null ? '' : `<text x="${r1(x + g.cw / 2)}" y="${r1(y + 17.5)}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="${mark ? 700 : 500}" fill="${st.text}">${esc(show(v))}</text>`;
      (mark ? raised : parts).push(rect + label);
    }
  }
  parts.push(...raised);
  return { w: g.lw + g.cols * g.cw + 2, h: g.top + g.rows * CH + 2, body: parts.join('') };
}

const SQ = 34;
export const boardSize = (snap) => ({ w: (snap.n || 0) * SQ + 24, h: (snap.n || 0) * SQ + 20 });
export function drawBoard(snap, { id, marks = {}, c }) {
  const n = snap.n || 0, cells = snap.cells || [];
  const parts = [];
  for (let r = 0; r < n; r++) {
    parts.push(`<text x="9" y="${r1(r * SQ + SQ / 2 + 4)}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${c.muted}">${r}</text>`);
    for (let col = 0; col < n; col++) {
      const key = `${r},${col}`, mark = marks[key] || '';
      const st = markStyle(mark, c);
      const dark = (r + col) % 2 === 1;
      parts.push(`<rect x="${18 + col * SQ}" y="${r * SQ}" width="${SQ}" height="${SQ}" fill="${mark ? st.fill : dark ? c.surface2 : c.surface}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 0.8}"/>`);
    }
  }
  // Sudoku: thicker lines between its boxes.
  const box = Number(snap.box) || 0;
  if (box > 1) for (let k = 0; k <= n; k += box) parts.push(`<line x1="${18 + k * SQ}" y1="0" x2="${18 + k * SQ}" y2="${n * SQ}" stroke="${c.ink}" stroke-width="2"/><line x1="18" y1="${k * SQ}" x2="${18 + n * SQ}" y2="${k * SQ}" stroke="${c.ink}" stroke-width="2"/>`);
  for (let col = 0; col < n; col++) parts.push(`<text x="${r1(18 + col * SQ + SQ / 2)}" y="${n * SQ + 14}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${c.muted}">${col}</text>`);
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const v = cells[r]?.[col];
      if (!v) continue;
      const mark = marks[`${r},${col}`] || '';
      const colour = mark === 'error' ? c.bad : mark === 'compare' ? c.hint : c.ink;
      // A queen drawn as a crown (no font has to hold ♛ where the picture is shown).
      const crown = `<path d="M-11 8 L-12 -6 L-6 0 L0 -10 L6 0 L12 -6 L11 8 Z" fill="${colour}"/><rect x="-11" y="9" width="22" height="3.5" rx="1.5" fill="${colour}"/><circle cx="-12" cy="-7" r="2.2" fill="${colour}"/><circle cx="0" cy="-11" r="2.2" fill="${colour}"/><circle cx="12" cy="-7" r="2.2" fill="${colour}"/>`;
      const t = show(v), size = t.length <= 2 ? 15 : Math.max(8, Math.floor((SQ - 4) / (t.length * 0.62)));
      const fill = mark === 'done' ? c.muted : colour;
      parts.push(v === 'Q' ? keyed(`${id}/q${r}`, 18 + col * SQ + SQ / 2, r * SQ + SQ / 2, crown) : `<text x="${18 + col * SQ + SQ / 2}" y="${r * SQ + SQ / 2 + size * 0.36}" text-anchor="middle" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${fill}">${esc(t)}</text>`);
    }
  }
  return { w: n * SQ + 24, h: n * SQ + 20, body: parts.join('') };
}

const boxOf = (snap) => Math.max(56, textWidth(show(snap.value), 16, true) + 24);
// Room on the right for an "old → new" badge.
export function valueSize(snap) { return { w: boxOf(snap) + 70, h: 34 }; }
export function drawValue(snap, { id, marks = {}, changes = [], c }) {
  const s = { w: boxOf(snap), h: 34 }, t = show(snap.value);
  const mark = marks.value || (changes.length ? 'new' : '');
  const st = markStyle(mark, c);
  let body = `<rect width="${r1(s.w - 2)}" height="32" rx="6" fill="${mark ? st.fill : c.surface2}" stroke="${mark ? st.stroke : c.line}" stroke-width="${mark ? st.width : 1.2}"/><text x="${r1((s.w - 2) / 2)}" y="22" text-anchor="middle" font-family="${MONO}" font-size="16" font-weight="700" fill="${st.text}" data-v="${esc(t)}">${esc(t)}</text>`;
  const ch = changes.find((q) => q.op === 'set');
  if (ch && ch.from !== null && ch.from !== undefined) body += badge(s.w + 4, 22, changeText(ch), c);
  return { w: s.w + 70, h: s.h, body: keyed(`${id}/value`, 1, 1, body) };
}
const LINE = 360;
function wrap(text, size = 12.5) {
  const words = String(text ?? '').split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    if (line && textWidth(`${line} ${w}`, size) > LINE) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
export const textSize = (snap) => { const lines = wrap(snap.text); return { w: Math.max(40, ...lines.map((l) => textWidth(l, 12.5))) + 8, h: lines.length * 17 + 4 }; };
export function drawText(snap, { c }) {
  const lines = wrap(snap.text), s = textSize(snap);
  return { w: s.w, h: s.h, body: lines.map((l, i) => `<text x="0" y="${14 + i * 17}" font-family="${MONO}" font-size="12.5" fill="${c.ink}">${esc(l)}</text>`).join('') };
}
