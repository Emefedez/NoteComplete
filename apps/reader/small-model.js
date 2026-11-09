// Small-model mode (docs/LOCAL-AI.md): the work split into the smallest steps,
// so a small model (the one in this app) does it well. Each page's text is
// taken (its handwriting recognized first by the app's OCR when it has none),
// or, with a model that reads images, the page is read into its content and key
// points; then each page is worked on alone with a short, single-purpose prompt,
// and the pieces are merged here, in JS. A quiz question quotes the page, and
// the quote is found among the page's word boxes: that is the hint's region.
//
// One module for every consumer: study (flashcards, quiz, fact check) calls
// smallStudy(), questions (Ask AI, Clarify, card Ask AI, double checks) call
// runAI(). Nothing here depends on WebLLM: with the box ticked, any tool gets
// the same steps. No DOM: everything is unit-tested with a fake `ai`.

const KEY = provider => `notecomplete-small-model:${provider}`;
const STOPPED = 'The AI request was stopped.';
// Pages with less content than this are packed with their neighbours.
export const SHORT_PAGE = 400;
export const MAX_PACK = 3;
// Packing budget when the model's window is unknown (desktop tools).
export const UNKNOWN_BUDGET = 12000;
const READ_TOKENS = 1600;
const HINT_CHARS = 1500;

// ---- The setting, per provider ----

// On by default for providers that say so (the model in this app), off for the
// desktop tools; a choice made in any dialog is remembered for that provider.
export function smallSetting(provider, { storage = globalThis.localStorage, ai = null } = {}) {
  let kept = null;
  try { kept = storage?.getItem(KEY(provider)) ?? null; } catch { /* Optional. */ }
  if (kept === '1' || kept === '0') return kept === '1';
  return !!ai?.smallByDefault?.(provider);
}
export function rememberSmall(provider, on, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY(provider), on ? '1' : '0'); } catch { /* Optional. */ }
}

// ---- Reading a page ----

const parseJson = text => {
  const s = String(text), start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw Error('The AI did not return the expected JSON.');
  return JSON.parse(s.slice(start, end + 1));
};
// A region as fractions of the page: inside it, and not a sliver (as quiz.js accepts).
export const validBox = b => Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && b[2] - b[0] > 0.02 && b[3] - b[1] > 0.01;

