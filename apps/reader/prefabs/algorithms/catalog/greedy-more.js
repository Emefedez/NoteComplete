// Greedy algorithms (activity 8) on the activity's data: travelling salesman by the nearest
// neighbour, map colouring, exam schedule, give change, burn a CD, fill the rucksack, plan
// activities; and Kruskal with union-find (an extra). The course's graphs keep their vertices
// in a HashSet: the presets list them in the order that set gives, so the colours come out as
// in the activity's tests.
import { lineFinder, normalizeGraph, placed, adjacency, edgeKey, randomGraph, startOf, rng, clampInt } from './common.js';

const pos = { ONE: [40, 130], TWO: [170, 40], THREE: [300, 130], FOUR: [300, 250], FIVE: [430, 190], SIX: [170, 250] };
const node = (id) => ({ id, x: pos[id][0], y: pos[id][1] });
const w = (from, to, v) => ({ from, to, w: v });
// GRAPH_TRAVELLER_PRIM / GRAPH_COLOUR of the activity's tests (vertices in HashSet order).
export const ACTIVITY_GRAPH = {
  nodes: ['FIVE', 'SIX', 'ONE', 'FOUR', 'TWO', 'THREE'].map(node),
  edges: [w('ONE', 'TWO', 3), w('TWO', 'THREE', 7), w('THREE', 'FOUR', 5), w('TWO', 'SIX', 10), w('ONE', 'SIX', 5), w('THREE', 'FIVE', 1), w('SIX', 'FOUR', 2), w('SIX', 'THREE', 8), w('FOUR', 'FIVE', 6)],
  directed: false,
};
const SCHEDULE = {
  nodes: [{ id: 'BD', x: 60, y: 60 }, { id: 'AEDII', x: 200, y: 40 }, { id: 'EST', x: 360, y: 60 }, { id: 'AL', x: 120, y: 220 }, { id: 'SO', x: 260, y: 170 }],
  edges: ['AL', 'AEDII', 'EST', 'BD'].map((v) => ({ from: 'SO', to: v })).concat([{ from: 'AEDII', to: 'BD' }, { from: 'AL', to: 'AEDII' }]),
  directed: false,
};
const showGraph = (graph, t, label = 'graph') => t.graph('graph', { nodes: placed(graph), edges: graph.edges, directed: graph.directed }, { label });
// "name a b …" lines → [{ name, nums: [a, b…] }].
function rows(text, count, what) {
  const out = [];
  for (const raw of String(text || '').split(/[\n;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = line.split(/\s+/);
    const nums = p.slice(1).map(Number);
    if (p.length !== count + 1 || nums.some((n) => !Number.isFinite(n) || n < 0)) throw Error(`Not ${what}: "${line}"`);
    out.push({ name: p[0], nums });
  }
  return out.slice(0, 16);
}

const travSource = `public static <T> Graph<T, Integer> traveller(Graph<T, Integer> graph, Vertex<T> vertex) {
  Graph<T, Integer> route = new AdjacencyList<>();
  Set<Vertex<T>> visited = new HashSet<>();
  Vertex<T> current = vertex;
  visited.add(current);
  route.addVertex(current);
  while (visited.size() < graph.getVertices().size()) {
    Vertex<T> nearest = null;
    int best = Integer.MAX_VALUE;
    for (Vertex<T> v : graph.getAdjacentsVertex(current)) {
      int distance = weight(graph, current, v);
      if (!visited.contains(v) && distance < best) { best = distance; nearest = v; }
    }
    if (nearest == null) break;                         // stuck: no new neighbour
    route.addVertex(nearest);
    route.addEdge(current, nearest, best);              // go to the nearest one
    visited.add(nearest);
    current = nearest;
  }
  return route;
}`;
const vAt = lineFinder(travSource);
export const traveller = {
  id: 'traveller', topic: 'greedy', name: 'Travelling salesman (nearest neighbour)',
  hint: 'From each city, go to the nearest one not yet visited',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph', weighted: true, directed: false }, { key: 'start', type: 'vertex', label: 'Start', of: 'graph' }],
  presets: [{ label: 'Activity graph from ONE', input: { graph: ACTIVITY_GRAPH, start: 'ONE' } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: 6, weighted: true, extra: 6 }), start: 'A' }; },
  normalize(raw = {}) { const graph = normalizeGraph(raw.graph ?? ACTIVITY_GRAPH, { weighted: true, directed: false }); return { graph, start: startOf(graph, raw.start ?? 'ONE') }; },
  source: travSource,
  run({ graph, start }, t) {
    const adj = adjacency(graph);
    showGraph(graph, t, 'graph (the route in green)');
    const route = t.array('route', [start], { label: 'route' });
    const total = t.value('length', 0, { label: 'length' });
    const visited = new Set([start]);
    let current = start;
    t.mark('graph', start, 'done');
    t.step(`Start at ${start}`, { line: vAt('visited.add(current)'), vars: { current } });
    while (visited.size < graph.nodes.length) {
      let nearest = null, best = Infinity;
      for (const { to, w: d } of adj.get(current)) {
        const better = !visited.has(to) && d < best;
        t.step(visited.has(to) ? `${to} is visited` : `${current}–${to}: ${d}${better ? ', the nearest so far' : ''}`, { line: vAt('if (!visited.contains(v) && distance < best)'), vars: { current, v: to, distance: d, best: best === Infinity ? '∞' : best }, marks: { graph: { [current]: 'current', [to]: 'compare', [edgeKey(current, to)]: 'compare' } } });
        if (better) { best = d; nearest = to; }
      }
      if (!nearest) { t.step(`No unvisited neighbour of ${current}: stuck`, { line: vAt('if (nearest == null) break'), vars: { current } }); break; }
      t.mark('graph', edgeKey(current, nearest), 'path'); t.mark('graph', nearest, 'done');
      route.push(nearest); total.set(total.get() + best);
      t.step(`Go to ${nearest} (${best})`, { line: vAt('route.addEdge(current, nearest, best)'), vars: { current, nearest, best }, marks: { graph: { [nearest]: 'current' } } });
      visited.add(nearest); current = nearest;
    }
    t.step(`Route ${route.toArray().join(' → ')}, length ${total.get()}`, { line: vAt('return route'), vars: {} });
    return { route: route.toArray(), length: total.get() };
  },
};

