// Textual Analysis (as Visual Paradigm's): a problem statement in Markdown and the candidates
// picked out of it. A candidate is a piece of extracted text ("las reservas de los clientes")
// with a model name ("ReservaPlaza"), a type (class, actor, use case, attribute, operation,
// other), a description and a highlight colour of its own; every place the extracted text
// appears in the statement is one of its occurrences, highlighted in its colour and counted,
// whatever its case. The statement itself stays plain Markdown (with any ==highlights== or
// =={.red}remarks== of md-highlight.js): occurrences are found, not marked. Pure (no DOM):
// the renderer, the editor, MCP add_prefab and the tests all use it.
//
// Spec: { type: 'textual-analysis', title, text, show: 'both'|'text'|'table',
//         match: { plural: false, accents: false },
//         candidates: [{ name, text, kind, description, colour, order,
//                        aliases?: [more extracted texts], folder?: 'Clases', owner?: name }] }
// `owner`: the class an attribute or operation belongs to, or the actor of a use case (its
// compartment or association in "Create UML diagrams"). `folder`: a group in the candidates'
// tree (VP's Model Explorer "Candidate Items" folders).
import { findMarkdownHighlights } from '../../md-highlight.js';

export const TYPE = 'textual-analysis';
export const SHOWS = ['both', 'text', 'table'];
export const MAX_CANDIDATES = 300;
// Visual Paradigm's candidate types.
export const KINDS = [
  { id: 'class', label: 'Class' },
  { id: 'actor', label: 'Actor' },
  { id: 'usecase', label: 'Use case' },
  { id: 'attribute', label: 'Attribute' },
  { id: 'operation', label: 'Operation' },
  { id: 'other', label: 'Other' },
];
const KIND_IDS = KINDS.map((k) => k.id);
// Highlight colours given to new candidates in turn (distinct pastels, readable under black).
export const PALETTE = ['#fff169', '#ffc799', '#cdb8fb', '#8ee6dc', '#a8e6a1', '#9ed6ff', '#fab0c8', '#e6d3a3', '#ffd6a5', '#c8f0a0', '#f3c4fb', '#b8c7ff'];
const HEX = /^#[0-9a-f]{6}$/i;

