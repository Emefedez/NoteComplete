// One step of a trace as SVG: every structure of the run in its box (its name over it), laid
// out once per trace from the largest each one gets in the run, so nothing jumps from step to
// step (and the player can tween what moved). Over them, optionally, the algorithm's name and
// the step's caption; beside them, optionally, the code with the step's line; under them the
// marks' legend. Pure: no DOM.
import { theme, esc, r1, FONT, MONO, TITLE_H, title, textWidth, LEGEND, markStyle } from './theme.js';
import * as graph from './graph.js';
import * as array from './array.js';
import * as heap from './heap.js';
import * as linear from './linear.js';
import * as hashtable from './hashtable.js';
import * as coll from './collections.js';
import * as tree from './tree.js';
import * as grid from './grid.js';

const lin = (kind) => ({ hint: (snaps) => linear.hint(snaps, kind), size: (s, h) => linear.size(s, kind, h), draw: (s, ctx) => linear.draw(s, kind, ctx) });
export const KINDS = {
  graph: { hint: graph.hint, size: graph.size, draw: graph.draw },
  array: { size: array.size, draw: array.draw },
  heap: { hint: heap.hint, size: heap.size, draw: heap.draw },
  queue: lin('queue'), stack: lin('stack'), deque: lin('deque'), pq: lin('pq'),
  hashtable: { hint: hashtable.hint, size: hashtable.size, draw: hashtable.draw },
  map: { hint: coll.mapHint, size: coll.mapSize, draw: coll.drawMap },
  set: { hint: coll.setHint, size: coll.setSize, draw: coll.drawSet },
  binarytree: { size: (s) => tree.size(s, true), draw: (s, ctx) => tree.draw(s, true, ctx) },
  tree: { size: (s) => tree.size(s, false), draw: (s, ctx) => tree.draw(s, false, ctx) },
  matrix: { size: grid.matrixSize, draw: grid.drawMatrix },
  board: { size: grid.boardSize, draw: grid.drawBoard },
  value: { size: grid.valueSize, draw: grid.drawValue },
  text: { size: grid.textSize, draw: grid.drawText },
};
KINDS.list = KINDS.array;

const GAP_X = 28, GAP_Y = 16, PAD = 14;
const layouts = new WeakMap();

// Where each structure goes for this trace: { boxes: { id: { x, y, w, h, hint } }, w, h }.
export function layoutOf(trace) {
  if (layouts.has(trace)) return layouts.get(trace);
  const ids = Object.keys(trace.structures || {});
  const steps = trace.steps || [];
  const sized = ids.map((id) => {
    const { kind, label } = trace.structures[id];
    const k = KINDS[kind];
    if (!k) return { id, w: 0, h: 0, hint: null };
    const snaps = steps.map((s) => s.state?.[id]).filter(Boolean);
    let hint = null;
    try { hint = k.hint ? k.hint(snaps) : null; } catch { hint = null; }
    let w = textWidth(label || '', 12.5) + 8, h = 0;
    for (const snap of snaps) {
      try { const s = k.size(snap, hint); w = Math.max(w, s.w); h = Math.max(h, s.h); } catch { /* Drawn as nothing. */ }
    }
    return { id, w: Math.ceil(w), h: Math.ceil(h) + TITLE_H, hint };
  }).filter((b) => b.h > TITLE_H);
  const widest = Math.max(0, ...sized.map((b) => b.w));
  const limit = Math.max(640, widest);
  const boxes = {};
  let x = 0, y = 0, rowH = 0, w = 0;
  for (const b of sized) {
    if (x > 0 && x + b.w > limit) { x = 0; y += rowH + GAP_Y; rowH = 0; }
    boxes[b.id] = { x, y, w: b.w, h: b.h, hint: b.hint };
    x += b.w + GAP_X;
    rowH = Math.max(rowH, b.h);
    w = Math.max(w, x - GAP_X);
  }
  const out = { boxes, w: Math.max(w, 120), h: y + rowH };
  layouts.set(trace, out);
  return out;
}

