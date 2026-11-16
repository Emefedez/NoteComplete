// The order of an editor's palette (the chart editor's brushes, the UML editor's elements and
// connectors): the one the person dragged them into, kept on this device, and the number
// keys that follow it (1 for the first, 2 for the second… 0 for the tenth).

const PREFIX = 'notecomplete.palette.';
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// `ids` in the order kept under `name`: the kept ones first, as they were left, then any new
// ones where they come in `ids`. Nothing kept: `ids` as they are.
export function orderedIds(name, ids, storage = store()) {
  let kept = [];
  try { kept = JSON.parse(storage?.getItem(PREFIX + name) || '[]'); } catch { /* None kept. */ }
  if (!Array.isArray(kept)) kept = [];
  const known = kept.filter((id) => ids.includes(id));
  const out = [...known];
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    // A new one goes after the one before it in the default order.
    const before = ids.slice(0, i).reverse().find((q) => out.includes(q));
    out.splice(before == null ? 0 : out.indexOf(before) + 1, 0, id);
  });
  return out;
}
export function saveOrder(name, ids, storage = store()) {
  try { storage?.setItem(PREFIX + name, JSON.stringify(ids)); } catch { /* Private window: not kept. */ }
}
export function forgetOrder(name, storage = store()) {
  try { storage?.removeItem(PREFIX + name); } catch { /* Nothing kept. */ }
}

// The key that chooses the palette entry at `index` (from 0): "1"… "9", "0", or "".
export const keyFor = (index) => (index < 9 ? String(index + 1) : index === 9 ? '0' : '');
// The entry a number key chooses, or -1.
export const indexOfKey = (key) => (/^[1-9]$/.test(key) ? Number(key) - 1 : key === '0' ? 9 : -1);
