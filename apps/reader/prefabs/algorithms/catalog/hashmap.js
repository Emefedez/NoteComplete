// The course's HashMap (activity 6): an array of lists of pairs (separate chaining), the
// bucket of a key at |hashCode % length|; add replaces the value of a key already there; a
// load factor over the maximum doubles the array and puts every pair again (rehash).
import { lineFinder, clampInt, rng } from './common.js';

const source = `public class HashMap<K, V> implements Map<K, V> {
  private static final double MAX_LOAD = 0.75;
  private int size;
  private List<Pair<K, V>>[] map;

  @SuppressWarnings("unchecked")
  public HashMap(int capacity) {
    this.size = 0;
    this.map = (List<Pair<K, V>>[]) new List[capacity];
    for (int i = 0; i < capacity; i++) this.map[i] = new LinkedList<>();
  }

  private int calculateIndex(K key) {
    return Math.abs(key.hashCode() % map.length);
  }

  public V get(K key) {
    if (key == null) return null;
    List<Pair<K, V>> bucket = map[calculateIndex(key)];
    for (Pair<K, V> pair : bucket) {
      if (pair.getKey().equals(key)) return pair.getValue();
    }
    return null;
  }

  public void add(K key, V value) throws NullPointerException {
    if (key == null) throw new NullPointerException();
    List<Pair<K, V>> bucket = map[calculateIndex(key)];
    for (Pair<K, V> pair : bucket) {
      if (pair.getKey().equals(key)) {
        pair.setValue(value);                       // the key is there: new value
        return;
      }
    }
    bucket.add(new Pair<>(key, value));
    size++;
    if ((double) size / map.length > MAX_LOAD) rehash();
  }

  public V remove(K key) {
    if (key == null) return null;
    List<Pair<K, V>> bucket = map[calculateIndex(key)];
    for (int i = 0; i < bucket.size(); i++) {
      if (bucket.get(i).getKey().equals(key)) {
        size--;
        return bucket.remove(i).getValue();
      }
    }
    return null;
  }

  @SuppressWarnings("unchecked")
  private void rehash() {
    List<Pair<K, V>>[] old = map;
    map = (List<Pair<K, V>>[]) new List[old.length * 2];
    for (int i = 0; i < map.length; i++) map[i] = new LinkedList<>();
    for (List<Pair<K, V>> bucket : old) {
      for (Pair<K, V> pair : bucket) {
        map[calculateIndex(pair.getKey())].add(pair);
      }
    }
  }

  private static class Pair<K, V> {
    private final K k;
    private V v;
    public Pair(K k, V v) { this.k = k; this.v = v; }
    public K getKey() { return k; }
    public V getValue() { return v; }
    public void setValue(V v) { this.v = v; }
  }
}`;
const at = lineFinder(source);

// Java's hashCode: String (s[0]*31^(n-1) + …, 32-bit) and Integer (the value itself).
export function javaHash(k) {
  if (typeof k === 'number') return k | 0;
  let h = 0;
  const s = String(k);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; // UTF-16 units, as Java
  return h;
}
const keyOf = (s) => (/^-?\d+$/.test(s) ? Number(s) : s);
// "add Ana 7", "put Ana 7", "get Ana", "remove Ana" (one per line or separated by ;).
export function parseOps(text) {
  const ops = [], problems = [];
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const op = parts[0].toLowerCase();
    if ((op === 'add' || op === 'put') && parts.length >= 3) ops.push({ op: 'add', key: keyOf(parts[1]), value: keyOf(parts.slice(2).join(' ')) });
    else if ((op === 'get' || op === 'remove') && parts.length === 2) ops.push({ op, key: keyOf(parts[1]) });
    else problems.push(raw.trim());
  }
  return { ops: ops.slice(0, 40), problems };
}
const OPS = 'add Ana 7\nadd Luis 3\nadd Eva 9\nadd Ana 8\nget Eva\nadd Xoan 2\nadd Iria 5\nremove Luis\nget Luis';

