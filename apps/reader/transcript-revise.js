// AI clean-up of an automatic transcript (typically a fast local Voxtype or
// Whisper pass). The text goes to the user's AI tool in numbered segments; the
// corrected words are aligned back onto the original ones so every word keeps
// a time: kept or replaced words keep theirs, inserted words are placed
// between their neighbours, dropped words disappear.

const norm = w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

// Segments of about `size` words, ending after a sentence when one is near.
export function segments(words, size = 120) {
  const out = [];
  for (let from = 0; from < words.length;) {
    let to = Math.min(words.length, from + size);
    if (to < words.length) {
      for (let i = to; i > from + size * 0.6; i--) if (/[.!?…]$/.test(words[i - 1].text)) { to = i; break; }
    }
    out.push({ from, to, text: words.slice(from, to).map(w => w.text).join(' ') });
    from = to;
  }
  return out;
}

// `flagNoise`: the reply also lists, per segment, stretches that are not part of the lesson.
// They are only marked (transcript.js underlines them for the user to remove or keep).
export function revisePrompt(batch, { title = '', language = '', flagNoise = false } = {}) {
  return `This is part of an automatic transcript of a lecture${title ? ` for the notes "${title}"` : ''}${language ? `, spoken in ${language}` : ''}. Speech recognition made mistakes.
It was recorded in a live class: the teacher is not always heard well, and the microphone also picks up students talking among themselves, cut-off fragments and remarks that have nothing to do with the subject. Do not try to make such passages coherent or invent what was meant.
Correct misheard words (above all technical terms and names), punctuation and capitalization. Keep the speaker's wording and order: do not summarize, translate, reorder, add explanations or drop content. Leave a segment unchanged if it is already right.
${flagNoise ? `Also list, for each segment, the stretches that are clearly not part of the lesson (side conversations, unrelated remarks, incoherent fragments) in "noise", each copied exactly from your corrected text, a few words to a few sentences long. Do not remove them from "text". Only flag clear cases; when unsure, leave it out. Use [] when there are none.
Reply with ONLY JSON: {"segments":[{"i":<same number>,"text":"corrected text","noise":["exact stretch", …]}]}, one entry for each segment below.` : 'Reply with ONLY JSON: {"segments":[{"i":<same number>,"text":"corrected text"}]}, one entry for each segment below.'}

${batch.map(s => `[${s.i}] ${s.text}`).join('\n')}`;
}

// Edit-distance alignment of the corrected tokens onto the original words.
export function realign(original, text) {
  const next = text.split(/\s+/).filter(Boolean);
  if (!original.length) return [];
  const a = original.map(w => norm(w.text)), b = next.map(norm), n = a.length, m = b.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Int32Array.from({ length: m + 1 }, (_, j) => i + j));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  // Walk back: each corrected token takes the time of the original word it replaces.
  const timed = new Array(m).fill(null);
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { timed[j - 1] = original[i - 1]; i--; j--; }
    else if (j > 0 && cost[i][j] === cost[i][j - 1] + 1) j--;
    else i--;
  }
  const first = original[0].start, last = original.at(-1).end ?? original.at(-1).start;
  return next.map((t, k) => {
    if (timed[k]) return { ...timed[k], text: t };
    const before = timed.slice(0, k).findLast(Boolean), after = timed.slice(k + 1).find(Boolean);
    const start = before ? (before.end ?? before.start) : first, end = after ? after.start : last;
    return { text: t, start, end: Math.max(start, end) };
  });
}

// Marks the words of `words` (in place) that make up each quoted stretch: the first run of
// words whose normalized text equals the stretch's. Returns the number of stretches found.
export function markNoise(words, stretches) {
  const keys = words.map(w => norm(w.text));
  let found = 0;
  for (const stretch of stretches || []) {
    if (typeof stretch !== 'string') continue;
    const want = stretch.split(/\s+/).map(norm).filter(Boolean);
    if (!want.length) continue;
    for (let i = 0; i + want.length <= words.length; i++) {
      // Punctuation-only tokens normalize to '' and are skipped on both sides.
      let j = i, k = 0;
      while (j < words.length && k < want.length) {
        if (!keys[j]) { j++; continue; }
        if (keys[j] !== want[k]) break;
        j++; k++;
      }
      if (k === want.length && keys[i]) {
        for (let m = i; m < j; m++) words[m].noise = true;
        found++;
        break;
      }
    }
  }
  return found;
}
// Contiguous flagged words around index `at`: [from, to) of the run, or null.
export function noiseRun(words, at) {
  if (!words[at]?.noise) return null;
  let from = at, to = at + 1;
  while (from > 0 && words[from - 1].noise) from--;
  while (to < words.length && words[to].noise) to++;
  return [from, to];
}
// Number of separate flagged runs.
export const noiseRuns = words => words.reduce((n, w, i) => n + (w.noise && !words[i - 1]?.noise ? 1 : 0), 0);

// Revises `words` in batches of segments; `ask(prompt)` returns the AI's text. With
// `flagNoise`, words in stretches the AI calls noise get `noise: true` (nothing is removed).
export async function reviseWords(words, { ask, parse, title, language, flagNoise = false, perCall = 8, onProgress = () => {}, cancelled = () => false }) {
  const parts = segments(words).map((s, i) => ({ ...s, i }));
  // Copies, so the words shown stay as they are until the revision is accepted.
  const out = parts.map(s => words.slice(s.from, s.to).map(w => {
    const copy = { ...w };
    if (flagNoise) delete copy.noise;
    return copy;
  }));
  let changed = 0, flagged = 0;
  for (let b = 0; b < parts.length; b += perCall) {
    if (cancelled()) throw Error('Revision stopped.');
    const batch = parts.slice(b, b + perCall);
    const reply = parse(await ask(revisePrompt(batch, { title, language, flagNoise })));
    for (const s of reply?.segments || []) {
      const part = batch.find(p => p.i === s.i);
      if (!part || typeof s.text !== 'string' || !s.text.trim()) continue;
      // A reply far shorter or longer than the segment is a summary or a runaway; keep the original.
      const ratio = s.text.split(/\s+/).length / Math.max(1, part.to - part.from);
      if (ratio >= 0.6 && ratio <= 1.6) {
        out[part.i] = realign(out[part.i], s.text.trim());
        if (s.text.trim() !== part.text) changed++;
      }
      if (flagNoise && Array.isArray(s.noise)) flagged += markNoise(out[part.i], s.noise);
    }
    onProgress(Math.min(parts.length, b + perCall), parts.length);
  }
  return { words: out.flat(), changed, flagged, segments: parts.length };
}