const colourSource = `public static <T> Map<Vertex<T>, String> colourMap(Graph<T, Integer> graph, String[] colours) {
  Map<Vertex<T>, String> result = new HashMap<>();
  for (Vertex<T> vertex : graph.getVertices()) {
    for (String colour : colours) {
      boolean free = true;
      for (Vertex<T> adjacent : graph.getAdjacentsVertex(vertex)) {
        if (colour.equals(result.get(adjacent))) free = false;   // a neighbour has it
      }
      if (free) { result.add(vertex, colour); break; }        // the first colour that fits
    }
  }
  return result;
}`;
const kAt = lineFinder(colourSource);
// Shared by colouring and the exam schedule: the first label no neighbour has.
function colouring(t, graph, labels, at, what) {
  const adj = adjacency(graph);
  const g = showGraph(graph, t);
  const result = t.map('result', [], { label: 'result' });
  const got = new Map();
  for (const n of graph.nodes) {
    let chosen = null;
    for (const c of labels) {
      const clash = adj.get(n.id).find(({ to }) => got.get(to) === c);
      t.step(clash ? `${n.id}: ${c}? ${clash.to} has it` : `${n.id}: ${c} — no neighbour has it`, { line: clash ? at('free = false') : at('if (free) { result.add(vertex,'), vars: { vertex: n.id, [what]: c }, marks: { graph: { [n.id]: 'current', ...(clash ? { [clash.to]: 'error', [edgeKey(n.id, clash.to)]: 'error' } : {}) } } });
      if (!clash) { chosen = c; break; }
    }
    if (chosen) { got.set(n.id, chosen); g.setValue(n.id, chosen); result.set(n.id, chosen); t.mark('graph', n.id, 'done'); }
    else t.step(`No ${what} left for ${n.id}`, { line: null, vars: { vertex: n.id } });
  }
  t.step(`Done: ${[...got].map(([k, v]) => `${k} ${v}`).join(', ')}`, { line: at('return result'), vars: {} });
  return Object.fromEntries(got);
}
export const colourMap = {
  id: 'colour-map', topic: 'greedy', name: 'Map colouring',
  hint: 'Each vertex takes the first colour none of its neighbours has',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph', weighted: false, directed: false }, { key: 'colours', type: 'line', label: 'Colours, in order' }],
  presets: [{ label: 'Activity graph', input: { graph: ACTIVITY_GRAPH, colours: 'red blue green yellow' } }],
  random(seed) { return { graph: randomGraph(rng(seed), { n: 7, weighted: false, extra: 5 }), colours: 'red blue green yellow' }; },
  normalize(raw = {}) { const colours = typeof raw.colours === 'string' ? raw.colours : 'red blue green yellow'; if (!colours.trim()) throw Error('Write some colours'); return { graph: normalizeGraph(raw.graph ?? ACTIVITY_GRAPH, { directed: false }), colours }; },
  source: colourSource,
  run({ graph, colours }, t) { return colouring(t, graph, colours.split(/[\s,]+/).filter(Boolean), kAt, 'colour'); },
};

