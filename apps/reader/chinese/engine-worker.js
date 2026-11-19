// The dictionary worker (docs/CHINESE-INPUT.md §4.1): loads vendor/chinese/*.bin on first use and
// answers client.js. Messages {id, op, args} → {id, result} | {id, error}. ime-core.bin loads with
// the first message; chars.bin with the first look-up; opencc.bin with the first conversion.
import { createEngine } from './engine.js';
import { decodeOpenCC, convertText, convertParts } from './convert.js';

let base = new URL('../vendor/chinese/', import.meta.url);
const load = name => fetch(new URL(name, base)).then(r => { if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.arrayBuffer(); });
let core = null, chars = null, opencc = null, bytes = 0;
const engine = () => (core ||= load('ime-core.bin').then(b => { bytes = b.byteLength; return createEngine({ ime: b }); }).catch(e => { core = null; throw e; }));
const withChars = async () => { const e = await engine(); await (chars ||= load('chars.bin').then(b => e.setChars(b)).catch(x => { chars = null; throw x; })); return e; };
const tables = () => (opencc ||= load('opencc.bin').then(decodeOpenCC).catch(e => { opencc = null; throw e; }));

const ops = {
  base(url) { base = new URL(url, base); },
  async candidates(input, opts) { return (await engine()).candidates(input, opts); },
  async annotate(text, opts) { return (await engine()).annotate(text, opts); },
  async lookup(text, opts) { return (await withChars()).lookup(text, opts); },
  async convert(text, direction) { return convertText(text, direction, await tables()); },
  async convertParts(text, direction) { return convertParts(text, direction, await tables()); },
  async user(rows) { (await engine()).setUser(rows); },
  async learn(row) { (await engine()).learn(row); },
  async expansions(rows) { (await engine()).setExpansions(rows); },
  async info() { const e = await engine(); return { words: e.pack.rows, bytes, cedict: e.pack.meta.cedict }; },
};

self.onmessage = async ({ data: { id, op, args = [] } }) => {
  try { self.postMessage({ id, result: await ops[op](...args) }); }
  catch (e) { self.postMessage({ id, error: String(e?.message || e) }); }
};