// Letters with their accents taken off, one character for one (so offsets stay): "é" → "e".
const foldChar = (c) => c.normalize('NFD')[0] || c;
const fold = (s, accents) => (accents ? [...s].map(foldChar).join('') : s).toLowerCase();
const cleanText = (s) => String(s ?? '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
// The key a text is known by: case, spaces and Markdown marks do not count (accents too
// when matching leaves them out).
export const textKey = (s, accents = false) => fold(cleanText(s), accents);

// Words that a suggested model name leaves out (articles and prepositions, Spanish and English).
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'en', 'por', 'para', 'con', 'su', 'sus', 'lo', 'the', 'a', 'an', 'of', 'and', 'or', 'to', 'for', 'in', 'on', 'its', 'their', 'his', 'her']);
// A model name from extracted text: CamelCase for classes ("dirección postal" →
// "DireccionPostal"), camelCase for attributes and operations ("Nombre de cliente" →
// "nombreCliente"), the words as they are (first letter capital) for actors and use cases.
export function suggestName(text, kind = 'class') {
  const words = cleanText(text).split(' ').filter(Boolean);
  if (!words.length) return '';
  if (kind === 'actor' || kind === 'usecase' || kind === 'other') { const s = words.join(' '); return s[0].toUpperCase() + s.slice(1); }
  const kept = words.filter((w) => !STOP.has(w.toLowerCase()));
  const parts = (kept.length ? kept : words).map((w) => [...w].map(foldChar).join('').replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  const camel = parts.map((w, i) => (i === 0 && kind !== 'class' ? w[0].toLowerCase() + w.slice(1).toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  return camel || words.join(' ');
}

// The next colour of the palette that no candidate has yet (then round again).
export function nextColour(candidates) {
  const used = new Set(candidates.map((c) => String(c.colour).toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[candidates.length % PALETTE.length];
}

export function normalize(raw = {}) {
  if (!raw || typeof raw !== 'object') raw = {};
  const match = { plural: !!raw.match?.plural, accents: !!raw.match?.accents };
  const model = {
    type: TYPE,
    title: String(raw.title ?? '').slice(0, 200),
    text: String(raw.text ?? ''),
    show: SHOWS.includes(raw.show) ? raw.show : 'both',
    match,
    candidates: [],
  };
  const listed = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .filter((c) => c && typeof c === 'object' && cleanText(c.text ?? c.name))
    .map((c, i) => ({ c, i, order: Number.isFinite(Number(c.order)) ? Number(c.order) : Infinity }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ c }) => c);
  for (const c of listed) {
    const text = cleanText(c.text ?? c.name).slice(0, 200);
    const aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(cleanText).filter(Boolean);
    const at = candidateOfText(model, text);
    if (at >= 0) {
      // The same extracted text twice: one candidate, the second's texts and words join it.
      const into = model.candidates[at];
      for (const a of aliases) if (candidateOfText(model, a) < 0) (into.aliases ||= []).push(a);
      if (c.description && !into.description.includes(String(c.description))) into.description = [into.description, String(c.description)].filter(Boolean).join(' ');
      continue;
    }
    const kind = KIND_IDS.includes(c.kind) ? c.kind : KIND_IDS.find((k) => k === String(c.kind ?? '').toLowerCase().replace(/[^a-z]/g, '')) || 'class';
    const out = {
      name: String(c.name ?? '').trim().slice(0, 120) || suggestName(text, kind),
      text,
      kind,
      description: String(c.description ?? '').slice(0, 2000),
      colour: HEX.test(c.colour || '') ? c.colour.toLowerCase() : HEX.test(c.color || '') ? c.color.toLowerCase() : nextColour(model.candidates),
    };
    const own = aliases.filter((a) => textKey(a, match.accents) !== textKey(text, match.accents) && candidateOfText(model, a) < 0);
    if (own.length) out.aliases = [...new Set(own)];
    if (String(c.folder ?? '').trim()) out.folder = String(c.folder).trim().slice(0, 60);
    if (String(c.owner ?? '').trim()) out.owner = String(c.owner).trim().slice(0, 120);
    model.candidates.push(out);
    if (model.candidates.length >= MAX_CANDIDATES) break;
  }
  model.candidates.forEach((c, i) => { c.order = i; });
  return model;
}

const textsOf = (c) => [c.text, ...(c.aliases || [])];

// The candidate whose extracted texts include `text`, as an index, or -1.
export function candidateOfText(model, text) {
  const key = textKey(text, model.match?.accents);
  return key ? model.candidates.findIndex((c) => textsOf(c).some((t) => textKey(t, model.match?.accents) === key)) : -1;
}

// The statement as it is searched: code, highlight delimiters and emphasis marks hidden (same
// length, so offsets are the text's), accents taken off when asked, lower case.
function searchable(model) {
  const masked = String(model.text)
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`/g, (code) => code.replace(/[^\n]/g, '\u0001'))
    .replace(/==(?:\{[._]?[A-Za-z0-9#-]{0,24}\})?/g, (d) => '\u0001'.repeat(d.length))
    .replace(/[*~]/g, '\u0001');
  return fold(masked, model.match?.accents);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every occurrence of every candidate in the statement: [{ start, end, index }] in text order.
// Whole words only, any case; a plural (-s, -es) too when `match.plural`. Where two overlap, the
// longer extracted text wins ("nombre de cliente" over "cliente").
export function findOccurrences(model) {
  const hay = searchable(model);
  const accents = model.match?.accents;
  const found = [];
  model.candidates.forEach((c, index) => {
    for (const t of textsOf(c)) {
      const words = fold(cleanText(t), accents).split(' ').filter(Boolean).map(escapeRe);
      if (!words.length) continue;
      // Words apart by spaces or marks (a line break, **bold** marks) as in the text.
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s\\u0001]+')}${model.match?.plural ? '(?:e?s)?' : ''}(?![\\p{L}\\p{N}])`, 'gu');
      for (const m of hay.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length, index });
    }
  });
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const f of [...found].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (!kept.some((k) => f.start < k.end && f.end > k.start)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// How many times each candidate appears, in the candidates' order.
export function occurrences(model) {
  const counts = model.candidates.map(() => 0);
  for (const o of findOccurrences(model)) counts[o.index]++;
  return counts;
}

const copy = (model) => ({ ...model, match: { ...model.match }, candidates: model.candidates.map((c) => ({ ...c, ...(c.aliases ? { aliases: [...c.aliases] } : {}) })) });
const renumber = (model) => { model.candidates.forEach((c, i) => { c.order = i; }); return model; };

// The text from `from` to `to` classified as `kind`: a new candidate (its suggested name, the
// next colour) at the end, or, when that text is a candidate already, that one given the kind.
// Returns { model, index, added }, or null when there is nothing to classify.
export function classify(model, from, to, kind) {
  if (!KIND_IDS.includes(kind)) return null;
  const picked = String(model.text).slice(Math.max(0, Math.min(from, to)), Math.max(from, to));
  const text = cleanText(picked);
  if (!text || /\n[ \t]*\n/.test(picked.trim()) || text.length > 200) return null;
  const out = copy(model);
  const at = candidateOfText(out, text);
  if (at >= 0) {
    out.candidates[at].kind = kind;
    return { model: out, index: at, added: false };
  }
  // The text of the statement as written there (its own case), not lower-cased.
  out.candidates.push({ name: suggestName(text, kind), text, kind, description: '', colour: nextColour(out.candidates), order: out.candidates.length });
  return { model: out, index: out.candidates.length - 1, added: true };
}

// The candidate whose occurrence is at `at` (an offset in the text), or -1.
export function candidateAt(model, at) {
  return findOccurrences(model).find((o) => at >= o.start && at <= o.end)?.index ?? -1;
}

// A candidate removed (its highlights go with it: they are its occurrences).
export function removeCandidate(model, i) {
  if (!model.candidates[i]) return model;
  const out = copy(model);
  const [gone] = out.candidates.splice(i, 1);
  for (const c of out.candidates) if (c.owner === gone.name) delete c.owner;
  return renumber(out);
}

// One field of a candidate changed (name, kind, description, colour, folder, owner).
export function update(model, i, fields) {
  if (!model.candidates[i]) return model;
  const out = copy(model);
  const c = out.candidates[i];
  const was = c.name;
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'kind' && !KIND_IDS.includes(v)) continue;
    if (k === 'colour' && !HEX.test(v || '')) continue;
    if ((k === 'folder' || k === 'owner') && !String(v ?? '').trim()) { delete c[k]; continue; }
    if (['name', 'kind', 'description', 'colour', 'folder', 'owner'].includes(k)) c[k] = String(v);
  }
  if (c.name !== was) for (const x of out.candidates) if (x.owner === was) x.owner = c.name;
  return out;
}

