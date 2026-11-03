// On-demand text recognition with Tesseract.js. Nothing loads until the user
// asks: the engine is vendored, language data comes from jsDelivr on first use
// and is then kept in this browser's storage by Tesseract.
let engine;
export const OCR_LANGUAGES = { spa: 'Español', eng: 'English', fra: 'Français', deu: 'Deutsch', ita: 'Italiano', por: 'Português', cat: 'Català', chi_sim: '中文（简体）', chi_tra: '中文（繁體）' };

export async function ocrWorker(languages, progress = () => {}) {
  engine ||= (await import('./vendor/tesseract/tesseract.esm.min.js')).default;
  const base = new URL('./vendor/tesseract/', import.meta.url).href;
  return engine.createWorker(languages, 1 /* LSTM only: the bundled cores */, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    workerBlobURL: false,
    logger: message => progress(message),
  });
}

// The passes over one page, by quality: the whole page, then the ink alone at several
// sizes (handwriting reads differently at each). High quality reads the page larger and
// also as scattered text, and the ink at more sizes, with thicker strokes once (thin
// pen lines break into pieces the engine misreads), and once as scattered text (page
// segmentation 11, for notes written all over the page). Every reading then votes.
// (Tesseract's full-precision data would need float routines its web build lacks.)
// High quality is the normal passes and more, so a quick normal reading of the pages
// can be kept and improved by the rest (`extra`).
const NORMAL = { whole: [{ width: 2200 }], ink: [{ width: 1200 }, { width: 3000 }] };
const EXTRA = { whole: [{ width: 3000 }, { width: 2200, sparse: true }], ink: [{ width: 2000 }, { width: 4200 }, { width: 2400, bold: true }, { width: 2400, sparse: true }], lines: { width: 3000 } };
export function ocrPasses(quality = 'normal', { extra = false } = {}) {
  if (quality !== 'high') return NORMAL;
  if (extra) return EXTRA;
  return { whole: [...NORMAL.whole, ...EXTRA.whole], ink: [...NORMAL.ink, ...EXTRA.ink], lines: EXTRA.lines };
}

// Recognised words in page units, dropping low-confidence noise.
export function ocrWords(data, scale, minConfidence = 35) {
  const out = [];
  for (const block of data?.blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || [])
        for (const word of line.words || []) {
          const text = word.text?.trim();
          if (!text || word.confidence < minConfidence) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          out.push({ text, box: [x0 / scale, y0 / scale, (x1 - x0) / scale, (y1 - y0) / scale], confidence: Math.round(word.confidence) });
        }
  return out;
}

// Page segmentation: 3 is automatic (columns, paragraphs), 7 one line, 11 text anywhere.
async function segmentation(worker, mode) {
  if (worker.segmentation !== mode) { await worker.setParameters({ tessedit_pageseg_mode: mode }); worker.segmentation = mode; }
}

// The words of a page; `lines` carries the lines it found (page units), for lineWords.
export async function recognizePage(worker, canvas, scale, { sparse = false } = {}) {
  await segmentation(worker, sparse ? '11' : '3');
  const { data } = await worker.recognize(canvas, {}, { text: false, blocks: true });
  const words = ocrWords(data, scale);
  words.lines = ocrLines(data, scale);
  return words;
}

// Line boxes in page units.
export function ocrLines(data, scale) {
  const out = [];
  for (const block of data?.blocks || [])
    for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) {
        const { x0, y0, x1, y1 } = line.bbox;
        if (x1 > x0 && y1 > y0) out.push([x0 / scale, y0 / scale, (x1 - x0) / scale, (y1 - y0) / scale]);
      }
  return out;
}

