// preload.cjs officeKeyHook: NoteComplete's Ctrl shortcuts pressed inside Euro-Office's frames go
// up to the reader; the editor keeps its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
function frame(origin) {
  const listeners = [], posted = [];
  const module = { exports: {} };
  const electron = {
    contextBridge: { exposeInMainWorld() {}, executeInMainWorld() {} },
    ipcRenderer: { invoke() {}, on() {}, send() {}, removeListener() {}, sendSync() {} },
    webFrame: { executeJavaScript() {} },
  };
  const context = { require: () => electron, module, process: { isMainFrame: false }, location: { origin }, console, setTimeout, clearTimeout,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }), top: { postMessage: (data, to) => posted.push([data, to]) } };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const press = (init) => {
    const e = { type: 'keydown', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, prevented: false, stopped: false, ...init, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const l of listeners.filter((x) => x.type === 'keydown')) l.fn(e);
    return e;
  };
  return { listeners, posted, press, exports: module.exports };
}

test('Ctrl S, O, N and Ctrl 1–9 in the editor go to the reader', () => {
  const f = frame('http://127.0.0.1:41234');
  assert.equal(f.listeners.filter((l) => l.type === 'keydown' && l.capture === true).length, 1);
  const s = f.press({ key: 's', code: 'KeyS', ctrlKey: true });
  assert.ok(s.prevented && s.stopped);
  assert.deepEqual(JSON.parse(JSON.stringify(f.posted[0][0])), { type: 'nc-office-key', key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false });
  f.press({ key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true });
  f.press({ key: '3', code: 'Digit3', metaKey: true });
  f.press({ key: 'o', code: 'KeyO', ctrlKey: true });
  assert.deepEqual(f.posted.map(([d]) => d.code), ['KeyS', 'KeyN', 'Digit3', 'KeyO']);
});

test('the editor keeps its own shortcuts and plain typing', () => {
  const f = frame('http://127.0.0.1:41234');
  for (const init of [{ key: 'z', code: 'KeyZ', ctrlKey: true }, { key: 'k', code: 'KeyK', ctrlKey: true }, { key: 'b', code: 'KeyB', ctrlKey: true }, { key: 's', code: 'KeyS' }, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true }, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }]) {
    assert.equal(f.press(init).prevented, false, init.code);
  }
  assert.equal(f.posted.length, 0);
});

test('other frames get no key hook', () => {
  assert.equal(frame('https://example.com').listeners.length, 0);
});
