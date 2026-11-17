// UML diagrams: the model, the registry of element and connector types, and the drawing.
// A diagram is one JSON object (the prefab's spec, type "uml"); everything else (the editor
// in uml-editor.js, the files in uml-xml.js, the picture on the note) reads this registry, so
// a new element type, or a new field on one, is one entry here.
//
// Model:
//   { type: 'uml', version: 1, diagram: 'class', name, badge,
//     elements:   [{ id, type, name, props: {...}, bounds: [x, y, w, h], parent }],
//     connectors: [{ id, type, from, to, props: {...}, waypoints: [[x, y], ...] }],
//     source: { format, ids: { ourId: theirId }, extra: { ourId: { theirAttr: value } } } }
// Variables (attributes, operations, literals, actions) are lists of records whose fields are
// described in LISTS; each record also has a one-line UML text form (parseLine / formatLine).

export const UML_VERSION = 1;

// ---------------------------------------------------------------------------------------
// Registry

// Diagram kinds: what the palette offers for each, in order.
export const DIAGRAMS = {
  useCase: { label: 'Use case diagram', elements: ['actor', 'useCase', 'system', 'note'], connectors: ['association', 'include', 'extend', 'generalization', 'anchor'], vp: 'UseCaseDiagram' },
  class: { label: 'Class diagram', elements: ['class', 'interface', 'enumeration', 'package', 'note'], connectors: ['association', 'aggregation', 'composition', 'generalization', 'realization', 'dependency', 'anchor'], vp: 'ClassDiagram' },
  state: { label: 'State machine diagram', elements: ['state', 'compositeState', 'initial', 'final', 'choice', 'fork', 'join', 'history', 'note'], connectors: ['transition', 'anchor'], vp: 'StateDiagram' },
  activity: { label: 'Activity diagram', elements: ['action', 'initial', 'activityFinal', 'flowFinal', 'decision', 'merge', 'fork', 'join', 'objectNode', 'inputPin', 'outputPin', 'partition', 'region', 'note'], connectors: ['controlFlow', 'objectFlow', 'anchor'], vp: 'ActivityDiagram' },
  sequence: { label: 'Sequence diagram', elements: ['lifeline', 'actorLifeline', 'activation', 'fragment', 'note'], connectors: ['syncMessage', 'asyncMessage', 'replyMessage', 'createMessage', 'anchor'], vp: 'InteractionDiagram' },
  // Not UML: nodes and arrows for trees, automata and graphs (no UML badge, no UML files).
  graph: { label: 'Node graph', notUml: true, elements: ['node', 'boxNode', 'note'], connectors: ['edge', 'line', 'anchor'], vp: null },
};

// Field kinds understood by the property panel: text, longText, bool, tags (a list of words),
// an enum name of ENUMS, or { list: <LISTS key> }.
export const ENUMS = {
  visibility: ['+', '-', '#', '~'],
  direction: ['in', 'out', 'inout', 'return'],
  actionKind: ['entry', 'do', 'exit'],
  operator: ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'ref', 'seq', 'strict'],
  orientation: ['horizontal', 'vertical'],
  historyKind: ['shallow', 'deep'],
};

// Records of variables: their fields and their one-line form. `line` names fields in braces;
// parseLine reads that form back (see the parsers below, one per list).
export const LISTS = {
  attribute: { label: 'Attributes', fields: { visibility: 'visibility', name: 'text', type: 'text', multiplicity: 'text', default: 'text', static: 'bool' }, example: '- name: String [1] = ""' },
  operation: { label: 'Operations', fields: { visibility: 'visibility', name: 'text', params: { list: 'param' }, returns: 'text', static: 'bool', abstract: 'bool' }, example: '+ lend(to: Member): void' },
  param: { label: 'Parameters', fields: { direction: 'direction', name: 'text', type: 'text', default: 'text' }, example: 'to: Member' },
  literal: { label: 'Literals', fields: { name: 'text' }, example: 'RED' },
  action: { label: 'Internal actions', fields: { kind: 'actionKind', body: 'text' }, example: 'entry / start timer' },
};

// Element types. `shape` names a drawing in SHAPES (and its icon in SHAPE_ICONS); `fields`
// is what the property panel shows besides the name; `vp` and `xmi` are the names in Visual
// Paradigm's XML and in XMI (uml-xml.js); `container` types can hold others (parent).
export const ELEMENTS = {
  // Use case
  actor: { label: 'Actor', shape: 'stickman', size: [60, 100], fields: { stereotypes: 'tags' }, vp: { element: 'Actor' }, xmi: { type: 'uml:Actor' } },
  useCase: { label: 'Use case', shape: 'ellipse', size: [150, 64], fields: { stereotypes: 'tags' }, vp: { element: 'UseCase' }, xmi: { type: 'uml:UseCase' } },
  system: { label: 'System boundary', shape: 'boundary', size: [320, 300], container: true, fields: {}, vp: { element: 'System' }, xmi: { type: 'uml:Component' } },
  // Class
  class: { label: 'Class', shape: 'compartments', size: [180, 100], compartments: ['attributes', 'operations'], fields: { stereotypes: 'tags', abstract: 'bool', attributes: { list: 'attribute' }, operations: { list: 'operation' } }, vp: { element: 'Class' }, xmi: { type: 'uml:Class' } },
  interface: { label: 'Interface', shape: 'compartments', size: [180, 80], keyword: 'interface', compartments: ['attributes', 'operations'], fields: { stereotypes: 'tags', attributes: { list: 'attribute' }, operations: { list: 'operation' } }, vp: { element: 'Class', stereotype: 'Interface' }, xmi: { type: 'uml:Interface' } },
  enumeration: { label: 'Enumeration', shape: 'compartments', size: [160, 90], keyword: 'enumeration', compartments: ['literals'], fields: { literals: { list: 'literal' } }, vp: { element: 'Class', stereotype: 'enumeration' }, xmi: { type: 'uml:Enumeration' } },
  package: { label: 'Package', shape: 'folder', size: [260, 200], container: true, fields: { stereotypes: 'tags' }, vp: { element: 'Package' }, xmi: { type: 'uml:Package' } },
  // State machine
  state: { label: 'State', shape: 'state', size: [140, 60], fields: { actions: { list: 'action' } }, vp: { element: 'State2' }, xmi: { type: 'uml:State' } },
  compositeState: { label: 'Composite state', shape: 'composite', size: [300, 200], container: true, fields: { actions: { list: 'action' } }, vp: { element: 'State2', composite: true }, xmi: { type: 'uml:State', composite: true } },
  initial: { label: 'Initial', shape: 'dot', size: [24, 24], noName: true, fields: {}, vp: { element: 'InitialPseudoState', also: ['InitialNode'], activity: 'InitialNode' }, xmi: { type: 'uml:Pseudostate', kind: 'initial', activity: 'uml:InitialNode' } },
  final: { label: 'Final state', shape: 'bullseye', size: [28, 28], noName: true, fields: {}, vp: { element: 'FinalState' }, xmi: { type: 'uml:FinalState' } },
  choice: { label: 'Choice', shape: 'diamond', size: [32, 32], optionalName: true, fields: {}, vp: { element: 'ChoicePseudoState' }, xmi: { type: 'uml:Pseudostate', kind: 'choice' } },
  fork: { label: 'Fork', shape: 'bar', size: [100, 8], noName: true, fields: {}, vp: { element: 'ForkNode' }, xmi: { type: 'uml:Pseudostate', kind: 'fork', activity: 'uml:ForkNode' } },
  join: { label: 'Join', shape: 'bar', size: [100, 8], noName: true, fields: {}, vp: { element: 'JoinNode' }, xmi: { type: 'uml:Pseudostate', kind: 'join', activity: 'uml:JoinNode' } },
  history: { label: 'History', shape: 'history', size: [30, 30], noName: true, fields: { historyKind: 'historyKind' }, vp: { element: 'ShallowHistoryPseudoState' }, xmi: { type: 'uml:Pseudostate', kind: 'shallowHistory' } },
  // Activity
  action: { label: 'Action', shape: 'rounded', size: [140, 50], fields: {}, vp: { element: 'ActivityAction' }, xmi: { type: 'uml:OpaqueAction' } },
  activityFinal: { label: 'Activity final', shape: 'bullseye', size: [28, 28], noName: true, fields: {}, vp: { element: 'ActivityFinalNode' }, xmi: { type: 'uml:ActivityFinalNode' } },
  flowFinal: { label: 'Flow final', shape: 'flowFinal', size: [26, 26], noName: true, fields: {}, vp: { element: 'FlowFinalNode' }, xmi: { type: 'uml:FlowFinalNode' } },
  decision: { label: 'Decision', shape: 'diamond', size: [36, 36], optionalName: true, fields: {}, vp: { element: 'DecisionNode' }, xmi: { type: 'uml:DecisionNode' } },
  merge: { label: 'Merge', shape: 'diamond', size: [36, 36], optionalName: true, fields: {}, vp: { element: 'MergeNode' }, xmi: { type: 'uml:MergeNode' } },
  inputPin: { label: 'Input pin', shape: 'pin', size: [14, 14], optionalName: true, fields: {}, vp: { element: 'InputPin' }, xmi: { type: 'uml:InputPin' } },
  outputPin: { label: 'Output pin', shape: 'pin', size: [14, 14], optionalName: true, fields: {}, vp: { element: 'OutputPin' }, xmi: { type: 'uml:OutputPin' } },
  region: { label: 'Interruptible region', shape: 'region', size: [260, 160], container: true, optionalName: true, fields: {}, vp: { element: 'InterruptibleActivityRegion' }, xmi: { type: 'uml:InterruptibleActivityRegion' } },
  objectNode: { label: 'Object node', shape: 'box', size: [120, 46], fields: { type: 'text' }, vp: { element: 'ObjectNode' }, xmi: { type: 'uml:CentralBufferNode' } },
  partition: { label: 'Swimlane', shape: 'lane', size: [220, 360], container: true, fields: {}, vp: { element: 'ActivityPartition' }, xmi: { type: 'uml:ActivityPartition' } },
  // Sequence
  lifeline: { label: 'Lifeline', shape: 'lifeline', size: [120, 320], fields: { type: 'text' }, vp: { element: 'InteractionLifeLine' }, xmi: { type: 'uml:Lifeline' } },
  actorLifeline: { label: 'Actor lifeline', shape: 'actorLifeline', size: [80, 320], fields: { type: 'text' }, vp: { element: 'InteractionActor' }, xmi: { type: 'uml:Lifeline', actor: true } },
  activation: { label: 'Activation bar', shape: 'activation', size: [14, 90], noName: true, fields: {}, vp: { element: 'Activation' }, xmi: { type: 'uml:BehaviorExecutionSpecification' } },
  fragment: { label: 'Combined fragment', shape: 'fragment', size: [300, 120], fields: { operator: 'operator', guard: 'text' }, vp: { element: 'CombinedFragment' }, xmi: { type: 'uml:CombinedFragment' } },
  // Node graph
  node: { label: 'Node', shape: 'node', size: [48, 48], fields: { start: 'bool', accepting: 'bool' }, vp: { element: 'NCNode' }, xmi: { type: 'nc:Node' } },
  boxNode: { label: 'Box node', shape: 'rounded', size: [110, 44], fields: {}, vp: { element: 'NCBoxNode' }, xmi: { type: 'nc:BoxNode' } },
  // Any diagram
  note: { label: 'Note', shape: 'note', size: [160, 70], fields: {}, longName: true, vp: { element: 'NOTE' }, xmi: { type: 'uml:Comment' } },
};

