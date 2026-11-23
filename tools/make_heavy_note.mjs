// A note with much ink on every page, for the page navigation benchmark (page_nav_bench.mjs).
// Pages are A4 with `strokes` handwriting-like lines each (about the density of the densest
// page in samples/Examen wuolah: ~1 MB of SVG), and every fifth page also holds figures made
// of graph parts, the way inserted prefabs and graphs are. Needs a web build (apps/reader/pkg).
//   node tools/make_heavy_note.mjs out.nfedit [--pages 30] [--strokes 1400]
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const pages = Number(flag('--pages', 30));
const strokes = Number(flag('--strokes', 1400));
const out = args[0];
if (!out) { console.error('usage: node tools/make_heavy_note.mjs out.nfedit [--pages 30] [--strokes 1400]'); process.exit(2); }

const pkg = new URL('../apps/reader/pkg/', import.meta.url);
const wasm = await import(new URL('noteful_wasm.js', pkg));
await wasm.default({ module_or_path: readFileSync(new URL('noteful_wasm_bg.wasm', pkg)) });
const session = wasm.EditorSession.create_document('Heavy', JSON.stringify(Array(pages).fill([595, 842])), new Uint8Array());
let seed = 1;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let page = 0; page < pages; page++) {
  for (let i = 0; i < strokes; i++) {
    const x = 20 + random() * 540, y = 20 + random() * 780, points = [];
    for (let k = 0; k < 30; k++) points.push([x + k * 1.2 + random() * 3, y + Math.sin(k / 3) * 6 + random() * 2]);
    const line = { points, width: 1.5 + random(), rgba: [random() * 0.3, random() * 0.3, 0.5 + random() * 0.5, 1] };
    // One line in thirty drawn with pressure (its outline is a filled path, several times larger).
    if (i % 30 === 0) line.pressure = points.map(() => 0.6 + random() * 0.8);
    if (page % 5 === 0 && i < 300) line.part = { id: `g${page}_${Math.floor(i / 50)}`, kind: 'graph', spec: '{"x":[-5,5]}' };
    session.draw(page, JSON.stringify(line));
  }
}
writeFileSync(out, session.save_project_archive());
console.log(`${out}: ${pages} pages, ${strokes} lines each, ${JSON.parse(session.view(0)).svg.length} characters of SVG on the first`);
session.free();
