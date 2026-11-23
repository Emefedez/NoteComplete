// Switching between documents: after opening one note while another is still drawing its
// pages (or right after), every page in the window is drawn, its PDF page included, without
// scrolling. A PDF page skipped while its page briefly left the band used to stay blank.
//   node tools/doc_switch_e2e.mjs [rounds] [heavy note]
import { readFileSync } from 'node:fs';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';
import { docx } from '../tests/fixtures/office-files.mjs';

const rounds = Number(process.argv[2] || 8);
const files = [samplePath('Examen wuolah.pdf'), samplePath('Examen wuolah.noteful'), samplePath('Practice book (vol. 1).noteful'), process.argv[3]].filter(Boolean)
  .map((path) => ({ name: path.split('/').pop(), bytes: readFileSync(path) }));
// A Word file shows in the text view, with the pages hidden: the next note starts from there.
files.splice(1, 0, { name: 'Resumen.docx', bytes: Buffer.from(docx()), text: true });
const server = await startReader();
const b = await chromium.launch();
let failures = 0;
try {
  const p = await b.newPage({ viewport: { width: 1180, height: 820 } });
  p.on('pageerror', (e) => console.error('pageerror', e.message));
  await openReader(p, server.origin);
  // A tablet-like CPU: PDF pages take long enough to draw for a page to leave the band and
  // come back while its PDF page is drawn.
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  files.forEach((file, i) => { file.url = `/__switch_${i}`; });
  for (const file of files) await p.route(`**${file.url}`, (route) => route.fulfill({ body: file.bytes, contentType: 'application/octet-stream' }));
  const open = (file) => p.evaluate(async ([name, url]) => {
    const buf = await (await fetch(url)).arrayBuffer();
    const input = document.getElementById('file');
    const dt = new DataTransfer(); dt.items.add(new File([buf], name)); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [file.name, file.url]);
  // Pages whose box meets the window, and which of them have no drawing.
  const blank = () => p.evaluate(() => {
    const v = document.getElementById('viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.sheet')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom;
    }).filter((el) => {
      const render = el.querySelector('.render');
      if (!render?.querySelector('svg')) return true;
      // A page over a PDF page also shows that page's picture.
      const background = render.querySelector('[data-background]');
      return !!background && !render.querySelector(':scope > canvas.pdf-raster') && !background.querySelector('image');
    }).map((el) => Number(el.dataset.page));
  });
  for (let i = 0; i < rounds; i++) {
    const a = files[i % files.length];
    let c = files[(i + 1) % files.length];
    if (c.text) c = files[(i + 2) % files.length];
    await open(a);
    // Sometimes switch at once, sometimes while the first is half drawn, sometimes after.
    await p.waitForTimeout([0, 60, 250, 900][i % 4]);
    await open(c);
    await p.waitForFunction((title) => document.getElementById('title').textContent && document.querySelector('.sheet .render svg'), c.name, { timeout: 60000 }).catch(() => {});
    // Into the note as a jump would, and a little back: pages leave and re-enter the band.
    await p.evaluate(async () => {
      const v = document.getElementById('viewport'), h = document.querySelector('.sheet').getBoundingClientRect().height;
      v.scrollTop = h * 4; await new Promise((r) => setTimeout(r, 120));
      v.scrollTop = h * 2.5;
    });
    let left = [];
    const until = Date.now() + 8000;
    do { await p.waitForTimeout(250); left = await blank(); } while (left.length && Date.now() < until);
    console.log(`round ${i + 1}: ${a.name} → ${c.name}: ${left.length ? `pages ${left.join(', ')} still blank` : 'all drawn'}`);
    if (left.length) failures++;
  }
} finally {
  await b.close();
}
if (failures) { console.error(`${failures} rounds left pages blank`); process.exit(1); }
console.log('Switching documents: every page in view drawn.');
process.exit(0);
