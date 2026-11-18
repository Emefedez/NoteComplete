// Text boxes with parts in their own style (core TextBox.spans): a bold word in a paragraph
// taken from a PDF, a word in another font or colour. A span is { len, bold?, italic?,
// font?, rgba? }: `len` characters (Unicode code points, as the core counts them) and only what
// differs from the box. The text box is typed in a plain textarea; these functions keep the
// spans with the text as it changes.

const chars = (s) => [...(s || "")];
const sameColour = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const KEYS = ["bold", "italic", "font", "rgba"];

// What a style differs in from the box's: the span's fields.
export function overrides(style, base) {
  const out = {};
  if (!!style.bold !== !!base.bold) out.bold = !!style.bold;
  if (!!style.italic !== !!base.italic) out.italic = !!style.italic;
  if (style.font && style.font !== base.font) out.font = style.font;
  if (style.rgba && !sameColour(style.rgba, base.rgba)) out.rgba = style.rgba;
  return out;
}
const sameOverrides = (a, b) => KEYS.every((k) => (k === "rgba" ? (a.rgba == null && b.rgba == null) || sameColour(a.rgba, b.rgba) : a[k] === b[k]));

// Spans from parts of text, each with its overrides: neighbours alike are joined, and none at
// all when every part looks like the box.
export function spansOf(parts) {
  const spans = [];
  for (const { text, style } of parts) {
    const len = chars(text).length;
    if (!len) continue;
    const last = spans.at(-1);
    if (last && sameOverrides(last, style)) last.len += len;
    else spans.push({ len, ...style });
  }
  return spans.some((s) => Object.keys(s).length > 1) ? spans : [];
}

// The spans for `next` after the box's text changed from `before`: characters kept keep their
// style; typed ones take the style of the character before them (at the start, the one after).
export function remapSpans(before, next, spans) {
  if (!spans?.length) return [];
  const a = chars(before), b = chars(next);
  // Each old character's span.
  const owner = [];
  spans.forEach((s, i) => { for (let k = 0; k < s.len; k++) owner.push(i); });
  if (owner.length !== a.length) return [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const typed = b.length - start - end;
  const near = start > 0 ? owner[start - 1] : owner[a.length - end] ?? owner[0];
  const style = [...owner.slice(0, start), ...Array(typed).fill(near), ...owner.slice(a.length - end)];
  const out = [];
  for (const i of style) {
    const last = out.at(-1);
    if (last && last.i === i) last.len++;
    else out.push({ i, len: 1 });
  }
  return spansOf(out.map(({ i, len }) => {
    const { len: _len, ...rest } = spans[i];
    return { text: "x".repeat(len), style: rest };
  }));
}

// A style changed for the whole box (the format bar): the spans give up that field, so the
// change shows everywhere; spans left with nothing to say go.
export function withoutKeys(spans, keys) {
  const drop = KEYS.filter((k) => keys.includes(k));
  if (!drop.length || !spans?.length) return spans || [];
  return spansOf(spans.map(({ len, ...rest }) => {
    for (const k of drop) delete rest[k];
    return { text: "x".repeat(len), style: rest };
  }));
}

// A typed box as the core gives it back (its runs, the last a zero-width space): the box's
// style is the one most of its characters have, and the spans the rest.
export function fromRuns(runs, styleOf) {
  const parts = (runs || []).map((r) => ({ text: (r.text || "").replaceAll("​", ""), style: styleOf(r) })).filter((p) => p.text);
  if (parts.length < 2) return { base: parts[0]?.style || styleOf(runs?.[0]), spans: [] };
  const weight = new Map();
  for (const p of parts) {
    const key = JSON.stringify([!!p.style.bold, !!p.style.italic, p.style.font, p.style.rgba]);
    weight.set(key, (weight.get(key) || 0) + chars(p.text).length);
  }
  const top = [...weight.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const base = parts.find((p) => JSON.stringify([!!p.style.bold, !!p.style.italic, p.style.font, p.style.rgba]) === top).style;
  return { base, spans: spansOf(parts.map((p) => ({ text: p.text, style: overrides(p.style, base) }))) };
}

// A span list that covers `text` exactly, else none (never sent to the core broken).
export const spansFor = (text, spans) => (spans?.length && spans.reduce((n, s) => n + s.len, 0) === chars(text).length ? spans : []);
