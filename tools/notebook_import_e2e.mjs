// Browser check of Goodnotes and Notability notebooks (Chromium, after a web build): each
// fixture in tests/fixtures/import opens as a note through the importer module (pkg/import),
// takes ink and a prefab, saves as a v13 .nfedit that keeps the notebook as its origin, and
// reopens with its undo.
//   node tools/notebook_import_e2e.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (bytes, from, to) => Buffer.from(bytes.subarray(from, to)).toString('latin1');

// The members of a tar, in order: name and bytes.
function tarMembers(bytes) {
  const out = [];
  for (let at = 0; at + 512 <= bytes.length;) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = text(header, 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(text(header, 124, 136).replace(/\0.*$/s, '').trim() || '0', 8);
    out.push({ name, bytes: bytes.subarray(at + 512, at + 512 + size) });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
// A v13 project archive: ustar, manifest.json first, format notecomplete-project, version 13,
// and its note as a member. Returns the manifest and the member names.
function assertV13(bytes, label) {
  assert.ok(bytes.length > 1024, `${label}: ${bytes.length} bytes`);
  assert.equal(text(bytes, 257, 262), 'ustar', `${label}: not a tar (starts ${JSON.stringify(text(bytes, 0, 40))})`);
  const members = tarMembers(bytes);
  assert.equal(members[0]?.name, 'manifest.json', `${label}: first member ${members[0]?.name}`);
  const raw = Buffer.from(members[0].bytes).toString('utf8');
  assert.ok(raw.startsWith('{"format":"notecomplete-project"'), `${label}: manifest starts ${raw.slice(0, 60)}`);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.version, 13, `${label}: version ${manifest.version}`);
  assert.ok(!manifest.source_base64, `${label}: the note is a member, not Base64`);
  const names = members.map((m) => m.name);
  assert.ok(names.includes('note.noteful'), `${label}: members ${names}`);
  const note = members.find((m) => m.name === 'note.noteful').bytes;
  assert.deepEqual([...note.subarray(0, 4)], [0xaa, 0xbb, 0xcc, 0xde], `${label}: note.noteful is a Noteful archive`);
  return { manifest, names };
}
const server = await startReader({ port: 0 });
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const errors = [];
// Checks that fail without stopping the rest: reported together at the end.
const failures = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  ctx.setDefaultTimeout(20000);
  // The page the helpers below act on (check 6 starts a fresh one).
  let p;
  const freshPage = async () => {
    p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await openReader(p, server.origin);
  };
  await freshPage();

  const ITEMS = '.sheet[data-page="0"] .render [data-item]';
  const items = () => p.locator(ITEMS).count();
  const waitItems = (n) => p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n, [ITEMS, n])
    .catch(async (e) => { throw Error(`${e.message}\nwanted ${n} items, have ${await items()}; status: ${await p.textContent('#status')}`); });
  const statusText = (re) => p.waitForFunction((source) => new RegExp(source).test(document.getElementById('status').textContent), re.source)
    .catch(async (e) => { throw Error(`${e.message}\nwanted ${re}; status: ${await p.textContent('#status')}`); });
  const keepFile = async () => {
    // A newer automatic save of the same note asks first: keep the file.
    await sleep(300);
    if (await p.locator('#recoverDialog[open]').count()) await p.click('#recoverManual');
  };
  // Open bytes as a file of this name; waits until the app says it opened.
  const openBytes = async (name, bytes) => {
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await statusText(/Document opened|Could not open/);
    const said = await p.textContent('#status');
    assert.ok(!/Could not open/.test(said), `${name}: ${said}`);
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await keepFile();
  };
  const stroke = async (y) => {
    await p.evaluate(() => document.querySelector('[data-tool=draw]').click());
    const s = await p.locator('.sheet').first().boundingBox();
    await p.mouse.move(s.x + 100, s.y + y); await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(s.x + 100 + i * 15, s.y + y + 20);
    await p.mouse.up();
  };
  const undo = () => p.evaluate(() => document.getElementById('undo').click());
  // What a save kept in NoteComplete (the web's save target: no file of its own, no picker),
  // read back from the library as stored.
  const savedCopy = (name, edited = true) => p.evaluate(async ([name, edited]) => {
    const { Library } = await import('./library.js');
    const lib = new Library();
    const entries = (await lib.store.values('entries')).filter((e) => e.source === 'imported' && e.name === name && (e.edited || !edited));
    entries.sort((a, b) => b.openedAt - a.openedAt);
    if (!entries.length) throw Error(`No saved copy named ${name}`);
    const blob = await (await lib.location()).read(entries[0].filename);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [name, edited]).then((b64) => new Uint8Array(Buffer.from(b64, 'base64')));
  const saveNow = async (name) => {
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.keyboard.press('Control+s');
    await statusText(new RegExp(`Saved ${name.replace(/[.()]/g, '\\$&')}`));
    await p.waitForFunction(() => !document.getElementById('saveState').classList.contains('dirty'));
    return savedCopy(name);
  };
  const newDocument = async (title, format) => {
    await p.evaluate(() => document.getElementById('newDocument').click());
    await p.fill('#newName', title);
    await p.check(`[name="newFormat"][value="${format}"]`);
    await p.click('#newCreate');
    await p.waitForFunction((t) => document.getElementById('title').textContent === t, title)
      .catch(async (e) => { throw Error(`${e.message}\nFile → New “${title}” did not open; title ${await p.textContent('#title')}; status: ${await p.textContent('#status')}`); });
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await sleep(300);
  };

  // Every notebook fixture: it opens as a note (with its PDF pages), takes ink, a text box and
  // a prefab, saves as a v13 .nfedit that keeps the notebook, and reopens with its undo.
  const notebookOpened = async (name, bytes) => {
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await statusText(/notebook opened as a note|Could not open/);
    const said = await p.textContent('#status');
    assert.ok(!/Could not open/.test(said), `${name}: ${said}`);
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await keepFile();
    return said;
  };
  for (const [file, format, pages] of [
    ['goodnotes-basic.goodnotes', 'goodnotes', 2],
    ['goodnotes-pdf.goodnotes', 'goodnotes', 2],
    ['notability-basic.ntb', 'notability', 2],
    ['notability-pdf.ntb', 'notability', 1],
  ]) {
    const bytes = readFileSync(fileURLToPath(new URL(`../tests/fixtures/import/${file}`, import.meta.url)));
    const said = await notebookOpened(file, bytes);
    assert.match(said, format === 'goodnotes' ? /^Goodnotes/ : /^Notability/);
    assert.equal(await p.locator('.sheet').count(), pages, `${file}: pages`);
    await sleep(500);
    const before = await items();
    assert.ok(before > 0, `${file}: the notebook's ink is on the page`);
    // A notebook PDF (or its paper) is drawn behind the page.
    if (/pdf|notability/.test(file)) await p.waitForSelector('.sheet[data-page="0"] canvas, .sheet[data-page="0"] .pdf-layer, .sheet[data-page="0"] img', { state: 'attached' });
    await stroke(300);
    await waitItems(before + 1);
    // A prefab on the imported page.
    await p.evaluate(() => document.getElementById('insertGraph').click());
    await p.waitForSelector('.prefab-grid');
    await p.click('.prefab-card:has(strong:text-is("Process states"))');
    await p.waitForSelector('.chart-dialog button.primary');
    await p.click('.chart-dialog button.primary');
    await p.waitForFunction(() => !document.querySelector('.chart-dialog'));
    await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item]').length > n, before + 1);
    await sleep(400);
    const edited = await items();
    const saved = await saveNow(file.replace(/\.[^.]+$/, '.nfedit'));
    const { manifest, names } = assertV13(saved, `${file} saved`);
    assert.equal(manifest.origin?.format, format, `${file}: origin ${JSON.stringify(manifest.origin)}`);
    assert.equal(manifest.origin?.name, file);
    assert.ok(names.includes('origin'), `${file}: the notebook is kept (${names})`);
    const origin = tarMembers(saved).find((m) => m.name === 'origin').bytes;
    assert.equal(Buffer.compare(Buffer.from(origin), bytes), 0, `${file}: the notebook unchanged`);
    await openBytes(file.replace(/\.[^.]+$/, '.nfedit'), saved);
    await waitItems(edited);
    await undo();
    await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item]').length < n, edited);
    await undo();
    await waitItems(before);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${file}.png` });
    console.log(`· ${file}: opened as a note (${before} items), ink and a prefab added, saved as v13 with the notebook kept, reopened with undo`);
  }

  // Recent covers: a notebook (and a zipped one, as Goodnotes exports them) gets its first
  // page as its cover once it is open (its own thumbnail stands in before), kept after a restart.
  const coverOf = (name) => p.evaluate(async (name) => {
    const { Library } = await import('./library.js');
    const lib = new Library();
    const entry = (await lib.store.values('entries')).filter((e) => e.name === name).sort((a, b) => b.openedAt - a.openedAt)[0];
    return entry ? String((await lib.cover(entry.key)) || '') : 'no entry';
  }, name);
  const firstPageCover = async (name) => {
    for (let i = 0; i < 100; i++) {
      const url = await coverOf(name);
      if (url.startsWith('data:image/jpeg;base64,')) return url;
      await sleep(100);
    }
    throw Error(`${name}: cover ${(await coverOf(name)).slice(0, 60)}`);
  };
  const covered = [['goodnotes-basic.goodnotes', 'Lecture 5.goodnotes.zip'], ['goodnotes-pdf.goodnotes', 'Worksheet.goodnotes'], ['notability-basic.ntb', 'Biology.ntb']];
  for (const [fixture, name] of covered) {
    const bytes = readFileSync(fileURLToPath(new URL(`../tests/fixtures/import/${fixture}`, import.meta.url)));
    await p.evaluate(() => { document.getElementById('status').textContent = ''; });
    await p.setInputFiles('#file', { name, mimeType: 'application/octet-stream', buffer: bytes });
    await p.waitForFunction((t) => document.getElementById('title').textContent.startsWith(t), name.replace(/\..*$/, ''));
    await p.waitForSelector('.sheet[data-page="0"] .render');
    await keepFile();
    await firstPageCover(name);
  }
  await freshPage();
  await p.waitForFunction(() => document.querySelectorAll('#recentList .note-card').length > 0);
  for (const title of ['Lecture 5', 'Worksheet', 'Biology']) {
    const card = p.locator('#recentList .note-card', { has: p.locator('strong', { hasText: new RegExp(`^${title}`) }) }).first();
    await p.waitForFunction((el) => el?.getAttribute('src')?.startsWith('data:image/jpeg') && !el.classList.contains('missing'), await card.locator('img.note-cover').elementHandle())
      .catch(async (e) => { throw Error(`${title}: card cover ${await card.locator('img.note-cover').getAttribute('src')} (${e.message})`); });
  }
  console.log('· notebook covers: the first page, for .goodnotes, .ntb and .goodnotes.zip, after a restart too');

  assert.deepEqual(errors, []);
  console.log('notebook import e2e: ok');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close().catch(() => {});
  await server.close?.();
  process.exit(process.exitCode || 0);
}