function wrapLine(text, size, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    if (line && textWidth(`${line} ${word}`, size) > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Just the structures of step `index` (the player's stage): { svg, width, height }.
// `options`: theme ("light" | "dark"), heading (a title line over them), caption (the step's
// caption over them), code (the source text: drawn beside them with the step's line),
// legend (the marks used in the step, under them), background (false: transparent).
export function drawStep(trace, index, { theme: themeName = 'light', heading = '', caption = false, code = '', legend = false, background = true } = {}) {
  const c = theme(themeName);
  const steps = trace?.steps || [];
  const i = Math.max(0, Math.min(steps.length - 1, Number.isInteger(index) ? index : 0));
  const step = steps[i];
  const lay = layoutOf(trace);
  const parts = [];
  let top = PAD;
  const textW = Math.max(lay.w, 360);
  if (heading) {
    parts.push(`<text x="${PAD}" y="${top + 14}" font-family="${FONT}" font-size="15" font-weight="700" fill="${c.ink}">${esc(heading)}</text>`);
    top += 22;
  }
  if (caption && step) {
    const lines = wrapLine(`Step ${i + 1} of ${steps.length}: ${step.caption}`, 12.5, textW);
    lines.forEach((l, k) => parts.push(`<text x="${PAD}" y="${top + 13 + k * 17}" font-family="${FONT}" font-size="12.5" fill="${c.muted}">${esc(l)}</text>`));
    top += lines.length * 17 + 6;
  }
  if (heading || caption) top += 6;
  const changes = step?.changes || [];
  for (const [id, box] of Object.entries(lay.boxes)) {
    const { kind, label } = trace.structures[id];
    const snap = step?.state?.[id];
    if (!snap) continue;
    let drawn = null;
    try { drawn = KINDS[kind].draw(snap, { id, marks: step.marks?.[id] || {}, changes: changes.filter((ch) => ch.id === id), c, hint: box.hint }); } catch (e) { drawn = { body: `<text y="30" font-family="${FONT}" font-size="12" fill="${c.bad}">${esc(e.message)}</text>` }; }
    parts.push(`<g data-s="${esc(id)}" transform="translate(${PAD + box.x} ${top + box.y})">${title(label, c)}<g transform="translate(0 ${TITLE_H})">${drawn.body}</g></g>`);
  }
  let width = PAD * 2 + lay.w, height = top + lay.h + PAD;
  if (legend && step) {
    const used = [...new Set(Object.values(step.marks || {}).flatMap((m) => Object.values(m)))].filter((m) => LEGEND[m]);
    if (used.length) {
      let x = PAD;
      const y = height;
      for (const m of used) {
        const st = markStyle(m, c);
        parts.push(`<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/><text x="${x + 19}" y="${y + 11.5}" font-family="${FONT}" font-size="11.5" fill="${c.muted}">${esc(LEGEND[m])}</text>`);
        x += 30 + textWidth(LEGEND[m], 11.5);
      }
      width = Math.max(width, x + PAD);
      height += 24;
    }
  }
  if (code) {
    const lines = String(code).replace(/\s+$/, '').split('\n');
    const lw = Math.max(...lines.map((l) => textWidth(l.replace(/\t/g, '  '), 11, true))) + 44;
    const x = width + 6, lh = 14.5;
    const ch = lines.length * lh + 16;
    parts.push(`<rect x="${x}" y="${PAD}" width="${r1(lw)}" height="${r1(ch)}" rx="6" fill="${c.surface2}" stroke="${c.line}"/>`);
    lines.forEach((l, k) => {
      const y = PAD + 8 + k * lh;
      const on = step?.line === k + 1;
      if (on) parts.push(`<rect x="${x + 1}" y="${r1(y)}" width="${r1(lw - 2)}" height="${lh}" fill="${c.accentSoft}"/><rect x="${x + 1}" y="${r1(y)}" width="3" height="${lh}" fill="${c.accent}"/>`);
      parts.push(`<text x="${x + 26}" y="${r1(y + 11)}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${c.faint}">${k + 1}</text><text x="${x + 32}" y="${r1(y + 11)}" font-family="${MONO}" font-size="11" fill="${on ? c.ink : c.muted}" font-weight="${on ? 700 : 400}" xml:space="preserve">${esc(l.replace(/\t/g, '  '))}</text>`);
    });
    width = x + lw + PAD;
    height = Math.max(height, PAD + ch + PAD);
  }
  width = Math.ceil(width); height = Math.ceil(height);
  const bg = background ? `<rect width="${width}" height="${height}" fill="${c.bg}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bg}${parts.join('')}</svg>`;
  return { svg, width, height };
}
