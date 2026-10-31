// On-demand text recognition with Tesseract.js. Nothing loads until the user
// asks: the engine is vendored, language data comes from jsDelivr on first use
// and is then kept in this browser's storage by Tesseract.
let engine;
export const OCR_LANGUAGES = { spa: 'Español', eng: 'English', fra: 'Français', deu: 'Deutsch', ita: 'Italiano', por: 'Português', cat: 'Català' };

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

export async function recognizePage(worker, canvas, scale) {
  const { data } = await worker.recognize(canvas, {}, { text: false, blocks: true });
  return ocrWords(data, scale);
}

// Words from several passes over one page (the whole page, and the ink alone at
// two sizes). Readings of the same spot become one word: the most confident
// reading is its text and the others stay searchable as `alts`.
const overlap = (a, b) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? (w * h) / Math.min(a[2] * a[3], b[2] * b[3]) : 0;
};
export function mergeWords(...passes) {
  const kept = [];
  for (const word of passes.flat().sort((a, b) => b.confidence - a.confidence)) {
    const same = kept.find(k => overlap(k.box, word.box) > 0.5);
    if (!same) kept.push({ ...word });
    else if (word.text.toLowerCase() !== same.text.toLowerCase() && !(same.alts ||= []).includes(word.text)) same.alts.push(word.text);
  }
  return kept.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}
