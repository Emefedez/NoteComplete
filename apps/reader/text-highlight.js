// The highlighter's Text mode: drag across the text of a PDF page (or recognized text) and
// the words under the drag are highlighted as bands, one per line, instead of drawing the
// band by hand. The words come from the page's text layer (text-layer.js textLines).

// The words of a page in reading order, each knowing its line.
export function readingOrder(lines) {
  const words = [];
  lines.forEach((line, l) => { for (const w of line.words) words.push({ ...w, line: l }); });
  return words;
}

// The word nearest to a point (page units): the one it is over, else the closest box, with
// the line the point is on counting more than the distance along it, so a drag that wanders
// above or below the line you meant still picks that line's words.
export function nearestWord(words, [x, y]) {
  let best = -1, bestDistance = Infinity;
  words.forEach((w, i) => {
    const dx = Math.max(w.x - x, 0, x - (w.x + w.w)), dy = Math.max(w.y - y, 0, y - (w.y + w.h));
    const distance = Math.hypot(dx, dy * 2);
    if (distance < bestDistance) { best = i; bestDistance = distance; }
  });
  return best;
}

// How far a point is from a word's box (0 over it), in page units.
export const distanceTo = (w, [x, y]) => Math.hypot(Math.max(w.x - x, 0, x - (w.x + w.w)), Math.max(w.y - y, 0, y - (w.y + w.h)));

// The bands for the words from index `a` to `b` (either order): one rectangle per line,
// from the first selected word's left edge to the last one's right edge.
export function bandsFor(words, a, b) {
  if (a < 0 || b < 0 || !words.length) return [];
  const [from, to] = a <= b ? [a, b] : [b, a];
  const bands = [];
  for (let i = from; i <= to; i++) {
    const w = words[i], last = bands.at(-1);
    if (last && last.line === w.line) {
      last.x1 = Math.max(last.x1, w.x + w.w);
      last.y0 = Math.min(last.y0, w.y);
      last.y1 = Math.max(last.y1, w.y + w.h);
    } else bands.push({ line: w.line, x0: w.x, x1: w.x + w.w, y0: w.y, y1: w.y + w.h });
  }
  return bands;
}

// A band as the highlighter's own line: a square-ended stroke as wide as the band is tall,
// along its middle. Lines after the first are joined, so one undo takes the whole selection.
export function bandLine(band, rgba, layer = 0, joined = false) {
  const pad = Math.max(0.5, (band.y1 - band.y0) * 0.06);
  const y = (band.y0 + band.y1) / 2;
  return {
    points: [[band.x0 - pad, y], [band.x1 + pad, y]],
    width: band.y1 - band.y0 + pad,
    rgba: [...rgba.slice(0, 3), 1],
    tool: 1,
    layer,
    square: true,
    ...(joined ? { joined: true } : {}),
  };
}
