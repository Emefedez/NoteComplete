import test from 'node:test';
import assert from 'node:assert/strict';
import { copyKey, copyGroups, copyRows, hideDuplicates, setHideDuplicates } from './duplicate-copies.js';

test('same-named items join one card, folders and files apart', () => {
  const groups = copyGroups();
  const a = groups.add(copyKey('Noteful', true), { id: 1 });
  assert.ok(a);
  let changed = 0;
  a.changed = () => changed++;
  assert.equal(groups.add(copyKey(' noteful ', true), { id: 2 }), null);
  assert.ok(groups.add(copyKey('Noteful', false), { id: 3 }), 'a file named like a folder is its own card');
  assert.deepEqual(a.copies.map(c => c.id), [1, 2]);
  assert.equal(changed, 1);
  groups.clear();
  assert.ok(groups.add(copyKey('Noteful', true), { id: 4 }));
});

test('copies are offered newest first with size and place', () => {
  const rows = copyRows([
    { id: 'old', modifiedTime: '2025-01-01T00:00:00Z', size: 1048576 },
    { id: 'new', modifiedTime: '2026-05-01T00:00:00Z', size: '2097152' },
  ], { where: c => (c.id === 'old' ? '/Apps/Noteful' : '') });
  assert.deepEqual(rows.map(r => r.item.id), ['new', 'old']);
  assert.match(rows[0].label, /2\.0 MB · newest$/);
  assert.match(rows[1].label, /1\.0 MB · \/Apps\/Noteful$/);
});

test('the switch is on by default and announces changes', () => {
  const kept = new Map();
  const storage = { getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  assert.equal(hideDuplicates(storage), true);
  const seen = [];
  setHideDuplicates(false, { storage, target: { dispatchEvent: e => seen.push(e.detail.on) } });
  assert.equal(hideDuplicates(storage), false);
  assert.deepEqual(seen, [false]);
});
