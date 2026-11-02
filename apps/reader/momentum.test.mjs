import test from 'node:test';
import assert from 'node:assert/strict';
import { project, travelled, VelocityTracker, momentum } from './momentum.js';

test('a release projects where Apple scroll deceleration comes to rest', () => {
  assert.equal(Math.round(project(1000)), 499);
  assert.equal(project(0), 0);
  assert.ok(Math.abs(travelled(2000, 1e6) - project(2000)) < 1e-6);
  assert.ok(travelled(2000, 100) < project(2000));
});

test('velocity counts only the last 100 ms, so a paused drag does not fling', () => {
  const v = new VelocityTracker();
  v.add(0, 0, 0); v.add(0, 50, 50); v.add(0, 100, 100);
  assert.equal(v.velocity().vy, 1000);
  assert.deepEqual(v.velocity(400), { vx: 0, vy: 0 });
});

test('a fling glides to its projection and stops at an edge', () => {
  let t = 0, queued = null, total = 0;
  const m = momentum({ apply: (dx, dy) => { total += dy; return true; }, frame: (f) => { queued = f; return 1; }, cancel: () => { queued = null; }, now: () => t });
  assert.equal(m.fling(0, 30), false);
  assert.ok(m.fling(0, 1500));
  while (queued) { const f = queued; queued = null; t += 16; f(); }
  assert.ok(Math.abs(total - project(1500)) < 10);
  let calls = 0;
  const edge = momentum({ apply: () => (++calls, false), frame: (f) => { queued = f; return 1; }, cancel: () => {}, now: () => t });
  edge.fling(0, 1500);
  while (queued) { const f = queued; queued = null; t += 16; f(); }
  assert.equal(calls, 1);
});
