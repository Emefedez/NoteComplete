// The IndexedDB database of Chinese mode, "notecomplete-chinese" (docs/CHINESE-INPUT.md §4.6,
// §7.4), shared by user-dict.js (stores "chosen", "words"), practice.js ("practice") and anything
// later. Opened without a version, so whoever opens it first never blocks the others; when a
// store someone needs is missing, it is opened again one version up and the missing stores are
// made. Every caller lists the stores it needs: `chineseDb(["practice"])`.
export const DB_NAME = 'notecomplete-chinese';
// Every store anyone uses, made together whenever one is missing: { name: keyPath options }.
export const STORES = {
  chosen: {},
  words: {},
  packs: {}, // packs.js: installed HSK expansions, key = pack id
  practice: { keyPath: 'id', autoIncrement: true },
};
const opening = new Map();

const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
function open(version) {
  const r = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
  r.onupgradeneeded = () => {
    const db = r.result;
    for (const [name, opts] of Object.entries(STORES)) {
      if (db.objectStoreNames.contains(name)) continue;
      const store = db.createObjectStore(name, opts);
      if (name === 'practice') store.createIndex('char', 'char');
    }
  };
  r.onblocked = () => console.warn(`${DB_NAME}: an older tab keeps the database open`);
  return request(r).then((db) => { db.onversionchange = () => { db.close(); opening.clear(); }; return db; });
}
// The database with `needs` (store names) present. Rejects where IndexedDB is missing.
export function chineseDb(needs = Object.keys(STORES)) {
  const key = needs.join(',');
  if (!opening.has(key)) {
    opening.set(key, (async () => {
      if (typeof indexedDB === 'undefined') throw Error('IndexedDB is not available');
      const db = await open();
      if (needs.every((n) => db.objectStoreNames.contains(n))) return db;
      const next = db.version + 1;
      db.close();
      return open(next);
    })().catch((e) => { opening.delete(key); throw e; }));
  }
  return opening.get(key);
}
// One transaction's work: `fn(store)` → a value or a request; resolves after it commits.
export async function withStore(name, mode, fn) {
  const db = await chineseDb([name]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let out;
    const r = fn(tx.objectStore(name));
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; }; else out = r;
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
