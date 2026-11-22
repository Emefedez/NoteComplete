import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuality, presets, zoomDetailFrom } from './quality.js';
import { rasterTarget } from './pdf-background.js';

test('quality preferences reject invalid storage and bound memory controls', () => {
  assert.deepEqual(normalizeQuality(null), presets.balanced);
  assert.deepEqual(normalizeQuality({ scale: NaN, megapixels: '24' }), presets.balanced);
  assert.deepEqual(normalizeQuality({ scale: 99, megapixels: 999, contrast: 0, brightness: -1, preloadPages: 99 }), { scale: 3, megapixels: 24, contrast: 75, brightness: 75, preloadPages: 20 });
  assert.equal(normalizeQuality({ preloadPages: -5 }).preloadPages, 0);
  assert.equal(normalizeQuality({ preloadPages: 3.7 }).preloadPages, 4);
});
test('presets change actual raster resolution and respect page budgets', () => {
  const page = { width: 612, height: 792 };
  assert.equal(rasterTarget(page, 900, 3, presets.performance).width, 900);
  assert.equal(rasterTarget(page, 900, 2, presets.sharp).width, 2700);
  assert.equal(rasterTarget(page, 900, 1, presets.sharp).width, 1350, 'a 1× screen: half per side');
  for (const settings of Object.values(presets)) {
    const target = rasterTarget(page, 24000, 3, settings);
    assert.ok(target.width * target.height < settings.megapixels * 1e6 + 15000);
    assert.ok(Math.max(target.width, target.height) <= 8192);
  }
});
test('fast zoom sharpening draws only the part on screen, at the zoomed resolution', async () => {
  const { regionTarget } = await import('./pdf-background.js');
  const page = { width: 612, height: 792 };
  const balanced = presets.balanced;
  // A page zoomed to 2448 CSS px (4× a 612 px fit) on a 2× screen: 4896 px across in all.
  const whole = rasterTarget(page, 2448, 2, balanced);
  assert.ok(whole.width < 4896, 'the whole page is capped by the pixel budget');
  const part = regionTarget(page, 2448, [0.25, 0.25, 0.5, 0.5], 2, balanced);
  assert.equal(Math.round(part.scale * page.width), 4896, 'the on-screen part keeps full resolution');
  assert.ok(part.width <= 1225 && part.width >= 1223);
  assert.ok(part.width * part.height < 2_000_000, 'a few megapixels, not a whole page');
  // The box comes back snapped to whole pixels, covering what was asked.
  assert.ok(part.box[0] <= 0.25 && part.box[1] <= 0.25 && part.box[2] >= 0.5 && part.box[3] >= 0.5);
  assert.equal(part.left, Math.floor(0.25 * page.width * part.scale));
  // Never larger than a GPU texture many Android tablets take, nor the pixel budget.
  const huge = regionTarget(page, 24000, [0, 0, 1, 1], 3, presets.sharp);
  assert.ok(Math.max(huge.width, huge.height) <= 4096);
  assert.ok(huge.width * huge.height <= presets.sharp.megapixels * 1e6 + 10000);
  // Out-of-range boxes are clamped to the page.
  const clamped = regionTarget(page, 612, [-1, -1, 2, 2], 2, balanced);
  assert.deepEqual(clamped.box, [0, 0, 1, 1]);
});
test('fast zoom sharpening is on unless turned off', () => {
  assert.equal(zoomDetailFrom(null), true, 'never set: on');
  assert.equal(zoomDetailFrom('1'), true);
  assert.equal(zoomDetailFrom('0'), false);
  assert.equal(zoomDetailFrom(''), false, 'turned off before it was the default');
});