const examSource = colourSource.replace('colourMap(Graph<T, Integer> graph, String[] colours)', 'examSchedule(Graph<T, Integer> graph, String[] daysWeek)').replace(/colours/g, 'daysWeek').replace(/colour/g, 'day').replace('// a neighbour has it', '// an exam that shares students').replace('// the first colour that fits', '// the first free day');
const eAt = lineFinder(examSource);
export const examSchedule = {
  id: 'exam-schedule', topic: 'greedy', name: 'Exam schedule',
  hint: 'Subjects that share students (an edge) cannot have their exam on the same day',
  fields: [{ key: 'graph', type: 'graph', label: 'Subjects (an edge: shared students)', weighted: false, directed: false }, { key: 'days', type: 'line', label: 'Days, in order' }],
  presets: [{ label: 'Activity subjects', input: { graph: SCHEDULE, days: 'monday tuesday wednesday thursday friday' } }],
  random(seed) { return { graph: randomGraph(rng(seed), { n: 6, weighted: false, extra: 4 }), days: 'monday tuesday wednesday thursday friday' }; },
  normalize(raw = {}) { const days = typeof raw.days === 'string' ? raw.days : 'monday tuesday wednesday thursday friday'; return { graph: normalizeGraph(raw.graph ?? SCHEDULE, { directed: false }), days }; },
  source: examSource,
  run({ graph, days }, t) { return colouring(t, graph, days.split(/[\s,]+/).filter(Boolean), eAt, 'day'); },
};

