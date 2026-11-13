import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { terminateProcess } from './terminate-process.js';

function child() {
  const c = new EventEmitter();
  Object.assign(c, { exitCode: null, signalCode: null, signals: [] });
  c.kill = signal => { c.signals.push(signal); };
  return c;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a process is asked to stop, and killed only if it is still running after the grace time', async () => {
  terminateProcess(null);
  const stuck = child();
  terminateProcess(stuck, 10);
  assert.deepEqual(stuck.signals, ['SIGTERM']);
  await wait(40);
  assert.deepEqual(stuck.signals, ['SIGTERM', 'SIGKILL']);
  // One that closes in time is left alone, as is one that already ended.
  const polite = child();
  terminateProcess(polite, 10);
  polite.emit('close', 0, null);
  const ended = child();
  terminateProcess(ended, 10);
  ended.signalCode = 'SIGTERM';
  await wait(40);
  assert.deepEqual(polite.signals, ['SIGTERM']);
  assert.deepEqual(ended.signals, ['SIGTERM']);
  // A process that cannot be signalled does not throw.
  const gone = child();
  gone.kill = () => { throw Error('ESRCH'); };
  terminateProcess(gone, 10);
  await wait(40);
});

test('both runners use the one module, and the packaged app contains it', async () => {
  const text = name => readFile(new URL(name, import.meta.url), 'utf8');
  assert.ok(JSON.parse(await text('./package.json')).build.files.includes('terminate-process.js'));
  for (const name of ['./ai-runner.js', './transcriber.js']) {
    const source = await text(name);
    assert.match(source, /import \{ terminateProcess \} from '\.\/terminate-process\.js';/);
    assert.doesNotMatch(source, /function terminateProcess/);
  }
});
