import test from 'node:test';
import assert from 'node:assert/strict';
import { sentKind, recentTargets } from './send-in.js';

const enc = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
test('sent files go where their kind belongs', () => {
  assert.equal(sentKind({ name: 'cat.gif', type: 'image/gif' }), 'picture');
  assert.equal(sentKind({ name: 'IMG_1.HEIC', type: '' }), 'picture');
  assert.equal(sentKind({ name: 'download', type: '' }, enc('GIF89a')), 'picture');
  assert.equal(sentKind({ name: 'logo.svg', type: 'image/svg+xml' }), null);
  assert.equal(sentKind({ name: 'paper.pdf', type: '' }), 'pdf');
  assert.equal(sentKind({ name: 'download', type: '' }, enc('%PDF-1.7')), 'pdf');
  assert.equal(sentKind({ name: 'page.html', type: 'text/html' }), 'html');
  assert.equal(sentKind({ name: 'Tema.docx', type: '' }), 'office');
  assert.equal(sentKind({ name: 'notes.md', type: '' }), 'text');
  assert.equal(sentKind({ name: 'main.rs', type: '' }), 'text');
  assert.equal(sentKind({ name: 'setup.exe', type: 'application/octet-stream' }), null);
});
test('only notebooks on this computer are offered from Recent', () => {
  assert.deepEqual(recentTargets([
    { source: 'local', path: '/n/Memoria 1.noteful', name: 'Memoria 1.noteful', title: 'Memoria' },
    { source: 'local', path: '/n/Tema.pdf', name: 'Tema.pdf' },
    { source: 'local', path: '/n/a.md', name: 'a.md' },
    { source: 'drive', name: 'Drive.noteful' },
  ]), [{ path: '/n/Memoria 1.noteful', title: 'Memoria' }, { path: '/n/Tema.pdf', title: 'Tema' }]);
});