// Connector types: the line, what each end shows (END_MARKS), a keyword shown at the middle,
// and which ends have properties (role, multiplicity, navigability).
export const CONNECTORS = {
  association: { label: 'Association', line: 'solid', start: 'none', end: 'none', ends: true, fields: { name: 'text' }, vp: { element: 'Association' }, xmi: { type: 'uml:Association' } },
  aggregation: { label: 'Aggregation', line: 'solid', start: 'hollowDiamond', end: 'none', ends: true, fields: { name: 'text' }, vp: { element: 'Association', aggregation: 'shared' }, xmi: { type: 'uml:Association', aggregation: 'shared' } },
  composition: { label: 'Composition', line: 'solid', start: 'filledDiamond', end: 'none', ends: true, fields: { name: 'text' }, vp: { element: 'Association', aggregation: 'composite' }, xmi: { type: 'uml:Association', aggregation: 'composite' } },
  generalization: { label: 'Generalization', line: 'solid', start: 'none', end: 'hollowTriangle', fields: {}, vp: { element: 'Generalization' }, xmi: { type: 'uml:Generalization' } },
  realization: { label: 'Realization', line: 'dashed', start: 'none', end: 'hollowTriangle', fields: {}, vp: { element: 'Realization' }, xmi: { type: 'uml:InterfaceRealization' } },
  dependency: { label: 'Dependency', line: 'dashed', start: 'none', end: 'open', fields: { name: 'text', stereotypes: 'tags' }, vp: { element: 'Dependency' }, xmi: { type: 'uml:Dependency' } },
  include: { label: 'Include', line: 'dashed', start: 'none', end: 'open', keyword: 'include', fields: {}, vp: { element: 'Include' }, xmi: { type: 'uml:Include' } },
  extend: { label: 'Extend', line: 'dashed', start: 'none', end: 'open', keyword: 'extend', drawnBack: true, fields: { condition: 'text' }, vp: { element: 'Extend' }, xmi: { type: 'uml:Extend' } },
  transition: { label: 'Transition', line: 'solid', start: 'none', end: 'open', fields: { trigger: 'text', guard: 'text', effect: 'text' }, vp: { element: 'Transition2' }, xmi: { type: 'uml:Transition' } },
  controlFlow: { label: 'Control flow', line: 'solid', start: 'none', end: 'open', fields: { guard: 'text', name: 'text' }, vp: { element: 'ControlFlow' }, xmi: { type: 'uml:ControlFlow' } },
  objectFlow: { label: 'Object flow', line: 'solid', start: 'none', end: 'open', fields: { guard: 'text', name: 'text' }, vp: { element: 'ObjectFlow' }, xmi: { type: 'uml:ObjectFlow' } },
  syncMessage: { label: 'Message', message: true, line: 'solid', start: 'none', end: 'filled', fields: { name: 'text', args: 'text', y: 'number' }, vp: { element: 'Message', kind: 'synchCall' }, xmi: { type: 'uml:Message', sort: 'synchCall' } },
  asyncMessage: { label: 'Asynchronous message', message: true, line: 'solid', start: 'none', end: 'open', fields: { name: 'text', args: 'text', y: 'number' }, vp: { element: 'Message', kind: 'asynchCall' }, xmi: { type: 'uml:Message', sort: 'asynchCall' } },
  replyMessage: { label: 'Reply', message: true, line: 'dashed', start: 'none', end: 'open', fields: { name: 'text', y: 'number' }, vp: { element: 'Message', kind: 'reply' }, xmi: { type: 'uml:Message', sort: 'reply' } },
  createMessage: { label: 'Create message', message: true, line: 'dashed', start: 'none', end: 'open', keyword: 'create', fields: { name: 'text', y: 'number' }, vp: { element: 'Message', kind: 'createMessage' }, xmi: { type: 'uml:Message', sort: 'createMessage' } },
  edge: { label: 'Arrow', line: 'solid', start: 'none', end: 'filled', fields: { name: 'text' }, vp: { element: 'NCEdge' }, xmi: { type: 'nc:Edge' } },
  line: { label: 'Line', line: 'solid', start: 'none', end: 'none', fields: { name: 'text' }, vp: { element: 'NCLine' }, xmi: { type: 'nc:Line' } },
  anchor: { label: 'Note link', line: 'dashed', start: 'none', end: 'none', fields: {}, vp: { element: 'Anchor' }, xmi: { type: 'nc:Anchor' } },
};

// ---------------------------------------------------------------------------------------
// One-line forms of variables

