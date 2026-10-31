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

export function revisePrompt(batch, { title = '', language = '' } = {}) {
  return `This is part of an automatic transcript of a lecture${title ? ` for the notes "${title}"` : ''}${language ? `, spoken in ${language}` : ''}. Speech recognition made mistakes.
Correct misheard words (above all technical terms and names), punctuation and capitalization. Keep the speaker's wording and order: do not summarize, translate, reorder, add explanations or drop content. Leave a segment unchanged if it is already right.
Reply with ONLY JSON: {"segments":[{"i":<same number>,"text":"corrected text"}]}, one entry for each segment below.

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

// Revises `words` in batches of segments; `ask(prompt)` returns the AI's text.
export async function reviseWords(words, { ask, parse, title, language, perCall = 8, onProgress = () => {}, cancelled = () => false }) {
  const parts = segments(words).map((s, i) => ({ ...s, i }));
  const out = parts.map(s => words.slice(s.from, s.to));
  let changed = 0;
  for (let b = 0; b < parts.length; b += perCall) {
    if (cancelled()) throw Error('Revision stopped.');
    const batch = parts.slice(b, b + perCall);
    const reply = parse(await ask(revisePrompt(batch, { title, language })));
    for (const s of reply?.segments || []) {
      const part = batch.find(p => p.i === s.i);
      if (!part || typeof s.text !== 'string' || !s.text.trim()) continue;
      // A reply far shorter or longer than the segment is a summary or a runaway; keep the original.
      const ratio = s.text.split(/\s+/).length / Math.max(1, part.to - part.from);
      if (ratio < 0.6 || ratio > 1.6) continue;
      out[part.i] = realign(words.slice(part.from, part.to), s.text.trim());
      if (s.text.trim() !== part.text) changed++;
    }
    onProgress(Math.min(parts.length, b + perCall), parts.length);
  }
  return { words: out.flat(), changed, segments: parts.length };
}
