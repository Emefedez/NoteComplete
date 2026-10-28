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