export default {
  id: 'hashmap',
  topic: 'maps',
  name: 'HashMap (chaining and rehash)',
  hint: 'The course’s HashMap: buckets of pairs, collisions in the same list, rehash when too full',
  fields: [
    { key: 'ops', type: 'text', label: 'Operations', hint: 'add key value · get key · remove key (one per line)' },
    { key: 'capacity', type: 'int', label: 'Initial capacity', min: 1, max: 16 },
    { key: 'maxLoad', type: 'number', label: 'Rehash above load factor (0: never)', min: 0, max: 4, step: 0.05 },
  ],
  presets: [
    { label: 'Names, with a rehash', input: { ops: OPS, capacity: 4, maxLoad: 0.75 } },
    { label: 'Collisions, no rehash', input: { ops: 'add 3 a\nadd 8 b\nadd 13 c\nadd 4 d\nget 13\nremove 8\nget 13', capacity: 5, maxLoad: 0 } },
  ],
  random(seed) {
    const r = rng(seed), names = ['Ana', 'Luis', 'Eva', 'Xoan', 'Iria', 'Brais', 'Uxía', 'Noa', 'Hugo', 'Sara'];
    const lines = [];
    for (let k = 0; k < r.int(6, 9); k++) { const n = r.pick(names); lines.push(r.next() < 0.7 ? `add ${n} ${r.int(1, 20)}` : `${r.next() < 0.5 ? 'get' : 'remove'} ${n}`); }
    return { ops: lines.join('\n'), capacity: r.int(3, 6), maxLoad: 0.75 };
  },
  normalize(raw = {}) {
    const ops = typeof raw.ops === 'string' ? raw.ops : OPS;
    const { problems } = parseOps(ops);
    if (problems.length) throw Error(`Not an operation: "${problems[0]}" (write add key value, get key or remove key)`);
    const maxLoad = Number(raw.maxLoad);
    return { ops, capacity: clampInt(raw.capacity, 1, 16, 4), maxLoad: Number.isFinite(maxLoad) && maxLoad >= 0 ? Math.min(4, maxLoad) : 0.75 };
  },
  source,
  run(input, t) {
    const { ops } = parseOps(input.ops);
    const table = t.hashTable('map', { label: 'map (buckets)', capacity: input.capacity, maxLoad: input.maxLoad || 0 });
    const last = t.value('result', null, { label: 'returned' });
    const index = (k) => Math.abs(javaHash(k) % table.capacity);
    const results = [];
    const lookup = (key, fn) => {
      const h = javaHash(key), i = index(key);
      t.step(`${JSON.stringify(key)}.hashCode() = ${h}; |${h} % ${table.capacity}| = ${i}: bucket ${i}`, { line: at('return Math.abs(key.hashCode() % map.length)'), vars: { key, hashCode: h, index: i }, marks: { map: { [i]: 'current' } } });
      const chain = table.bucket(i);
      for (let j = 0; j < chain.length; j++) {
        const same = chain[j].k === key;
        t.step(same ? `${JSON.stringify(chain[j].k)} equals ${JSON.stringify(key)}: found` : `${JSON.stringify(chain[j].k)} is not ${JSON.stringify(key)}: next`, { line: at(fn === 'remove' ? 'if (bucket.get(i).getKey().equals(key))' : 'if (pair.getKey().equals(key))', fn === 'add' ? 2 : 1), vars: { key, index: i, j }, marks: { map: { [i]: 'current', [`k:${chain[j].k}`]: same ? 'path' : 'compare' } } });
        if (same) return { i, j, found: chain[j] };
      }
      return { i, j: -1, found: null };
    };
    t.step(`An empty HashMap with ${input.capacity} buckets`, { line: at('for (int i = 0; i < capacity; i++) this.map[i] = new LinkedList<>()') });
    for (const op of ops) {
      t.call(op.op, op.op === 'add' ? `${op.key}, ${op.value}` : op.key);
      if (op.op === 'get') {
        const { found } = lookup(op.key, 'get');
        last.set(found ? found.v : null);
        results.push(found ? found.v : null);
        t.step(`get(${JSON.stringify(op.key)}) returns ${found ? found.v : 'null'}`, { line: at(found ? 'return pair.getValue()' : 'return null;', found ? 1 : 2), vars: { key: op.key } });
      } else if (op.op === 'remove') {
        const { i, j, found } = lookup(op.key, 'remove');
        if (found) {
          table.removeAt(i, j); table.setSize(table.size - 1);
          last.set(found.v); results.push(found.v);
          t.step(`remove(${JSON.stringify(op.key)}): the pair leaves bucket ${i}; returns ${found.v}`, { line: at('return bucket.remove(i).getValue()'), vars: { key: op.key }, marks: { map: { [i]: 'current' } } });
        } else {
          last.set(null); results.push(null);
          t.step(`remove(${JSON.stringify(op.key)}): not there, returns null`, { line: at('return null;', 4), vars: { key: op.key } });
        }
      } else {
        const { i, j, found } = lookup(op.key, 'add');
        if (found) {
          table.setValue(i, j, op.value);
          t.step(`${JSON.stringify(op.key)} was there: its value becomes ${op.value}`, { line: at('pair.setValue(value)'), vars: { key: op.key, value: op.value }, marks: { map: { [`k:${op.key}`]: 'current' } } });
        } else {
          table.append(i, op.key, op.value); table.setSize(table.size + 1);
          const load = table.size / table.capacity;
          t.step(`Add (${op.key}, ${op.value}) at the end of bucket ${i}${table.bucket(i).length > 1 ? ' (a collision: the list grows)' : ''}; size ${table.size}, load factor ${load.toFixed(2)}`, { line: at('bucket.add(new Pair<>(key, value))'), vars: { key: op.key, value: op.value, size: table.size }, marks: { map: { [i]: 'current' } } });
          if (input.maxLoad && load > input.maxLoad) {
            t.call('rehash');
            const old = table.resize(table.capacity * 2);
            t.step(`${load.toFixed(2)} > ${input.maxLoad}: rehash into ${table.capacity} buckets`, { line: at('map = (List<Pair<K, V>>[]) new List[old.length * 2]'), vars: { size: table.size, length: table.capacity } });
            for (const bucket of old) for (const e of bucket) {
              const ni = index(e.k);
              table.append(ni, e.k, e.v);
              t.step(`${JSON.stringify(e.k)}: |${javaHash(e.k)} % ${table.capacity}| = ${ni}, to bucket ${ni}`, { line: at('map[calculateIndex(pair.getKey())].add(pair)'), vars: { key: e.k, index: ni }, marks: { map: { [ni]: 'current', [`k:${e.k}`]: 'current' } } });
            }
            t.ret();
          }
        }
      }
      t.ret();
    }
    t.step(`Done: ${table.size} pairs in ${table.capacity} buckets`, { line: null, vars: {} });
    return { results, buckets: Array.from({ length: table.capacity }, (_, i) => table.bucket(i).map((e) => [e.k, e.v])) };
  },
};
