import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textAdvance,
  cssFont,
  textBoxSize,
  wrapText,
  hexColor,
  rgbaOf,
  textPayload,
  boxText,
  hideText,
  holdInk,
  letGo,
  keepHeld,
  textBoxController,
} from './text-box.js';

test('text metrics, wrapping, colours and payloads match the core contract', () => {
  const style = { font: 'Helvetica', size: 16, bold: true, italic: false, rgba: [0.12, 0.14, 0.16, 1] };
  assert.equal(textAdvance(16), 27.2);
  assert.match(cssFont(style), /^700 16px Helvetica/);
  const [w, h] = textBoxSize('hello\nworld!', style, (line) => line.length * 8);
  assert.equal(w, 48 + 12);
  assert.equal(h, Math.ceil(8 + 2 * 27.2));

  const wrapped = wrapText('one two three four', style, 60, (line) => line.length * 8);
  assert.equal(wrapped, 'one two\nthree\nfour');

  const hex = hexColor([1, 0, 0.5, 1]);
  assert.equal(hex, '#ff0080');
  const rgba = rgbaOf('#ff0080');
  assert.equal(rgba[0], 1);
  assert.equal(rgba[1], 0);
  assert.ok(Math.abs(rgba[2] - 128 / 255) < 0.01);
  assert.equal(rgba[3], 1);

  assert.deepEqual(textPayload('hi', { ...style, math: true }), {
    text: 'hi',
    font_size: 16,
    rgba: style.rgba,
    bold: true,
    italic: false,
    font: 'Helvetica',
    math: true,
  });
  assert.equal(boxText({ runs: [{ text: 'hel\u200blo ' }, { text: 'world' }] }), 'hello world');
});

test('holdInk, letGo and keepHeld manage pending ink and text placeholders across renders', () => {
  const itemEl = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  const makeNode = (name) => ({
    name,
    removed: false,
    parentNode: null,
    classList: { added: [], add(c) { this.added.push(c); } },
    remove() { this.removed = true; },
  });
  const overlay = {
    children: [],
    append(el) { el.parentNode = this; this.children.push(el); },
  };
  const pageEl = {
    children: [],
    append(el) { el.parentNode = this; this.children.push(el); },
  };
  const p = {
    el: pageEl,
    overlay,
    render: { querySelector: (sel) => (sel === '[data-item="42"]' ? itemEl : null) },
    held: [],
  };

  hideText(p, 42, true);
  assert.equal(itemEl.attrs.visibility, 'hidden');
  hideText(p, 42, false);
  assert.equal(itemEl.attrs.visibility, undefined);

  const stroke = makeNode('stroke');
  const heldStroke = holdInk(p, stroke);
  assert.deepEqual(stroke.classList.added, ['pending-ink']);
  assert.equal(p.held.length, 1);

  letGo(heldStroke);
  assert.equal(stroke.removed, true);
  assert.equal(p.held.length, 0);

  const stroke2 = makeNode('stroke2');
  const held2 = holdInk(p, stroke2);
  held2.revision = 5;
  keepHeld(p, 4, true);
  assert.equal(p.held.length, 1);
  keepHeld(p, 5, true);
  assert.equal(p.held.length, 0);
  assert.equal(stroke2.removed, true);
});

test('textBoxController opens, formats, commits and discards a text box', async () => {
  globalThis.Option = class Option {
    constructor(text, value) { this.text = text; this.value = value; }
  };
  globalThis.requestAnimationFrame = (fn) => fn();

  const makeEl = (tag = 'div') => ({
    tag,
    value: '',
    hidden: false,
    style: { setProperty() {} },
    dataset: {},
    attrs: {},
    children: [],
    options: [],
    listeners: {},
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      toggle(c, on) { if (on ?? !this.classes.has(c)) { this.classes.add(c); return true; } this.classes.delete(c); return false; },
      contains(c) { return this.classes.has(c); },
    },
    add(opt) { this.options.push(opt); },
    append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } },
    remove() { this.removed = true; },
    focus() {},
    blur() {},
    contains() { return false; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    getBoundingClientRect() { return { left: 10, right: 110, top: 10, bottom: 40, width: 100, height: 30 }; },
  });

  const els = new Map();
  for (const id of ['textSize', 'textSwatches', 'textFormat', 'toolOptions', 'viewport', 'textFont', 'textBold', 'textItalic', 'textMath', 'textColor', 'textFormatDock', 'pages']) {
    els.set(id, makeEl(id));
  }
  const fakeDoc = {
    body: makeEl('body'),
    activeElement: null,
    createElement(tag) {
      if (tag === 'canvas') {
        return { getContext: () => ({ font: '', measureText: (s) => ({ width: s.length * 8 }) }) };
      }
      return makeEl(tag);
    },
    querySelector() { return { click() {} }; },
    querySelectorAll() { return []; },
  };
  globalThis.document = fakeDoc;

  const actions = [];
  const statuses = [];
  const p = {
    index: 0,
    size: [600, 800],
    view: { texts: [] },
    el: Object.assign(makeEl('page'), { clientWidth: 600 }),
    render: { querySelector: () => null },
  };

  const controller = textBoxController({
    call: async () => null,
    action: async (op, args, hold) => { actions.push({ op, args, hold }); },
    status: (msg) => { statuses.push(msg); },
    selection: { item: null, clear() {}, async selectId() {} },
    swatches: ['#1f2328', '#246bce'],
    getDoc: () => ({ edit_count: 1, layers: [{ id: 0, visible: true, locked: false }] }),
    getActiveLayer: () => 0,
    getTool: () => 'text',
    getPanels: () => [p],
    getPage: () => 0,
    $: (id) => els.get(id),
    doc: fakeDoc,
  });

  await controller.open(p, [100, 120]);
  assert.equal(controller.active, true);
  const area = p.el.children.find((c) => c.className === 'text-editor');
  assert.ok(area);
  area.value = 'Hello note';
  els.get('textBold').onclick();

  await controller.commit();
  assert.equal(controller.active, false);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].op, 'image');
  assert.equal(actions[0].args.image.text.text, 'Hello note');
  assert.equal(actions[0].args.image.text.bold, true);
});

test('Chinese wraps between characters, never before closing punctuation', async () => {
  const { wrapText, wrapPieces } = await import('./text-box.js');
  assert.deepEqual(wrapPieces('我不知道。'), ['我', '不', '知', '道。']);
  assert.deepEqual(wrapPieces('「你好」'), ['「你', '好」']);
  assert.equal(wrapText('我不知道银行在哪里，你呢？ hello', { size: 16 }, 40, (l) => [...l].length * 10), '我不知道\n银行在哪\n里，你\n呢？\nhello');
});
