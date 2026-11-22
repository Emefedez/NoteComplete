import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fractionalScroller } from './smooth-scroll.js';
import { momentum } from './momentum.js';

// A scroller as Chromium has it: positions set from script round to whole pixels and stop at the edges.
function scroller(max = 1000) {
  let left = 0, top = 0;
  const clamp = (v) => Math.max(0, Math.min(max, Math.round(v)));
  return {
    get scrollLeft() { return left; }, set scrollLeft(v) { left = clamp(v); },
    get scrollTop() { return top; }, set scrollTop(v) { top = clamp(v); },
  };
}
const content = () => ({ style: { transform: '', willChange: '' } });
// Where the content shows: the scroll position less the transform's shift.
const shown = (s, c) => {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\)/.exec(c.style.transform);
  return [s.scrollLeft - (m ? Number(m[1]) : 0), s.scrollTop - (m ? Number(m[2]) : 0)];
};

test('a fractional position shows exactly: whole pixels scroll, the rest is a transform', () => {
  const s = scroller(), c = content(), f = fractionalScroller(s, c);
  f.begin();
  assert.equal(c.style.willChange, 'transform');
  for (const top of [10.25, 10.5, 10.75, 11, 11.4]) {
    f.to(0, top);
    assert.equal(s.scrollTop, Math.round(top));
    const [, y] = shown(s, c);
    assert.ok(Math.abs(y - top) < 1e-9, `${top} shows at ${y}`);
  }
  f.end();
  assert.equal(c.style.transform, '');
  assert.equal(c.style.willChange, '');
});

test('half a pixel a frame advances every frame, not every other one (the 1, 1, 1, 2 stutter)', () => {
  const s = scroller(), c = content(), f = fractionalScroller(s, c);
  let last = 0;
  for (let i = 1; i <= 8; i++) {
    f.by(0, 0.5);
    const [, y] = shown(s, c);
    assert.ok(Math.abs(y - last - 0.5) < 1e-9, `frame ${i} moved ${y - last}`);
    last = y;
  }
});

test('at an edge nothing is shifted and by() reports that it did not move', () => {
  const s = scroller(100), c = content(), f = fractionalScroller(s, c);
  f.to(0, 99.6);
  assert.equal(f.by(0, 5), true);
  assert.equal(s.scrollTop, 100);
  assert.equal(c.style.transform, '');
  assert.equal(f.by(0, 5), false);
});

test('a glide passes fractions with whole: false and says when it ends, also when stopped', () => {
  let t = 0, queued = null, total = 0, ended = 0;
  const run = momentum({ whole: false, apply: (dx, dy) => { total += dy; return true; }, onEnd: () => ended++, frame: (f) => { queued = f; return 1; }, cancel: () => { queued = null; }, now: () => t });
  assert.equal(run.fling(0, 1000), true);
  const steps = [];
  while (queued) { t += 8; const f = queued; queued = null; const before = total; f(); steps.push(total - before); }
  assert.ok(steps.some((d) => d % 1 !== 0), 'fractional steps');
  assert.equal(ended, 1);
  run.fling(0, 1000); t += 8; const f = queued; queued = null; f(); run.stop();
  assert.equal(ended, 2);
});
