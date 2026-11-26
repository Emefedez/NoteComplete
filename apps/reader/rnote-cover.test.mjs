import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { rnoteSkeleton, rnoteCoverSvg, rnoteCover } from './rnote-cover.js';

const note = (extra = []) => JSON.stringify({ version: '0.13.1', data: { engine_snapshot: {
  document: { config: { format: { width: 800, height: 1000 }, background: { color: { r: 0, g: 0, b: 0, a: 1 } } } },
  stroke_components: [
    { value: { bitmapimage: { image: { data: 'A'.repeat(200000), pixel_width: 10, pixel_height: 10 }, rectangle: { cuboid: { half_extents: [400, 500] }, transform: { affine: [1, 0, 0, 0, 1, 0, 400, 500, 1] } } } } },
    { value: { vectorimage: { svg_data: '<svg a=\\"1\\">' + 'x'.repeat(50000) + '</svg>', rectangle: { cuboid: { half_extents: [10, 10] }, transform: { affine: [1, 0, 0, 0, 1, 0, 0, 2000, 1] } } } } },
    { value: { brushstroke: { path: { start: { pos: [900, 100] }, segments: [{ lineto: { end: { pos: [950, 120] } } }] }, style: { smooth: { stroke_width: 3, stroke_color: { r: 1, g: 0.5, b: 0.5, a: 1 } } } } } },
    ...extra,
  ] } } });
const blob = (text) => new Blob([gzipSync(Buffer.from(text))]);

test('page pictures are left out of the stream, everything else is kept', async () => {
  const json = await rnoteSkeleton(blob(note()));
  assert.ok(json.length < 2000, `skeleton is small (${json.length})`);
  const root = JSON.parse(json);
  const items = root.data.engine_snapshot.stroke_components;
  assert.equal(items[0].value.bitmapimage.image.data, '');
  assert.equal(items[1].value.vectorimage.svg_data, '');
  assert.deepEqual(items[2].value.brushstroke.path.start.pos, [900, 100]);
});

test('the cover is the top page with the notes beside it, on the canvas colour', async () => {
  const svg = rnoteCoverSvg(await rnoteSkeleton(blob(note())));
  assert.match(svg, /fill="rgb\(0,0,0\)"/);
  assert.match(svg, /<rect x="0" y="0" width="800" height="1000" fill="#fff"/);
  assert.match(svg, /<polyline points="900,100 950,120" stroke="rgb\(255,128,128\)"/);
  const url = await rnoteCover(blob(note()));
  assert.ok(url.startsWith('data:image/svg+xml;utf8,'));
});

test('an empty note has no cover of its own', async () => {
  const empty = JSON.stringify({ data: { engine_snapshot: { document: {}, stroke_components: [] } } });
  assert.equal(rnoteCoverSvg(await rnoteSkeleton(blob(empty))), null);
});
