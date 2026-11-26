import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { systemOpenWith } from './system-open-with.js';

const fake = (lines, code) => (cmd, args) => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.cmd = cmd; child.args = args;
  setTimeout(() => { for (const l of lines) child.stdout.emit('data', l); if (code !== undefined) child.emit('exit', code); }, 1);
  return child;
};

test('linux asks the portal and reports when the chooser is up', async () => {
  let seen;
  const ok = await systemOpenWith('/u/a.rnote', { platform: 'linux', run: (c, a, o) => { seen = [c, a]; return fake(['asked\n'])(c, a, o); } });
  assert.equal(ok, true);
  assert.equal(seen[0], 'python3');
  assert.equal(seen[1].at(-1), '/u/a.rnote');
});

test('a helper that exits before asking falls back', async () => {
  assert.equal(await systemOpenWith('/u/a.rnote', { platform: 'linux', run: fake([], 1) }), false);
  assert.equal(await systemOpenWith('/u/a.rnote', { platform: 'darwin' }), false);
});
