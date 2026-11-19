// Simplified ↔ traditional (docs/CHINESE-INPUT.md §4.5): OpenCC tables, longest match over
// phrases first, then characters (头发 → 頭髮, 干部 → 幹部, 以后 → 以後, 皇后 → 皇后). Pure.
// opencc.bin (tools/build_chinese_data.mjs): per table of meta.tables, keys then values as string
// columns (u16 lengths + UTF-8 blob); a value lists alternatives separated by spaces, OpenCC's
// default first.
import { readContainer } from './pack.js';

export function decodeOpenCC(bytes) {
  const p = readContainer(bytes), m = p.meta;
  if (m.kind !== 'opencc') throw new Error('not an OpenCC pack');
  const table = name => {
    const i = m.tables.indexOf(name), n = m.counts[name], at = 1 + i * 4;
    const keys = p.strings(at, n), values = p.strings(at + 2, n), map = new Map();
    let max = 1;
    for (let r = 0; r < n; r++) { const k = keys.get(r); map.set(k, values.get(r).split(' ')); max = Math.max(max, [...k].length); }
    return { map, max };
  };
  const pair = (phrases, chars) => {
    const a = table(phrases), b = table(chars);
    for (const [k, v] of b.map) if (!a.map.has(k)) a.map.set(k, v);
    return { map: a.map, max: Math.max(a.max, b.max) };
  };
  return { s2t: pair('STPhrases', 'STCharacters'), t2s: pair('TSPhrases', 'TSCharacters') };
}

// The text in parts: converted runs and characters with their alternatives (for the convert
// dialog, which underlines a character that still has several targets).
export function convertParts(text, direction, tables) {
  const t = tables[direction];
  if (!t) throw new Error(`unknown direction ${direction}`);
  const cps = [...String(text)], out = [];
  let plain = '', from = '';
  for (let i = 0; i < cps.length;) {
    let hit = null, len = Math.min(t.max, cps.length - i);
    for (; len >= 1; len--) { const v = t.map.get(cps.slice(i, i + len).join('')); if (v) { hit = v; break; } }
    if (!hit) { plain += cps[i]; from += cps[i++]; continue; }
    const source = cps.slice(i, i + len).join('');
    if (len === 1 && hit.length > 1) {
      if (plain) out.push({ text: plain, source: from }), plain = from = '';
      out.push({ text: hit[0], source, alternatives: hit });
    } else { plain += hit[0]; from += source; }
    i += len;
  }
  if (plain) out.push({ text: plain, source: from });
  return out;
}

export function convertText(text, direction, tables) {
  return convertParts(text, direction, tables).map(p => p.text).join('');
}