export const READ_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    points: { type: 'array', maxItems: 8, items: { type: 'object', properties: { text: { type: 'string' }, box: { type: 'array', items: { type: 'number' } } }, required: ['text', 'box'] } },
  },
  required: ['content', 'points'],
};
export function readPrompt({ extracted = '', unit = 'page' } = {}) {
  const hint = String(extracted || '').trim();
  return [
    `Read this ${unit} of a student's notes. Write out everything on it as Markdown, in its own language and order: handwriting and printed text as written, formulas in LaTeX ($…$), tables as Markdown tables, and one line for each drawing or diagram saying what it shows.`,
    'Then list up to 8 important points (definitions, results, formulas, key facts), each as a short phrase with its region on the page as [x0, y0, x1, y1]: fractions of the page width and height, from the top-left corner.',
    hint && `Text already extracted from this ${unit} (it may be incomplete or wrong; what you see wins):\n${hint.slice(0, HINT_CHARS)}`,
    // No numbers in the example: a small model copies them into every point.
    'Reply with ONLY JSON: {"content": "…", "points": [{"text": "…", "box": [x0, y0, x1, y1]}]}, where the box is where that point is written on this page.',
  ].filter(Boolean).join('\n\n');
}
// A reading as { content, points: [{ text, box|null }] }; an answer that is not
// JSON is kept as the content.
export function cleanReading(text, fallback = '') {
  let value;
  try { value = parseJson(text); } catch { return { content: String(text || fallback).trim(), points: [] }; }
  const content = typeof value?.content === 'string' && value.content.trim() ? value.content.trim() : String(fallback || '').trim();
  // Small models repeat themselves: a point said twice is kept once, and a box
  // given to three or more points is a placeholder, not a place on the page.
  const seen = new Set(), listed = (Array.isArray(value?.points) ? value.points : []).filter(p => {
    const key = typeof p?.text === 'string' ? p.text.trim().toLowerCase() : '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
  const boxKey = b => (validBox(b) ? b.join(',') : '');
  const uses = new Map();
  for (const p of listed) if (boxKey(p.box)) uses.set(boxKey(p.box), (uses.get(boxKey(p.box)) || 0) + 1);
  const points = listed.map(p => ({ text: p.text.trim().slice(0, 200), box: boxKey(p.box) && uses.get(boxKey(p.box)) < 3 ? p.box.map(v => Math.round(v * 1000) / 1000) : null }));
  return { content, points };
}

// Readings are kept per page image for the session: a page is read once,
// whatever is asked of it afterwards.
const readings = new Map();
const READINGS_KEPT = 64;
export function imageKey(image) {
  const bytes = image?.bytes;
  if (!(bytes instanceof Uint8Array)) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return `${bytes.length}:${(h >>> 0).toString(36)}`;
}
export function forgetReadings() { readings.clear(); }

const call = (ai, request, onDelta) => (typeof onDelta === 'function' ? ai.run(request, onDelta) : ai.run(request));

// The content of one page: read from its image when the model reads images,
// otherwise its extracted text (no regions then).
export async function readPage(ai, { provider, model = '', tag = '', notePath = '' }, { image = null, extracted = '', vision = false, unit = 'page' } = {}) {
  if (!vision || !image || !/^image\//.test(image.type || '')) return { content: String(extracted || '').trim(), points: [] };
  const key = `${provider}:${model}:${unit}:${imageKey(image)}`;
  if (readings.has(key)) return readings.get(key);
  const { text } = await call(ai, { provider, model, tag, notePath, images: [image], prompt: readPrompt({ extracted, unit }), schema: READ_SCHEMA, maxTokens: READ_TOKENS });
  const reading = cleanReading(text, extracted);
  readings.set(key, reading);
  if (readings.size > READINGS_KEPT) readings.delete(readings.keys().next().value);
  return reading;
}

// ---- Questions: read the image, then ask with text only ----

// Instead of ai.run for any question. Off: unchanged. On: the first image is
// read into text (vision) or left out (text only), then the question goes alone.
export async function runAI(ai, request, onDelta = null, { small = false, vision = false } = {}) {
  if (!small) return call(ai, request, onDelta);
  const images = (request.images || []).filter(i => /^image\//.test(i?.type || ''));
  let prompt = request.prompt;
  if (images.length && vision) {
    const reading = await readPage(ai, request, { image: images[0], vision: true });
    const points = reading.points.length ? `\nImportant points:\n${reading.points.map((p, i) => `[${i + 1}] ${p.text}`).join('\n')}` : '';
    prompt += `\n\nWhat the image "${images[0].label || 'image'}" shows (read from it):\n${reading.content}${points}`;
  }
  if (images.length > (vision ? 1 : 0)) prompt += `\n\n(${vision ? images.length - 1 : images.length} attached image${images.length - (vision ? 1 : 0) === 1 ? ' was' : 's were'} not sent; use the text.)`;
  return call(ai, { ...request, prompt, images: [] }, onDelta);
}

// ---- Where a quote is on the page ----

const distance = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
};
// OCR misreads a letter here and there: words match when one edit apart.
const sameWord = (a, b) => a === b || (a.length > 3 && b.length > 3 && distance(a, b) <= 1);
// The region of the page's words that best match a quote, as fractions of the
// page; null when fewer than 60% of its words are found in order. `layout` is
// { size: [w, h], words: [{ text, box: [x, y, w, h] }] } in page units.
export function locateQuote(quote, layout) {
  const words = layout?.words || [], [W, H] = layout?.size || [];
  const wanted = norm(quote).split(' ').filter(Boolean);
  // Too little to place: "6 - 2" or "255" match digits anywhere on a page of maths.
  const telling = wanted.filter(t => t.length >= 3).length;
  if ((wanted.length < 3 && telling < 2) || !words.length || !(W > 0) || !(H > 0)) return null;
  const tokens = words.map(w => norm(w.text));
  let best = null;
  for (let start = 0; start < tokens.length; start++) {
    if (!wanted.some(t => sameWord(tokens[start], t))) continue;
    let at = start, matched = 0, first = -1, last = -1;
    // In order, skipping at most two page words (OCR noise) or a quote word.
    for (const t of wanted) {
      const k = [at, at + 1, at + 2].find(i => i < tokens.length && sameWord(tokens[i], t));
      if (k === undefined) continue;
      matched++;
      if (first < 0) first = k;
      last = k;
      at = k + 1;
    }
    const score = matched / wanted.length;
    if (first >= 0 && (!best || score > best.score)) best = { score, first, last };
  }
  if (!best || best.score < 0.6) return null;
  const picked = words.slice(best.first, best.last + 1);
  const x0 = Math.min(...picked.map(w => w.box[0])), y0 = Math.min(...picked.map(w => w.box[1]));
  const x1 = Math.max(...picked.map(w => w.box[0] + w.box[2])), y1 = Math.max(...picked.map(w => w.box[1] + w.box[3]));
  // A little room around the words, so the outline does not touch them.
  const pad = 0.01, f = v => Math.round(v * 1000) / 1000;
  const box = [f(Math.max(0, x0 / W - pad)), f(Math.max(0, y0 / H - pad)), f(Math.min(1, x1 / W + pad)), f(Math.min(1, y1 / H + pad))];
  if (box[2] - box[0] < 0.03) { const c = (box[0] + box[2]) / 2; box[0] = f(Math.max(0, c - 0.015)); box[2] = f(Math.min(1, c + 0.015)); }
  if (box[3] - box[1] < 0.015) { const c = (box[1] + box[3]) / 2; box[1] = f(Math.max(0, c - 0.0075)); box[3] = f(Math.min(1, c + 0.0075)); }
  return validBox(box) ? box : null;
}

// ---- Study: each page alone, then merged ----

// Whether a read page joins the pages waiting to be packed. Only near-empty
// pages are packed, up to MAX_PACK and the budget; any other page goes alone.
export function packStep(pending, entry, { budget = UNKNOWN_BUDGET, maxPages = MAX_PACK, short = SHORT_PAGE } = {}) {
  const size = e => e.content.length;
  if (size(entry) >= short) return 'alone';
  if (!pending.length) return 'add';
  const total = pending.reduce((n, e) => n + size(e), 0) + size(entry);
  return pending.length < maxPages && total <= budget ? 'add' : 'flush';
}

const unitName = unit => (unit === 'section' ? 'section' : 'page');
// The material of a pack: each page's content and its numbered points (numbered
// across the pack, so a question can cite one).
export function packMaterial(pack, unit = 'page') {
  let n = 0;
  const label = unit === 'section' ? 'Section' : 'Page';
  return pack.map(e => {
    const points = e.points.map(p => `[${++n}] ${p.text}`);
    return `--- ${label} ${e.page + 1} ---\n${e.content || '(nothing readable)'}${points.length ? `\nKey points:\n${points.join('\n')}` : ''}`;
  }).join('\n\n');
}
const pointsOf = pack => pack.flatMap(e => e.points.map(p => ({ ...p, page: e.page + 1 })));

// Short, single-purpose prompts and their schemas; `count` items for the pack.
// The language of some text, by its commonest short words; '' when unclear.
// A small model told "the notes' own language" often answers in English.
const STOP = {
  Spanish: ['de', 'la', 'que', 'el', 'en', 'los', 'se', 'las', 'por', 'un', 'una', 'para', 'con', 'no', 'es', 'si', 'del', 'al', 'como', 'puede'],
  English: ['the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'it', 'with', 'as', 'are', 'this', 'be', 'by', 'on', 'not', 'or', 'can', 'if'],
  French: ['le', 'la', 'les', 'des', 'est', 'et', 'une', 'du', 'que', 'pour', 'dans', 'pas', 'sur', 'au', 'ce', 'qui'],
  German: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'ein', 'eine', 'zu', 'den', 'mit', 'von', 'auf', 'sich', 'dem', 'wenn'],
  Italian: ['il', 'di', 'che', 'la', 'per', 'un', 'una', 'non', 'sono', 'del', 'della', 'gli', 'come', 'con', 'si', 'se'],
  Portuguese: ['de', 'que', 'não', 'uma', 'um', 'para', 'com', 'os', 'as', 'do', 'da', 'em', 'se', 'por', 'mais', 'pode'],
};
export function guessLanguage(text) {
  const words = norm(text).split(' ');
  const scores = Object.entries(STOP).map(([name, list]) => [name, words.filter(w => list.includes(w)).length]).sort((a, b) => b[1] - a[1]);
  const [[best, n], [, next]] = scores;
  return n >= 3 && n >= next * 1.3 ? best : '';
}

export function packPrompt(kind, pack, { count = 4, language = '', title = '', unit = 'page', instructions = '' } = {}) {
  const guessed = language || guessLanguage(pack.map(e => e.content).join(' '));
  const lang = guessed ? `Write in ${guessed}.` : "Write in the notes' own language.";
  const word = unitName(unit), pages = pack.map(e => e.page + 1).join(', ');
  const material = packMaterial(pack, unit);
  if (kind === 'cards')
    return `Make ${count} flashcards from the ${word}${pack.length > 1 ? 's' : ''} below of the notes "${title}". One fact or concept per card: a clear question on the front, a short exact answer on the back; put each item of a list on its own line (\\n). Use only this material. Set "page" to the ${word} each card comes from (${pages}). ${lang}\nReply with ONLY JSON: {"cards":[{"front":"…","back":"…","page":${pack[0].page + 1}}]}\n\n${material}`;
  if (kind === 'quiz') {
    const own = instructions.trim() ? `\nThe student's instructions for questions:\n${instructions.trim().slice(0, 800)}\n` : '';
    return `Write ${count} multiple-choice questions about the ${word}${pack.length > 1 ? 's' : ''} below of the notes "${title}" that test understanding. Each has 4 options of similar length, all plausible, exactly one correct; "answer" is the index of the correct one (0-3). Use only this material. Set "page" to the ${word} it comes from (${pages}), "quote" to the exact words of that ${word} that show the answer (3 to 12 words, copied as written) and "point" to the number of the key point it tests (0 if none). ${lang}${own}\nReply with ONLY JSON: {"questions":[{"question":"…","options":["…","…","…","…"],"answer":0,"page":${pack[0].page + 1},"quote":"…","point":0}]}\n\n${material}`;
  }
  return `Check the ${word}${pack.length > 1 ? 's' : ''} below of the notes "${title}" as a careful teacher: factual errors (dates, names, definitions, formulas, numbers, calculations), unclear or misleading statements, and something important that is missing. Report only what you are sure of. Quote the note's words in "quote", say what is wrong in "problem" and give the corrected statement in "correction". Every ${word} (${pages}) appears once in "pages", with an empty "issues" list when nothing needs correcting. ${lang}\nReply with ONLY JSON: {"pages":[{"page":${pack[0].page + 1},"issues":[{"kind":"error|unclear|missing","quote":"…","problem":"…","correction":"…"}]}]}\n\n${material}`;
}
export function packSchema(kind, pack) {
  const page = { type: 'integer', enum: pack.map(e => e.page + 1) };
  const str = { type: 'string' };
  if (kind === 'cards') return { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: { front: str, back: str, page }, required: ['front', 'back', 'page'] } } }, required: ['cards'] };
  if (kind === 'quiz') return { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { question: str, options: { type: 'array', items: str }, answer: { type: 'integer' }, page, quote: str, point: { type: 'integer' } }, required: ['question', 'options', 'answer', 'page', 'quote', 'point'] } } }, required: ['questions'] };
  return { type: 'object', properties: { pages: { type: 'array', items: { type: 'object', properties: { page, issues: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['error', 'unclear', 'missing'] }, quote: str, problem: str, correction: str }, required: ['kind', 'problem', 'correction'] } } }, required: ['page', 'issues'] } } }, required: ['pages'] };
}
// Questions in the quiz's own shape. The hint's region (H) is where the quote is
// among the page's words; failing that, the region of the key point it cites.
export function questionsWithRegions(value, pack) {
  const points = pointsOf(pack);
  return {
    questions: (Array.isArray(value?.questions) ? value.questions : []).map(q => {
      const cited = Number.isInteger(q?.point) && q.point >= 1 ? points[q.point - 1] : null;
      const page = Number.isInteger(q?.page) ? q.page : cited?.page ?? pack[0].page + 1;
      const quote = typeof q?.quote === 'string' ? q.quote.trim() : '';
      const found = quote ? locateQuote(quote, pack.find(e => e.page + 1 === page)?.layout) : null;
      const box = found || (cited && cited.page === page && cited.box ? cited.box : null);
      return { question: q?.question, options: q?.options, answer: q?.answer, source: { page, box, ...(quote ? { quote } : {}) } };
    }),
  };
}

