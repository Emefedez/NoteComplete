import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipFiles } from './zip.js';
import {
  archiveFormat, readArchive, extractEntry, archiveTree, safeEntryPath, entryKind, isNotePackageTar,
  looksLikeGoodnotes, notebooksIn, notebookTitle, packFolder, unsupportedMessage,
} from './archive.js';

const enc = new TextEncoder();
const text = (s) => enc.encode(s);
async function deflate(bytes) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(out);
}
async function gzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
// A zip with deflated entries (or stored, `store`), optional flags; `zip64` writes the
// sizes and offsets in zip64 records, as large archives do.
async function makeZip(files, { zip64 = false } = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = text(f.name), data = f.store ? f.bytes : await deflate(f.bytes);
    const crc = f.crc ?? crc32(f.bytes), method = f.store ? 0 : 8, size = f.size ?? f.bytes.length;
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800 | (f.flags || 0), true); l.setUint16(8, method, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, size, true); l.setUint16(26, name.length, true);
    locals.push(new Uint8Array(l.buffer), name, data);
    const extra = zip64 ? new DataView(new ArrayBuffer(28)) : null;
    if (extra) { extra.setUint16(0, 1, true); extra.setUint16(2, 24, true); extra.setBigUint64(4, BigInt(size), true); extra.setBigUint64(12, BigInt(data.length), true); extra.setBigUint64(20, BigInt(offset), true); }
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 0x0314, true); c.setUint16(6, 45, true); c.setUint16(8, 0x800 | (f.flags || 0), true); c.setUint16(10, method, true);
    c.setUint16(12, 0x6000, true); c.setUint16(14, 0x5a21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, zip64 ? 0xffffffff : data.length, true); c.setUint32(24, zip64 ? 0xffffffff : size, true);
    c.setUint16(28, name.length, true); c.setUint16(30, extra ? 28 : 0, true);
    c.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.push(new Uint8Array(c.buffer), name, ...(extra ? [new Uint8Array(extra.buffer)] : []));
    offset += 30 + name.length + data.length;
  }
  const cd = concat(central), tail = [];
  if (zip64) {
    const e = new DataView(new ArrayBuffer(56));
    e.setUint32(0, 0x06064b50, true); e.setBigUint64(4, 44n, true); e.setUint16(12, 45, true); e.setUint16(14, 45, true);
    e.setBigUint64(24, BigInt(files.length), true); e.setBigUint64(32, BigInt(files.length), true);
    e.setBigUint64(40, BigInt(cd.length), true); e.setBigUint64(48, BigInt(offset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true); loc.setBigUint64(8, BigInt(offset + cd.length), true); loc.setUint32(16, 1, true);
    tail.push(new Uint8Array(e.buffer), new Uint8Array(loc.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : files.length, true); end.setUint16(10, zip64 ? 0xffff : files.length, true);
  end.setUint32(12, zip64 ? 0xffffffff : cd.length, true); end.setUint32(16, zip64 ? 0xffffffff : offset, true);
  return concat([...locals, cd, ...tail, new Uint8Array(end.buffer)]);
}
// A ustar tar of { name, bytes } (and { name, dir: true }).
function makeTar(files) {
  const blocks = [];
  for (const f of files) {
    const h = new Uint8Array(512), put = (s, at) => h.set(text(s), at);
    put(f.name, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put((f.dir ? 0 : f.bytes.length).toString(8).padStart(11, '0') + '\0', 124);
    put('14750354125\0', 136); put('        ', 148); h[156] = (f.dir ? '5' : '0').charCodeAt(0);
    put('ustar\0', 257); put('00', 263);
    put(h.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h);
    if (!f.dir) { const data = new Uint8Array(Math.ceil(f.bytes.length / 512) * 512); data.set(f.bytes); blocks.push(data); }
  }
  blocks.push(new Uint8Array(1024));
  return concat(blocks);
}

test('archive formats come from the name; notes, Office files and NoteComplete tars are not archives', () => {
  assert.equal(archiveFormat('a.zip'), 'zip');
  assert.equal(archiveFormat('a.TGZ'), 'tgz');
  assert.equal(archiveFormat('a.tar.gz'), 'tgz');
  assert.equal(archiveFormat('log.gz'), 'gz');
  assert.equal(archiveFormat('a.7z'), '7z');
  assert.equal(archiveFormat('x.rar'), 'rar');
  for (const n of ['a.goodnotes', 'b.docx', 'c.nfedit', 'd.notecomplete', 'e.pdf']) assert.equal(archiveFormat(n), '', n);
  const pkg = makeTar([{ name: 'manifest.json', bytes: text('{}') }, { name: 'note.noteful', bytes: text('x') }]);
  assert.ok(isNotePackageTar(pkg));
  assert.equal(archiveFormat('old.tar', pkg), '');
  assert.equal(archiveFormat('photos.tar', makeTar([{ name: 'a.png', bytes: text('x') }])), 'tar');
  assert.match(unsupportedMessage('7z'), /7-Zip/);
});

test('a zip with stored and deflated entries is listed, checked intact and its entries unpacked', async () => {
  const pdf = text('%PDF-1.4\n' + 'x'.repeat(5000)), note = text('hello '.repeat(300));
  const stored = zipFiles([{ name: 'docs/a.pdf', bytes: pdf }, { name: 'readme.txt', bytes: note }]);
  const deflated = await makeZip([{ name: 'docs/a.pdf', bytes: pdf }, { name: 'docs/sub/b.txt', bytes: note }, { name: 'tool.exe', bytes: text('MZ'), store: true }]);
  for (const bytes of [stored, deflated]) {
    const a = await readArchive(bytes, { name: 't.zip' });
    assert.equal(a.summary.text, `${a.entries.length} files, all intact`);
    assert.ok(a.summary.ok);
    const pdfEntry = a.entries.find((e) => e.path === 'docs/a.pdf');
    assert.equal(pdfEntry.opens, 'pdf');
    assert.deepEqual(await extractEntry(a, pdfEntry), pdf);
  }
  const a = await readArchive(deflated, { name: 't.zip' });
  assert.equal(a.entries.find((e) => e.name === 'tool.exe').opens, '', 'not openable: listed greyed');
  const tree = archiveTree(a.entries);
  assert.deepEqual(tree.children.map((c) => c.name), ['docs', 'tool.exe']);
  assert.deepEqual(tree.children[0].children.map((c) => c.name), ['sub', 'a.pdf']);
  assert.equal(tree.files, 3);
});

test('zip64 records are read', async () => {
  const body = text('zip64 entry '.repeat(100));
  const a = await readArchive(await makeZip([{ name: 'big.txt', bytes: body }, { name: 'x.md', bytes: text('# x') }], { zip64: true }), { name: 'z.zip' });
  assert.ok(a.zip64);
  assert.equal(a.entries.length, 2);
  assert.ok(a.summary.ok, a.summary.text);
  assert.deepEqual(await extractEntry(a, a.entries[0]), body);
});

test('a corrupted entry is reported damaged by its CRC-32, with the others intact', async () => {
  const good = text('fine '.repeat(100)), bad = text('broken data '.repeat(100));
  const bytes = await makeZip([{ name: 'ok.txt', bytes: good }, { name: 'bad.txt', bytes: bad, store: true }]);
  const i = Buffer.from(bytes).indexOf('broken data');
  assert.ok(i > 0);
  bytes[i + 3] ^= 0xff;
  const a = await readArchive(bytes, { name: 'c.zip' });
  assert.equal(a.entries.find((e) => e.name === 'ok.txt').status, 'ok');
  assert.equal(a.entries.find((e) => e.name === 'bad.txt').status, 'damaged');
  assert.equal(a.summary.ok, false);
  assert.match(a.summary.text, /1 damaged: bad\.txt/);
  await assert.rejects(extractEntry(a, a.entries.find((e) => e.name === 'bad.txt')), /CRC/);
  // A deflated entry with a wrong CRC in its header, and a cut-short archive.
  const wrong = await readArchive(await makeZip([{ name: 'w.txt', bytes: good, crc: 1234 }]), { name: 'w.zip' });
  assert.equal(wrong.entries[0].status, 'damaged');
  const cut = await readArchive(bytes.subarray(0, 120), { name: 'cut.zip' });
  assert.equal(cut.summary.ok, false);
  assert.match(cut.summary.problems.join(' '), /index/);
});

test('encrypted entries are marked, not counted as damaged', async () => {
  const a = await readArchive(await makeZip([{ name: 'secret.pdf', bytes: text('xx'), store: true, flags: 1 }, { name: 'open.txt', bytes: text('hi') }]), { name: 'e.zip' });
  const secret = a.entries.find((e) => e.name === 'secret.pdf');
  assert.equal(secret.status, 'encrypted');
  assert.equal(secret.opens, '');
  assert.match(a.summary.text, /1 encrypted/);
  assert.equal(a.summary.broken, false);
});

test('names that point outside the archive are rejected', async () => {
  assert.deepEqual(safeEntryPath('../../etc/passwd'), { path: 'etc/passwd', unsafe: true });
  assert.equal(safeEntryPath('/abs/x.txt').unsafe, true);
  assert.equal(safeEntryPath('C:\\Windows\\x.txt').unsafe, true);
  assert.deepEqual(safeEntryPath('dir\\sub\\ok.txt'), { path: 'dir/sub/ok.txt', unsafe: false });
  const a = await readArchive(await makeZip([{ name: '../evil.txt', bytes: text('x') }, { name: 'fine.txt', bytes: text('y') }]), { name: 'p.zip' });
  const evil = a.entries.find((e) => e.name === 'evil.txt');
  assert.equal(evil.status, 'unsafe');
  assert.equal(evil.opens, '');
  await assert.rejects(extractEntry(a, evil), /outside/);
  assert.match(a.summary.text, /unsafe names/);
});

test('decompression bombs are not unpacked: caps on size, ratio and lying sizes', async () => {
  const zeros = new Uint8Array(4 * 1048576);
  const bytes = await makeZip([{ name: 'zeros.bin', bytes: zeros }]);
  // Too large for the per-entry cap.
  let a = await readArchive(bytes, { name: 'b.zip', limits: { maxEntry: 1048576 } });
  assert.equal(a.entries[0].status, 'refused');
  await assert.rejects(extractEntry(a, a.entries[0], { limits: { maxEntry: 1048576 } }), /more than/);
  // Suspicious expansion.
  a = await readArchive(bytes, { name: 'b.zip', limits: { maxRatio: 100, ratioFloor: 1048576 } });
  assert.equal(a.entries[0].status, 'refused');
  assert.match(a.entries[0].problem, /bomb/);
  // Says it holds 1 KB but expands to 4 MB: stopped at 1 KB, damaged.
  a = await readArchive(await makeZip([{ name: 'liar.bin', bytes: zeros, size: 1024 }]), { name: 'l.zip' });
  assert.equal(a.entries[0].status, 'damaged');
  assert.match(a.entries[0].problem, /stated size/);
  // The whole archive past maxTotal: the rest is not checked.
  a = await readArchive(await makeZip([{ name: '1.bin', bytes: zeros }, { name: '2.bin', bytes: zeros }]), { name: 't.zip', limits: { maxTotal: 5 * 1048576 } });
  assert.equal(a.entries[0].status, 'ok');
  assert.equal(a.entries[1].status, 'unchecked');
});

test('tar, tar.gz and .gz are listed and checked', async () => {
  const files = [{ name: 'notes', dir: true }, { name: 'notes/a.md', bytes: text('# A') }, { name: 'b.txt', bytes: text('bee') }];
  const tar = makeTar(files);
  let a = await readArchive(tar, { name: 'x.tar' });
  assert.equal(a.entries.filter((e) => e.kind === 'file').length, 2);
  assert.match(a.summary.text, /^2 files, all intact/);
  assert.equal(new TextDecoder().decode(await extractEntry(a, a.entries.find((e) => e.name === 'a.md'))), '# A');
  // A damaged header checksum.
  const broken = tar.slice(); broken[512 * 3 + 1] ^= 0x20; // b.txt's header
  a = await readArchive(broken, { name: 'x.tar' });
  assert.equal(a.summary.ok, false);
  assert.ok(a.entries.some((e) => e.status === 'damaged'));
  // tar.gz
  a = await readArchive(await gzip(tar), { name: 'x.tar.gz' });
  assert.equal(a.format, 'tgz');
  assert.ok(a.summary.ok, a.summary.text);
  assert.equal(new TextDecoder().decode(await extractEntry(a, a.entries.find((e) => e.name === 'b.txt'))), 'bee');
  // .gz of one file, and one with its CRC broken.
  const gz = await gzip(text('single file '.repeat(50)));
  a = await readArchive(gz, { name: 'log.txt.gz' });
  assert.equal(a.entries[0].name, 'log.txt');
  assert.equal(a.entries[0].opens, 'text');
  assert.ok(a.summary.ok);
  const bad = gz.slice(); bad[bad.length - 6] ^= 1;
  a = await readArchive(bad, { name: 'log.txt.gz' });
  assert.equal(a.entries[0].status, 'damaged');
});

test('what opens from inside', () => {
  assert.equal(entryKind('x/a.noteful'), 'note');
  assert.equal(entryKind('a.goodnotes'), 'note');
  assert.equal(entryKind('a.PNG'), 'image');
  assert.equal(entryKind('in.zip'), 'archive');
  assert.equal(entryKind('in.7z'), '');
  assert.equal(entryKind('main.c'), 'text');
  assert.equal(entryKind('setup.exe'), '');
});

test('Goodnotes notebooks: a zipped notebook, a pack of them, and one stored as a folder', async () => {
  const notebook = [{ name: 'index.notes.pb', bytes: text('n') }, { name: 'schema.pb', bytes: text('s') }, { name: 'notes/ABC', bytes: text('page') }];
  const one = await readArchive(zipFiles(notebook), { name: 'AM.goodnotes.zip', verify: false });
  assert.ok(looksLikeGoodnotes(one.entries));
  assert.equal(notebookTitle('AM - Apuntes.goodnotes.zip'), 'AM - Apuntes');
  const pack = await readArchive(zipFiles([
    { name: 'Sem 1/Calc.goodnotes', bytes: zipFiles(notebook) },
    { name: 'Sem 2/Alg.goodnotes', bytes: zipFiles(notebook) },
    ...notebook.map((f) => ({ ...f, name: `Sem 2/Loose.goodnotes/${f.name}` })),
    { name: 'more.zip', bytes: zipFiles([]) },
    { name: 'readme.txt', bytes: text('x') },
  ]), { name: 'pack.zip', verify: false });
  assert.equal(looksLikeGoodnotes(pack.entries), false);
  const found = notebooksIn(pack);
  assert.deepEqual(found.map((n) => [n.path, n.kind]), [['more.zip', 'archive'], ['Sem 1/Calc.goodnotes', 'file'], ['Sem 2/Alg.goodnotes', 'file'], ['Sem 2/Loose.goodnotes', 'folder']]);
  const repacked = await readArchive(await packFolder(pack, 'Sem 2/Loose.goodnotes', { zipFiles }), { name: 'Loose.goodnotes', verify: true });
  assert.ok(looksLikeGoodnotes(repacked.entries));
  assert.ok(repacked.summary.ok);
});