const changeSource = `public static Map<Integer, Integer> giveChange(int amountReturned, Map<Integer, Integer> changeAvailable) {
  Map<Integer, Integer> solution = new HashMap<>();
  List<Integer> coins = new ArrayList<>(changeAvailable.getKeys());
  coins.sort(Collections.reverseOrder());                // the largest first
  for (int coin : coins) {
    int count = Math.min(amountReturned / coin, changeAvailable.get(coin));
    if (count > 0) {
      solution.add(coin, count);
      amountReturned -= count * coin;
    }
  }
  return amountReturned == 0 ? solution : null;        // null: no exact change
}`;
const cAt = lineFinder(changeSource);
export const giveChange = {
  id: 'give-change', topic: 'greedy', name: 'Give change',
  hint: 'As many of the largest coin as fit (and are left), then the next',
  fields: [{ key: 'amount', type: 'int', label: 'Amount', min: 0, max: 100000 }, { key: 'coins', type: 'text', label: 'Coins', hint: 'coin how-many, one per line' }],
  presets: [{ label: '1200 with 500 and 200', input: { amount: 1200, coins: '500 20\n200 10' } }, { label: 'Greedy fails: 6 with 4, 3', input: { amount: 6, coins: '4 5\n3 5\n1 0' } }],
  random(seed) { const r = rng(seed); return { amount: r.int(10, 99) * 10, coins: '200 3\n100 4\n50 5\n20 6\n10 9' }; },
  normalize(raw = {}) { const coins = typeof raw.coins === 'string' ? raw.coins : '500 20\n200 10'; if (rows(coins, 1, 'a coin and how many').some((c) => !Number.isInteger(Number(c.name)) || Number(c.name) <= 0)) throw Error('Coins are whole numbers'); return { amount: clampInt(raw.amount, 0, 100000, 1200), coins }; },
  source: changeSource,
  run({ amount, coins }, t) {
    const list = rows(coins, 1, '').map((c) => ({ coin: Number(c.name), have: c.nums[0] })).sort((a, b) => b.coin - a.coin);
    const avail = t.map('available', list.map((c) => [c.coin, c.have]), { label: 'changeAvailable' });
    const sol = t.map('solution', [], { label: 'solution' });
    const left = t.value('left', amount, { label: 'amountReturned' });
    t.step(`Give ${amount}, the largest coins first: ${list.map((c) => c.coin).join(', ')}`, { line: cAt('coins.sort(Collections.reverseOrder())'), vars: { amountReturned: amount } });
    let rest = amount;
    for (const { coin, have } of list) {
      const count = Math.min(Math.floor(rest / coin), have);
      t.step(`${coin}: ${rest} / ${coin} = ${Math.floor(rest / coin)}, ${have} left: take ${count}`, { line: cAt('int count = Math.min'), vars: { coin, count, amountReturned: rest }, marks: { available: { [coin]: 'current' } } });
      if (count > 0) { sol.set(coin, count); avail.set(coin, have - count); rest -= count * coin; left.set(rest); t.step(`${count} × ${coin}; ${rest} left`, { line: cAt('amountReturned -= count * coin'), vars: { coin, count, amountReturned: rest }, marks: { solution: { [coin]: 'new' } } }); }
    }
    t.step(rest === 0 ? `Exact change: ${sol.entries().map(([c, n]) => `${n} × ${c}`).join(', ')}` : `${rest} cannot be given: null (greedy is not always right)`, { line: cAt('return amountReturned == 0 ? solution : null'), vars: {} });
    return rest === 0 ? Object.fromEntries(sol.entries()) : null;
  },
};

const cdSource = `public static Set<String> burnCD(int maximumCapacity, Map<String, Integer> espacePrograms) {
  Set<String> cd = new HashSet<>();
  List<String> programs = new ArrayList<>(espacePrograms.getKeys());
  programs.sort((a, b) -> espacePrograms.get(b) - espacePrograms.get(a));   // the largest first
  int free = maximumCapacity;
  for (String program : programs) {
    if (espacePrograms.get(program) <= free) {        // it fits
      cd.add(program);
      free -= espacePrograms.get(program);
    }
  }
  return cd;
}`;
const dAt = lineFinder(cdSource);
export const burnCD = {
  id: 'burn-cd', topic: 'greedy', name: 'Burn a CD',
  hint: 'The largest programs first, each one that still fits',
  fields: [{ key: 'capacity', type: 'int', label: 'Capacity', min: 1, max: 10000 }, { key: 'programs', type: 'text', label: 'Programs', hint: 'name size, one per line' }],
  presets: [{ label: 'Activity: 21 with p1…p5', input: { capacity: 21, programs: 'p1 10\np2 3\np3 5\np4 3\np5 3' } }],
  random(seed) { const r = rng(seed); return { capacity: r.int(15, 30), programs: Array.from({ length: 6 }, (_, i) => `p${i + 1} ${r.int(2, 12)}`).join('\n') }; },
  normalize(raw = {}) { const programs = typeof raw.programs === 'string' ? raw.programs : 'p1 10\np2 3\np3 5\np4 3\np5 3'; rows(programs, 1, 'a program and its size'); return { capacity: clampInt(raw.capacity, 1, 10000, 21), programs }; },
  source: cdSource,
  run({ capacity, programs }, t) {
    const list = rows(programs, 1, '').map((p) => ({ name: p.name, size: p.nums[0] }));
    const sorted = list.map((p, i) => ({ ...p, i })).sort((a, b) => b.size - a.size || a.i - b.i);
    const arr = t.array('programs', sorted.map((p) => `${p.name}:${p.size}`), { label: 'programs, largest first' });
    const cd = t.hashSet('cd', [], { label: 'cd' });
    const free = t.value('free', capacity, { label: 'free' });
    t.step(`Capacity ${capacity}; the programs from the largest`, { line: dAt('programs.sort('), vars: { free: capacity } });
    let left = capacity;
    sorted.forEach((p, i) => {
      arr.pointer('program', i);
      const fits = p.size <= left;
      if (fits) { cd.add(p.name); left -= p.size; free.set(left); t.mark('programs', i, 'done'); }
      t.step(fits ? `${p.name} (${p.size}) fits: burn it; ${left} free` : `${p.name} (${p.size}) does not fit in ${left}`, { line: fits ? dAt('free -= espacePrograms.get(program)') : dAt('if (espacePrograms.get(program) <= free)'), vars: { program: p.name, free: left }, marks: { programs: { [i]: fits ? 'path' : 'error' } } });
    });
    arr.pointer('program', null);
    t.step(`On the CD: {${cd.toArray().join(', ')}}, ${capacity - left} of ${capacity} used`, { line: dAt('return cd'), vars: {} });
    return cd.toArray();
  },
};

