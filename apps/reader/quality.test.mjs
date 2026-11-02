import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuality, presets } from './quality.js';
import { rasterTarget } from './pdf-background.js';

test('quality preferences reject invalid storage and bound memory controls', () => {
  assert.deepEqual(normalizeQuality(null), presets.balanced);
  assert.deepEqual(normalizeQuality({ scale: NaN, megapixels: '24' }), presets.balanced);
  assert.deepEqual(normalizeQuality({ scale: 99, megapixels: 999, contrast: 0, brightness: -1 }), { scale: 3, megapixels: 24, contrast: 75, brightness: 75 });
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
