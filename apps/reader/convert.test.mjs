import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsFrom, LOOK_FIELDS, SAMPLE } from './convert.js';

test('only known look options reach the core, and defaults are left out', () => {
  assert.deepEqual(optionsFrom({ look: 'classic', theme: 'dark', paper: 'ruled', hand: '', pen: 'ballpoint', size: '13' }), { look: 'classic', theme: 'dark', paper: 'ruled', pen: 'ballpoint', size: 13 });
  assert.deepEqual(optionsFrom({ look: '<script>', paper: 'lava', size: '11' }), {});
  assert.deepEqual(optionsFrom({ size: '200' }), {});
  for (const [key, options] of Object.entries(LOOK_FIELDS)) assert.ok(options.length > 1, key);
  assert.match(SAMPLE, /^# /);
});
