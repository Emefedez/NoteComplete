# Animated algorithms (prefab module "algorithms")

Owner's request (2026-11-18): node graphs and other prefabs can be played as animated
algorithms, step by step, showing what changes in the heap, queue, map… and how things move.
Many algorithms come pre-added (at least every one in AEDII's activities, from Dijkstra to
hash maps), sorted alphabetically, with the user's own input; and the user can write their own
in Java (classes included), run through a JavaScript simulation layer.

## What the user sees

- **Insert prefab → Algorithms** (group "algorithms"): a catalog card per algorithm, grouped
  by topic with headings ("Greedy algorithms", "Trees", "Heaps", "Maps and hashing", "Graphs",
  "Backtracking", "Divide and conquer", "Dynamic programming", "Recursion", "Sorting"), topics
  in alphabetical order and algorithms alphabetical inside each; each card is named
  "Topic: Algorithm" ("Greedy: Dijkstra", "Greedy: Prim") so a flat search or a sort by name
  also keeps them grouped. Searchable, filterable by topic, with a sort switch (by topic / by
  name / recently used). Each card has a thumbnail of a middle frame.
- **The player** (a movable kit window, `prefabs/kit/window.js`): the structures drawn on the
  left (graph, array, heap as tree + array, queue, stack, hash table with buckets, map, set,
  tree, matrix/board, recursion/call stack), the code on the right with the current line
  marked, the variables below it. Controls: play/pause (Space), step back/forward (← →),
  first/last (Home/End), speed, a scrubbable timeline with the step's caption ("dist[C] =
  7 < 9: update"), and a "changes" list for the step. What changed is marked (colour,
  "+"/"−" badges, old → new values) and moves are animated between steps (nodes slide,
  array cells swap, items enter/leave queues), respecting prefers-reduced-motion.
- **Input**: each algorithm has an input form (an array as text, a graph drawn in the node
  graph editor or as an edge list "A-B 4", a start vertex, n for queens/Hanoi, a knapsack
  table…), random input, and presets. Changing the input re-runs the trace.