// Its extracted text changed: when another candidate has that text, the two are merged.
export function setText(model, i, text) {
  const t = cleanText(text);
  if (!model.candidates[i] || !t) return model;
  const other = candidateOfText(model, t);
  if (other >= 0 && other !== i) return merge(model, i, other);
  const out = copy(model);
  out.candidates[i].text = t;
  if (out.candidates[i].aliases) {
    out.candidates[i].aliases = out.candidates[i].aliases.filter((a) => textKey(a, model.match?.accents) !== textKey(t, model.match?.accents));
    if (!out.candidates[i].aliases.length) delete out.candidates[i].aliases;
  }
  return out;
}

// Candidate `from` merged into `into`: its extracted texts count for `into` from then on, its
// description is added to `into`'s.
export function merge(model, from, into) {
  const a = model.candidates[from], b = model.candidates[into];
  if (!a || !b || from === into) return model;
  const out = copy(model);
  const target = out.candidates[into];
  const aliases = [...(target.aliases || [])];
  for (const t of textsOf(a)) if (!textsOf({ text: target.text, aliases }).some((x) => textKey(x, model.match?.accents) === textKey(t, model.match?.accents))) aliases.push(t);
  if (aliases.length) target.aliases = aliases;
  if (a.description.trim() && !target.description.includes(a.description.trim())) target.description = [target.description.trim(), a.description.trim()].filter(Boolean).join(' ');
  for (const x of out.candidates) if (x.owner === a.name) x.owner = target.name;
  out.candidates.splice(from, 1);
  return renumber(out);
}

