// Browser check of prefabs in the Markdown editor (Chromium): right-click → Insert prefab… and the
// toolbar's Insert prefab put a figure after the line as a pill (the preview draws it), its pill
// menu edits it, the page-only graph is not offered, Open in Euro-Office's conversion turns the
// SVGs into PNGs, and the bar's Open in Euro-Office button answers on the web.
//   node tools/markdown_prefab_e2e.mjs
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';
const server = await startReader({ port: 0 });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
const errors=[]; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', m => { if (m.type()==='error'||m.type()==='warning') errors.push('console: '+m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await openReader(p, server.origin);
  await p.setInputFiles('#file', { name: 'demo.md', mimeType: 'text/markdown', buffer: Buffer.from('# Demo\n\nSome text here.\n\nMore text.\n') });
  await p.waitForSelector('#textView:not([hidden]) #textBody h1');
  await p.click('#textEdit');
  await p.waitForSelector('#textEditor .TinyMDE');
  await sleep(500);
  const titles = await p.$$eval('#textEditor .TMCommandButton', (bs) => bs.map((b) => b.title));
  assert.match(titles.at(-1), /^Insert prefab/);
  // Right-click in the text.
  const line = await p.locator('#textEditor .TinyMDE > div').nth(2).boundingBox();
  await p.mouse.click(line.x + 40, line.y + line.height / 2, { button: 'right' });
  await sleep(500);

  await p.getByRole('menuitem', { name: 'Insert prefab…' }).click();
  await p.waitForSelector('dialog.prefab-picker[open]');
  await p.fill('.prefab-search', 'sticky');
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(1500);
  await p.getByRole('button', { name: 'Insert', exact: true }).last().click();
  await sleep(1500);
  const lines = () => p.$$eval('#textEditor .TinyMDE > div', (ds) => ds.map((d) => (d.dataset.prefab ? `[PREFAB ${d.dataset.prefab}]` : d.textContent.slice(0, 60))));
  assert.deepEqual(await lines(), ['# Demo', '', 'Some text here.', '', '[PREFAB Sticky note]', '', 'More text.', '']);
  // Toolbar button at the end: a UML class diagram.
  await p.locator('#textEditor .TinyMDE > div').last().click();
  await p.click('#textEditor .TMCommandButton[title^="Insert prefab"]');
  await p.waitForSelector('dialog.prefab-picker[open]');
  const ids = await p.$$eval('dialog.prefab-picker .prefab-card', (cs) => cs.map((c) => c.dataset.id));
  assert.ok(!ids.includes('graph') && ids.includes('table') && ids.includes('uml-class'));
  await p.click('dialog.prefab-picker .prefab-card[data-id="uml-class"]');
  await sleep(500);
  const picker = await p.$('dialog.prefab-picker[open]');
  if (picker) { await p.locator('dialog.prefab-picker[open] button.primary:visible').first().click(); }
  await sleep(2500);
  await p.locator('button.primary:visible', { hasText: 'Insert' }).last().click();
  await sleep(2000);
  assert.deepEqual((await lines()).slice(6), ['More text.', '', '[PREFAB UML class diagram]', '']);
  // Right-click the UML pill: its menu.
  await p.locator('#textEditor [data-prefab]').last().click({ button: 'right' });
  await sleep(500);
  const menu = await p.$$eval('[role=menuitem]', (m) => m.map((e) => e.textContent.trim()));
  assert.ok(menu.includes('Edit UML class diagram…') && menu.includes('Delete prefab'));
  await p.keyboard.press('Escape');
  // Preview: images drawn.
  await p.click('#textSplitToggle'); await sleep(1500);
  const imgs = await p.$$eval('#textBody img[src^="data:image/svg+xml"]', (is) => is.map((i) => [i.alt, i.naturalWidth > 0]));
  assert.deepEqual(imgs, [['Sticky note', true], ['UML class diagram', true]]);
  // Euro-Office conversion of the current text, as the button does it.
  const conv = await p.evaluate(async () => {
    const { markdownForOffice, svgUriToPng } = await import('./markdown-prefab.js');
    const text = [...document.querySelectorAll('#textEditor .TinyMDE > div')].map((d) => d.textContent).join('\n');
    const out = await markdownForOffice(text, (u) => svgUriToPng(u));
    const pngs = [...out.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1].length);
    const img = new Image(); img.src = out.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)[0]; await img.decode();
    return { svgLeft: /data:image\/svg/.test(out), pngs, first: [img.naturalWidth, img.naturalHeight] };
  });
  assert.equal(conv.svgLeft, false); assert.equal(conv.pngs.length, 2); assert.deepEqual(conv.first, [512, 512]);
  await p.click('#textOpenOffice', { force: true }); await sleep(800);
  // On the web Euro-Office is never installed: the button says so.
  assert.ok((await p.$$eval('[role=menuitem]', (m) => m.map((e) => e.textContent.trim()))).includes('Euro-Office is not installed'));
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);

  // A new Markdown note, never saved ("Untitled", no extension), goes to Euro-Office as
  // Untitled.md with its text and prefab as PNG, without asking to discard the unsaved edits.
  const q = await b.newPage({ viewport: { width: 1300, height: 850 } });
  q.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  q.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await q.addInitScript(() => {
    window.__officeOpened = [];
    window.notecompleteOffice = {
      status: async () => ({ installed: true, state: 'installed', fontsGenerated: true }),
      open: async ({ bytes, name, mode }) => { window.__officeOpened.push({ name, mode, text: new TextDecoder().decode(bytes) }); throw Error('stub'); },
    };
  });
  await openReader(q, server.origin);
  // New note… numbers its choices; 2 is Markdown note.
  await q.evaluate(() => document.getElementById('newNoteOpen').click());
  await q.waitForSelector('#newNoteMenuDialog[open]');
  const nums = await q.$$eval('#newNoteMenuDialog .export-item[data-num]', (bs) => bs.map((b) => [b.dataset.num, b.id]));
  assert.deepEqual(nums.slice(0, 2), [['1', 'newDocument'], ['2', 'newMarkdownDoc']]);
  await q.keyboard.press('2');
  await q.waitForSelector('#textEditor .TinyMDE');
  await q.click('#textEditor .TinyMDE');
  await q.keyboard.type('# Draft');
  await q.keyboard.press('Enter');
  await q.click('#textEditor .TMCommandButton[title^="Insert prefab"]');
  await q.waitForSelector('dialog.prefab-picker[open]');
  await q.fill('.prefab-search', 'sticky');
  await q.keyboard.press('Enter');
  await q.getByRole('button', { name: 'Insert', exact: true }).last().click();
  await sleep(1200);
  await q.click('#textOpenOffice:visible');
  await q.waitForFunction(() => window.__officeOpened.length > 0, null, { timeout: 15000 });
  const sent = await q.evaluate(() => window.__officeOpened[0]);
  assert.equal(sent.name, 'Untitled.md');
  assert.match(sent.text, /^# Draft/);
  assert.match(sent.text, /!\[Sticky note\]\(data:image\/png;base64,/);
  assert.deepEqual(dialogs, [], 'no discard prompt');
  // A saved file (shown under its name without ".md"): goes as itself, edited text included.
  await q.evaluate(() => { window.__officeOpened.length = 0; });
  await q.setInputFiles('#file', { name: 'saved notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Saved\n\nBody.\n') });
  await q.waitForFunction(() => document.querySelector('#textTitle')?.textContent === 'saved notes');
  await q.click('#textEdit');
  await q.waitForSelector('#textEditor .TinyMDE');
  await q.click('#textOpenOffice:visible');
  await q.waitForFunction(() => window.__officeOpened.length > 0, null, { timeout: 15000 });
  const saved = await q.evaluate(() => window.__officeOpened[0]);
  assert.equal(saved.name, 'saved notes.md');
  assert.match(saved.text, /^# Saved/);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|stub/.test(e)), []);
  console.log('Markdown prefabs end to end: passed.');

} catch (e) { console.error(e); process.exitCode = 1; } finally { await b.close(); process.exit(process.exitCode || 0); }