const rsSource = `public static Map<String, Integer> fillRucksack(int maxVolume, Map<String, Integer> amounts, Map<String, Integer> volumes) {
  Map<String, Integer> result = new HashMap<>();
  List<String> objects = new ArrayList<>(volumes.getKeys());
  objects.sort((a, b) -> volumes.get(b) - volumes.get(a));    // the largest first
  int free = maxVolume;
  for (String object : objects) {
    int units = Math.min(amounts.get(object), free / volumes.get(object));
    if (units > 0) {
      result.add(object, units);
      free -= units * volumes.get(object);
    }
  }
  return result;
}`;
const rAt = lineFinder(rsSource);
export const fillRucksack = {
  id: 'fill-rucksack', topic: 'greedy', name: 'Fill the rucksack',
  hint: 'Whole units of the largest objects first, as many as are left and fit',
  fields: [{ key: 'capacity', type: 'int', label: 'Volume', min: 1, max: 10000 }, { key: 'objects', type: 'text', label: 'Objects', hint: 'name how-many volume, one per line' }],
  presets: [{ label: 'Activity: 55 with cars and dolls', input: { capacity: 55, objects: 'car 5 10\ndoll 4 20' } }, { label: 'Three objects', input: { capacity: 40, objects: 'tent 1 25\nbook 4 4\nmug 6 3' } }],
  random(seed) { const r = rng(seed); return { capacity: r.int(30, 80), objects: ['car', 'doll', 'ball', 'kite'].map((n) => `${n} ${r.int(1, 5)} ${r.int(3, 20)}`).join('\n') }; },
  normalize(raw = {}) { const objects = typeof raw.objects === 'string' ? raw.objects : 'car 5 10\ndoll 4 20'; if (rows(objects, 2, 'an object, how many and its volume').some((o) => o.nums[1] <= 0)) throw Error('Volumes above 0'); return { capacity: clampInt(raw.capacity, 1, 10000, 55), objects }; },
  source: rsSource,
  run({ capacity, objects }, t) {
    const list = rows(objects, 2, '').map((o) => ({ name: o.name, amount: o.nums[0], volume: o.nums[1] }));
    const sorted = list.map((o, i) => ({ ...o, i })).sort((a, b) => b.volume - a.volume || a.i - b.i);
    const arr = t.array('objects', sorted.map((o) => `${o.name}:${o.volume}×${o.amount}`), { label: 'objects (volume × how many), largest first' });
    const result = t.map('result', [], { label: 'result' });
    const free = t.value('free', capacity, { label: 'free' });
    let left = capacity;
    t.step(`Volume ${capacity}; the largest objects first`, { line: rAt('objects.sort('), vars: { free: capacity } });
    sorted.forEach((o, i) => {
      arr.pointer('object', i);
      const units = Math.min(o.amount, Math.floor(left / o.volume));
      t.step(`${o.name}: ${o.amount} left, ${Math.floor(left / o.volume)} fit in ${left}: take ${units}`, { line: rAt('int units = Math.min'), vars: { object: o.name, units, free: left }, marks: { objects: { [i]: 'current' } } });
      if (units > 0) { result.set(o.name, units); left -= units * o.volume; free.set(left); t.mark('objects', i, 'done'); t.step(`${units} × ${o.name}; ${left} free`, { line: rAt('free -= units * volumes.get(object)'), vars: { object: o.name, units, free: left }, marks: { result: { [o.name]: 'new' } } }); }
    });
    arr.pointer('object', null);
    t.step(`In the rucksack: ${result.entries().map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}; ${left} free`, { line: rAt('return result'), vars: {} });
    return Object.fromEntries(result.entries());
  },
};