const VIS = /^([+\-#~])\s*/;
const trimAll = (s) => String(s ?? '').trim();

function parseParams(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(text || '')) {
    if (ch === ',' && !depth) { out.push(cur); cur = ''; continue; }
    if ('(<['.includes(ch)) depth++;
    if (')>]'.includes(ch)) depth--;
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => parseLine('param', p)).filter((p) => p.name || p.type);
}

// Reads one line of a variable list into its fields.
export function parseLine(list, line) {
  let s = trimAll(line);
  if (list === 'literal') return { name: s };
  if (list === 'action') {
    const m = /^(entry|do|exit)\s*\/\s*(.*)$/i.exec(s);
    return m ? { kind: m[1].toLowerCase(), body: m[2].trim() } : { kind: 'do', body: s };
  }
  if (list === 'param') {
    const m = /^(?:(in|out|inout|return)\s+)?([^:=]*?)\s*(?::\s*([^=]*?))?\s*(?:=\s*(.*))?$/.exec(s);
    return { direction: m?.[1] || '', name: trimAll(m?.[2]), type: trimAll(m?.[3]), default: trimAll(m?.[4]) };
  }
  const rec = {};
  const flags = /^(static|abstract)\s+/i;
  for (let f; (f = flags.exec(s)); s = s.slice(f[0].length)) rec[f[1].toLowerCase()] = true;
  const v = VIS.exec(s);
  rec.visibility = v ? v[1] : '';
  if (v) s = s.slice(v[0].length);
  for (let f; (f = flags.exec(s)); s = s.slice(f[0].length)) rec[f[1].toLowerCase()] = true;
  if (list === 'operation') {
    const m = /^([^(]*)\((.*)\)\s*(?::\s*(.*))?$/.exec(s);
    if (m) return { visibility: rec.visibility, name: m[1].trim(), params: parseParams(m[2]), returns: trimAll(m[3]), static: !!rec.static, abstract: !!rec.abstract };
    return { visibility: rec.visibility, name: s.replace(/\s*:.*$/, ''), params: [], returns: trimAll(/:\s*(.*)$/.exec(s)?.[1]), static: !!rec.static, abstract: !!rec.abstract };
  }
  // attribute: name: Type [mult] = default
  const m = /^([^:=[]*?)\s*(?::\s*([^=[]*?))?\s*(?:\[([^\]]*)\])?\s*(?:=\s*(.*))?$/.exec(s);
  return { visibility: rec.visibility, name: trimAll(m?.[1]), type: trimAll(m?.[2]), multiplicity: trimAll(m?.[3]), default: trimAll(m?.[4]), static: !!rec.static };
}

// The one-line form of a record (as drawn in the diagram and edited as text).
// `keywords`: static and abstract written out (the text form); drawn, they are underlined
// and italic instead.
export function formatLine(list, r = {}, { keywords = true } = {}) {
  if (list === 'literal') return trimAll(r.name);
  if (list === 'action') return `${r.kind || 'do'} / ${trimAll(r.body)}`;
  if (list === 'param') return [r.direction && r.direction !== 'in' ? `${r.direction} ` : '', trimAll(r.name), r.type ? `: ${trimAll(r.type)}` : '', r.default ? ` = ${trimAll(r.default)}` : ''].join('');
  const vis = `${keywords && r.static ? 'static ' : ''}${keywords && r.abstract ? 'abstract ' : ''}${r.visibility ? `${r.visibility} ` : ''}`;
  if (list === 'operation') {
    const params = (r.params || []).map((p) => formatLine('param', p)).join(', ');
    return `${vis}${trimAll(r.name)}(${params})${r.returns ? `: ${trimAll(r.returns)}` : ''}`;
  }
  return `${vis}${trimAll(r.name)}${r.type ? `: ${trimAll(r.type)}` : ''}${r.multiplicity ? ` [${trimAll(r.multiplicity)}]` : ''}${r.default ? ` = ${trimAll(r.default)}` : ''}`;
}

// ---------------------------------------------------------------------------------------
// The model

let counter = 0;
export function newId(prefix = 'e', model = null) {
  const taken = new Set([...(model?.elements || []), ...(model?.connectors || [])].map((x) => x.id));
  let id;
  do id = `${prefix}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 5)}`; while (taken.has(id));
  return id;
}

// The default props of a type: every field present, so editors and exporters can rely on them.
function defaultValue(kind) {
  if (kind === 'bool') return false;
  if (kind === 'tags') return [];
  if (kind === 'number') return null;
  if (kind && typeof kind === 'object' && kind.list) return [];
  if (typeof kind === 'string' && ENUMS[kind]) return ENUMS[kind][0];
  return '';
}
// (An element's name is its own field, not a prop; a connector's name is a prop.)
export function defaultProps(def) {
  return Object.fromEntries(Object.entries(def?.fields || {}).filter(([k]) => k !== 'name' || def.line).map(([k, kind]) => [k, defaultValue(kind)]));
}

export function makeElement(type, at = [40, 40], extra = {}, model = null) {
  const def = ELEMENTS[type];
  if (!def) throw Error(`Unknown UML element: ${type}`);
  const [w, h] = def.size;
  return { id: extra.id || newId('e', model), type, name: extra.name ?? (def.noName || def.optionalName ? '' : def.label), props: { ...defaultProps(def), ...(extra.props || {}) }, bounds: extra.bounds || [at[0], at[1], w, h], parent: extra.parent ?? null };
}

export function makeConnector(type, from, to, extra = {}, model = null) {
  const def = CONNECTORS[type];
  if (!def) throw Error(`Unknown UML connector: ${type}`);
  const props = { ...defaultProps(def), ...(def.ends ? { fromEnd: { role: '', multiplicity: '', navigable: false }, toEnd: { role: '', multiplicity: '', navigable: type === 'association' ? false : false } } : {}), ...(extra.props || {}) };
  return { id: extra.id || newId('c', model), type, from, to, props, waypoints: extra.waypoints || [] };
}

// A model read from anywhere (a note, a file, an older version): every list present, unknown
// element types kept as boxes, connectors to missing elements dropped.
export function normalizeModel(input) {
  const m = input && typeof input === 'object' ? input : {};
  const diagram = DIAGRAMS[m.diagram] ? m.diagram : 'class';
  const elements = (Array.isArray(m.elements) ? m.elements : []).filter((e) => e && typeof e === 'object').map((e, i) => {
    const def = ELEMENTS[e.type];
    const size = def?.size || [140, 60];
    const b = Array.isArray(e.bounds) && e.bounds.length === 4 && e.bounds.every(Number.isFinite) ? e.bounds.map(Number) : null;
    return { id: String(e.id || `e${i + 1}`), type: String(e.type || 'note'), name: String(e.name ?? ''), props: { ...defaultProps(def), ...(e.props && typeof e.props === 'object' ? e.props : {}) }, bounds: b || [NaN, NaN, size[0], size[1]], parent: e.parent ? String(e.parent) : null };
  });
  const ids = new Set(elements.map((e) => e.id));
  const connectors = (Array.isArray(m.connectors) ? m.connectors : []).filter((c) => c && ids.has(String(c.from)) && ids.has(String(c.to))).map((c, i) => {
    const def = CONNECTORS[c.type];
    const base = def?.ends ? { fromEnd: { role: '', multiplicity: '', navigable: false }, toEnd: { role: '', multiplicity: '', navigable: false } } : {};
    return { id: String(c.id || `c${i + 1}`), type: String(c.type || 'association'), from: String(c.from), to: String(c.to), props: { ...defaultProps(def), ...base, ...(c.props && typeof c.props === 'object' ? c.props : {}) }, waypoints: Array.isArray(c.waypoints) ? c.waypoints.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) : [] };
  });
  const out = { type: 'uml', version: UML_VERSION, diagram, name: String(m.name ?? ''), title: String(m.title ?? ''), badge: m.badge === undefined ? !DIAGRAMS[diagram].notUml : m.badge !== false, elements, connectors, source: m.source && typeof m.source === 'object' ? m.source : null };
  if (!out.source) delete out.source;
  // Notes on the diagram (Markdown, uml-editor.js), kept with it and never drawn.
  if (typeof m.notes === 'string' && m.notes.trim()) out.notes = m.notes;
  autoLayout(out);
  return out;
}

// Places elements that have no position (an import without layout): a grid, rows of four,
// sequence lifelines side by side, children inside their container.
export function autoLayout(model) {
  const loose = model.elements.filter((e) => !Number.isFinite(e.bounds[0]) || !Number.isFinite(e.bounds[1]));
  if (!loose.length) return model;
  const placed = model.elements.filter((e) => !loose.includes(e));
  let y0 = placed.length ? Math.max(...placed.map((e) => e.bounds[1] + e.bounds[3])) + 40 : 40;
  if (model.diagram === 'sequence') {
    let x = placed.length ? Math.max(...placed.map((e) => e.bounds[0] + e.bounds[2])) + 40 : 40;
    for (const e of loose.filter((q) => ELEMENTS[q.type]?.shape?.toLowerCase().includes('lifeline'))) { e.bounds[0] = x; e.bounds[1] = 40; x += e.bounds[2] + 50; }
  }
  const rest = loose.filter((e) => !Number.isFinite(e.bounds[0]));
  let x = 40, rowH = 0, col = 0;
  for (const e of rest) {
    if (col === 4) { col = 0; x = 40; y0 += rowH + 50; rowH = 0; }
    e.bounds[0] = x; e.bounds[1] = y0;
    x += e.bounds[2] + 60; rowH = Math.max(rowH, e.bounds[3]); col++;
  }
  // Message heights in a sequence diagram, in order, where none is given.
  if (model.diagram === 'sequence') {
    let y = 110;
    for (const c of model.connectors) if (CONNECTORS[c.type]?.message) { if (!Number.isFinite(c.props.y)) c.props.y = y; y = c.props.y + 40; }
  }
  return model;
}

// A starting diagram for each kind (the picker's previews and the editor's first view).
export function starterModel(diagram = 'class') {
  const m = { type: 'uml', version: UML_VERSION, diagram, name: '', badge: !DIAGRAMS[diagram]?.notUml, elements: [], connectors: [] };
  const el = (type, x, y, extra = {}) => { const e = makeElement(type, [x, y], extra, m); m.elements.push(e); return e; };
  const link = (type, a, b, extra = {}) => { const c = makeConnector(type, a.id, b.id, extra, m); m.connectors.push(c); return c; };
  if (diagram === 'useCase') {
    const sys = el('system', 140, 20, { name: 'Library', bounds: [140, 20, 260, 220] });
    const u = el('actor', 30, 70, { name: 'Member' });
    const a = el('useCase', 195, 70, { name: 'Borrow book', parent: sys.id });
    const b = el('useCase', 195, 160, { name: 'Check account', parent: sys.id });
    link('association', u, a);
    link('include', a, b);
  } else if (diagram === 'class') {
    const a = el('class', 20, 20, { name: 'Book', props: { attributes: [parseLine('attribute', '- isbn: String'), parseLine('attribute', '- title: String')], operations: [parseLine('operation', '+ lend(to: Member): void')] } });
    const b = el('class', 300, 20, { name: 'Member', props: { attributes: [parseLine('attribute', '- name: String')], operations: [] } });
    const c = el('class', 20, 200, { name: 'EBook', props: { attributes: [parseLine('attribute', '- url: String')], operations: [] } });
    a.bounds[2] = 200;
    link('association', a, b, { props: { name: 'borrows', fromEnd: { role: '', multiplicity: '0..*', navigable: false }, toEnd: { role: '', multiplicity: '0..1', navigable: true } } });
    link('generalization', c, a);
  } else if (diagram === 'state') {
    const i = el('initial', 30, 48);
    const a = el('state', 100, 30, { name: 'Ready' });
    const b = el('state', 320, 30, { name: 'Running', props: { actions: [parseLine('action', 'entry / start timer')] } });
    const f = el('final', 506, 46);
    link('transition', i, a);
    link('transition', a, b, { props: { trigger: 'dispatch', guard: '', effect: '' } });
    link('transition', b, f, { props: { trigger: 'exit', guard: '', effect: '' } });
  } else if (diagram === 'activity') {
    const i = el('initial', 98, 20);
    const a = el('action', 40, 80, { name: 'Receive order' });
    const d = el('decision', 92, 170);
    const b = el('action', 220, 160, { name: 'Reject order' });
    const c = el('action', 40, 250, { name: 'Ship order' });
    const f = el('activityFinal', 96, 340);
    link('controlFlow', i, a);
    link('controlFlow', a, d);
    link('controlFlow', d, b, { props: { guard: 'not in stock' } });
    link('controlFlow', d, c, { props: { guard: 'in stock' } });
    link('controlFlow', c, f);
  } else if (diagram === 'graph') {
    // A small binary search tree; drag from a node to grow it.
    const [r, a, b, c, d] = ['10', '5', '15', '3', '7'].map((name) => el('node', 0, 0, { name }));
    link('line', r, a); link('line', r, b); link('line', a, c); link('line', a, d);
    treeLayout(m);
  } else if (diagram === 'sequence') {
    const u = el('actorLifeline', 20, 20, { name: 'Member', bounds: [20, 20, 80, 260] });
    const a = el('lifeline', 160, 20, { name: ':Library', bounds: [160, 20, 120, 260] });
    const b = el('lifeline', 340, 20, { name: ':Catalog', bounds: [340, 20, 120, 260] });
    link('syncMessage', u, a, { props: { name: 'borrow', args: 'isbn', y: 120 } });
    link('syncMessage', a, b, { props: { name: 'find', args: 'isbn', y: 160 } });
    link('replyMessage', b, a, { props: { name: 'book', y: 200 } });
    link('replyMessage', a, u, { props: { name: 'ok', y: 240 } });
    // Activation bars: while each object is busy, from the call it gets to its reply.
    el('activation', 53, 112, { bounds: [53, 112, 14, 138] });
    el('activation', 213, 112, { bounds: [213, 112, 14, 134] });
    el('activation', 393, 152, { bounds: [393, 152, 14, 54] });
  }
  return m;
}

// Arranges what the connectors join as a tree, top down: each element under the one that
// connects to it, leaves side by side, parents centred over their children. Elements in no
// connection keep their place. Returns the model.
export function treeLayout(model, { gapX = 30, gapY = 60, origin = [40, 40] } = {}) {
  const joins = model.connectors.filter((c) => c.type !== 'anchor' && c.from !== c.to);
  const children = new Map(), hasParent = new Set();
  for (const c of joins) {
    if (hasParent.has(c.to)) continue; // the first parent wins (a graph with cycles still lays out)
    if (!children.has(c.from)) children.set(c.from, []);
    children.get(c.from).push(c.to);
    hasParent.add(c.to);
  }
  const inTree = new Set(joins.flatMap((c) => [c.from, c.to]));
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const roots = model.elements.filter((e) => inTree.has(e.id) && !hasParent.has(e.id));
  if (!roots.length && inTree.size) roots.push(byId.get(joins[0].from));
  const seen = new Set();
  let nextX = origin[0];
  const levelH = Math.max(...model.elements.filter((e) => inTree.has(e.id)).map((e) => fitBounds(e)[3]), 40) + gapY;
  // Returns the middle x of the subtree.
  const place = (e, depth) => {
    seen.add(e.id);
    const [, , w, h] = fitBounds(e);
    const kids = (children.get(e.id) || []).map((id) => byId.get(id)).filter((k) => k && !seen.has(k.id));
    let mid;
    if (!kids.length) { mid = nextX + w / 2; nextX += w + gapX; }
    else { const xs = kids.map((k) => place(k, depth + 1)); mid = (xs[0] + xs[xs.length - 1]) / 2; nextX = Math.max(nextX, mid + w / 2 + gapX); }
    e.bounds = [Math.round(mid - w / 2), Math.round(origin[1] + depth * levelH + (levelH - gapY - h) / 2), e.bounds[2], e.bounds[3]];
    return mid;
  };
  for (const r of roots) if (!seen.has(r.id)) place(r, 0);
  for (const id of inTree) if (!seen.has(id) && byId.get(id)) place(byId.get(id), 0);
  for (const c of joins) c.waypoints = [];
  return model;
}

export const umlName = (model) => {
  const d = DIAGRAMS[model?.diagram];
  if (!d) return 'UML diagram';
  if (d.notUml) return d.label;
  return `UML ${d.label.replace(/ diagram$/, '').toLowerCase()} diagram`;
};

// ---------------------------------------------------------------------------------------
// Drawing

const FONT = 13, LINE = 17, PAD = 8, CHAR = 0.55;
const textWidth = (s, size = FONT) => String(s ?? '').length * size * CHAR;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n = (v) => Math.round(v * 10) / 10;
const INK = '#1f2328', FILL = '#ffffff', SOFT = '#fff8dc', MUTED = '#57606a';

function text(x, y, s, { anchor = 'middle', weight = '', style = '', size = FONT, fill = INK, deco = '' } = {}) {
  if (s === '' || s == null) return '';
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" text-anchor="${anchor}"${weight ? ` font-weight="${weight}"` : ''}${style ? ` font-style="${style}"` : ''}${deco ? ` text-decoration="${deco}"` : ''} fill="${fill}">${esc(s)}</text>`;
}
const stereo = (list) => (Array.isArray(list) ? list : String(list || '').split(',')).map((s) => String(s).trim()).filter(Boolean).map((s) => `«${s}»`).join(' ');
// Words wrapped to `width` (names of use cases, actions and notes).
function wrap(s, width, size = FONT) {
  const max = Math.max(4, Math.floor(width / (size * CHAR)));
  const out = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && (line + ' ' + word).length > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}
const lines = (arr, x, y, opts) => arr.map((s, i) => text(x, y + i * LINE, s, opts)).join('');

// The lines a compartment shows.
function compartmentLines(e, key) {
  const list = { attributes: 'attribute', operations: 'operation', literals: 'literal' }[key];
  return (e.props?.[key] || []).map((r) => ({ text: formatLine(list, r, { keywords: false }), underline: !!r.static, italic: !!r.abstract }));
}

// The size an element needs for what it shows (it never draws smaller than its bounds).
// An element's text size (props.textScale): what it shows is drawn that much larger (or
// smaller) inside the same box on the page.
export const textScale = (item) => { const s = Number(item?.props?.textScale); return s > 0.2 && s < 5 ? s : 1; };
export function fitBounds(e) {
  const s = textScale(e);
  if (s === 1) return fitRaw(e);
  const [x, y, w, h] = e.bounds;
  const inner = fitRaw({ ...e, bounds: [x, y, w / s, h / s] });
  return [x, y, inner[2] * s, inner[3] * s];
}
// What a colour (props.color, #rrggbb) gives: the line colour and a light fill.
const HEX = /^#[0-9a-f]{6}$/i;
export const itemColor = (item) => (HEX.test(item?.props?.color || '') ? item.props.color : null);
function tint(hex, share = 0.16) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(255 - (255 - v) * share).toString(16).padStart(2, '0')).join('')}`;
}
function recolor(svg, color, { fill = true } = {}) {
  if (!color) return svg;
  let out = svg.replaceAll(`stroke="${INK}"`, `stroke="${color}"`);
  if (fill) out = out.replaceAll(`fill="${FILL}"`, `fill="${tint(color)}"`).replaceAll(`fill="${SOFT}"`, `fill="${tint(color, 0.24)}"`);
  return out;
}
function fitRaw(e) {
  const def = ELEMENTS[e.type];
  const [x, y, w0, h0] = e.bounds;
  let w = w0, h = h0;
  if (def?.shape === 'compartments') {
    const head = [def.keyword ? `«${def.keyword}»` : '', stereo(e.props?.stereotypes), e.name].filter(Boolean);
    const comps = (def.compartments || []).map((k) => compartmentLines(e, k));
    const widest = Math.max(...head.map((s) => textWidth(s) + 2 * PAD), ...comps.flat().map((l) => textWidth(l.text) + 2 * PAD), 60);
    w = Math.max(w, widest);
    h = Math.max(h, head.length * LINE + PAD + comps.reduce((s, c) => s + Math.max(1, c.length) * LINE + PAD, 0) + 4);
  } else if (def?.shape === 'state') {
    const acts = (e.props?.actions || []).length;
    w = Math.max(w, textWidth(e.name) + 2 * PAD + 10, ...(e.props?.actions || []).map((a) => textWidth(formatLine('action', a)) + 2 * PAD));
    h = Math.max(h, LINE + 2 * PAD + (acts ? acts * LINE + PAD : 0));
  } else if (def?.shape === 'node') {
    const need = textWidth(e.name) + 14;
    if (need > w) { w = need; h = Math.max(h, Math.min(need, h * 1.4)); }
  } else if (def?.shape === 'ellipse' || def?.shape === 'rounded' || def?.shape === 'note' || def?.shape === 'box') {
    const tight = def.shape === 'rounded' || def.shape === 'box';
    const ls = wrap(e.name, w - (tight ? PAD : 2 * PAD) - (def.shape === 'ellipse' ? 20 : 0));
    h = Math.max(h, ls.length * LINE + (tight ? PAD : 2 * PAD) + (def.shape === 'ellipse' ? 16 : 0) + (e.props?.type ? LINE : 0));
  }
  return [x, y, w, h];
}

// The outline point of `b` (bounds) toward `toward` from its middle: ellipses, diamonds and
// circles clip as themselves, everything else as a box.
function clip(e, b, toward) {
  const [x, y, w, h] = b, cx = x + w / 2, cy = y + h / 2;
  let dx = toward[0] - cx, dy = toward[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const shape = ELEMENTS[e?.type]?.shape;
  if (shape === 'node' || shape === 'ellipse' || shape === 'dot' || shape === 'bullseye' || shape === 'flowFinal' || shape === 'history') {
    const t = 1 / Math.sqrt((dx * dx) / ((w / 2) ** 2) + (dy * dy) / ((h / 2) ** 2));
    return [cx + dx * t, cy + dy * t];
  }
  if (shape === 'diamond') {
    const t = 1 / (Math.abs(dx) / (w / 2) + Math.abs(dy) / (h / 2));
    return [cx + dx * t, cy + dy * t];
  }
  if (shape === 'stickman') {
    const t = Math.min(Math.abs((w / 2) / (dx || 1e-9)), Math.abs((h / 2) / (dy || 1e-9)));
    return [cx + dx * t, cy + dy * t];
  }
  const t = Math.min(Math.abs((w / 2) / (dx || 1e-9)), Math.abs((h / 2) / (dy || 1e-9)));
  return [cx + dx * t, cy + dy * t];
}

const SHAPES = {
  compartments(e, [x, y, w, h], def) {
    const head = [def.keyword ? { s: `«${def.keyword}»` } : null, e.props?.stereotypes?.length ? { s: stereo(e.props.stereotypes) } : null, { s: e.name, bold: true, italic: !!e.props?.abstract || def.keyword === 'interface' }].filter(Boolean);
    let out = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>`;
    let cy = y + PAD + FONT - 2;
    for (const l of head) { out += text(x + w / 2, cy, l.s, { weight: l.bold ? 'bold' : '', style: l.italic ? 'italic' : '' }); cy += LINE; }
    cy += PAD / 2 - LINE + 4;
    for (const key of def.compartments || []) {
      out += `<line x1="${n(x)}" y1="${n(cy)}" x2="${n(x + w)}" y2="${n(cy)}" stroke="${INK}" stroke-width="1"/>`;
      const ls = compartmentLines(e, key);
      ls.forEach((l, i) => { out += text(x + PAD, cy + LINE * (i + 1) - 2, l.text, { anchor: 'start', deco: l.underline ? 'underline' : '', style: l.italic ? 'italic' : '' }); });
      cy += Math.max(1, ls.length) * LINE + PAD;
    }
    return out;
  },
  stickman(e, [x, y, w, h]) {
    const cx = x + w / 2, fig = Math.max(30, h - LINE - 4), r = fig * 0.13, top = y + 2;
    const neck = top + 2 * r, hip = top + fig * 0.62, arm = top + fig * 0.38, foot = top + fig;
    return `<g fill="none" stroke="${INK}" stroke-width="1.5"><circle cx="${n(cx)}" cy="${n(top + r)}" r="${n(r)}" fill="${FILL}"/><path d="M${n(cx)} ${n(neck)}V${n(hip)}M${n(cx - fig * 0.25)} ${n(arm)}H${n(cx + fig * 0.25)}M${n(cx - fig * 0.22)} ${n(foot)}L${n(cx)} ${n(hip)}L${n(cx + fig * 0.22)} ${n(foot)}"/></g>` + text(cx, y + h, e.name);
  },
  ellipse(e, [x, y, w, h]) {
    const ls = wrap(e.name, w - 2 * PAD - 20);
    const st = stereo(e.props?.stereotypes);
    const all = st ? [st, ...ls] : ls;
    return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + lines(all, x + w / 2, y + h / 2 - ((all.length - 1) * LINE) / 2 + 4.5);
  },
  boundary(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${FILL}" fill-opacity="0.6" stroke="${INK}" stroke-width="1.3"/>` + text(x + w / 2, y + LINE, e.name, { weight: 'bold' });
  },
  folder(e, [x, y, w, h]) {
    const tw = Math.min(w * 0.45, Math.max(50, textWidth(e.name, FONT) + 2 * PAD)), th = 18;
    return `<path d="M${n(x)} ${n(y + th)}V${n(y)}H${n(x + tw)}V${n(y + th)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/><rect x="${n(x)}" y="${n(y + th)}" width="${n(w)}" height="${n(h - th)}" fill="${FILL}" fill-opacity="0.6" stroke="${INK}" stroke-width="1.3"/>` + text(x + PAD, y + th - 5, e.name, { anchor: 'start', weight: 'bold' });
  },
  note(e, [x, y, w, h]) {
    const k = 12, ls = wrap(e.name, w - 2 * PAD - 6);
    return `<path d="M${n(x)} ${n(y)}H${n(x + w - k)}L${n(x + w)} ${n(y + k)}V${n(y + h)}H${n(x)}Z" fill="${SOFT}" stroke="${INK}" stroke-width="1.1"/><path d="M${n(x + w - k)} ${n(y)}V${n(y + k)}H${n(x + w)}" fill="none" stroke="${INK}" stroke-width="1.1"/>` + lines(ls, x + PAD, y + PAD + FONT - 2, { anchor: 'start', size: FONT - 1 });
  },
  state(e, [x, y, w, h]) {
    const acts = (e.props?.actions || []).map((a) => formatLine('action', a));
    let out = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="12" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>`;
    if (!acts.length) return out + text(x + w / 2, y + h / 2 + 4.5, e.name, { weight: 'bold' });
    out += text(x + w / 2, y + PAD + FONT - 1, e.name, { weight: 'bold' });
    const ly = y + PAD + LINE + 2;
    out += `<line x1="${n(x)}" y1="${n(ly)}" x2="${n(x + w)}" y2="${n(ly)}" stroke="${INK}"/>`;
    return out + lines(acts, x + PAD, ly + LINE - 2, { anchor: 'start' });
  },
  composite(e, [x, y, w, h]) {
    const acts = (e.props?.actions || []).map((a) => formatLine('action', a));
    const ly = y + LINE + 6;
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="14" fill="${FILL}" fill-opacity="0.6" stroke="${INK}" stroke-width="1.3"/>` + text(x + w / 2, y + LINE, e.name, { weight: 'bold' }) + `<line x1="${n(x)}" y1="${n(ly)}" x2="${n(x + w)}" y2="${n(ly)}" stroke="${INK}"/>` + lines(acts, x + PAD, ly + LINE - 2, { anchor: 'start' });
  },
  dot(e, [x, y, w, h]) {
    return `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(Math.min(w, h) / 2)}" fill="${INK}"/>`;
  },
  bullseye(e, [x, y, w, h]) {
    const r = Math.min(w, h) / 2;
    return `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(r)}" fill="${FILL}" stroke="${INK}" stroke-width="1.5"/><circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(r * 0.62)}" fill="${INK}"/>`;
  },
  flowFinal(e, [x, y, w, h]) {
    const r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2, k = r * 0.7;
    return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${FILL}" stroke="${INK}" stroke-width="1.5"/><path d="M${n(cx - k)} ${n(cy - k)}L${n(cx + k)} ${n(cy + k)}M${n(cx + k)} ${n(cy - k)}L${n(cx - k)} ${n(cy + k)}" stroke="${INK}" stroke-width="1.5"/>`;
  },
  history(e, [x, y, w, h]) {
    const r = Math.min(w, h) / 2;
    return `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(r)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + text(x + w / 2, y + h / 2 + 4.5, e.props?.historyKind === 'deep' ? 'H*' : 'H', { weight: 'bold' });
  },
  diamond(e, [x, y, w, h]) {
    const cx = x + w / 2, cy = y + h / 2;
    return `<path d="M${n(cx)} ${n(y)}L${n(x + w)} ${n(cy)}L${n(cx)} ${n(y + h)}L${n(x)} ${n(cy)}Z" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + (e.name ? text(cx, y - 6, e.name, { size: FONT - 1 }) : '');
  },
  // A pin on the edge of an action: a small square, its name beside it.
  pin(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + (e.name ? text(x + w + 4, y - 3, e.name, { anchor: 'start', size: FONT - 2 }) : '');
  },
  region(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="10" fill="none" stroke="${INK}" stroke-width="1.3" stroke-dasharray="7 5"/>` + (e.name ? text(x + PAD, y + LINE, e.name, { anchor: 'start', size: FONT - 1 }) : '');
  },
  // An execution on a lifeline: a narrow white bar over its dashed line.
  activation(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>`;
  },
  bar(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${INK}"/>`;
  },
  rounded(e, [x, y, w, h]) {
    const ls = wrap(e.name, w - PAD);
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(16, h / 2))}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + lines(ls, x + w / 2, y + h / 2 - ((ls.length - 1) * LINE) / 2 + 4.5);
  },
  box(e, [x, y, w, h]) {
    const ls = wrap(e.name, w - PAD);
    if (e.props?.type) ls.push(`[${e.props.type}]`);
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + lines(ls, x + w / 2, y + h / 2 - ((ls.length - 1) * LINE) / 2 + 4.5);
  },
  lane(e, [x, y, w, h]) {
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${INK}" stroke-width="1.3"/><line x1="${n(x)}" y1="${n(y + 28)}" x2="${n(x + w)}" y2="${n(y + 28)}" stroke="${INK}"/>` + text(x + w / 2, y + 19, e.name, { weight: 'bold' });
  },
  lifeline(e, [x, y, w, h]) {
    const head = 40, cx = x + w / 2, label = e.props?.type ? `${e.name}: ${e.props.type}` : e.name;
    return `<line x1="${n(cx)}" y1="${n(y + head)}" x2="${n(cx)}" y2="${n(y + h)}" stroke="${INK}" stroke-dasharray="6 4"/><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${head}" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>` + text(cx, y + head / 2 + 4.5, label, { deco: 'underline' });
  },
  actorLifeline(e, [x, y, w, h]) {
    const cx = x + w / 2, head = 70;
    return `<line x1="${n(cx)}" y1="${n(y + head)}" x2="${n(cx)}" y2="${n(y + h)}" stroke="${INK}" stroke-dasharray="6 4"/>` + SHAPES.stickman({ ...e, name: e.props?.type ? `${e.name}: ${e.props.type}` : e.name }, [x, y, w, head - 4]);
  },
  node(e, [x, y, w, h]) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    let out = `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${FILL}" stroke="${INK}" stroke-width="1.4"/>`;
    if (e.props?.accepting) out += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(Math.max(2, rx - 4))}" ry="${n(Math.max(2, ry - 4))}" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
    // A start state: an arrow coming in from the left.
    if (e.props?.start) out += `<path d="M${n(x - 28)} ${n(cy)}H${n(x - 1)}" stroke="${INK}" stroke-width="1.3"/>` + mark('filled', [x - 1, cy], 1, 0);
    const ls = wrap(e.name, w - 8);
    return out + lines(ls, cx, cy - ((ls.length - 1) * LINE) / 2 + 4.5);
  },
  fragment(e, [x, y, w, h]) {
    const op = e.props?.operator || 'alt', tw = Math.max(44, textWidth(op) + 18), th = 20;
    return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="${INK}" stroke-width="1.3"/><path d="M${n(x)} ${n(y + th)}H${n(x + tw - 8)}L${n(x + tw)} ${n(y + th - 8)}V${n(y)}" fill="${FILL}" stroke="${INK}" stroke-width="1.1"/>` + text(x + 6, y + 14, op, { anchor: 'start', weight: 'bold' }) + (e.props?.guard ? text(x + tw + 8, y + 14, `[${e.props.guard}]`, { anchor: 'start' }) : '') + (e.name ? text(x + 8, y + th + LINE, e.name, { anchor: 'start', fill: MUTED }) : '');
  },
};

// The end marks of connectors, drawn at `tip` pointing along (ux, uy).
function mark(kind, tip, ux, uy) {
  const px = -uy, py = ux, L = 12, W = 6;
  const [tx, ty] = tip;
  const p = (a, b) => `${n(tx - ux * a + px * b)} ${n(ty - uy * a + py * b)}`;
  if (kind === 'open') return `<path d="M${p(L, W)}L${n(tx)} ${n(ty)}L${p(L, -W)}" fill="none" stroke="${INK}" stroke-width="1.3"/>`;
  if (kind === 'filled') return `<path d="M${p(L, W * 0.8)}L${n(tx)} ${n(ty)}L${p(L, -W * 0.8)}Z" fill="${INK}" stroke="${INK}"/>`;
  if (kind === 'hollowTriangle') return `<path d="M${p(14, 8)}L${n(tx)} ${n(ty)}L${p(14, -8)}Z" fill="${FILL}" stroke="${INK}" stroke-width="1.3"/>`;
  if (kind === 'hollowDiamond' || kind === 'filledDiamond') return `<path d="M${n(tx)} ${n(ty)}L${p(9, 6)}L${p(18, 0)}L${p(9, -6)}Z" fill="${kind === 'filledDiamond' ? INK : FILL}" stroke="${INK}" stroke-width="1.3"/>`;
  return '';
}
// How far back from the tip the line stops under a mark (so it does not show through).
const BACK = { hollowTriangle: 14, hollowDiamond: 18, filledDiamond: 18, filled: 10 };

// The label of a connector at its middle.
export function connectorLabel(c) {
  const def = CONNECTORS[c.type] || {};
  const p = c.props || {};
  const parts = [];
  if (def.keyword) parts.push(`«${def.keyword}»`);
  if (p.stereotypes?.length) parts.push(stereo(p.stereotypes));
  if (c.type === 'transition') {
    const s = `${p.trigger || ''}${p.guard ? ` [${p.guard}]` : ''}${p.effect ? ` / ${p.effect}` : ''}`.trim();
    if (s) parts.push(s);
  } else if (c.type === 'controlFlow' || c.type === 'objectFlow') {
    if (p.name) parts.push(p.name);
    if (p.guard) parts.push(`[${p.guard}]`);
  } else if (def.message) {
    if (p.name) parts.push(`${p.name}${'args' in (def.fields || {}) ? `(${p.args || ''})` : ''}`);
  } else {
    if (p.name) parts.push(p.name);
    if (c.type === 'extend' && p.condition) parts.push(`[${p.condition}]`);
  }
  return parts.join(' ');
}

// Where a connector's label goes: beside the middle of its longest segment (above a level
// line, right of an upright one), moved by `offset` ([dx, dy], dragged in the editor).
// { x, y (baseline), w }.
export function labelBox(pts, label, offset = null) {
  let best = 1, bl = -1;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (l > bl) { bl = l; best = i; } }
  const mx = (pts[best][0] + pts[best - 1][0]) / 2, my = (pts[best][1] + pts[best - 1][1]) / 2;
  const horizontal = Math.abs(pts[best][1] - pts[best - 1][1]) < Math.abs(pts[best][0] - pts[best - 1][0]);
  const w = textWidth(label, FONT - 1);
  let x = horizontal ? mx - w / 2 : mx + 9, y = horizontal ? my - 7 : my + 4;
  if (Array.isArray(offset) && offset.length === 2 && offset.every(Number.isFinite)) { x += offset[0]; y += offset[1]; }
  return { x, y, w };
}

// The points of a connector's line on the page of the diagram (after clipping to its ends).
export function connectorPath(model, c, fitted = null) {
  const byId = fitted || new Map(model.elements.map((e) => [e.id, fitBounds(e)]));
  const A = model.elements.find((e) => e.id === c.from), B = model.elements.find((e) => e.id === c.to);
  const a = byId.get(c.from), b = byId.get(c.to);
  if (!A || !B || !a || !b) return null;
  if (CONNECTORS[c.type]?.message) {
    const y = Number.isFinite(c.props?.y) ? c.props.y : a[1] + 80;
    let ax = a[0] + a[2] / 2, bx = b[0] + b[2] / 2;
    // An activation bar on the lifeline at that height: the message starts or ends at its edge.
    const bar = (x, yy) => model.elements.find((e) => ELEMENTS[e.type]?.shape === 'activation' && e.bounds[0] <= x && x <= e.bounds[0] + e.bounds[2] && e.bounds[1] <= yy && yy <= e.bounds[1] + e.bounds[3]);
    if (A.id === B.id) { const r = bar(ax, y); if (r) ax = r.bounds[0] + r.bounds[2]; return [[ax, y], [ax + 40, y], [ax + 40, y + 20], [ax, y + 20]]; }
    const dir = Math.sign(bx - ax) || 1;
    const ra = bar(ax, y), rb = bar(bx, y);
    if (ra) ax = dir > 0 ? ra.bounds[0] + ra.bounds[2] : ra.bounds[0];
    if (rb) bx = dir > 0 ? rb.bounds[0] : rb.bounds[0] + rb.bounds[2];
    return [[ax, y], [bx, y]];
  }
  const mid = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
  const way = c.waypoints || [];
  if (A.id === B.id && !way.length) {
    const [x, y, w] = a;
    return [[x + w * 0.7, y], [x + w * 0.7, y - 30], [x + w + 30, y - 30], [x + w + 30, y + 20], [x + w, y + 20]];
  }
  const first = way[0] || mid(b), last = way[way.length - 1] || mid(a);
  // Two connectors between the same two elements (a → b and b → a in an automaton) are
  // drawn apart instead of on top of each other.
  if (!way.length && model.connectors.some((q) => q !== c && !q.waypoints?.length && ((q.from === c.to && q.to === c.from) || (q.from === c.from && q.to === c.to)))) {
    const [ax, ay] = mid(a), [bx, by] = mid(b), l = Math.hypot(bx - ax, by - ay) || 1;
    // To the left of its own direction: a → b and b → a then fall on opposite sides.
    const ox = (-(by - ay) / l) * 7, oy = ((bx - ax) / l) * 7;
    const p = clip(A, a, [bx + ox, by + oy]), q = clip(B, b, [ax + ox, ay + oy]);
    return [[p[0] + ox, p[1] + oy], [q[0] + ox, q[1] + oy]];
  }
  return [clip(A, a, first), ...way, clip(B, b, last)];
}

// The whole diagram as SVG text, with its size: { svg, width, height, box: [x, y, w, h] }.
// `ids`: data-uml-id attributes on each element and connector (for the editor);
// `selected`: ids drawn highlighted.
export function renderUml(input, { ids = false, selected = [], margin = 16, badge = null } = {}) {
  const model = input?.elements && input?.connectors && input.version ? input : normalizeModel(input);
  const fitted = new Map(model.elements.map((e) => [e.id, fitBounds(e)]));
  const sel = new Set(selected);
  // Containers first (they sit under what they hold), then by order.
  const depth = (e) => { let d = 0, p = e.parent; const seen = new Set(); while (p && !seen.has(p)) { seen.add(p); d++; p = model.elements.find((q) => q.id === p)?.parent; } return d; };
  const order = [...model.elements].sort((a, b) => (ELEMENTS[b.type]?.container ? 1 : 0) - (ELEMENTS[a.type]?.container ? 1 : 0) || depth(a) - depth(b));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  let body = '', labels = '';
  for (const e of order) {
    const def = ELEMENTS[e.type] || { shape: 'box' };
    const b = fitted.get(e.id);
    const draw = SHAPES[def.shape] || SHAPES.box;
    const attr = ids ? ` data-uml-id="${esc(e.id)}" data-uml-kind="element"` : '';
    const k = textScale(e);
    let shape = k === 1 ? draw(e, b, def) : `<g transform="translate(${n(b[0])} ${n(b[1])}) scale(${n(k * 1000) / 1000}) translate(${n(-b[0])} ${n(-b[1])})">${draw(e, [b[0], b[1], b[2] / k, b[3] / k], def)}</g>`;
    shape = recolor(shape, itemColor(e));
    body += `<g${attr}>${shape}${sel.has(e.id) ? `<rect x="${n(b[0] - 4)}" y="${n(b[1] - 4)}" width="${n(b[2] + 8)}" height="${n(b[3] + 8)}" fill="none" stroke="#0a84ff" stroke-width="2" stroke-dasharray="5 3" rx="4"/>` : ''}</g>`;
    grow(b[0], b[1]); grow(b[0] + b[2], b[1] + b[3]);
    if (def.shape === 'stickman' || def.shape === 'actorLifeline') { const w = textWidth(e.name); grow(b[0] + b[2] / 2 - w / 2, b[1]); grow(b[0] + b[2] / 2 + w / 2, b[1] + b[3] + 6); }
    if (def.shape === 'diamond' && e.name) grow(b[0], b[1] - LINE - 4);
  }
  for (const c of model.connectors) {
    const def = CONNECTORS[c.type] || CONNECTORS.association;
    const pts = connectorPath(model, c, fitted);
    if (!pts || pts.length < 2) continue;
    const draw = pts.map((p) => [...p]);
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    const startMark = def.start, endMark = c.type === 'association' && c.props?.toEnd?.navigable ? 'open' : def.end;
    const fromMark = c.type === 'association' && c.props?.fromEnd?.navigable ? 'open' : startMark;
    const [eu, ev] = unit(draw[draw.length - 2], draw[draw.length - 1]);
    const [su, sv] = unit(draw[1], draw[0]);
    const tip = [...draw[draw.length - 1]], tail = [...draw[0]];
    if (BACK[endMark]) { draw[draw.length - 1][0] -= eu * BACK[endMark]; draw[draw.length - 1][1] -= ev * BACK[endMark]; }
    if (BACK[fromMark]) { draw[0][0] -= su * BACK[fromMark]; draw[0][1] -= sv * BACK[fromMark]; }
    const attr = ids ? ` data-uml-id="${esc(c.id)}" data-uml-kind="connector"` : '';
    const d = draw.map((p, i) => `${i ? 'L' : 'M'}${n(p[0])} ${n(p[1])}`).join('');
    const tone = itemColor(c), k = textScale(c);
    let g = `<path d="${d}" fill="none" stroke="${sel.has(c.id) ? '#0a84ff' : tone || INK}" stroke-width="${sel.has(c.id) ? 2.4 : 1.3}"${def.line === 'dashed' ? ' stroke-dasharray="7 5"' : ''}/>`;
    if (ids) g += `<path d="${d}" fill="none" stroke="transparent" stroke-width="14"/>`;
    g += recolor(mark(endMark, tip, eu, ev) + mark(fromMark, tail, su, sv), tone, { fill: false });
    // The label beside the middle of the longest segment (above a level line, right of an
    // upright one), moved from there by `props.labelOffset`. Drawn after every line, on its
    // own background, so a line never hides it.
    const label = connectorLabel(c);
    if (label) {
      const at = labelBox(pts, label, c.props?.labelOffset);
      const grown = k === 1 ? '' : ` transform="translate(${n(at.x + at.w / 2)} ${n(at.y - FONT / 2)}) scale(${n(k * 1000) / 1000}) translate(${n(-(at.x + at.w / 2))} ${n(-(at.y - FONT / 2))})"`;
      labels += `<g${ids ? ` data-uml-id="${esc(c.id)}" data-uml-kind="label"` : ''}${grown}><rect x="${n(at.x - 3)}" y="${n(at.y - FONT + 1)}" width="${n(at.w + 6)}" height="${FONT + 3}" rx="2" fill="${FILL}"${sel.has(c.id) ? ' stroke="#0a84ff" stroke-width="1"' : ''}/>${text(at.x + at.w / 2, at.y, label, { anchor: 'middle', size: FONT - 1, fill: tone || INK })}</g>`;
      grow(at.x + at.w / 2 - (at.w / 2 + 3) * k, at.y - FONT / 2 - (FONT / 2) * k - 1); grow(at.x + at.w / 2 + (at.w / 2 + 3) * k, at.y - FONT / 2 + (FONT / 2 + 3) * k);
    }
    // Role and multiplicity at each end.
    if (def.ends) {
      for (const [end, at, u, v] of [[c.props?.fromEnd, pts[0], -su, -sv], [c.props?.toEnd, pts[pts.length - 1], -eu, -ev]]) {
        const s = [end?.role, end?.multiplicity].filter(Boolean).join('  ');
        if (!s) continue;
        // Along the line from the end, on the side away from the middle label (below or right).
        let nx = -v, ny = u;
        if (ny < -0.1 || (Math.abs(ny) <= 0.1 && nx < 0)) { nx = -nx; ny = -ny; }
        const ex = at[0] + u * 14 + nx * 12, ey = at[1] + v * 14 + ny * 12 + 4;
        g += text(ex, ey, s, { size: FONT - 1, anchor: Math.abs(u) > Math.abs(v) ? (u > 0 ? 'start' : 'end') : 'start' });
        grow(ex - textWidth(s, FONT - 1), ey - FONT); grow(ex + textWidth(s, FONT - 1), ey + 2);
      }
    }
    for (const p of pts) grow(p[0], p[1]);
    body += `<g${attr}>${g}</g>`;
  }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 200; y1 = 100; }
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const title = model.title || '';
  const showBadge = badge ?? model.badge !== false;
  if (title) y0 -= LINE + 6;
  else if (showBadge) y0 -= 16;
  const W = x1 - x0, H = y1 - y0;
  let head = title ? text(x0 + W / 2, y0 + LINE, title, { weight: 'bold', size: FONT + 2 }) : '';
  if (showBadge) head += `<g class="uml-badge"><rect x="${n(x1 - 38)}" y="${n(y0 + 4)}" width="34" height="15" rx="4" fill="#eef2ff" stroke="#8b95c9" stroke-width="0.8"/>${text(x1 - 21, y0 + 15, 'UML', { size: 9.5, weight: 'bold', fill: '#4b5596' })}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x0)} ${n(y0)} ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}"><rect x="${n(x0)}" y="${n(y0)}" width="${n(W)}" height="${n(H)}" fill="${FILL}"/><g font-family="Helvetica, Arial, sans-serif">${head}${body}${labels}</g></svg>`;
  return { svg, width: W, height: H, box: [x0, y0, W, H] };
}