// A candidate moved from `i` to `j`.
export function move(model, i, j) {
  if (!model.candidates[i] || j < 0 || j >= model.candidates.length || i === j) return model;
  const out = copy(model);
  const [c] = out.candidates.splice(i, 1);
  out.candidates.splice(j, 0, c);
  return renumber(out);
}

// The statement as blocks of styled runs for drawing: { heading, bullet, level, runs:
// [{ text, bold, italic, tag (a ==highlight=='s), cand (a candidate's index) }] }. Markdown
// marks are left out; candidates are found as in the editor.
export function textBlocks(model) {
  const text = String(model.text).replace(/\r/g, '');
  const occ = findOccurrences({ ...model, text });
  const candAt = new Int32Array(text.length).fill(-1);
  for (const o of occ) candAt.fill(o.index, o.start, o.end);
  const blocks = [];
  let offset = 0, inCode = false;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode || !line.trim()) { if (!line.trim()) blocks.push(null); continue; }
    const m = line.match(/^(\s*)(?:(#{1,6})\s+|([-*+]|\d+[.)])\s+)?/);
    const level = Math.floor((m[1] || '').replace(/\t/g, '    ').length / 2);
    const heading = !!m[2], bullet = m[3] ? (/^\d/.test(m[3]) ? m[3] : ['•', '◦', '▪'][Math.min(level, 2)]) : '';
    const body = line.slice(m[0].length), bodyStart = lineStart + m[0].length;
    // Characters with their style; marks dropped.
    const chars = [];
    const hls = findMarkdownHighlights(body);
    let bold = false, italic = false;
    for (let i = 0; i < body.length;) {
      const h = hls.find((x) => x.start === i);
      if (h) { for (let j = h.from; j < h.to; j++) if (!'*`~'.includes(body[j])) chars.push({ c: body[j], bold, italic, tag: h.tag, cand: candAt[bodyStart + j] }); i = h.end; continue; }
      if (body.startsWith('**', i) || body.startsWith('__', i)) { bold = !bold; i += 2; continue; }
      if ((body[i] === '*' || (body[i] === '_' && !/[\p{L}\p{N}]/u.test(body[i - 1] || '') )) && body[i + 1] !== ' ') { italic = !italic; i++; continue; }
      if (body[i] === '`' || body[i] === '~') { i++; continue; }
      chars.push({ c: body[i], bold, italic, tag: undefined, cand: candAt[bodyStart + i] });
      i++;
    }
    const runs = [];
    for (const ch of chars) {
      const last = runs.at(-1);
      if (last && last.bold === ch.bold && last.italic === ch.italic && last.tag === ch.tag && last.cand === ch.cand) last.text += ch.c;
      else runs.push({ text: ch.c, bold: ch.bold, italic: ch.italic, tag: ch.tag, cand: ch.cand });
    }
    // A line that goes on a paragraph joins it (Markdown's soft line break).
    const prev = blocks.at(-1);
    if (prev && !heading && !bullet && !prev.heading && !m[1]) prev.runs.push({ text: ' ', bold: false, italic: false, tag: undefined, cand: -1 }, ...runs);
    else blocks.push({ heading, bullet, level, runs });
  }
  return blocks.filter(Boolean);
}
