import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const appConfig = require('./app.config.js');
const app = require('./app.json');

test('each release has a higher Android versionCode than the last', () => {
  assert.equal(appConfig.versionCode('1.2.29'), 10229);
  assert.ok(appConfig.versionCode('1.3.0') > appConfig.versionCode('1.2.99'));
  assert.ok(appConfig.versionCode('1.2.29') > 1, 'above the 1 every earlier APK had');
  assert.throws(() => appConfig.versionCode('1.2'));
  const config = appConfig({ config: app.expo });
  assert.equal(config.android.versionCode, appConfig.versionCode(app.expo.version));
  assert.equal(config.android.package, 'com.notecomplete.viewer');
});