// De-duplication: the same normalised text, or (questions) most words shared.
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function similar(a, b, threshold = 0.8) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Short words are noise, but numbers tell "page 1" from "page 3".
  const words = t => new Set(t.split(' ').filter(w => w.length > 2 || /\d/.test(w)));
  const wa = words(x), wb = words(y);
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared) >= threshold;
}
// Items from all pages: duplicates dropped, then at most `perPage` per page.
export function mergeItems(items, { kind = 'cards', perPage = 4 } = {}) {
  const textOf = item => (kind === 'cards' ? item.front : item.question);
  const pageOf = item => (kind === 'cards' ? item.page : item.source?.page) ?? 0;
  const kept = [], perCount = new Map();
  for (const item of items) {
    if (kept.some(k => similar(textOf(k), textOf(item)))) continue;
    const page = pageOf(item), n = perCount.get(page) || 0;
    if (n >= perPage) continue;
    perCount.set(page, n + 1);
    kept.push(item);
  }
  return kept;
}

// Flashcards, quiz or fact check, page by page. `clean(kind, value, pages)` turns
// one answer into items (the study module's own cleaners). Returns the merged
// items and the pages that failed; a failed page never loses the others.
export async function smallStudy({
  ai, provider, model = '', notePath = '', tag = 'study', kind, pages, amount = 4, language = '', title = '', unit = 'page', instructions = '',
  vision = false, contextTokens = 0, pageImage = async () => null, pageText = async () => '', pageWords = async () => null, clean, onProgress = () => {}, cancelled = () => false,
}) {
  const base = { provider, model, tag, notePath };
  const budget = contextTokens ? Math.max(1200, (contextTokens - 1700) * 3) : UNKNOWN_BUDGET;
  const items = [], failures = [], done = new Set();
  const doing = kind === 'cards' ? 'making cards' : kind === 'quiz' ? 'writing questions' : 'checking';
  let pending = [], index = 0;
  const progress = (phase, step) => onProgress({ phase: `${unitName(unit)} ${index + 1} of ${pages.length} · ${phase}`, fraction: Math.min(0.99, (index + step) / pages.length), page: index });
  async function generate(pack) {
    if (!pack.length || cancelled()) return;
    progress(doing, 0.6);
    const pagesOf = pack.map(e => e.page);
    try {
      const extra = kind === 'check' ? 0 : 1;
      const prompt = packPrompt(kind, pack, { count: amount * pack.length + extra, language, title, unit, instructions });
      const { text } = await call(ai, { ...base, images: [], prompt, schema: packSchema(kind, pack) });
      // An answer that arrived is kept, even if Stop came meanwhile.
      const value = parseJson(text);
      items.push(...clean(kind, kind === 'quiz' ? questionsWithRegions(value, pack) : value, pagesOf));
      for (const p of pagesOf) done.add(p);
    } catch (error) {
      if (cancelled() || error?.message === STOPPED) return;
      failures.push(...pagesOf.map(page => ({ page, error: error.message })));
    }
  }
  for (; index < pages.length && !cancelled(); index++) {
    const page = pages[index];
    progress(vision ? 'reading' : 'reading the text', 0.1);
    let entry;
    try {
      const extracted = String(await pageText(page) || '');
      const image = vision ? await pageImage(page) : null;
      if (cancelled()) break;
      const layout = kind === 'quiz' ? await pageWords(page).catch(() => null) : null;
      entry = { page, layout, ...(await readPage(ai, base, { image, extracted, vision, unit })) };
    } catch (error) {
      if (cancelled() || error?.message === STOPPED) break;
      failures.push({ page, error: error.message });
      continue;
    }
    if (!entry.content.trim() && !entry.points.length) { done.add(page); continue; }
    const step = packStep(pending, entry, { budget });
    if (step === 'alone') { await generate(pending.splice(0)); await generate([entry]); }
    else if (step === 'flush') { await generate(pending.splice(0)); pending.push(entry); }
    else pending.push(entry);
  }
  await generate(pending.splice(0));
  const merged = kind === 'check' ? items : mergeItems(items, { kind, perPage: Number(amount) || 4 });
  return { items: merged, failures, done: [...done].sort((a, b) => a - b) };
}

// The dialect reference for handwriting conversion, cut to its core for a small
// model: headings, emphasis, lists, cards, colours; no drawings, columns, maps or options.
export function compactDialect(dialect) {
  const lines = String(dialect || '').split('\n');
  const end = lines.findIndex(l => /^Classic look:/.test(l));
  return (end > 0 ? lines.slice(0, end) : lines)
    .filter(l => !/!draw|!columns|!map|!zone|!stat|!sticky|^Drawings:|^Options:/.test(l))
    .join('\n').trim();
}
