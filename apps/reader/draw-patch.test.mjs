import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyDrawPatch, placeDrawnItem } from './draw-patch.js';

// A page as the core writes it: paper, a group per visible layer, then the layers' tape.
const item = (id, body = '<polyline points="1,1 2,2"/>') => `<g data-item="${id}">${body}</g>`;
const taped = (id) => `<g data-item="${id}" data-tape="${id}" data-revealed="0" opacity="1"><path d="M0 0"/><g class="nc-tape-pattern"><path d="M0 0"/></g></g>`;
const DEFS = '<defs><pattern id="ncTape" width="14" height="14"></pattern><style>.nc-tape-pattern path{fill:url(#ncTape)!important}</style></defs>';
const page = ({ layers, tapes = {}, defs = Object.keys(tapes).length > 0 }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${defs ? DEFS : ''}<g data-background="true"><rect/></g>`
  + layers.map(([id, items]) => `<g data-layer="${id}" opacity="1">${items.join('')}</g>`).join('')
  + Object.entries(tapes).map(([id, items]) => `<g data-tapes="${id}" opacity="1">${items.join('')}</g>`).join('') + '</svg>';
const view = (content, more = {}) => ({
  page: 2, slot: 5, svg: page(content), engine_state: 40, visible_added: 3, visible_imported: 7, edit_count: 9, can_undo: true, can_redo: true,
  layers: content.layers.map(([id]) => ({ id, visible: true })), shapes: [], tapes: [], parts: [], texts: [{ id: 'image:1' }], ...more,
});
const drawn = (id, more = {}) => ({
  id, page: 2, slot: 5, item: item(id), layer: 0, under: false, tape: false, before: null,
  edit_count: 10, can_undo: true, can_redo: false, base_state: 40, engine_state: 41, ...more,
});

test('a line goes last in its layer, and the small fields follow', () => {
  const before = view({ layers: [[0, [item('stroke:0'), item('new:3')]]] });
  const kept = structuredClone(before);
  const next = applyDrawPatch(before, drawn('new:9'));
  assert.equal(next.svg, page({ layers: [[0, [item('stroke:0'), item('new:3'), item('new:9')]]] }));
  assert.deepEqual({ ...next, svg: '' }, { ...before, svg: '', visible_added: 4, edit_count: 10, can_redo: false, engine_state: 41 });
  assert.deepEqual(before, kept, 'the view it was given is not changed');
  assert.notEqual(next.shapes, undefined);
  // Again from the result: the next line's base is the state this one left.
  assert.equal(applyDrawPatch(next, drawn('new:10')), null);
  const again = applyDrawPatch(next, drawn('new:10', { base_state: 41, engine_state: 42, edit_count: 11 }));
  assert.ok(again.svg.endsWith(`${item('new:9')}${item('new:10')}</g></svg>`));
});

test('the layer is found among others, with and without tape after them', () => {
  const layers = [[0, [item('stroke:0')]], [7, [item('new:1')]], [9, []]];
  for (const tapes of [{}, { 7: [taped('new:2')] }, { 0: [taped('stroke:4')], 9: [taped('new:2')] }]) {
    const listed = Object.values(tapes).flat().map(() => ({ id: 'x' }));
    for (const [layer, expected] of [
      [0, [[0, [item('stroke:0'), item('new:9')]], layers[1], layers[2]]],
      [7, [layers[0], [7, [item('new:1'), item('new:9')]], layers[2]]],
      [9, [layers[0], layers[1], [9, [item('new:9')]]]],
    ]) {
      const next = applyDrawPatch(view({ layers, tapes }, { tapes: listed }), drawn('new:9', { layer }));
      assert.equal(next.svg, page({ layers: expected, tapes }), `layer ${layer}, tapes ${JSON.stringify(Object.keys(tapes))}`);
    }
  }
  // A hidden layer has no group: the last visible one is the last on the page.
  const hidden = view({ layers: [[0, [item('stroke:0')]]] }, { layers: [{ id: 0, visible: true }, { id: 3, visible: false }] });
  assert.ok(applyDrawPatch(hidden, drawn('new:9')).svg.endsWith(`${item('new:9')}</g></svg>`));
  assert.equal(applyDrawPatch(hidden, drawn('new:9', { layer: 3 })), null);
});

test('a line under the ink goes before the item the engine names, or last', () => {
  const layers = [[0, [item('new:2'), item('stroke:0'), item('image:1'), item('new:3')]], [1, [item('stroke:9')]]];
  const next = applyDrawPatch(view({ layers }), drawn('new:9', { under: true, before: 'stroke:0' }));
  assert.equal(next.svg, page({ layers: [[0, [item('new:2'), item('new:9'), item('stroke:0'), item('image:1'), item('new:3')]], layers[1]] }));
  // Only lines under the ink on the layer: last.
  const only = applyDrawPatch(view({ layers: [[0, [item('new:2')]], layers[1]] }), drawn('new:9', { under: true }));
  assert.equal(only.svg, page({ layers: [[0, [item('new:2'), item('new:9')]], layers[1]] }));
  // The named item is on another layer, or nowhere: not here.
  assert.equal(applyDrawPatch(view({ layers }), drawn('new:9', { under: true, before: 'stroke:9' })), null);
  assert.equal(applyDrawPatch(view({ layers }), drawn('new:9', { under: true, before: 'stroke:77' })), null);
  // "stroke:1" is not the start of "stroke:10".
  const tens = view({ layers: [[0, [item('stroke:10'), item('stroke:1')]]] });
  assert.ok(applyDrawPatch(tens, drawn('new:9', { under: true, before: 'stroke:1' })).svg.includes(`${item('stroke:10')}${item('new:9')}${item('stroke:1')}`));
});

test('tape goes last in its layer\'s tape, and only where there is tape already', () => {
  const layers = [[0, [item('stroke:0')]], [1, []]], strip = { item: taped('new:9'), tape: true, tape_entry: { id: 'new:9', bounds: [0, 0, 1, 1], revealed: false } };
  const tapes = { 0: [taped('new:2')], 1: [taped('new:4')] }, listed = [{ id: 'new:2' }, { id: 'new:4' }];
  const first = applyDrawPatch(view({ layers, tapes }, { tapes: listed }), drawn('new:9', strip));
  assert.equal(first.svg, page({ layers, tapes: { 0: [taped('new:2'), taped('new:9')], 1: tapes[1] } }));
  assert.deepEqual(first.tapes, [...listed, strip.tape_entry]);
  const second = applyDrawPatch(view({ layers, tapes }, { tapes: listed }), drawn('new:9', { ...strip, layer: 1 }));
  assert.equal(second.svg, page({ layers, tapes: { 0: tapes[0], 1: [taped('new:4'), taped('new:9')] } }));
  // The layer's first tape, and the page's first (no stripes defined): the whole view.
  assert.equal(applyDrawPatch(view({ layers, tapes: { 1: tapes[1] } }, { tapes: listed }), drawn('new:9', strip)), null);
  assert.equal(applyDrawPatch(view({ layers }), drawn('new:9', strip)), null);
  assert.equal(applyDrawPatch(view({ layers, tapes: { 0: [item('stroke:5')] }, defs: false }, { tapes: listed }), drawn('new:9', strip)), null);
});

test('shapes and parts are listed as the view lists them', () => {
  const layers = [[0, []]], shape = { id: 'new:9', line: { points: [] } }, part = { item: 'new:9', id: 'g1', kind: 'graph', spec: null };
  const before = view({ layers }, { shapes: [{ id: 'new:1' }], parts: [{ item: 'new:1', id: 'g1' }, { item: 'image:4', id: 'g1' }, { item: 'image:6', id: 'g1' }] });
  const next = applyDrawPatch(before, drawn('new:9', { shape, part }));
  assert.deepEqual(next.shapes, [{ id: 'new:1' }, shape]);
  assert.deepEqual(next.parts.map((p) => p.item), ['new:1', 'new:9', 'image:4', 'image:6']);
  assert.equal(before.shapes.length, 1);
  assert.equal(before.parts.length, 3);
  assert.deepEqual(applyDrawPatch(view({ layers }), drawn('new:9', { part })).parts, [part]);
});

test('anything but the view from just before the line is refused', () => {
  const before = view({ layers: [[0, [item('stroke:0')]]] });
  assert.ok(applyDrawPatch(before, drawn('new:9')));
  for (const [why, v, d] of [
    ['no view', null, drawn('new:9')],
    ['no answer', before, null],
    ['an older state of the note', { ...before, engine_state: 39 }, drawn('new:9')],
    ['a newer state of the note', { ...before, engine_state: 41 }, drawn('new:9')],
    ['a view with no state', { ...before, engine_state: undefined }, drawn('new:9', { base_state: undefined })],
    ['another page', { ...before, slot: 6 }, drawn('new:9')],
    ['a page that moved', { ...before, page: 3 }, drawn('new:9')],
    ['an answer with only the id (a canvas that grew)', before, { id: 'new:9', page: 2, slot: 5, base_state: 40, engine_state: 41 }],
    ['an item that is not the line', before, drawn('new:9', { item: item('new:8') })],
    ['a layer the page does not show', before, drawn('new:9', { layer: 4 })],
    ['a view without its drawing', { ...before, svg: undefined }, drawn('new:9')],
    ['a drawing cut short', { ...before, svg: before.svg.slice(0, -3) }, drawn('new:9')],
    ['a drawing that does not end in a layer', { ...before, svg: '<svg><rect/></svg>' }, drawn('new:9')],
    ['a view with no count', { ...before, visible_added: undefined }, drawn('new:9')],
  ]) assert.equal(applyDrawPatch(v, d), null, why);
});

// The few things of an element the page's code uses.
class El {
  constructor(localName, attributes = {}, children = []) {
    Object.assign(this, { localName, attributes, children: [], id: attributes.id || '' });
    for (const c of children) this.append(c);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(el) { this.insertBefore(el, null); }
  insertBefore(el, next) {
    el.parent?.children.splice(el.parent.children.indexOf(el), 1);
    el.parent = this;
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, el);
  }
}
const g = (attributes, children) => new El('g', attributes, children);
const node = (id) => g({ 'data-item': id });
const tree = ({ layers, tapes = {}, defs = Object.keys(tapes).length > 0 }) => new El('svg', {}, [
  ...(defs ? [new El('defs', {}, [new El('pattern', { id: 'ncTape-p3' }), new El('style')])] : []),
  g({ 'data-background': 'true' }),
  ...layers.map(([id, items]) => g({ 'data-layer': String(id) }, items.map(node))),
  ...Object.entries(tapes).map(([id, items]) => g({ 'data-tapes': String(id) }, items.map(node))),
]);
const shape = (svg) => svg.children.filter((c) => c.localName === 'g' && !c.attributes['data-background'])
  .map((c) => `${c.attributes['data-layer'] != null ? 'L' : 'T'}${c.attributes['data-layer'] ?? c.attributes['data-tapes']}:${c.children.map((i) => i.attributes['data-item']).join(',')}`).join(' ');

test('the element goes where the text has it', () => {
  const content = { layers: [[0, ['new:2', 'stroke:0', 'new:3']], [7, ['new:5']]], tapes: { 0: ['new:4'], 7: ['new:6'] } };
  for (const [more, expected] of [
    [{}, 'L0:new:2,stroke:0,new:3,new:9 L7:new:5 T0:new:4 T7:new:6'],
    [{ layer: 7 }, 'L0:new:2,stroke:0,new:3 L7:new:5,new:9 T0:new:4 T7:new:6'],
    [{ under: true, before: 'stroke:0' }, 'L0:new:2,new:9,stroke:0,new:3 L7:new:5 T0:new:4 T7:new:6'],
    [{ under: true, layer: 7 }, 'L0:new:2,stroke:0,new:3 L7:new:5,new:9 T0:new:4 T7:new:6'],
    [{ tape: true }, 'L0:new:2,stroke:0,new:3 L7:new:5 T0:new:4,new:9 T7:new:6'],
    [{ tape: true, layer: 7 }, 'L0:new:2,stroke:0,new:3 L7:new:5 T0:new:4 T7:new:6,new:9'],
  ]) {
    const svg = tree(content);
    assert.equal(placeDrawnItem(svg, drawn('new:9', more), node('new:9')), true, JSON.stringify(more));
    assert.equal(shape(svg), expected);
  }
});

test('the element is not placed where its place is missing, and nothing moves', () => {
  const content = { layers: [[0, ['new:2', 'stroke:0']], [7, []]], tapes: { 7: ['new:6'] } };
  const was = shape(tree(content));
  for (const [why, svg, d, el] of [
    ['a layer the page does not show', tree(content), drawn('new:9', { layer: 3 }), node('new:9')],
    ['the layer has no tape yet', tree(content), drawn('new:9', { tape: true }), node('new:9')],
    ['no stripes defined', tree({ ...content, defs: false }), drawn('new:9', { tape: true, layer: 7 }), node('new:9')],
    ['the item it goes before is on another layer', tree(content), drawn('new:9', { under: true, layer: 7, before: 'stroke:0' }), node('new:9')],
    ['the item it goes before is gone', tree(content), drawn('new:9', { under: true, before: 'stroke:5' }), node('new:9')],
    ['the element is another item', tree(content), drawn('new:9'), node('new:8')],
    ['no element', tree(content), drawn('new:9'), null],
    ['no page', null, drawn('new:9'), node('new:9')],
  ]) {
    assert.equal(placeDrawnItem(svg, d, el), false, why);
    if (svg) assert.equal(shape(svg), why === 'no stripes defined' ? shape(tree({ ...content, defs: false })) : was, why);
  }
});
