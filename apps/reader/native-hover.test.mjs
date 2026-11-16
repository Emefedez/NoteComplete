import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHoverBridge } from './native-hover.js';

function fakeDom() {
  const dispatched = [];
  const winListeners = new Map();
  const makeTarget = (name) => ({
    name,
    dispatchEvent(ev) {
      dispatched.push({ target: name, type: ev.type, clientX: ev.clientX, clientY: ev.clientY, buttons: ev.buttons, pointerType: ev.pointerType, relatedTarget: ev.relatedTarget?.name ?? null });
      return true;
    },
  });
  const sheet = makeTarget('sheet');
  const button = makeTarget('button');
  let hit = sheet;
  class FakePointerEvent {
    constructor(type, init = {}) {
      Object.assign(this, { type, ...init });
    }
  }
  const win = {
    addEventListener(type, fn) { winListeners.set(type, fn); },
    removeEventListener(type, fn) { if (winListeners.get(type) === fn) winListeners.delete(type); },
    triggerTrusted(ev) { winListeners.get(ev.type)?.(ev); },
  };
  const doc = {
    body: sheet,
    elementFromPoint: () => hit,
  };
  return {
    dispatched,
    sheet,
    button,
    setHit: (next) => { hit = next; },
    win,
    doc,
    PointerEvent: FakePointerEvent,
  };
}

test('native hover bridge emits pointerover, pointermove, and pointerout with pen semantics', () => {
  const dom = fakeDom();
  const globalObj = { PointerEvent: dom.PointerEvent };
  let clock = 1000;
  const cleanup = installNativeHoverBridge({ globalObj, win: dom.win, doc: dom.doc, now: () => clock });

  assert.equal(typeof globalObj.__notecompleteNativeHover, 'function');
  assert.equal(globalObj.__notecompleteNativeHover('enter', 120, 240, 'pen', 4.5), true);
  assert.deepEqual(dom.dispatched.map((d) => [d.target, d.type, d.pointerType, d.buttons]), [
    ['sheet', 'pointerover', 'pen', 0],
    ['sheet', 'pointermove', 'pen', 0],
  ]);

  // Moving onto another element emits pointerout on the previous target then pointerover + move.
  dom.dispatched.length = 0;
  dom.setHit(dom.button);
  assert.equal(globalObj.__notecompleteNativeHover('move', 150, 260, 'pen'), true);
  assert.deepEqual(dom.dispatched.map((d) => [d.target, d.type, d.relatedTarget]), [
    ['sheet', 'pointerout', 'button'],
    ['button', 'pointerover', 'sheet'],
    ['button', 'pointermove', null],
  ]);

  // Exit clears hover target with pointerout.
  dom.dispatched.length = 0;
  assert.equal(globalObj.__notecompleteNativeHover('exit', 150, 260, 'pen'), true);
  assert.deepEqual(dom.dispatched.map((d) => [d.target, d.type, d.relatedTarget]), [
    ['button', 'pointerout', null],
  ]);

  // Dedupes move events when Chromium already emitted a trusted DOM hover within 120ms.
  dom.dispatched.length = 0;
  dom.win.triggerTrusted({ type: 'pointermove', isTrusted: true, pointerType: 'pen', buttons: 0 });
  clock += 40;
  assert.equal(globalObj.__notecompleteNativeHover('move', 160, 270, 'pen'), false);
  assert.equal(dom.dispatched.length, 0);

  clock += 200;
  assert.equal(globalObj.__notecompleteNativeHover('move', 160, 270, 'pen'), true);
  assert.equal(dom.dispatched.length, 2); // pointerover (after exit cleared hoverTarget) + pointermove

  // Stale native hover events arriving while the pen is touching down are suppressed so
  // they cannot clear contact state before pointerup.
  dom.dispatched.length = 0;
  dom.win.triggerTrusted({ type: 'pointerdown', isTrusted: true, pointerType: 'pen', buttons: 1 });
  assert.equal(globalObj.__notecompleteNativeHover('move', 165, 275, 'pen'), false);
  assert.equal(globalObj.__notecompleteNativeHover('exit', 165, 275, 'pen'), false);
  assert.equal(dom.dispatched.length, 0);

  dom.win.triggerTrusted({ type: 'pointerup', isTrusted: true, pointerType: 'pen', buttons: 0 });
  assert.equal(globalObj.__notecompleteNativeHover('enter', 170, 280, 'pen'), true);
  assert.equal(dom.dispatched.length, 2);

  cleanup();
  assert.equal(globalObj.__notecompleteNativeHover, undefined);
});

test('leaving hover range is reported even when the browser\'s own hover events were used', () => {
  const dom = fakeDom();
  const globalObj = { PointerEvent: dom.PointerEvent };
  let clock = 1000;
  installNativeHoverBridge({ globalObj, win: dom.win, doc: dom.doc, now: () => clock });
  // Trusted hover moves only: the bridge dedupes its own, so it never picks a hover target.
  dom.win.triggerTrusted({ type: 'pointermove', isTrusted: true, pointerType: 'pen', buttons: 0 });
  clock += 40;
  assert.equal(globalObj.__notecompleteNativeHover('move', 10, 10, 'pen'), false);
  assert.equal(globalObj.__notecompleteNativeHover('exit', 10, 10, 'pen'), true);
  assert.deepEqual(dom.dispatched.map((d) => [d.target, d.type, d.relatedTarget]), [
    ['sheet', 'pointerout', null],
  ]);
});
