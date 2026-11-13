// Versions are compared in two packages: the desktop updater (updater.js) and the Android
// reader (reader android-updates.js). These tests keep the two answers the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as desktop from './updater.js';
import * as android from '../reader/android-updates.js';

const VERSIONS = [
  '1.1.67', 'v1.1.67', 'V1.1.67', ' 1.1.67 ', '1.1.68', '1.2.0', '2.0.0', '1.10.0', '1.9.9', '0.0.0', '01.002.0003',
  '1.1.67-beta', '1.1.67-beta.2', '1.1.67-beta.10', '1.1.67-rc.1', 'v1.1.67-alpha', '1.1.67-1', '1.1.67-', '1.1.67+build5', '1.1.67-beta+build',
  '1.1', '1', '1.1.67.4', '1.1.67.5', 'v', '', 'latest', 'x1.2.3', '1.2.x', '1..3', '-1.2.3', '1.2.3rc1', 'release-1.2.3', null, undefined, 123, {},
];

test('both read a version the same way', () => {
  for (const v of VERSIONS) assert.deepEqual(desktop.parseVersion(v), android.parseVersion(v), String(v));
  assert.deepEqual(android.parseVersion('v1.2.3-beta.2'), { parts: [1, 2, 3], pre: 'beta.2' });
  assert.equal(desktop.parseVersion('1.1'), null);
});

test('both agree on which of two versions is newer, for every pair', () => {
  let newerCount = 0;
  for (const a of VERSIONS) for (const b of VERSIONS) {
    const answer = desktop.newer(a, b);
    assert.equal(answer, android.newer(a, b), `${a} over ${b}`);
    if (answer) newerCount += 1;
    // Never both ways round.
    assert.ok(!(answer && desktop.newer(b, a)), `${a} and ${b}`);
  }
  assert.ok(newerCount > 50);
  // The answers themselves, so that the two cannot be wrong together unnoticed.
  for (const [a, b, expected] of [
    ['1.1.68', '1.1.67', true], ['v1.1.68', '1.1.67', true], ['1.1.67', 'v1.1.67', false], ['1.10.0', '1.9.9', true], ['1.9.9', '1.10.0', false],
    ['2.0.0', '1.99.99', true], ['1.1.67', '1.1.67-beta', true], ['1.1.67-beta', '1.1.67', false], ['1.1.67-beta.10', '1.1.67-beta.2', true],
    ['1.1.67-rc.1', '1.1.67-beta.2', true], ['1.1.67.5', '1.1.67.4', false], ['1.1', '1.0.0', false], ['1.2.0', 'latest', false], ['', '', false],
  ]) {
    assert.equal(desktop.newer(a, b), expected, `desktop: ${a} over ${b}`);
    assert.equal(android.newer(a, b), expected, `android: ${a} over ${b}`);
  }
});

test('both pick the same latest release', () => {
  const releases = [
    { tag_name: 'v1.1.66' }, { tag_name: 'v1.2.0', draft: true }, { tag_name: 'nightly' }, { tag_name: 'v1.1.67-beta.1' }, { tag_name: 'v1.1.67' }, { tag_name: '1.1.9' },
  ];
  assert.equal(desktop.latestRelease(releases).tag_name, 'v1.1.67');
  assert.equal(android.latestRelease(releases).tag_name, 'v1.1.67');
  for (const none of [[], null, [{ tag_name: 'x' }]]) assert.equal(desktop.latestRelease(none), android.latestRelease(none));
});
