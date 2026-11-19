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
  module.json        kind "custom", output "picture", editor "editor.js", group "algorithms"
  render.js          spec → SVG of one step (pure, no DOM; runs the trace, cached)
  editor.js          the player window + input forms + code editor
  trace/             the trace contract and recorder (pure)
  structures/        one SVG renderer per structure kind (pure) + layout (graph positions kept)
  catalog/           one file per algorithm: { id, name, topic, input schema, presets,
                     javaSource (shown), run(input, t) } written in JS against the recorder
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

### The Java simulation layer

A tree-walking interpreter for the Java subset the course uses (no JVM): classes (fields,
constructors, static and instance methods, inner/nested static classes, interfaces with
default methods ignored if simple), generics parsed and erased, primitives with int/long/double
arithmetic and integer division/overflow, `char`, `String` (common methods), arrays (1-D, 2-D),
`if/else`, `for`, for-each, `while`, `do`, `switch` (classic and arrow), `break/continue`,
`return`, `try/catch/throw` with the library's exceptions, recursion with a depth limit, lambdas
for `Comparator`/`forEach` where simple. Library classes are JS implementations that are also
tracked structures (a `PriorityQueue` the user creates appears in the player). Each statement
executed records the current line and locals; structure operations record changes. Runs are
step-limited and time-limited (a worker, cancellable) so an infinite loop cannot hang the app.
The interpreter is exposed as `runJava(source, entry, input, recorder)`.

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

## Open questions for the owner
- Show the AEDII sources (the owner's own code from the activities repo) inside the app, or
  only our own equivalent sources? (Default: our own sources written in the course's style;
  the user can paste theirs through "New from Java…".)
