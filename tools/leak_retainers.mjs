// What keeps detached DOM nodes alive after a feature closes (Chromium, after a web build): runs
// one of leak_bench.mjs's scenarios a few times, takes a heap snapshot, and prints, for the
// largest groups of detached nodes, the chain of references that holds them (closest first).
//   ONLY="Chart editor" node tools/leak_retainers.mjs
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await p.context().newCDPSession(p);
await openReader(p, server.origin);
await p.setInputFiles('#file', samplePath('Practice book (vol. 1).noteful'));
await p.locator('.sheet[data-page="0"] .render').first().waitFor();
await p.fill('#pageNumber', '2'); await p.press('#pageNumber', 'Enter');
await sleep(1200);
const sheet = () => p.locator('.sheet[data-page="1"]').boundingBox();
const blur = () => p.evaluate(() => document.activeElement?.blur());
const runs = {
  picker: async () => { await p.evaluate(() => document.getElementById('insertGraph').click()); await p.locator('.prefab-grid').first().waitFor(); await p.keyboard.press('Escape'); await sleep(200); },
  chart: async () => {
    await p.evaluate(() => document.getElementById('insertGraph').click()); await p.locator('.prefab-grid').first().waitFor();
    await p.click('.prefab-card:has(strong:text-is("Histogram"))'); await p.locator('.chart-dialog .ch-canvas').first().waitFor();
    await p.click('.chart-dialog button:has-text("Cancel")'); await sleep(300);
  },
  uml: async () => {
    await p.evaluate(() => document.getElementById('insertUml').click()); await p.locator('.prefab-grid, .uml-dialog').first().waitFor();
    if (await p.locator('.prefab-grid').count()) { await p.click('.prefab-card:has(strong:text-is("UML class"))'); if (await p.locator('.prefab-editor[data-view="visual"]').count()) await p.click('.prefab-editor[data-view="visual"]'); }
    await p.locator('.uml-dialog .uml-canvas svg').first().waitFor(); await p.click('.uml-dialog button:has-text("Cancel")'); await sleep(300);
  },
  menu: async () => { const s = await sheet(); await p.mouse.click(s.x + 120, Math.max(s.y, 150) + 420, { button: 'right' }); await p.locator('.context-menu').first().waitFor(); await p.keyboard.press('Escape'); await sleep(150); },
  pdfedit: async () => { await blur(); await p.keyboard.press('e'); const s = await sheet(); await p.mouse.move(s.x + s.width * 0.4, Math.max(s.y, 150) + 150); await p.locator('.sheet[data-page="1"] .pdf-edit-layer rect').first().waitFor(); await p.keyboard.press('v'); await sleep(150); },
  text: async () => { await blur(); await p.keyboard.press('w'); const s = await sheet(); await p.mouse.click(s.x + 150, Math.max(s.y, 150) + 400); await p.locator('.text-editor').first().waitFor(); await p.keyboard.type('x'); await p.keyboard.press('Shift+Escape'); await sleep(150); await p.keyboard.press('v'); },
};
const run = runs[process.env.ONLY || 'picker'];
let chunks = '';
cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => { chunks += chunk; });
async function snapshot() {
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(80); }
  chunks = '';
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  return JSON.parse(chunks);
}
// DIFF=1: what grew between 5 and 25 runs, by object name, with the chain holding one of them.
const tally = (sn) => {
  const mm = sn.snapshot.meta, f = mm.node_fields.length, t = mm.node_types[0];
  const out = new Map();
  for (let i = 0; i < sn.nodes.length; i += f) {
    const key = `${t[sn.nodes[i + mm.node_fields.indexOf('type')]]}:${sn.strings[sn.nodes[i + mm.node_fields.indexOf('name')]]}`.slice(0, 80);
    const o = out.get(key) || { n: 0, size: 0 };
    o.n++; o.size += sn.nodes[i + mm.node_fields.indexOf('self_size')];
    out.set(key, o);
  }
  return out;
};
for (let i = 0; i < 5; i++) await run();
const first = process.env.DIFF ? tally(await snapshot()) : null;
for (let i = 0; i < (process.env.DIFF ? 20 : 0); i++) await run();
const snap = await snapshot();
if (first) {
  const grew = [...tally(snap).entries()].map(([k, v]) => [k, v.n - (first.get(k)?.n || 0), v.size - (first.get(k)?.size || 0)]).filter((r) => r[1] > 0).sort((a, b) => b[2] - a[2]).slice(0, 18);
  console.log('grew over 20 runs (count, bytes):');
  for (const [k, n, size] of grew) console.log(`  +${n}\t+${Math.round(size / 1024)} KB\t${k}`);
  await b.close(); server.close?.(); process.exit(0);
}
const m = snap.snapshot.meta, nf = m.node_fields.length, ef = m.edge_fields.length;
const nodeTypes = m.node_types[0], edgeTypes = m.edge_types[0];
const N = snap.nodes, E = snap.edges, S = snap.strings;
const iType = m.node_fields.indexOf('type'), iName = m.node_fields.indexOf('name'), iEdges = m.node_fields.indexOf('edge_count'), iDet = m.node_fields.indexOf('detachedness');
const count = N.length / nf;
const firstEdge = new Uint32Array(count);
for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += N[i * nf + iEdges] * ef; }
const retainers = Array.from({ length: count }, () => []);
for (let i = 0; i < count; i++) {
  for (let e = firstEdge[i], end = e + N[i * nf + iEdges] * ef; e < end; e += ef) {
    const type = edgeTypes[E[e]];
    if (type === 'weak' || type === 'shortcut') continue;
    const to = E[e + 2] / nf;
    const label = type === 'element' || type === 'hidden' ? `[${E[e + 1]}]` : S[E[e + 1]];
    retainers[to].push([i, `${type}:${label}`]);
  }
}
const name = (i) => `${nodeTypes[N[i * nf + iType]]}:${S[N[i * nf + iName]]}`.slice(0, 90);
const detached = [];
for (let i = 0; i < count; i++) if (N[i * nf + iDet] === 2 && nodeTypes[N[i * nf + iType]] === 'native' && /HTML|SVG|Text|Comment/.test(name(i))) detached.push(i);
const groups = new Map();
for (const i of detached) groups.set(name(i), [...(groups.get(name(i)) || []), i]);
console.log(`${detached.length} detached DOM nodes`);
for (const [n, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
  console.log(`\n${list.length} × ${n}`);
  // The shortest chain up to something attached (not detached), breadth first.
  const seen = new Map([[list[0], null]]);
  let queue = [list[0]], found = null;
  while (queue.length && !found) {
    const next = [];
    for (const i of queue) {
      for (const [from, via] of retainers[i]) {
        if (seen.has(from)) continue;
        seen.set(from, [i, via]);
        // Up to what holds the DOM: a function's scope, a collection, the window or a global.
        if (/^closure:|^object:(Map|Set|WeakRef|Window|Array|Object|Promise)\b|NativeContext|Global handles|^synthetic:\(Document DOM trees\)/.test(name(from)) && !/HTML|SVG/.test(name(from))) { found = from; break; }
        next.push(from);
      }
      if (found) break;
    }
    queue = next.slice(0, 20000);
  }
  let at = found;
  const chain = [];
  while (at != null && seen.get(at)) { const [child, via] = seen.get(at); chain.push(`${name(at)} —${via}→`); at = child; }
  console.log(chain.slice(0, 18).map((c) => '  ' + c).join('\n'));
}
await b.close();
server.close?.();
process.exit(0);
