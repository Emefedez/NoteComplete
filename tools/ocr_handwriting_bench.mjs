// Handwriting OCR benchmark (Chromium, after a web build; needs the network for the
// language data and word lists, fetched with curl and kept in the system temp folder).
// Known Spanish text (with some English words, as notes have) is written as handwriting ink (Insert handwritten pages) in several
// hands, recognized at normal and high quality, and scored: recall is the share of the
// text's words found, precision the share of the words read that are right.
//   node tools/ocr_handwriting_bench.mjs [font,hand,pen ...] [--json out.json]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../apps/desktop/collab-server.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const cache = join(tmpdir(), 'notecomplete-ocr-data'); mkdirSync(cache, { recursive: true });
const args = process.argv.slice(2), jsonAt = args.indexOf('--json'), JSON_OUT = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : '';
const CONFIGS = args.length ? args : ['patrick,,', 'nixish,messy,ballpoint', 'caveat,messy,ballpoint', 'elfin,messy,', 'allure,messy,'];
const TEXT = `La memoria principal guarda los programas y los datos que el procesador necesita mientras se ejecutan.

Cuando una dirección no está en la caché, se produce un fallo y hay que traer el bloque completo desde la memoria.

El sistema operativo reparte el tiempo del procesador entre los procesos según su prioridad y su estado.

Ejercicio: calcula el número de páginas, la dirección física y el tamaño de la tabla de páginas.

El framework guarda cada request en un buffer y un thread pool hace el scheduling del trabajo.`;
const truth = TEXT.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[a-zñ]+/g);
async function run(CONFIG) {
const server = await startServer({ root: fileURLToPath(new URL('../apps/reader/', import.meta.url)), host: '127.0.0.1', address: '127.0.0.1', notes: null, port: 0 });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
const fromNetwork = async (route) => {
  const url = route.request().url(), file = join(cache, url.replace(/[^\w.-]+/g, '_'));
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, url]);
  await route.fulfill({ body: readFileSync(file), contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
};
await ctx.route('https://cdn.jsdelivr.net/**', fromNetwork);
await ctx.route('https://raw.githubusercontent.com/**', fromNetwork);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(server.origin + '/'); await p.waitForFunction(() => !document.getElementById('open').disabled);
await p.setInputFiles('#file', fileURLToPath(new URL('../samples/nota_1linea.noteful', import.meta.url)));
await p.waitForSelector('.sheet[data-page="0"] .render svg');
await p.evaluate(() => document.getElementById('insertHandwritten').click());
await p.waitForSelector('.handwriting-dialog[open]');
if (await p.isVisible('#hwModeMarkdown')) await p.click('#hwModeMarkdown');
const [font, hand, pen] = CONFIG.split(',');
for (const [k, v] of Object.entries({ font, hand, pen })) await p.selectOption('#hw-' + k, v);
await p.fill('#hwMarkdown', TEXT);
await p.waitForTimeout(1500);
await p.click('#hwInsert');
await p.waitForFunction(() => document.querySelectorAll('.sheet').length >= 2, null, { timeout: 60000 });
const pages = await p.evaluate(() => document.querySelectorAll('.sheet').length);
const out = {};
const score = (words) => {
  const got = words.join(' ').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[a-zñ]+/g) || [];
  const pool = new Map(); for (const w of got) pool.set(w, (pool.get(w) || 0) + 1);
  let hit = 0; for (const w of truth) if (pool.get(w)) { hit++; pool.set(w, pool.get(w) - 1); }
  return { recall: +(hit / truth.length).toFixed(3), precision: +(hit / Math.max(1, got.length)).toFixed(3), got: got.length };
};
for (const quality of ['normal', 'high']) {
  await p.evaluate(() => document.getElementById('ocrOpen').click());
  await p.waitForSelector('#ocrDialog[open]');
  await p.evaluate(() => document.querySelector('input[name="ocrScope"][value="range"]').click());
  await p.fill('#ocrFrom', '2'); await p.fill('#ocrTo', String(pages));
  await p.selectOption('#ocrLanguage', ['spa', 'eng']);
  await p.locator(`input[name="ocrQuality"][value="${quality}"]`).locator('xpath=..').click();
  if (!(await p.isChecked('#ocrRedo'))) await p.check('#ocrRedo');
  await p.evaluate(() => { document.getElementById('status').textContent = ''; });
  const t = Date.now();
  await p.click('#ocrStart');
  await p.waitForFunction(() => /Text recognized|Could not|already/.test(document.getElementById('status').textContent + document.getElementById('ocrStatus').textContent), null, { timeout: 900000 });
  const words = [];
  for (let i = 1; i < pages; i++) {
    await p.evaluate((i) => document.querySelector(`.sheet[data-page="${i}"]`).scrollIntoView(), i);
    await p.waitForTimeout(1200);
    words.push(...await p.evaluate((i) => [...document.querySelectorAll(`.sheet[data-page="${i}"] .text-layer tspan`)].map(e => e.textContent.trim()).filter(Boolean), i));
  }
  out[quality] = { seconds: (Date.now() - t) / 1000, ...score(words), text: words.join(' ') };
}
await b.close(); await server.stop();
return out;
}

const report = {};
const pc = v => `${Math.round(v * 100)} %`;
console.log('| Hand | Normal recall | Normal precision | High recall | High precision | Time normal / high |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const config of CONFIGS) {
  const r = await run(config);
  report[config] = r;
  console.log(`| ${config} | ${pc(r.normal.recall)} | ${pc(r.normal.precision)} | ${pc(r.high.recall)} | ${pc(r.high.precision)} | ${r.normal.seconds.toFixed(1)} s / ${r.high.seconds.toFixed(1)} s |`);
  if (process.env.TEXT) for (const q of ['normal', 'high']) console.log(`  ${q}: ${r[q].text}`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
