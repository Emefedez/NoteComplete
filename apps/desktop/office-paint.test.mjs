// preload.cjs officePaintHook: lifts sdkjs's 40 ms paint gate (PaintMessageLoop.isUseInterval)
// in the DocumentServer's frames, whether the hook runs before or after AscCommon exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
function load({ isMainFrame = true, origin = 'notecomplete://reader' } = {}) {
  const exposed = [], mainWorld = [];
  const module = { exports: {} };
  const electron = {
    contextBridge: { exposeInMainWorld: (key) => exposed.push(key), executeInMainWorld: ({ func }) => mainWorld.push(func) },
    ipcRenderer: { invoke() {}, on() {}, send() {}, removeListener() {}, sendSync() {} },
    webFrame: { executeJavaScript() {} },
  };
  const context = { require: () => electron, module, process: { isMainFrame }, location: { origin }, console, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { exports: module.exports, exposed, mainWorld };
}
// The way sdkjs defines and uses its paint loop (common/Drawings/WorkEvents.js, word/Drawing/HtmlPage.js).
function sdk(window) {
  window.AscCommon = window.AscCommon || {};
  function PaintMessageLoop(interval, api) { this.isUseInterval = api.isMobileVersion !== true; this.interval = interval || 40; }
  window.AscCommon.PaintMessageLoop = PaintMessageLoop;
  return new window.AscCommon.PaintMessageLoop(40, {});
}

test('the main frame gets the bridges and no hook', () => {
  const { exposed, mainWorld } = load();
  assert.ok(exposed.includes('notecompleteFiles') && exposed.includes('notecompleteOffice'));
  assert.equal(mainWorld.length, 0);
});

test('a DocumentServer frame gets the hook and no bridge', () => {
  const { exposed, mainWorld } = load({ isMainFrame: false, origin: 'http://127.0.0.1:41234' });
  assert.deepEqual(exposed, []);
  assert.equal(mainWorld.length, 1);
});

test('other sub-frames get nothing', () => {
  for (const origin of ['notecomplete://reader', 'https://www.youtube.com', 'http://127.0.0.1.evil.com:80', 'http://localhost:8080']) {
    const { exposed, mainWorld } = load({ isMainFrame: false, origin });
    assert.deepEqual([exposed, mainWorld.length], [[], 0], origin);
  }
});

// A window with input events and a clock the test moves.
function frameWindow() {
  const listeners = {};
  const clock = { t: 10000 };
  const window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  const fire = (type, extra = {}) => { for (const fn of listeners[type] || []) fn({ type, ...extra }); };
  return { window, clock, fire, context: { window, performance: { now: () => clock.t } } };
}

test('the gate is lifted while the user interacts, and back when idle', () => {
  const { exports } = load();
  const { window, clock, fire, context } = frameWindow();
  vm.runInNewContext(`(${exports.officePaintHook})()`, context);
  const loop = sdk(window);
  assert.equal(loop.interval, 40);
  assert.equal(loop.isUseInterval, true, 'idle: 25 FPS as before');
  for (const type of ['wheel', 'keydown', 'pointerdown', 'touchmove']) {
    clock.t += 5000;
    fire(type);
    assert.equal(loop.isUseInterval, false, type);
    clock.t += 900;
    assert.equal(loop.isUseInterval, false, `${type} + 0.9 s`);
    clock.t += 200;
    assert.equal(loop.isUseInterval, true, `${type} + 1.1 s`);
  }
  // Hovering does not count; dragging does.
  fire('pointermove', { buttons: 0 });
  assert.equal(loop.isUseInterval, true);
  fire('pointermove', { buttons: 1 });
  assert.equal(loop.isUseInterval, false);
  // Running twice does nothing more.
  vm.runInNewContext(`(${exports.officePaintHook})()`, context);
  assert.equal(window.AscCommon.PaintMessageLoop.__ncPatched, true);
});

test('the hook also patches a loop already defined', () => {
  const { exports } = load();
  const { window, fire, context } = frameWindow();
  sdk(window);
  vm.runInNewContext(`(${exports.officePaintHook})()`, context);
  fire('wheel');
  assert.equal(new window.AscCommon.PaintMessageLoop(40, {}).isUseInterval, false);
});

test('the mobile editor is unchanged (it never used the gate)', () => {
  const { exports } = load();
  const { window, context } = frameWindow();
  vm.runInNewContext(`(${exports.officePaintHook})()`, context);
  window.AscCommon = window.AscCommon || {};
  function P(interval, api) { this.isUseInterval = api.isMobileVersion !== true; }
  window.AscCommon.PaintMessageLoop = P;
  assert.equal(new P(40, { isMobileVersion: true }).isUseInterval, false);
});
