import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadQueue } from './download-queue.js';

test('enqueue processes items in order and reports progress', async () => {
  const completed = [];
  const updates = [];

  const fakeClient = {
    download: async (repoId, doc, signal, onProgress) => {
      onProgress(50, 100);
      onProgress(100, 100);
      return new Blob(['fake content'], { type: 'application/pdf' });
    }
  };

  const queue = createDownloadQueue({
    onUpdate: (s) => updates.push(s),
    onItemDone: (item) => completed.push(item.id)
  });

  const count = queue.enqueue([
    { source: 'archive', sourceId: 'repo1', doc: { name: 'file1.pdf', path: '/file1.pdf' }, client: fakeClient },
    { source: 'archive', sourceId: 'repo1', doc: { name: 'file2.pdf', path: '/file2.pdf' }, client: fakeClient }
  ]);

  assert.equal(count, 2);

  // Wait until queue is not busy
  await new Promise(resolve => {
    const check = () => {
      if (!queue.stats().isBusy) resolve();
      else setTimeout(check, 10);
    };
    check();
  });

  const finalStats = queue.stats();
  assert.equal(finalStats.completed, 2);
  assert.equal(finalStats.pending, 0);
  assert.equal(finalStats.errors, 0);
  assert.deepEqual(completed, ['archive:repo1:/file1.pdf', 'archive:repo1:/file2.pdf']);
});

test('duplicate items are not re-enqueued unless errored', async () => {
  const queue = createDownloadQueue();
  const fakeClient = { download: () => new Promise(() => {}) }; // stays pending
  const item = { source: 'drive', id: 'd1', name: 'Note1.noteful', client: fakeClient };

  assert.equal(queue.enqueue(item), 1);
  assert.equal(queue.enqueue(item), 0);
  assert.equal(queue.stats().total, 1);
});

test('cancel aborts active item and clears queue', async () => {
  let aborted = false;
  const slowClient = {
    download: async (doc, signal) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
  };

  const queue = createDownloadQueue();
  queue.enqueue({
    source: 'drive',
    id: 'd_slow',
    name: 'Slow.pdf',
    client: slowClient
  });

  assert.ok(queue.stats().isBusy);
  queue.clear();
  assert.ok(aborted);
  assert.equal(queue.stats().total, 0);
});
