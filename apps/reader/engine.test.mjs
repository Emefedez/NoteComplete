import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, RECYCLE_BYTES } from './engine.js';

// A stand-in worker that answers each request on demand.
function fakeWorkers() {
  const made = [];
  const create = () => {
    const w = { posted: [], terminated: false, postMessage(m) { w.posted.push(m); }, terminate() { w.terminated = true; } };
    made.push(w);
    return w;
  };
  return { made, create };
}

test('a reply resolves its request; an error rejects it', async () => {
  const { made, create } = fakeWorkers();
  const engine = new Engine({ create });
  const ok = engine.call({ op: 'view' }), bad = engine.call({ op: 'view' });
  made[0].onmessage({ data: { id: made[0].posted[0].id, result: 7 } });
  made[0].onmessage({ data: { id: made[0].posted[1].id, error: 'no page' } });
  assert.equal(await ok, 7);
  await assert.rejects(bad, /no page/);
  assert.equal(engine.pending.size, 0);
});

test('ready and fatal messages are reported, not treated as replies', () => {
  const { made, create } = fakeWorkers();
  const seen = [];
  new Engine({ create, onReady: () => seen.push('ready'), onFatal: t => seen.push(t) });
  made[0].onmessage({ data: { ready: true } });
  made[0].onmessage({ data: { fatal: 'wasm failed' } });
  assert.deepEqual(seen, ['ready', 'wasm failed']);
});

test('closing a small note frees its session and keeps the worker', async () => {
  const { made, create } = fakeWorkers();
  const engine = new Engine({ create });
  engine.opened(RECYCLE_BYTES - 1);
  assert.equal(engine.release(), false);
  assert.equal(made.length, 1);
  assert.equal(made[0].terminated, false);
  assert.equal(made[0].posted.at(-1).op, 'close');
  assert.equal(engine.size, 0);
  made[0].onmessage({ data: { id: made[0].posted.at(-1).id, result: true } });
  assert.equal(engine.pending.size, 0);
});

test('closing a big note replaces the worker and rejects what it still owed', async () => {
  const { made, create } = fakeWorkers();
  const engine = new Engine({ create });
  engine.opened(RECYCLE_BYTES);
  const late = engine.call({ op: 'view' });
  assert.equal(engine.release(), true);
  assert.equal(made.length, 2);
  assert.equal(made[0].terminated, true);
  assert.equal(engine.worker, made[1]);
  await assert.rejects(late, /Document closed/);
  assert.equal(engine.pending.size, 0);
  // The new worker takes the next request; no 'close' is needed on a fresh one.
  engine.call({ op: 'open' }).catch(() => {});
  assert.equal(made[1].posted[0].op, 'open');
});

test('messages from a replaced worker are ignored', async () => {
  const { made, create } = fakeWorkers();
  const seen = [];
  const engine = new Engine({ create, onReady: () => seen.push('ready'), onError: m => seen.push(m) });
  engine.opened(RECYCLE_BYTES);
  engine.release();
  const next = engine.call({ op: 'view' });
  // A late reply with the same id from the old worker must not settle the new request.
  made[0].onmessage({ data: { id: made[1].posted[0].id, result: 'stale' } });
  made[0].onmessage({ data: { ready: true } });
  made[0].onerror({ message: 'old failure' });
  assert.deepEqual(seen, []);
  made[1].onmessage({ data: { id: made[1].posted[0].id, result: 'fresh' } });
  assert.equal(await next, 'fresh');
});

test('a worker error rejects everything pending and is reported', async () => {
  const { made, create } = fakeWorkers();
  const seen = [];
  const engine = new Engine({ create, onError: m => seen.push(m) });
  const one = engine.call({ op: 'view' });
  made[0].onerror({ message: 'boom' });
  await assert.rejects(one, /boom/);
  assert.deepEqual(seen, ['boom']);
});