const planSource = `public static Set<String> plannerActivities(List<Activity> listActivities) {
  Set<String> chosen = new HashSet<>();
  List<Activity> activities = new ArrayList<>(listActivities);
  activities.sort((a, b) -> a.getEnd() - b.getEnd());          // the earliest to end first
  int free = Integer.MIN_VALUE;
  for (Activity activity : activities) {
    if (activity.getStart() >= free) {                         // it starts after the last one
      chosen.add(activity.getName());
      free = activity.getEnd();
    }
  }
  return chosen;
}`;
const pAt = lineFinder(planSource);
export const planner = {
  id: 'activity-planner', topic: 'greedy', name: 'Activity planner',
  hint: 'The most activities without overlaps: always the one that ends first',
  fields: [{ key: 'activities', type: 'text', label: 'Activities', hint: 'name start end, one per line' }],
  presets: [{ label: 'Activity data (act1, act5, act4)', input: { activities: 'act1 8 10\nact2 9 12\nact3 10 13\nact4 13 14\nact5 10 12\nact6 12 14' } }],
  random(seed) { const r = rng(seed); return { activities: Array.from({ length: 7 }, (_, i) => { const s = r.int(8, 17); return `a${i + 1} ${s} ${s + r.int(1, 3)}`; }).join('\n') }; },
  normalize(raw = {}) { const activities = typeof raw.activities === 'string' ? raw.activities : this.presets[0].input.activities; if (rows(activities, 2, 'an activity, its start and end').some((a) => a.nums[1] < a.nums[0])) throw Error('An activity ends before it starts'); return { activities }; },
  source: planSource,
  run({ activities }, t) {
    const list = rows(activities, 2, '').map((a, i) => ({ name: a.name, start: a.nums[0], end: a.nums[1], i })).sort((a, b) => a.end - b.end || a.i - b.i);
    const arr = t.array('activities', list.map((a) => `${a.name} ${a.start}-${a.end}`), { label: 'activities, by end' });
    const chosen = t.hashSet('chosen', [], { label: 'chosen' });
    const free = t.value('free', '−∞', { label: 'free from' });
    let at = -Infinity;
    t.step('Sort the activities by when they end', { line: pAt('activities.sort('), vars: {} });
    list.forEach((a, i) => {
      arr.pointer('activity', i);
      const ok = a.start >= at;
      if (ok) { chosen.add(a.name); at = a.end; free.set(at); t.mark('activities', i, 'path'); }
      else t.mark('activities', i, 'done');
      t.step(ok ? `${a.name} (${a.start}–${a.end}) starts at ${a.start} ≥ ${at === a.end ? '' : ''}the last end: take it` : `${a.name} starts at ${a.start}, before ${at}: it overlaps`, { line: ok ? pAt('free = activity.getEnd()') : pAt('if (activity.getStart() >= free)'), vars: { activity: a.name, free: at }, marks: { activities: { [i]: ok ? 'current' : 'error' } } });
    });
    arr.pointer('activity', null);
    t.step(`Chosen: {${chosen.toArray().join(', ')}}`, { line: pAt('return chosen'), vars: {} });
    return chosen.toArray();
  },
};

