import test from 'node:test';
import assert from 'node:assert/strict';
import { graphItems, niceStep } from './graph.js';

const box = [100, 100, 400, 300];
const inBox = ([x, y]) => x >= 99.9 && x <= 500.1 && y >= 99.9 && y <= 400.1;

test('round grid steps', () => {
  assert.equal(niceStep(10), 1);
  assert.equal(niceStep(37), 5);
  assert.equal(niceStep(0.8), 0.1);
});

test('empty axes: grid, two arrows, axis names and numbers, no curve', () => {
  const { lines, images } = graphItems(box);
  const arrows = lines.filter((l) => l.shape?.kind === 'arrow'), grid = lines.filter((l) => l.shape?.kind === 'line');
  assert.equal(arrows.length, 2);
  assert.ok(grid.length >= 15, `${grid.length} grid lines`);
  assert.ok(lines.every((l) => l.shape), 'nothing but shapes');
  const frame = lines.find((l) => l.part.spec);
  assert.deepEqual([frame.shape.start, frame.shape.end], [[100, 100], [500, 400]], 'the frame is the box and keeps the spec');
  assert.deepEqual(images.slice(0, 2).map((i) => i.text.text), ['x', 'y']);
  assert.ok(images.some((i) => i.text.text === '2') && images.some((i) => i.text.text === '−2'));
  // Square cells: the x axis through the middle of the box.
  assert.equal(arrows[0].points[0][1], 250);
});

test('a parabola: one ink curve inside the box, with a y range that shows it', () => {
  const { lines, range } = graphItems(box, { functions: ['y = x^2'] }, { rgba: [1, 0, 0, 1], width: 3 });
  const curves = lines.filter((l) => !l.shape);
  assert.equal(curves.length, 1);
  assert.ok(curves[0].points.length > 300);
  assert.ok(curves[0].points.every(inBox));
  assert.deepEqual(curves[0].rgba, [1, 0, 0, 1]);
  assert.ok(range.y[0] <= 0 && range.y[1] >= 20, `${range.y}`);
});

test('a pole splits the curve; the parts stay in the box', () => {
  const curves = graphItems(box, { functions: ['\\frac{1}{x}'] }).lines.filter((l) => !l.shape);
  assert.ok(curves.length >= 2, `${curves.length} parts`);
  for (const c of curves) assert.ok(c.points.every(inBox));
  const tan = graphItems(box, { functions: ['\\tan x'] }).lines.filter((l) => !l.shape);
  assert.ok(tan.length >= 3, `tan: ${tan.length} branches`);
});

test('formulas that cannot be graphed throw a reason', () => {
  assert.throws(() => graphItems(box, { functions: ['x^2 + y^2 = 1'] }), /y = /);
  assert.throws(() => graphItems(box, { functions: ['\\sqrt{-1-x^2}'] }), /no values/);
});

test('every part names the graph; the first keeps its spec, which can change the ranges and the look', () => {
  const { lines, images, spec } = graphItems(box, { functions: ['x', 'x^2'], x: [0, 10], y: [0, 50], grid: false, numbers: false }, { id: 'g7' });
  const all = [...lines, ...images];
  assert.ok(all.every((i) => i.part.id === 'g7' && i.part.kind === 'graph'));
  assert.equal(all.filter((i) => i.part.spec).length, 1);
  assert.deepEqual(JSON.parse(all.find((i) => i.part.spec).part.spec), spec);
  assert.equal(lines.filter((l) => l.shape?.kind === 'line').length, 0, 'no grid');
  assert.equal(lines.filter((l) => l.shape?.kind === 'rectangle').length, 1, 'only the frame');
  assert.deepEqual(images.map((i) => i.text.text), ['x', 'y'], 'no numbers');
  const curves = lines.filter((l) => !l.shape);
  assert.equal(new Set(curves.map((c) => c.rgba.join())).size, 2, 'each function its own colour');
  // y from 0 to 50: x² leaves the box at x = 7.07, so it ends on the top edge.
  assert.ok(curves.every((c) => c.points.every(inBox)));
});