// Each line read again on its own, as a single line (handwriting is mostly misread where
// the engine cuts a page into lines and words; given one line, it only has to read it).
// `lines` are page units; the canvas is the ink at `scale` pixels per unit.
export async function lineWords(worker, canvas, scale, lines) {
  await segmentation(worker, '7');
  const out = [];
  for (const [x, y, w, h] of lines) {
    const pad = h * 0.3;
    const left = Math.max(0, Math.floor((x - pad) * scale)), top = Math.max(0, Math.floor((y - pad) * scale));
    const rectangle = { left, top, width: Math.min(canvas.width - left, Math.ceil((w + 2 * pad) * scale)), height: Math.min(canvas.height - top, Math.ceil((h + 2 * pad) * scale)) };
    if (rectangle.width < 8 || rectangle.height < 8) continue;
    const { data } = await worker.recognize(canvas, { rectangle }, { text: false, blocks: true });
    out.push(...ocrWords(data, scale));
  }
  return out;
}

// Lines found by several passes, once each (the most common reading of each place).
export function uniqueLines(...passes) {
  const kept = [];
  for (const line of passes.flat().sort((a, b) => b[2] * b[3] - a[2] * a[3]))
    if (!kept.some(k => overlap(k, line) > 0.6)) kept.push(line);
  return kept;
}

// Words from several passes over one page (the whole page, and the ink alone at
// several sizes). Readings of the same spot become one word, chosen by vote: each
// reading counts its confidence once per pass that gave it, so a word several passes
// agree on wins over one pass's lucky guess. The others stay searchable as `alts`.
const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) : 0;
};
export function mergeWords(...passes) { return voteWords(passes); }
// The same, where a reading that is a real word (`isWord`, from the chosen languages'
// word lists) counts double: several passes then settle on a word that exists.
export function voteWords(passes, { isWord = null } = {}) {
  // Only readings from different passes merge: two words of one pass are two words,
  // even when their boxes overlap (close Chinese characters, a word and its accent).
  const spots = [];
  const readings = passes.flatMap((pass, n) => pass.map(word => ({ word, n })));
  for (const { word, n } of readings.sort((a, b) => b.word.confidence - a.word.confidence)) {
    const spot = spots.find(s => !s.passes.has(n) && overlap(s.box, word.box) > 0.5);
    if (spot) { spot.readings.push(word); spot.passes.add(n); }
    else spots.push({ box: word.box, readings: [word], passes: new Set([n]) });
  }
  // A piece of a word one pass split ("pri" "ncipal") lies inside a spot more passes
  // agree on: it goes, as long as it is not a word of its own in most passes.
  const inside = (a, b) => { const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? (w * h) / (a[2] * a[3]) : 0; };
  const solid = spots.filter(s => !spots.some(o => o !== s && o.readings.length > s.readings.length && inside(s.box, o.box) > 0.7));
  return readingOrder(solid.map(({ readings }) => {
    const votes = new Map();
    for (const r of readings) {
      const key = r.text.toLowerCase(), v = votes.get(key);
      const weight = r.confidence * (isWord?.(r.text) ? 2 : 1);
      if (v) v.score += weight;
      else votes.set(key, { score: weight, best: r });
    }
    const ranked = [...votes.values()].sort((a, b) => b.score - a.score || b.best.confidence - a.best.confidence);
    const word = { ...ranked[0].best };
    if (ranked.length > 1) word.alts = ranked.slice(1).map(v => v.best.text);
    return word;
  }));
}

// Lines, top to bottom, each left to right: a word belongs to a line when its middle
// is within that line's height, so a letter a little higher stays in its place.
export function readingOrder(words) {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.box[1] + a.box[3] / 2 - (b.box[1] + b.box[3] / 2))) {
    const middle = word.box[1] + word.box[3] / 2, line = lines.at(-1);
    if (line && middle >= line.top && middle <= line.bottom) {
      line.words.push(word);
      line.top = Math.min(line.top, word.box[1]); line.bottom = Math.max(line.bottom, word.box[1] + word.box[3]);
    } else lines.push({ top: word.box[1], bottom: word.box[1] + word.box[3], words: [word] });
  }
  return lines.flatMap(line => line.words.sort((a, b) => a.box[0] - b.box[0]));
}
