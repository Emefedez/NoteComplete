import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readerPermissionAllowed } from './permissions.js';

const HOME = 'notecomplete://reader/';

test('readerPermissionAllowed permits camera and microphone media only for the reader origin', () => {
  assert.equal(readerPermissionAllowed(HOME, 'media', `${HOME}index.html`, ['video']), true);
  assert.equal(readerPermissionAllowed(HOME, 'media', `${HOME}index.html`, ['audio']), true);
  assert.equal(readerPermissionAllowed(HOME, 'media', `${HOME}index.html`, ['audio', 'video']), true);
  assert.equal(readerPermissionAllowed(HOME, 'media', 'notecomplete://reader', ['video']), true);
  assert.equal(readerPermissionAllowed(HOME, 'media', 'notecomplete://reader', ['unknown']), true);
  assert.equal(readerPermissionAllowed(HOME, 'media', 'notecomplete://reader', []), true);
  assert.equal(readerPermissionAllowed(HOME, 'clipboard-sanitized-write', HOME, []), true);
});

test('readerPermissionAllowed rejects unsupported media types, other permissions, and untrusted origins', () => {
  assert.equal(readerPermissionAllowed(HOME, 'media', `${HOME}index.html`, ['screen']), false);
  assert.equal(readerPermissionAllowed(HOME, 'display-capture', `${HOME}index.html`, ['video']), false);
  assert.equal(readerPermissionAllowed(HOME, 'geolocation', `${HOME}index.html`, []), false);
  assert.equal(readerPermissionAllowed(HOME, 'media', 'https://example.com/', ['video']), false);
  assert.equal(readerPermissionAllowed(HOME, 'media', 'notecomplete://reader.evil/', ['video']), false);
  assert.equal(readerPermissionAllowed(HOME, 'media', '', ['video']), false);
});
