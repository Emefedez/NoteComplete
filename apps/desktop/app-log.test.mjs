import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appLog, keep } from './app-log.js';

test('keeps warnings, errors and [NC] lines only', () => {
  assert.equal(keep('info', 'hello'), false);
  assert.equal(keep('info', '[NC] expand: inserted 3 pages'), true);
  assert.equal(keep('warning', 'x'), true);
  assert.equal(keep(3, 'x'), true);
});

test('writes lines and rotates past the size limit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nclog-'));
  const log = appLog(dir, { max: 50 });
  log.write('ignored while off');
  assert.equal(existsSync(log.file), false, 'nothing is written while off');
  log.setOn(true);
  assert.equal(appLog(dir).on, true, 'the switch is remembered');
  log.write('first line that is fairly long, long enough');
  log.write('second line');
  log.write('third');
  assert.ok(existsSync(log.file + '.1'));
  assert.match(readFileSync(log.file, 'utf8'), /third/);
});
