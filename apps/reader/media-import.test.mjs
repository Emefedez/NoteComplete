import test from 'node:test';
import assert from 'node:assert/strict';
import {fileKind,imageBounds} from './media-import.js';
const bytes=value=>new TextEncoder().encode(value);
test('imports identify content even when a provider hides the filename',()=>{
 assert.equal(fileKind('opaque',bytes('%PDF-1.7')),'pdf');
 assert.equal(fileKind('opaque',new Uint8Array([0x89,0x50,0x4e,0x47])),'image');
 assert.equal(fileKind('wrong.pdf',new Uint8Array([0xaa,0xbb,0xcc,0xde])),'note');
 assert.equal(fileKind('opaque',bytes(' {"format":"noteful-re-project"}')),'project');
 assert.throws(()=>fileKind('looks-like-a.pdf',bytes('<html>not a PDF')));
 assert.throws(()=>fileKind('image.svg',bytes('<svg onload="bad()"/>')));
});
test('Goodnotes and Notability notebooks are imported, by name or as an unnamed zip',()=>{
 const zip=new Uint8Array([0x50,0x4b,3,4,0,0]);
 assert.equal(fileKind('Lecture.goodnotes',zip),'notebook');
 assert.equal(fileKind('Biology.NTB',zip),'notebook');
 assert.equal(fileKind('shared-file',zip),'notebook');
 assert.throws(()=>fileKind('archive.zip',zip));
});
test('files only the Office suite module opens say so; others keep the usual message',()=>{
 const zip=new Uint8Array([0x50,0x4b,3,4,0,0]);
 for(const name of ['Show.ppsx','Plan.xltx','Scan.djvu','Flow.vsdx','Deck.potx'])assert.throws(()=>fileKind(name,zip),/Office suite \(Euro-Office\).*Modules/,name);
 assert.throws(()=>fileKind('archive.zip',zip),/Choose a Noteful note/);
 assert.equal(fileKind('Report.docx',zip),'office');
});
test('imported images preserve aspect ratio, fit the page and never upscale',()=>{
 assert.deepEqual(imageBounds([1200,600],[600,800]),[60,280,480,240]);
 assert.deepEqual(imageBounds([100,50],[600,800]),[250,375,100,50]);
});

test('text and Markdown files open as text documents', async () => {
  const { fileKind, prepareDocument } = await import('./media-import.js');
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(fileKind('notes.txt', enc('hello')), 'text');
  assert.equal(fileKind('tema.md', enc('# Tema')), 'text');
  assert.equal(fileKind('tema.MARKDOWN', enc('{"looks":"like json"}')), 'text');
  const doc = await prepareDocument(new File(['# Tema 1\n$E=mc^2$'], 'Tema 1.md'));
  assert.equal(doc.kind, 'text');
  assert.equal(doc.title, 'Tema 1');
  assert.equal(doc.text, '# Tema 1\n$E=mc^2$');
});

test('files without an extension open as text when their content is text', async () => {
  const { fileKind, prepareDocument } = await import('./media-import.js');
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(fileKind('ciudades', enc('Madrid 3300000\nBarcelona 1600000\n')), 'text');
  assert.equal(fileKind('Makefile', enc('all:\n\tcc main.c')), 'text');
  assert.equal(fileKind('script.py', enc('{"not": "a project"}')), 'text');
  assert.throws(() => fileKind('programa', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2])));
  const latin = await prepareDocument(new File([new Uint8Array([0x41, 0xf1, 0x6f])], 'notas'));
  assert.equal(latin.text, 'Año');
  assert.equal(latin.title, 'notas');
});
test('GIF, WebP and animated PNG keep their own bytes; HEIC photos open as images', async () => {
  const { pictureFormat } = await import('./media-import.js');
  const enc = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const chunk = (type, length = 0) => enc(String.fromCharCode(0, 0, 0, length) + type + '\0'.repeat(length + 4));
  const png = (...chunks) => new Uint8Array([...enc('\x89PNG\r\n\x1a\n'), ...chunks.flatMap((c) => [...c])]);
  assert.equal(pictureFormat(enc('GIF89a\x01\0\x01\0')), 'gif');
  assert.equal(pictureFormat(enc('RIFF\x10\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(pictureFormat(png(chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT', 2))), 'apng');
  assert.equal(pictureFormat(png(chunk('IHDR', 13), chunk('IDAT', 2), chunk('acTL', 8))), null);
  const heic = enc('\0\0\0\x18ftypheic\0\0\0\0mif1heic');
  assert.equal(pictureFormat(heic), 'heic');
  assert.equal(fileKind('IMG_0001.HEIC', heic), 'image');
  assert.equal(fileKind('opaque', enc('\0\0\0\x18ftypmif1\0\0\0\0heic')), 'image');
  // M4A audio is an ftyp file too: never a picture.
  assert.equal(pictureFormat(enc('\0\0\0\x20ftypM4A \0\0\0\0')), null);
  assert.equal(fileKind('photo.jfif', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image');
});