- **On the page** the figure is a picture of the chosen step (the player's "Show this step
  on the page"); its menu has Play…, Edit input…, Edit code…. Exported/printed notes show
  that step. (Later: a ▶ on the figure plays inline in the reader and in presentations.)
- **Your own code**: "New from Java…" opens a code editor with a template (a class with
  `run(...)`), the AEDII library classes available (Graph/Vertex/Edge, BinaryTree, Tree,
  Map/HashMap, Set, List, Queue, PriorityQueue, Stack, Deque, arrays). Errors point to the
  line. The run is traced like the built-in ones. JavaScript algorithms are accepted too.

## Starting point: the owner's two simulators

The owner already built two Claude artifacts that translate Java to JavaScript in the browser
and animate the course's structures, linked from aedii-activities/…/coderunner/examen-1.md
and examen-2.md. Their full HTML is saved locally (read-only reference; don't modify):
- "Taller de TADs AED2" (trees and heaps): /home/m1-max/.claude/projects/-home-m1-max-Work/a33cc4f1-2ded-4cab-87c8-d954b9cc80d6/tool-results/artifact-1dd03a53-1792648281-3bed.html
  (https://claude.ai/artifact/4gXWoYiNhsYET4zSv5gNeS): a Java→JS translator, replicas of
  LinkedBinaryTree, LinkedTree, BinaryMaxHeap, LinkedQueue/LinkedStack, a demo player (step,
  speed, scrub, code with the current line, state chips, legend: cur, visit, queued, hit, miss,
  pruned, new, removed, cmp) and tree/array SVG renderers.
- "Taller de Mapas y Grafos" (maps and graphs): /home/m1-max/.claude/projects/-home-m1-max-Work/a33cc4f1-2ded-4cab-87c8-d954b9cc80d6/tool-results/artifact-ca9de954-1794464141-0f14.html
  (https://claude.ai/artifact/S2AFZa2uRypAwSiGDgWXx5): Java helpers (jeq, jstr, String/Number
  shims), ArrayList/LinkedList/ArrayDeque, HashSet, the course's Map (add/get/remove/getKeys/
  getValues, no isEmpty/containsKey), Vertex, Edge, MapOfMap, MapOfDictionary, AdjacencyList,
  Pair, exceptions, a graph SVG viewer with states (cur, done, front, hid; new edges).
Reuse their translator, TAD replicas, definitions and renderers (they are the owner's own
work) rather than writing new ones; adapt them to ES modules, the app's tokens and the trace
contract below. Don't copy their global prototype patches (String.prototype.equals…) into
the app's realm as is: run translated code in a worker or scope those shims.

## Architecture

```
apps/reader/prefabs/algorithms/
  module.json        kind "window" (the player opens in the kit's movable window, not a modal
                     dialog), output "picture", editor "editor.js", group "algorithms",
                     prefabs "code" (render.js prefabs(): one card per algorithm)
  render.js          spec → SVG of one step (pure, no DOM; runs the trace, cached)
  editor.js          the player window + catalog + input forms (algorithms.css)
  trace/             the trace contract and recorder (pure)
  structures/        one SVG renderer per structure kind (pure) + layout (graph positions kept)
  catalog/           the algorithms: { id, name, topic, hint, fields (input schema), presets,
                     random(seed), normalize(input), source (Java, shown), run(input, t) }
                     written in JS against the recorder; lines found by their text
                     (lineFinder), so `line` follows the source
  java/              the Java subset interpreter (lexer, parser, interpreter, library)
  test/
```

### The trace contract (shared by the catalog and the Java layer)

A run produces `trace = { structures: {id: {kind, label}}, steps: [step] }`. A step is a
full snapshot (simple to scrub and to draw a single step on the page) plus what changed:

```js
step = {
  caption: "Extract A (dist 0) from the priority queue",
  line: 12,                       // line in the shown source (1-based), or null
  vars: { u: "A", d: 0 },          // locals shown under the code
  state: { <structureId>: <snapshot> },
  changes: [{ id, op, path, from, to }],   // op: set, add, remove, move, swap, mark, visit
  marks: { <structureId>: { <elementKey>: "current" | "visited" | "done" | "compare" | "path" | "error" } },
  calls: [{ fn: "dfs", args: "B" }],        // call stack, innermost last
}
```

Snapshot shapes by `kind`: `graph` {nodes:[{id,label,x?,y?,value?}], edges:[{from,to,w?,directed}]},
`array` {items:[…], pointers:{i:2, j:5}}, `heap` {items:[…], kind:"max"|"min"} (drawn as tree +
array), `queue`/`stack`/`deque` {items}, `pq` {items:[{key,prio}]}, `hashtable` {buckets:[[{k,v}]],
size, loadFactor}, `map`/`set` {entries | items}, `tree` / `binarytree` {root: {id,label,children|left/right}},
`matrix` {rows, cols, cells, highlight}, `board` (queens, sudoku, maze) {cells}, `value` {value},
`text` {text}. The recorder (`trace/recorder.js`) gives tracked wrappers (`t.array(id, items)`,
`t.graph(...)`, `t.queue(...)`, `t.hashMap(...)` …) whose operations record steps
automatically, plus `t.step(caption, {line, vars})`, `t.mark`, `t.call/ret`. A cap (e.g. 5 000
steps) stops runaway runs with a clear message.

Details fixed by the phase 1 implementation (all optional, so a trace without them still
draws; the Java layer emits the same):
- `trace` also has `version: 1`, and `result` (what the run returned) and `error` (why it
  stopped: the cap or bad input; the last step's caption says it too) when there are.
- Element keys for `marks` and `changes[].path`: array index; heap **position from 1** (the
  course's arrayHeap); graph node id, and edges as `"from-to"` (either order matches when
  undirected); map key; set item; hashtable bucket index (`"3"`) or entry `"k:<key>"` (path
  `[bucket, i]`); matrix and board `"r,c"`; queue/stack/pq index from the front/bottom.
- Snapshots may carry `ids` (one hidden id per item, parallel to `items`) so a swap or a
  shift is drawn as a move; arrays `pointers: {name: index}` and `base` (first index shown);
  stacks `sized: true` (discs, Hanoi); matrices `rowLabels`, `colLabels`.
- Marks: current, visited, done, compare, path, new, removed, error, and `queued` (waiting in
  a queue). A step's own marks (`t.step(…, {marks})`) last that step only; `t.mark` lasts.
- An element changed in a step and not marked is drawn as "new" (adds) and with an
  "old → new" badge (sets).

### The Java simulation layer

Implemented in `apps/reader/prefabs/algorithms/java/` (pure ES modules, no DOM, no eval). A
tree-walking interpreter (not the simulators' regex translator: a real lexer/parser gives
lines, columns and steppable statements), with the owner's TAD replicas ported to ES modules
and no global prototype patches.

```
java/lexer.js  parser.js      tokens (line/column) → AST; generics parsed, erased later
java/values.js                runtime values (int = number, long = BigInt, double/float/char boxed, …)
java/interpreter.js           classes, statements, expressions, steps, tracked structures
java/prelude.js               Throwable and the exception hierarchy, written in Java
java/lib/                     java.lang, java.util and the course's TADs as JS classes
java/library.js               class registry: imports, star imports, default names
java/index.js                 runJava(); java/worker.js runs it in a Worker
java/test/                    node --test suites, fixtures, run.mjs (CLI: prints a run step by step)
```

**API.** `runJava(source, { entry, args, input, recorder, maxSteps, maxMs, maxDepth, maxFrames,
record, shouldCancel, cancelFlag })` → the trace (`{ structures, steps }`) plus `result` (plain
JS), `resultText` (as Java prints it), `output`, `errOutput`, `stepsRun`, `truncated` and, when
the run did not complete, `error: { kind: 'compile'|'runtime'|'limit'|'cancelled'|'internal',
message, line, column, file, exception?, stack? }`. `source` is a string or several files
(`[{ name, text }]`); `entry` is `"Class.method"` (default: `main`); `args` are converted to the
parameter types: numbers, strings, arrays (Java arrays or lists), objects (maps, the course's or
java.util's per the imports), graphs as `{ vertices, edges }` or `"A-B 4, B-C 2"` (`->` for
directed), or `{ $java: "new int[]{1, 2}" }` for anything else. `input` feeds
`new Scanner(System.in)`. Errors are reported on Run (no live checking while typing): syntax
errors from the parser, symbol errors (unknown variable/method, wrong arguments) when the
statement runs, both with line and column; uncaught exceptions with the line where they were
created, their message (Java's, e.g. `Cannot invoke "length()" because "s" is null`) and the
call stack.

**Recorder interface**: the module's one recorder, `trace/recorder.js` (java/index.js's
`createRecorder` is it with `stopAtCap` and `stepMarks`): `structure(id, kind, label)`,
`set(id, snapshot, changes?)`, `mark(id, key, state)` (next step only), `call(fn, args)`,
`ret()`, `step(caption, { line, vars, file })` (false past the cap; the trace is then
`truncated`), `finish(extra)` → trace. The catalog uses the same recorder's tracked
structures (its set is `t.hashSet`) and lasting marks, and throws at the cap. A structure may
first appear in a later step (steps before it have no snapshot of it).

**Steps.** A step per executed statement (after it runs), per loop/if/switch condition (caption
`while (i < n)  → true`, for-each `→ x = 3`), per method entry (`dijkstra(graph, ONE)`) and
return (`return 12`), per catch. Each has the line, the locals of the current frame (and `this.`
fields), the call stack and every structure's snapshot. Library code and the prelude record no
steps; the user's comparators/lambdas called by the library do.

**Structures.** A library object or array bound to a variable, parameter or field becomes a
structure named after it (one per binding site, re-pointed when the variable gets another
object): lists → `array` (`queue`/`deque` when declared as Queue/Deque), Stack/LinkedStack →
`stack`, LinkedQueue → `queue`, ArrayDeque → `deque`, PriorityQueue → `pq`, maps (java.util
and the course's) → `map`, sets → `set`, Graph/AdjacencyList → `graph`, LinkedBinaryTree →
`binarytree`, LinkedTree → `tree`, BinaryMaxHeap → `heap`, StringBuilder → `text`, 1-D arrays
→ `array` (with `pointers` from index variables), 2-D → `matrix`, System.out → `text`
"console". Their operations record `changes` (`add`/`remove`/`set`/`clear` with path and
old/new values); array reads and writes are marked (`compare`/`current`).

**Supported.** Classes (fields, constructors with this()/super(), static and instance methods,
overloading by arity and argument types, static nested, inner (also `outer.new Inner()`), and
anonymous classes, interfaces with default and static methods, abstract classes, simple enums
(values, valueOf, ordinal, switch on enums), records); generics parsed and erased; int, long
(64-bit), short, byte, double, float (printed as Java does), char, boolean with Java's integer
division, overflow, shifts, `/ by zero`, casts, compound-assignment narrowing, char arithmetic;
String (reference `==`, literals interned, the usual methods incl. split/format/repeat/
compareTo), StringBuilder; 1-D, 2-D and jagged arrays with bounds checks; if/else, for,
for-each, while, do, switch (classic with fall-through, arrow, switch expressions with yield,
on int/char/String/enum), labelled break/continue, return, try/catch (multi-catch)/finally,
try-with-resources, throw, user exceptions extending the prelude's; lambdas and method
references (`String::length`, `Integer::compare`, `ArrayList::new`) for Comparator, Consumer,
BiConsumer, Function, Predicate, Supplier, Runnable; static imports; Math, Integer, Long,
Double, Character, Boolean, Objects, Arrays, Collections, List/Set/Map.of, Comparator.comparing,
System.out/err (print, println, printf), Scanner, Random (Java's generator, seed 42 by default).
java.util: ArrayList, LinkedList, Vector, Stack, ArrayDeque, PriorityQueue (Java's heap layout),
HashMap/HashSet (Java's bucket order, resizing and `merge`/`compute` insertion), LinkedHashMap/
Set, TreeMap/TreeSet, iterators failing fast with ConcurrentModificationException. The course:
aed1 LinkedList/LinkedQueue/LinkedStack, aed2 Vertex (prints `" " + value` like the jar), Edge,
AdjacencyList (Graph), MapOfMap, the course's Map/HashMap (50 buckets, no isEmpty/containsKey),
LinkedBinaryTree, LinkedBinarySearchTree, LinkedTree, BinaryMaxHeap, Pair, EmptyException/
EmptyTreeException/HeapEmptyException. Without imports, `HashMap`/`Map` mean the course's, the
other names java.util's; imports decide otherwise.

**Checked against the JVM.** `java/test/fixtures/` has the activities 1, 4, 6, 7 (owner's code)
and 8–11 (the repo's stubs filled in the course's style: Dijkstra, Prim, placeQueens,
quickSelection, Hanoi, fibonacciDynamic, fillRucksackDynamic), each with a driver running its
JUnit cases; the simulator's output equals the JVM's byte for byte (including the owner's heap
bugs that fail the same JUnit tests on the JVM), and the JUnit expected values are asserted.
`Semantics.java` covers the language edge cases against the JVM too.

**Not supported / differences.** Streams; generic type checks (wrong generic types are not
reported; types are erased, primitives are converted at declarations, parameters, returns and
array stores); most compile-time checks (definite assignment only when a value is read,
unreachable code, checked exceptions, missing returns only when reached); local classes;
extending a library class (`class MyList extends ArrayList`); interfaces from java.util as
user-implemented collections (a user `Iterable` works in for-each); boxed `Integer == Integer`
compares values (Java compares references above 127); `list.remove(x)` with an int-valued
Integer removes by index; `keySet()/values()/entrySet()/subList()` are copies, not live views;
`Set.of`/`Map.of` iterate in insertion order (the JVM's is randomized); ternaries do not
promote int/double across branches; threads, I/O beyond System.in/out, reflection, `var` in
lambda parameters, annotations (ignored). Recursion: `StackOverflowError` is thrown (and
catchable) when the JS engine's stack runs out, at about 500 Java frames in Node's default
stack (engine-dependent), or at `maxDepth` (3000). Defaults: 100 000 statements, 10 s, 5 000
recorded steps (`maxFrames`; the run continues past it and `truncated` is set).

## Catalog (first the AEDII activities)

- Recursion (activity 1): factorial, sum of digits, gcd (Euclid), invert string/array,
  minimum, binary search; Hanoi (activity 10).
- Binary trees (2, 3): traversals (pre/in/post/level), height, count nodes in level, complete?,
  rebuild from preorder+inorder, remove leaves, selection tree?, path; BST insert/search/delete.
- Heaps (4): max heap insert (sift up), remove max (sift down), build heap, heapsort.
- General trees (5): sum, height, grade, level of a value, 2-3 tree check, selection check.
- Maps and hashing (6): the HashMap implementation (buckets, collisions by chaining, load
  factor, rehash), anagrams, related words, map of maps, topological ordering.
- Graphs (7): DFS, BFS, predecessors, regular?, connected from a vertex, path between
  vertices, is a cycle, connected components.
- Greedy (8): Dijkstra, Prim, travelling salesman (nearest neighbour), map colouring, give
  change, burn CD, fractional knapsack, exam schedule, activity planner.
- Backtracking (9): give change, fill flash drive, subset sum, N queens, sudoku, word search
  in a grid, puzzle cards.
- Divide and conquer (10): quickselect (partition), binary search variants, inversions
  (merge count), Hanoi.
- Dynamic programming (11): Fibonacci (table), 0/1 knapsack (table), change making (table).
- Extras: bubble/insertion/selection/merge/quick sort, Kruskal (union-find), Floyd–Warshall,
  Bellman–Ford, AVL rotations.

## Phases (each ships on its own)

1. **Engine and first algorithms**: the trace recorder, structure renderers (graph, array,
   heap, queue, stack, pq, hashtable, map, set, binarytree, matrix, board, value), the player
   window with step/scrub/speed/changes, page figure of a step, the catalog UI (alphabetical,
   search, topics), input forms with presets/random. Algorithms: Dijkstra, Prim, BFS, DFS,
   topological ordering, max heap insert/remove + heapsort, HashMap put/get/rehash, quicksort,
   mergesort with inversions, Hanoi, N queens, Fibonacci DP, 0/1 knapsack DP.
2. **The rest of the AEDII catalog and the extras**.
3. **Java**: the interpreter + library, "New from Java…", the AEDII sources of each built-in
   algorithm shown in the code pane (the player highlights lines from the Java run when the
   algorithm is run through Java), errors with lines.
4. **On the page**: inline ▶ playback in the reader and presentations; export a step range as
   GIF/frames.

## Status

- **Phase 1 done**: the recorder (`trace/recorder.js`, cap 5 000 steps), the renderers
  (`structures/`, light and dark palettes), the player, the catalog UI, the input forms,
  unit tests (`prefabs/algorithms/test`) and `tools/algorithms_e2e.mjs`.
- **Phase 2 done**: 69 algorithms, the whole catalog above and the extras, on the activities'
  test data where they have it (a test checks every result their JUnit tests expect). The
  code pane scrolls sideways (the step's line in sight) or wraps; the side panels resize.
  The figure's menu has Play…, Edit input…, Edit code… (module.json `menu`, host.mode) and
  Edit Greedy: Dijkstra…; the player's list has each algorithm's picture.
  Graph input stays the player's own edge list and drag-to-place drawing: the diagram
  editor's node graphs open only from the app (one figure editor at a time, `oneFigure`, as
  a modal over the note), so a module editor cannot open it for its input without a new host
  call (host.edit(kind, spec)): left for later.
- **Phase 3 done (integration)**: one recorder for both layers; "New from Java…" (catalog):
  your class in the code editor (highlighted, no errors while typing), Entry, Arguments
  (JSON), System.in, a step limit, Run in a worker (Cancel) and the run's steps in the same
  player; errors with line and column in the code pane. A spec is then `{ algorithm: "java",
  source, entry, args, stdin, maxSteps }` ("Java: Count.sum"). "Edit code…" opens it (a
  built-in with a Java version opens as that program, its input as the arguments). Built-ins
  with a Java version (`catalog/java-versions.js`: recursion, DFS/BFS, Dijkstra, Prim, heap,
  HashMap, queens, quickselect, quicksort, Hanoi, Fibonacci, knapsack, the simple sorts) have
  "Run the Java version": their shown source runs through the interpreter (a one-line prefix
  keeps its lines), `{ java: true }` in the spec.
- The code pane uses the shared highlighter (`apps/reader/code-highlight.js`).

## Open questions for the owner
- Show the AEDII sources (the owner's own code from the activities repo) inside the app, or
  only our own equivalent sources? (Default: our own sources written in the course's style;
  the user can paste theirs through "New from Java…".)
