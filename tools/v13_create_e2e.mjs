// Browser check of the v13 .nfedit (a tar archive) across the ways a note is made and saved
// (Chromium, after a web build): File → New (NoteComplete and Noteful) saved and reopened, by
// name and without an extension, with its undo; an older JSON project opened and saved again;
// the .nfedit export with its options dialog; an automatic save (still the JSON form)
// restored; the handwritten-note and PDF-with-tape notes that batch notes, Expand and exams
// make (the engine's composeNoteFile and createPdfNoteWithTapes); and a prefab with its notes
// through Save and reopen.
//   node tools/v13_create_e2e.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader, samplePath } from './e2e_common.mjs';

const FIXTURE = fileURLToPath(new URL('../tests/fixtures/editing-demo.nfedit', import.meta.url));
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
// A one-page PDF (595 × 842 pt) with a line of text, written by hand.
function tinyPdf() {
  const content = 'BT /F1 24 Tf 72 760 Td (Exam page) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
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

  // 1. File → New, both formats: a stroke, Save, the bytes; reopened by name and without an
  // extension, the stroke is there and Undo works.
  await newDocument('V13 Project', 'project');
  const empty = await items();
  await stroke(400);
  await waitItems(empty + 1);
  const projectBytes = await saveNow('V13 Project.nfedit');
  assertV13(projectBytes, 'new project save');
  console.log(`· File → New (NoteComplete) + stroke + Save: a v13 archive (${projectBytes.length} bytes)`);
  for (const name of ['V13 Project.nfedit', 'V13 Project copy']) {
    await openBytes(name, projectBytes);
    await waitItems(empty + 1);
    await undo();
    await waitItems(empty);
    console.log(`· reopened as “${name}”: the stroke is there, and Undo takes it away`);
  }
  await newDocument('V13 Noteful', 'noteful');
  await stroke(400);
  await waitItems(empty + 1);
  const notefulBytes = await saveNow('V13 Noteful.noteful');
  assert.deepEqual([...notefulBytes.subarray(0, 4)], [0xaa, 0xbb, 0xcc, 0xde], 'a Noteful note');
  for (const name of ['V13 Noteful.noteful', 'V13 Noteful copy']) {
    await openBytes(name, notefulBytes);
    await waitItems(empty + 1);
    await stroke(500);
    await waitItems(empty + 2);
    await undo();
    await waitItems(empty + 1);
  }
  console.log('· File → New (Noteful) + stroke + Save: a .noteful that reopens by name and without an extension, with Undo');

  // 2. An older JSON project opens; saved, it is v13; reopened, the page is the same.
  const legacy = readFileSync(FIXTURE);
  assert.ok(legacy.toString('utf8', 0, 40).startsWith('{"format":"noteful-re-project"'), 'the fixture is the JSON form');
  await openBytes('editing-demo.nfedit', legacy);
  await sleep(500);
  const legacyItems = await items();
  assert.ok(legacyItems > 0, 'the old project shows its ink');
  const legacyCanUndo = await p.evaluate(() => !document.getElementById('undo').disabled);
  // Saved unchanged: mark it changed with a stroke and its undo, so Save writes it.
  await stroke(450);
  await waitItems(legacyItems + 1);
  await undo();
  await waitItems(legacyItems);
  const resaved = await saveNow('editing-demo.nfedit');
  const { manifest: legacyManifest } = assertV13(resaved, 'old project saved again');
  await openBytes('editing-demo.nfedit', resaved);
  await sleep(500);
  assert.equal(await items(), legacyItems, 'the same drawn items after save and reopen');
  assert.equal(await p.evaluate(() => !document.getElementById('undo').disabled), legacyCanUndo, 'undo as before');
  console.log(`· an old JSON .nfedit opens; saved, it is v13 (${legacyManifest.history.length} edits); reopened, the same ${legacyItems} items`);

  // 3. File → Export → NoteComplete project: the options dialog, without Markdown notes.
  await p.evaluate(() => document.getElementById('notesToggle').click());
  await p.waitForSelector('#notesEditor .TinyMDE');
  await p.click('#notesEditor .TinyMDE');
  await p.keyboard.type('# Exported notes\n\nKept only when asked.');
  await sleep(600);
  const full = await saveNow('editing-demo.nfedit');
  assert.match(assertV13(full, 'save with notes').manifest.markdown || '', /Exported notes/, 'Save keeps the notes');
  await p.evaluate(() => document.getElementById('exportProject').click());
  await p.waitForSelector('#nfeditExportDialog[open]');
  const md = p.locator('#nfeditExportList input[data-key="include_markdown"]');
  assert.equal(await md.isChecked(), true, 'Markdown notes offered');
  await md.uncheck();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#nfeditExportConfirm')]);
  assert.match(dl.suggestedFilename(), /\.nfedit$/);
  const exported = new Uint8Array(readFileSync(await dl.path()));
  const { manifest: exportedManifest } = assertV13(exported, 'filtered export');
  assert.ok(!exportedManifest.markdown, 'the export leaves the notes out');
  await statusText(/\.nfedit file exported/);
  await openBytes('editing-demo export.nfedit', exported);
  await sleep(500);
  assert.equal(await items(), legacyItems, 'the export opens with the same items');
  await p.evaluate(() => document.getElementById('notesToggle').click());
  console.log('· Export → .nfedit without Markdown notes: a v13 archive, without them, that opens');

  // 4. An automatic save (the JSON form) is restored.
  const sample = readFileSync(samplePath('nota_1linea.noteful'));
  await openBytes('nota_1linea.noteful', sample);
  await sleep(400);
  const before = await items();
  await stroke(400);
  await waitItems(before + 1);
  await p.evaluate(() => dispatchEvent(new Event('pagehide')));
  await sleep(800);
  const slot = await p.evaluate(async () => {
    const store = (await import('./autosave.js')).autosaveStore();
    const list = await store.list();
    const latest = list.sort((a, b) => (b.at || b.saved || 0) - (a.at || a.saved || 0))[0];
    const data = latest && await store.load(latest.id);
    const t = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data?.project ? new TextEncoder().encode(data.project) : data);
    return t.slice(0, 60);
  });
  assert.match(slot, /^\{"format":"noteful-re-project"/, `the slot is the JSON form: ${slot}`);
  await p.evaluate(() => { document.getElementById('status').textContent = ''; });
  await p.setInputFiles('#file', { name: 'nota_1linea.noteful', mimeType: 'application/octet-stream', buffer: sample });
  await p.waitForSelector('#recoverDialog[open]');
  assert.equal(await items(), before, 'the file as saved');
  await p.click('#recoverAuto');
  await waitItems(before + 1);
  assert.equal(await p.evaluate(() => document.getElementById('saveState').classList.contains('dirty')), true, 'recovered, unsaved');
  console.log(`· an automatic save (JSON form) brings the edit back: ${before + 1} items`);

  // 5. The notes batch notes, Expand and exams make: the engine's ops, in a worker of their own.
  const made = await p.evaluate(async (pdf) => {
    const worker = new Worker('./worker.js', { type: 'module' });
    const waiting = new Map();
    let next = 0;
    const ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.ready) return resolve();
        if (data.fatal) return reject(Error(data.fatal));
        const w = waiting.get(data.id);
        if (!w) return;
        waiting.delete(data.id);
        if (data.error) w.reject(Error(data.error)); else w.resolve(data.result);
      };
    });
    await ready;
    const ask = (op, args = {}) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); worker.postMessage({ id, op, page: 0, ...args }); });
    const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
    const asBytes = (x) => (x instanceof Uint8Array ? x : typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(x));
    try {
      const exam = { html: '<!doctype html><title>Exam</title><p>Q1</p>', source: { mode: 'create', exam: { title: 'Exam', sections: [] }, prefs: {} } };
      const composed = await ask('composeNoteFile', { title: 'Composed', markdown: '# Composed note\n\nHandwritten from Markdown.\n\n- one\n- two', options: {} });
      const withExam = await ask('composeNoteFile', { title: 'Solved', markdown: '# Solved\n\nAnswer: 42', options: {}, exam });
      const pdfBytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      const taped = await ask('createPdfNoteWithTapes', { title: 'Exam', sizes: [[595, 842]], pdf: pdfBytes.buffer, tapes: [{ page: 0, x: 60, y: 120, w: 300, h: 40 }], exam });
      const { isProjectArchive, fileKind } = await import('./media-import.js');
      const project = asBytes(composed.project);
      const summary = await ask('extractNoteSummary', { bytes: project.slice().buffer, maxPages: 0 }).then((s) => ({ ok: true, keys: Object.keys(s || {}) }), (e) => ({ ok: false, error: String(e) }));
      return {
        composed: b64(project), pages: composed.pages,
        withExam: b64(asBytes(withExam.project)),
        taped: b64(asBytes(taped)), tapedType: Object.prototype.toString.call(taped),
        archive: isProjectArchive(project), kind: fileKind('Composed', project),
        summary,
      };
    } finally { worker.terminate(); }
  }, tinyPdf().toString('base64'));
  const composed = new Uint8Array(Buffer.from(made.composed, 'base64'));
  assertV13(composed, 'composeNoteFile');
  assert.equal(made.archive, true, 'isProjectArchive on the composed note');
  assert.equal(made.kind, 'project', 'fileKind without an extension');
  const solved = new Uint8Array(Buffer.from(made.withExam, 'base64'));
  assert.ok(assertV13(solved, 'composeNoteFile with exam').manifest.exam?.html, 'the exam travels in the manifest');
  const taped = new Uint8Array(Buffer.from(made.taped, 'base64'));
  const { manifest: tapedManifest } = assertV13(taped, `createPdfNoteWithTapes (${made.tapedType})`);
  assert.ok(tapedManifest.exam?.html, 'the exam travels with the PDF note');
  await openBytes('Composed.nfedit', composed);
  assert.equal(await p.locator('.sheet').count(), made.pages, 'every composed page');
  assert.ok(await items() > 0, 'composed ink on the page');
  await openBytes('Solved.nfedit', solved);
  assert.ok(await items() > 0, 'solved ink on the page');
  await openBytes('Exam.nfedit', taped);
  assert.equal(await p.locator('.sheet').count(), 1);
  assert.ok(await items() >= 1, 'the tape on the PDF page');
  assert.equal(made.summary.ok, true, `extractNoteSummary of a v13 archive (exam sources): ${made.summary.error}`);
  console.log(`· composeNoteFile (${made.pages} pages, with and without exam) and createPdfNoteWithTapes return v13 archives that open`);

  // 7 (here, on the page that has had notes open). A new note's first save is a copy of its
  // own: it must not go over the note opened before it (the last one here, Exam.nfedit).
  const examCopy = await savedCopy('Exam.nfedit', false).catch(() => null);
  assert.ok(examCopy, 'Exam.nfedit is kept in NoteComplete');
  await newDocument('V13 After', 'project');
  const blank = await items();
  await stroke(400);
  await waitItems(blank + 1);
  await p.evaluate(() => { document.getElementById('status').textContent = ''; });
  await p.keyboard.press('Control+s');
  await statusText(/^Saved /);
  const newSave = await p.textContent('#status');
  const examAfter = await savedCopy('Exam.nfedit', false).catch(() => null);
  const overwrote = !/Saved V13 After\.nfedit/.test(newSave) || (examCopy && (!examAfter || Buffer.compare(Buffer.from(examCopy), Buffer.from(examAfter)) !== 0));
  if (overwrote) failures.push(`File → New after opening Exam.nfedit: Ctrl S said “${newSave}”; the earlier note's kept copy ${examAfter ? 'was overwritten by the new note' : 'is gone'}`);
  else console.log('· a new note saved after another was open gets its own copy in NoteComplete');

  // 6. A prefab with its notes survives Save → reopen of the v13 file (a fresh page, so the
  // first save of the new note is its own whatever check 7 found).
  await p.close();
  await freshPage();
  await newDocument('V13 Prefab', 'project');
  const none = await items();
  await p.evaluate(() => document.getElementById('insertGraph').click());
  await p.waitForSelector('.prefab-grid');
  await p.click('.prefab-card:has-text("Process states")');
  await p.waitForSelector('.chart-dialog .ch-notes-fold');
  if (!(await p.locator('.chart-dialog .fig-notes-editor .TinyMDE, .chart-dialog .fig-notes-plain').isVisible().catch(() => false))) await p.click('.chart-dialog .ch-notes-fold');
  await p.waitForSelector('.chart-dialog :is(.fig-notes-editor .TinyMDE, .fig-notes-plain)');
  await p.click('.chart-dialog :is(.fig-notes-editor .TinyMDE, .fig-notes-plain)');
  await p.keyboard.type('Process A blocks on input.');
  await sleep(300);
  await p.click('.chart-dialog button.primary');
  await p.waitForFunction(() => !document.querySelector('.chart-dialog'));
  await p.waitForFunction((n) => document.querySelectorAll('.sheet[data-page="0"] .render [data-item]').length > n, none);
  await sleep(400);
  const placed = await items();
  const prefabBytes = await saveNow('V13 Prefab.nfedit');
  const prefabManifest = JSON.stringify(assertV13(prefabBytes, 'prefab save').manifest);
  assert.ok(prefabManifest.includes('Process A blocks on input.'), 'the figure’s notes are in the saved project');
  await openBytes('V13 Prefab.nfedit', prefabBytes);
  await waitItems(placed);
  const img = await p.locator('.sheet[data-page="0"] .render [data-item^="image:"]').first().boundingBox();
  await p.mouse.click(img.x + img.width / 2, img.y + img.height / 2, { button: 'right' });
  await p.waitForSelector('.context-menu');
  const entries = await p.locator('.context-menu button span').allTextContents();
  const edit = entries.find((e) => /^Edit /.test(e) && /…$/.test(e));
  assert.ok(edit, `still an editable figure: ${entries}`);
  await p.click(`.context-menu button:has-text("${edit}")`);
  await p.waitForSelector('.chart-dialog');
  await p.click('.chart-dialog button:has-text("JSON")');
  const json = JSON.parse(await p.inputValue('.chart-dialog .ch-json'));
  assert.equal(json.notes, 'Process A blocks on input.', `its notes: ${JSON.stringify(json.notes)}`);
  await p.keyboard.press('Escape');
  console.log(`· Insert prefab → Process states with notes: after Save and reopen, “${edit}” has its notes`);

  assert.deepEqual(errors, []);
  if (failures.length) throw Error(`${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);
  console.log('v13 create e2e: ok');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await b.close().catch(() => {});
  await server.close?.();
  process.exit(process.exitCode || 0);
}