// ---------------------------------------------------------------------------------------
// Icons: 24 × 24 line drawings of what each type looks like (palette, menus, picker).

export const SHAPE_ICONS = {
  stickman: 'M12 3.5a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4ZM12 8v7M7 10.5h10M8 20.5l4-5.5 4 5.5',
  ellipse: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6Z',
  boundary: 'M3 4h18v16H3zM8 8h8',
  compartments: 'M4 3h16v18H4zM4 8h16M4 14h16M7 11h6M7 17h8',
  folder: 'M3 6V3h7v3M3 6h18v14H3z',
  note: 'M4 3h12l4 4v14H4zM16 3v4h4M7 11h9M7 15h6',
  state: 'M7 5h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4ZM3 11h18',
  composite: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM3 8h18M8 12h4v4H8zM14 13h3',
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  bullseye: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  flowFinal: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM7 7l10 10M17 7 7 17',
  history: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM9.5 8.5v7M14.5 8.5v7M9.5 12h5',
  diamond: 'M12 3l9 9-9 9-9-9Z',
  bar: 'M3 10.5h18v3H3z',
  rounded: 'M7 6h10a5 5 0 0 1 0 12H7A5 5 0 0 1 7 6Z',
  box: 'M4 7h16v10H4z',
  lane: 'M4 3h16v18H4zM4 7h16M12 3v18',
  lifeline: 'M6 3h12v6H6zM12 9v12',
  actorLifeline: 'M12 2.5a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6ZM12 6v4M9 8h6M9.5 12.5 12 10l2.5 2.5M12 14v1.5M12 18v1.5M12 22v.5',
  fragment: 'M3 4h18v16H3zM3 9h6l2-2V4',
  pin: 'M4 8h11v8H4zM15 10h3v4h-3zM18 12h3',
  region: 'M4 6h16v12H4z M8 10l3 3-2 1 4 3',
  activation: 'M12 2v4M12 18v4M9.5 6h5v12h-5z',
  node: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm-3 7h6',
};
// Connectors: a diagonal line with the mark at its upper end (a diamond at the start of an
// aggregation or composition is drawn at that end too).
export const CONNECTOR_ICONS = {
  none: 'M4 20 20 4',
  open: 'M4 20 20 4M13 4h7v7',
  filled: 'M4 20 15 9M13 5.5 20 4l-1.5 7Z',
  hollowTriangle: 'M4 20 15 9M13.2 7.2 20 4l-3.2 6.8Z',
  hollowDiamond: 'M4 20 14.5 9.5M14.5 9.5 15.6 5.6 19.5 4.5 18.4 8.4Z',
  filledDiamond: 'M4 20 14.5 9.5M14.5 9.5 15.6 5.6 19.5 4.5 18.4 8.4Z',
};
const FILLED_ICONS = new Set(['filled', 'filledDiamond']);

