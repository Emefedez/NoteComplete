import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanState, sessionOf, saveSession, takeSession, FRESH_MS } from './session.js';

test('a tab keeps only what restoring uses, and only when it showed a document', () => {
  assert.deepEqual(cleanState({ entryKey: 'local:/a.nfedit', page: 3, title: 'A', extra: 'x' }), { entryKey: 'local:/a.nfedit', slot: '', title: 'A', page: 3 });
  assert.deepEqual(cleanState({ slot: 'auto-1', page: -2 }), { entryKey: '', slot: 'auto-1', title: '', page: 0 });
  assert.equal(cleanState({ title: 'Home' }), null);
  assert.equal(cleanState(null), null);
  assert.equal(cleanState({ entryKey: 'x'.repeat(600) }), null);
});

test('windows keep their tabs in order, the active one, and Home tabs are left out', () => {
  const s = sessionOf([
    { tabs: [{ state: { entryKey: 'a' } }, { state: null, active: true }, { state: { entryKey: 'b' }, active: false }] },
    { tabs: [{ state: { slot: 's1' }, active: true }] },
  ], 1000);
  assert.equal(s.reason, 'update');
  assert.deepEqual(s.windows.map((w) => w.tabs.map((t) => t.entryKey || t.slot)), [['a', 'b'], ['s1']]);
  assert.equal(s.windows[1].active, 0);
});

test('the session is taken once, and only soon after an update restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-session-'));
  const file = path.join(dir, 'session.json');
  await saveSession(file, [{ tabs: [{ state: { entryKey: 'a', page: 2 } }, { state: { entryKey: 'b' }, active: true }] }], 10_000);
  const taken = await takeSession(file, 20_000);
  assert.deepEqual(taken, { windows: [{ tabs: [{ entryKey: 'a', slot: '', title: '', page: 2 }, { entryKey: 'b', slot: '', title: '', page: 0 }], active: 1 }] });
  await assert.rejects(access(file), 'removed once taken');
  assert.equal(await takeSession(file, 20_000), null, 'nothing the second time');
  await saveSession(file, [{ tabs: [{ state: { entryKey: 'a' } }] }], 0);
  assert.equal(await takeSession(file, FRESH_MS + 1), null, 'stale');
  await writeFile(file, '{"reason":"crash","at":0,"windows":[]}');
  assert.equal(await takeSession(file, 1), null, 'not an update restart');
  await writeFile(file, 'not json');
  assert.equal(await takeSession(file, 1), null);
});
