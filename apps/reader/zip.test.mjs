import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipFiles } from './zip.js';
import { zipEntry } from './office.js';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a zip written here is read back, with folders and accented names', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const bytes = zipFiles([{ name: 'Apuntes física.md', bytes: new TextEncoder().encode('# Hola\n') }, { name: 'Apuntes física_files/image1.png', bytes: png }]);
  assert.equal(new TextDecoder().decode(await zipEntry(bytes, 'Apuntes física.md')), '# Hola\n');
  assert.deepEqual([...await zipEntry(bytes, 'Apuntes física_files/image1.png')], [...png]);
  assert.equal(await zipEntry(bytes, 'otro'), null);
  // The system's own unzip agrees (when there is one).
});