const iconMark = (type) => { const def = CONNECTORS[type] || {}; return def.start && def.start !== 'none' ? def.start : def.end || 'none'; };
export function iconPath(kind, type) {
  if (kind === 'element') return SHAPE_ICONS[ELEMENTS[type]?.shape] || SHAPE_ICONS.box;
  return CONNECTOR_ICONS[iconMark(type)] || CONNECTOR_ICONS.none;
}
// The icon as an <svg> element (with a dashed line for dashed connectors).
export function umlIcon(kind, type, doc = globalThis.document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = doc.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', iconPath(kind, type));
  // A connector drawn back toward where the drag started («extend») points the other way.
  if (kind === 'connector' && CONNECTORS[type]?.drawnBack) path.setAttribute('transform', 'rotate(180 12 12)');
  if (kind === 'connector' && CONNECTORS[type]?.line === 'dashed') path.setAttribute('stroke-dasharray', '3 2.5');
  if ((kind === 'element' && ['dot', 'bar'].includes(ELEMENTS[type]?.shape)) || (kind === 'connector' && FILLED_ICONS.has(iconMark(type)))) path.setAttribute('fill', 'currentColor');
  svg.append(path);
  // A connector known by its keyword («include», «extend», «create») also shows its letter,
  // since the arrows alone look alike.
  const keyword = kind === 'connector' && CONNECTORS[type]?.keyword;
  if (keyword) {
    const t = doc.createElementNS(svg.namespaceURI, 'text');
    for (const [k, v] of Object.entries({ x: 2, y: 10.5, 'font-size': 10, 'font-weight': 700, 'font-family': 'system-ui, sans-serif', fill: 'currentColor', stroke: 'none' })) t.setAttribute(k, v);
    t.textContent = keyword[0].toUpperCase();
    svg.append(t);
  }
  return svg;
}