const kruskalSource = `public static <T> Graph<T, Integer> kruskal(Graph<T, Integer> graph) {
  Graph<T, Integer> tree = new AdjacencyList<>();
  Map<Vertex<T>, Vertex<T>> parent = new HashMap<>();      // union-find
  for (Vertex<T> v : graph.getVertices()) { parent.add(v, v); tree.addVertex(v); }
  List<Edge<T, Integer>> edges = new ArrayList<>(graph.getEdges());
  edges.sort((a, b) -> a.getLabel() - b.getLabel());       // the lightest first
  for (Edge<T, Integer> edge : edges) {
    Vertex<T> a = find(parent, edge.getSource());
    Vertex<T> b = find(parent, edge.getTarget());
    if (!a.equals(b)) {                                    // different trees: join them
      parent.add(a, b);
      tree.addEdge(edge.getSource(), edge.getTarget(), edge.getLabel());
    }
  }
  return tree;
}

private static <T> Vertex<T> find(Map<Vertex<T>, Vertex<T>> parent, Vertex<T> v) {
  while (!parent.get(v).equals(v)) v = parent.get(v);     // up to the root of its tree
  return v;
}`;
const uAt = lineFinder(kruskalSource);
export const kruskal = {
  id: 'kruskal', topic: 'greedy', name: 'Kruskal (union-find)',
  hint: 'Minimum spanning tree: the lightest edges first, unless they join a tree to itself',
  fields: [{ key: 'graph', type: 'graph', label: 'Graph (undirected)', weighted: true, directed: false }],
  presets: [{ label: 'Activity graph', input: { graph: ACTIVITY_GRAPH } }],
  random(seed) { const r = rng(seed); return { graph: randomGraph(r, { n: r.int(5, 7), weighted: true, extra: 4 }) }; },
  normalize(raw = {}) { return { graph: normalizeGraph(raw.graph ?? ACTIVITY_GRAPH, { weighted: true, directed: false }) }; },
  source: kruskalSource,
  run({ graph }, t) {
    showGraph(graph, t, 'graph (tree edges in green)');
    const edges = graph.edges.map((e, i) => ({ ...e, i })).sort((a, b) => a.w - b.w || a.i - b.i);
    const arr = t.array('edges', edges.map((e) => `${e.from}-${e.to}:${e.w}`), { label: 'edges, lightest first' });
    const parent = t.map('parent', graph.nodes.map((n) => [n.id, n.id]), { label: 'parent (union-find)' });
    const total = t.value('weight', 0, { label: 'tree weight' });
    t.step('Each vertex is a tree of its own; the edges sorted by weight', { line: uAt('edges.sort('), vars: {} });
    const find = (v) => { while (parent.get(v) !== v) v = parent.get(v); return v; };
    const chosen = [];
    edges.forEach((e, i) => {
      arr.pointer('edge', i);
      const a = find(e.from), b = find(e.to);
      t.step(`${e.from}–${e.to} (${e.w}): ${e.from} is in the tree of ${a}, ${e.to} in the tree of ${b}`, { line: uAt('Vertex<T> b = find(parent, edge.getTarget())'), vars: { a, b }, marks: { graph: { [edgeKey(e.from, e.to)]: 'current', [a]: 'compare', [b]: 'compare' }, edges: { [i]: 'current' } } });
      if (a !== b) {
        parent.set(a, b); chosen.push(e); total.set(total.get() + e.w);
        t.mark('graph', edgeKey(e.from, e.to), 'path'); t.mark('edges', i, 'path');
        t.step(`Different trees: join them (parent of ${a} = ${b}); weight ${total.get()}`, { line: uAt('parent.add(a, b)'), vars: { a, b } });
      } else { t.mark('graph', edgeKey(e.from, e.to), 'removed'); t.mark('edges', i, 'done'); t.step(`Same tree: it would close a cycle`, { line: uAt('if (!a.equals(b))'), vars: { a, b } }); }
    });
    arr.pointer('edge', null);
    t.step(`Minimum spanning tree: ${chosen.length} edges, weight ${total.get()}`, { line: uAt('return tree'), vars: {} });
    return { weight: total.get(), edges: chosen.map((e) => `${e.from}-${e.to}`) };
  },
};
