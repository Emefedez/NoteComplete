import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { pngClipboard, rawFormat } from './png-clipboard.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
class ClipboardItem { constructor(items) { this.items = items; } }
function setup({ platform = 'linux', env = { WAYLAND_DISPLAY: 'wayland-1' }, pasted = PNG, wlCopy = 0, noWlPaste = false } = {}) {
  const written = [], ran = [];
  const clipboard = { write: async (items) => { written.push(items[0].items); } };
  const run = async (cmd, args, input) => {
    ran.push([cmd, args, input && input.length]);
    if (cmd === 'wl-paste') { if (noWlPaste) throw Object.assign(Error('missing'), { code: 'ENOENT' }); return { code: pasted ? 0 : 1, stdout: Buffer.from(pasted || []) }; }
    return { code: wlCopy, stdout: Buffer.alloc(0) };
  };
  return { written, ran, board: pngClipboard({ clipboard, ClipboardItem, platform, env, run, wait: async () => {} }) };
}

test('raw PNG format per platform, with the marker text', async () => {
  for (const [platform, name] of [['linux', 'image/png'], ['win32', 'PNG'], ['darwin', 'public.png']]) {
    const { written, board } = setup({ platform, env: {} });
    assert.equal(await board.write(PNG, 'MARK'), 'electron');
    const entry = written[0];
    assert.deepEqual(Object.keys(entry), [rawFormat(platform), 'text/plain']);
    assert.ok(rawFormat(platform).endsWith(`format="${name}"`));
    assert.deepEqual(new Uint8Array(await entry[rawFormat(platform)].arrayBuffer()), PNG);
    assert.equal(entry['text/plain'], 'MARK');
  }
});

test('Wayland: kept when wl-paste gives the same bytes back', async () => {
  const { ran, board } = setup();
  assert.equal(await board.write(PNG, 'MARK'), 'electron');
  assert.deepEqual(ran.map((r) => r[0]), ['wl-paste']);
});

test('Wayland: wl-copy when the picture did not reach the clipboard', async () => {
  const { ran, board } = setup({ pasted: new Uint8Array([0x89, 0x50]) });
  assert.equal(await board.write(PNG, 'MARK'), 'wl-copy');
  assert.deepEqual(ran.at(-1), ['wl-copy', ['--type', 'image/png'], PNG.length]);
  await assert.rejects(setup({ pasted: null, wlCopy: 1 }).board.write(PNG, 'MARK'));
});

test('Wayland without wl-paste: Electron only', async () => {
  const { ran, board } = setup({ noWlPaste: true });
  assert.equal(await board.write(PNG, 'MARK'), 'electron');
  assert.equal(ran.length, 1);
});

test('only PNG bytes are written', async () => {
  const { board, written } = setup();
  await assert.rejects(board.write(new Uint8Array([1, 2, 3]), 'MARK'));
  await assert.rejects(board.write('not bytes', 'MARK'));
  assert.equal(written.length, 0);
});
