import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingMime, extensionOf, mergeAdded, packAdded, addedAudio, recordingTitle } from './recorder.js';

test('records in the first format the engine supports', () => {
  assert.equal(recordingMime(t => t === 'audio/mp4'), 'audio/mp4');
  assert.equal(recordingMime(t => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(recordingMime(() => false), '');
});

test('file extensions come from the name, else the type', () => {
  assert.equal(extensionOf('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionOf('audio/mp4'), 'm4a');
  assert.equal(extensionOf('', 'Lecture.MP3'), 'mp3');
  assert.equal(extensionOf('application/x-thing'), 'audio');
});

test('recordings from a .notecomp are added once', () => {
  const kept = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(mergeAdded(kept, [{ id: 'b' }, { id: 'c' }, {}]).map(a => a.id), ['a', 'b', 'c']);
});

test('packs bytes one after another with a matching layout', async () => {
  const list = [
    { id: 'a', name: 'One', mime: 'audio/webm', created: 1, blob: new Blob([new Uint8Array([1, 2, 3])]) },
    { id: 'b', name: 'Two', mime: 'audio/mp4', created: 2, blob: new Blob([new Uint8Array([4, 5])]) },
  ];
  const { audioData, audioLayout } = await packAdded(list);
  assert.deepEqual([...audioData], [1, 2, 3, 4, 5]);
  assert.deepEqual(JSON.parse(audioLayout).map(a => [a.id, a.length]), [['a', 3], ['b', 2]]);
});

test('imported and removed audio is kept per note', async () => {
  const stores = new Map(), changes = [];
  const store = { get: async (_s, k) => stores.get(k), set: async (_s, k, v) => { stores.set(k, v); } };
  const added = addedAudio({ store, now: () => 1_700_000_000_000 });
  added.onchange = list => changes.push(list.length);
  assert.deepEqual(await added.load('fp1'), []);
  const file = new File([new Uint8Array(10)], 'Clase 3.m4a', { type: 'audio/mp4' });
  const a = await added.import(file);
  assert.equal(a.name, 'Clase 3');
  assert.equal(a.mime, 'audio/mp4');
  assert.equal(stores.get('recordings:fp1').length, 1);
  await added.load('fp2');
  assert.equal(added.list.length, 0);
  await added.load('fp1', [{ id: 'x', name: 'From file', mime: 'audio/webm', created: 5, blob: new Blob([]) }]);
  assert.deepEqual(added.list.map(r => r.name), ['Clase 3', 'From file']);
  await added.remove(a.id);
  assert.deepEqual(added.list.map(r => r.id), ['x']);
  assert.deepEqual(changes, [1, 2, 1]);
  assert.match(recordingTitle(1_700_000_000_000), /^Recording · /);
});

test('says when the device cannot record', async () => {
  const added = addedAudio({ store: { get: async () => null, set: async () => {} } });
  await assert.rejects(added.start(), /cannot record/);
});
