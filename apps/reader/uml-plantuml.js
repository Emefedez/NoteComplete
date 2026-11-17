// PlantUML text ↔ the UML editor's model (uml.js), for class, package and use case diagrams:
// a .puml file opens in the same editor as the UML prefabs and is saved back as PlantUML.
//
// What PlantUML cannot hold (where each box sits, the bends of a line) is kept in one comment
// line, `' notecomplete-layout {…}`, which PlantUML ignores. Lines that only style the drawing
// (skinparam, !include, hide…) are kept as they were, above the diagram.
import { ELEMENTS, CONNECTORS, DIAGRAMS, CODE_DIAGRAMS, normalizeModel, parseLine, formatLine, UML_VERSION, headsOf } from './uml.js';

const LAYOUT = /^'\s*notecomplete-layout\s+(\{.*\})\s*$/;
// Lines kept verbatim: they style or configure the drawing and mean nothing to the model.
const KEPT = /^(!|skinparam\b|hide\b|show\b|left to right direction|top to bottom direction|scale\b|set\b|allowmixing\b|allow_mixing\b|header\b|footer\b|caption\b|newpage\b)/i;
// Lines of diagrams this does not turn into a model (activity, sequence, state…): those files
// stay as PlantUML, drawn as a picture.
const OTHER = /^(start|stop|end|if\s*\(|else|endif|while\s*\(|endwhile|repeat|fork|split|partition\b|\|[^|]+\||:.*;$|participant\b|boundary\b|control\b|database\b|collections\b|queue\b|activate\b|deactivate\b|alt\b|loop\b|state\b|\[\*\]|object\b|map\b|json\b|component\b|node\b|artifact\b|frame\b|cloud\b|storage\b|folder\b|file\b|card\b|agent\b|stack\b|label\b|@startmindmap|@startgantt|@startwbs)/i;

const unquote = (s) => String(s ?? '').trim().replace(/^"(.*)"$/s, '$1');
const spaced = (s) => unquote(s).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'X';

// One relation's arrow: [left head][line][direction or style][line][right head].
const ARROW = /^(<\||<|\*|o|\+|#|\^|\})?(-+|\.+|=+)(?:(left|right|up|down|le|ri|do|up|l|r|u|d|\[[^\]]*\])(-+|\.+|=+))?(\|>|>|\*|o|\+|#|\^|\{)?$/i;
// A relation line: one end, optional multiplicity, the arrow, optional multiplicity, the other end, label.
const END = String.raw`(\([^)]*\)|:[^:]+:|"[^"]+"|[\w.$À-￿]+)`;
const RELATION = new RegExp(String.raw`^${END}\s*(?:"([^"]*)"\s*)?(\S+?)\s*(?:"([^"]*)"\s*)?${END}\s*(?::\s*(.*))?$`, 'u');
const ASSOCIATION_CLASS = /^\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)\s*\.+\s*(\S+)$|^(\S+)\s*\.+\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/;

// The text → { model, preamble } or an Error saying what it cannot read.
export function parsePlantUml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const preamble = [];
  const elements = [], connectors = [], byKey = new Map();
  let name = '', title = '', layout = null, kind = '';
  const stack = []; // open packages / boundaries
  let i = 0;
  const parentId = () => stack.at(-1) || null;
  const add = (type, key, label, props = {}) => {
    if (byKey.has(key)) { const e = byKey.get(key); if (label && e.name === e.id) e.name = label; Object.assign(e.props, props); return e; }
    const def = ELEMENTS[type];
    const e = { id: key, type, name: label ?? key, props: { ...props }, bounds: [NaN, NaN, def.size[0], def.size[1]], parent: parentId() };
    elements.push(e);
    byKey.set(key, e);
    return e;
  };
  // An end of a relation: (Use case), :Actor:, "Quoted" or a name; made if not declared.
  const endOf = (raw) => {
    const s = raw.trim();
    if (/^\(.*\)$/.test(s)) { kind ||= 'useCase'; const label = spaced(s.slice(1, -1)); return add('useCase', slug(label), label); }
    if (/^:.*:$/.test(s)) { kind ||= 'useCase'; const label = spaced(s.slice(1, -1)); return add('actor', slug(label), label); }
    const key = unquote(s);
    return byKey.get(key) || add(kind === 'useCase' ? 'useCase' : 'class', key, spaced(key));
  };
  const stereo = (s) => [...String(s || '').matchAll(/<<\s*([^>]+?)\s*>>/g)].map((m) => m[1]);
  const declaration = (rest) => {
    // "Shown name" as Alias  |  Alias as "Shown name"  |  Name  — then <<stereotypes>>, then {
    const m = rest.match(/^("[^"]*"|\S+?)(?:\s+as\s+("[^"]*"|\S+?))?(\s*<<.*?>>)*\s*(\{.*)?$/s);
    if (!m) return null;
    let [label, alias] = [m[1], m[2]];
    if (alias && /^".*"$/.test(alias) && !/^".*"$/.test(label)) [label, alias] = [alias, label];
    return { key: unquote(alias || label), label: spaced(label), stereotypes: stereo(rest), open: (m[4] || '').trim() };
  };
  // A class body: attributes, operations, literals; until the closing brace.
  const body = (e, first) => {
    const out = [];
    let rest = first.replace(/^\{/, '');
    if (rest.includes('}')) { out.push(...rest.slice(0, rest.indexOf('}')).split(/\\n|;/)); }
    else {
      if (rest.trim()) out.push(rest);
      for (i++; i < lines.length && !/^\s*\}/.test(lines[i]); i++) out.push(lines[i]);
    }
    const attributes = [], operations = [], literals = [];
    for (let raw of out) {
      raw = raw.trim();
      if (!raw || /^(--|==|\.\.|__)/.test(raw) || raw.startsWith("'")) continue;
      if (e.type === 'enumeration') { literals.push({ name: raw.replace(/[,;]$/, '') }); continue; }
      const isStatic = /\{(static|classifier)\}/i.test(raw), isAbstract = /\{abstract\}/i.test(raw);
      const line = raw.replace(/\{(static|classifier|abstract|field|method)\}\s*/gi, '');
      if (/\(.*\)/.test(line)) operations.push({ ...parseLine('operation', operationLine(line)), static: isStatic, abstract: isAbstract });
      else attributes.push({ ...parseLine('attribute', line), static: isStatic });
    }
    if (e.type === 'enumeration') e.props.literals = literals;
    else { e.props.attributes = attributes; e.props.operations = operations; }
  };

  for (i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim();
    if (!line) continue;
    const lay = line.match(LAYOUT);
    if (lay) { try { layout = JSON.parse(lay[1]); } catch { /* A broken layout is laid out again. */ } continue; }
    if (line.startsWith("'")) continue;
    if (/^\/'/.test(line)) { while (i < lines.length && !lines[i].includes("'/")) i++; continue; }
    let m;
    if ((m = line.match(/^@startuml\s*(.*)$/i))) { name = m[1].trim(); continue; }
    if (/^@enduml/i.test(line)) break;
    if (/^@start/i.test(line)) throw Error('This PlantUML file is not a UML diagram the editor reads.');
    if ((m = line.match(/^title\s+(.*)$/i))) { title = m[1].trim(); continue; }
    if (/^skinparam\b.*\{\s*$/i.test(line)) { preamble.push(raw); for (i++; i < lines.length; i++) { preamble.push(lines[i]); if (/^\s*\}/.test(lines[i])) break; } continue; }
    if (/^(legend|note\s+as)\b/i.test(line) && !/:/.test(line)) { /* A block with no anchor: kept as styling. */ preamble.push(raw); for (i++; i < lines.length; i++) { preamble.push(lines[i]); if (/^\s*end\s*(legend|note)/i.test(lines[i])) break; } continue; }
    if (KEPT.test(line)) { preamble.push(raw); continue; }
    if (line === '}') { stack.pop(); continue; }
    if ((m = line.match(/^(package|namespace|rectangle)\s+(.*?)\s*\{\s*$/i))) {
      const d = declaration(m[2]) || { key: slug(m[2]), label: spaced(m[2]), stereotypes: [] };
      const isSystem = m[1].toLowerCase() === 'rectangle' && kind !== 'class';
      const e = add(isSystem ? 'system' : 'package', d.key, d.label, isSystem ? {} : { stereotypes: d.stereotypes });
      stack.push(e.id);
      continue;
    }
    if ((m = line.match(/^(abstract\s+class|abstract|class|interface|enum|annotation|entity|exception|metaclass|protocol|struct|dataclass|record)\s+(.*)$/i))) {
      kind ||= 'class';
      const word = m[1].toLowerCase().replace(/\s+/g, ' ');
      const type = word === 'interface' ? 'interface' : word === 'enum' ? 'enumeration' : 'class';
      const d = declaration(m[2]);
      if (!d) throw Error(`Cannot read: ${line}`);
      const e = add(type, d.key, d.label);
      if (type !== 'enumeration') e.props.stereotypes = d.stereotypes.filter((s) => s.toLowerCase() !== 'interface');
      if (word.startsWith('abstract')) e.props.abstract = true;
      if (d.open.startsWith('{')) body(e, d.open);
      continue;
    }
    if ((m = line.match(/^actor\s+(.*)$/i))) {
      kind ||= 'useCase';
      const rest = m[1].replace(/^:([^:]+):/, '"$1"');
      const d = declaration(rest);
      add('actor', d.key, d.label, { stereotypes: d.stereotypes });
      continue;
    }
    if ((m = line.match(/^(?:usecase\s+)?\(([^)]*)\)(?:\s+as\s+(\S+))?\s*(<<.*>>)?$/i)) || (m = line.match(/^usecase\s+("[^"]*"|\S+)(?:\s+as\s+(\S+))?\s*(<<.*>>)?$/i))) {
      kind ||= 'useCase';
      const label = spaced(m[1]);
      add('useCase', m[2] || slug(label), label);
      continue;
    }
    if ((m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(\S+)\s*:\s*(.*)$/i))) {
      const n = add('note', `N${elements.length + 1}`, m[3].replace(/\\n/g, '\n'));
      connectors.push({ type: 'anchor', from: n.id, to: unquote(m[2]), props: {} });
      continue;
    }
    if ((m = line.match(/^note\s+(left|right|top|bottom)\s+of\s+(\S+)\s*$/i))) {
      const out = [];
      for (i++; i < lines.length && !/^\s*end\s*note/i.test(lines[i]); i++) out.push(lines[i].trim());
      const n = add('note', `N${elements.length + 1}`, out.join('\n'));
      connectors.push({ type: 'anchor', from: n.id, to: unquote(m[2]), props: {} });
      continue;
    }
    if ((m = line.match(/^note\s+"([^"]*)"\s+as\s+(\S+)$/i))) { add('note', m[2], m[1].replace(/\\n/g, '\n')); continue; }
    if ((m = line.match(ASSOCIATION_CLASS))) {
      const [a, b, cls] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[6], m[4]];
      connectors.push({ type: 'associationClass', from: endOf(cls).id, between: [endOf(a).id, endOf(b).id], props: {} });
      continue;
    }
    const arrow = (m = line.match(RELATION)) && m[3].match(ARROW);
    if (arrow) {
      if (/hidden/i.test(arrow[3] || '')) continue;
      connectors.push(relation(endOf(m[1]), endOf(m[5]), arrow, m[2], m[4], m[6], kind));
      continue;
    }
    if (OTHER.test(line)) throw Error('This kind of PlantUML diagram opens as a picture: the editor reads class, package and use case diagrams.');
    throw Error(`Cannot read this line: ${line}`);
  }

  const useCase = kind === 'useCase' || elements.some((e) => e.type === 'actor' || e.type === 'useCase');
  const pkgConnectors = new Set(['dependency', 'generalization', 'realization', 'anchor']);
  const isPackage = !useCase && elements.some((e) => e.type === 'package')
    && elements.every((e) => !e.props?.attributes?.length && !e.props?.operations?.length && !e.props?.literals?.length)
    && connectors.every((c) => pkgConnectors.has(c.type));
  const diagram = layout?.d && DIAGRAMS[layout.d] ? layout.d : useCase ? 'useCase' : isPackage ? 'package' : 'class';
  const model = { type: 'uml', version: UML_VERSION, diagram, name, title, badge: false, elements, connectors: [] };
  // Connectors get ids now; an association class names its association by the two classes.
  let n = 0;
  const made = [];
  for (const c of connectors) {
    if (c.type === 'associationClass') continue;
    if (!byKey.has(c.to)) continue;
    made.push({ id: `c${++n}`, type: c.type, from: typeof c.from === 'string' ? c.from : c.from, to: c.to, props: c.props, waypoints: [] });
  }
  for (const c of connectors) {
    if (c.type !== 'associationClass') continue;
    const [a, b] = c.between;
    const line = made.find((q) => CONNECTORS[q.type]?.ends && ((q.from === a && q.to === b) || (q.from === b && q.to === a)));
    if (!line || !byKey.has(c.from)) continue;
    made.push({ id: `c${++n}`, type: 'associationClass', from: c.from, to: line.id, props: {}, waypoints: [] });
  }
  model.connectors = made;
  if (layout) applyLayout(model, layout);
  return { model, preamble, laidOut: Boolean(layout?.e) };
}

// "+ lend(to: Member) : void" (PlantUML) → "+ lend(to: Member): void" (the editor's line form).
function operationLine(line) {
  return line.replace(/\)\s*:\s*/, '): ');
}

// A relation's type and direction from its arrow. The model's connectors point from → to:
// generalization from the child, a diamond at `from` (the whole), «extend» from the extension.
function relation(left, right, arrow, leftMult, rightMult, label, kind) {
  const [, lh = '', line, , , rh = ''] = arrow;
  const dashed = line.startsWith('.');
  // A note's link to what it is about.
  if (left.type === 'note' || right.type === 'note') return { type: 'anchor', from: (left.type === 'note' ? left : right).id, to: (left.type === 'note' ? right : left).id, props: {} };
  let type, from = left, to = right, flipped = false;
  if (lh === '<|' || rh === '|>') { type = dashed ? 'realization' : 'generalization'; if (lh === '<|') { from = right; to = left; flipped = true; } }
  else if (lh === '*' || rh === '*') { type = 'composition'; if (rh === '*') { from = right; to = left; flipped = true; } }
  else if (lh === 'o' || rh === 'o') { type = 'aggregation'; if (rh === 'o') { from = right; to = left; flipped = true; } }
  else if (lh === '<' || rh === '>') {
    if (lh === '<' && rh !== '>') { from = right; to = left; flipped = true; }
    const word = String(label || '').match(/<<\s*(include|extend)\s*>>/i)?.[1]?.toLowerCase();
    type = word || (dashed ? (kind === 'useCase' ? 'dependency' : 'dependency') : 'association');
  } else type = 'association';
  if (type === 'realization' && kind === 'useCase') type = 'generalization';
  const props = {};
  let text = String(label || '').trim();
  const word = text.match(/<<\s*(include|extend)\s*>>/i);
  if (word) text = text.replace(word[0], '').trim();
  if (type === 'extend') {
    const cond = text.match(/^(?:\\n)?\s*\(([^)]*)\)\s*$|^\[([^\]]*)\]$/);
    props.condition = cond ? spaced(cond[1] ?? cond[2]) : spaced(text.replace(/^\\n/, ''));
    text = '';
  }
  let reading = '';
  if (/\s*>$/.test(text) || /^<\s*/.test(text) && !/^<</.test(text)) {
    reading = text.endsWith('>') ? 'right' : 'left';
    text = text.replace(/\s*>$/, '').replace(/^<\s*/, '').trim();
  }
  if (CONNECTORS[type]?.ends) {
    const end = (mult) => ({ role: '', multiplicity: mult || '', navigable: false });
    props.fromEnd = end(flipped ? rightMult : leftMult);
    props.toEnd = end(flipped ? leftMult : rightMult);
    if (type === 'association' && (rh === '>' || lh === '<')) props.toEnd.navigable = true;
    if (text) props.name = spaced(text);
    if (reading) props.reading = (reading === 'right') !== flipped ? 'forward' : 'backward';
  } else if (text && 'name' in (CONNECTORS[type]?.fields || {})) props.name = spaced(text);
  return { type, from: from.id, to: to.id, props };
}

// Positions saved in the file's layout comment: elements by id, bends by connector key.
function applyLayout(model, layout) {
  for (const e of model.elements) {
    const b = layout.e?.[e.id];
    if (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)) e.bounds = [...b];
  }
  const keys = connectorKeys(model);
  for (const c of model.connectors) {
    const w = layout.w?.[keys.get(c)];
    if (Array.isArray(w)) c.waypoints = w.filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
    const o = layout.l?.[keys.get(c)];
    if (Array.isArray(o) && o.length === 2 && o.every(Number.isFinite)) c.props.labelOffset = o;
  }
}
// A connector's key in the layout comment: its ends and type, numbered when repeated.
function connectorKeys(model) {
  const seen = new Map(), out = new Map();
  for (const c of model.connectors) {
    const base = `${c.type}:${c.from}>${c.to}`;
    const k = seen.get(base) || 0;
    seen.set(base, k + 1);
    out.set(c, k ? `${base}#${k}` : base);
  }
  return out;
}

// Where PlantUML drew each element (its SVG: <g id="elem_X"> and <g id="cluster_X">), as boxes.
const decodeEntities = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
function tracePath(d, grow) {
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const [, cmd, raw] of String(d || '').matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const nums = raw.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)?.map(Number) || [];
    const rel = cmd === cmd.toLowerCase(), op = cmd.toUpperCase();
    if (op === 'Z') { cx = sx; cy = sy; continue; }
    const step = op === 'H' || op === 'V' ? 1 : op === 'C' ? 6 : op === 'S' || op === 'Q' ? 4 : op === 'A' ? 7 : 2;
    for (let k = 0; k + step <= nums.length; k += step) {
      if (op === 'H') { cx = (rel ? cx : 0) + nums[k]; grow(cx, cy); }
      else if (op === 'V') { cy = (rel ? cy : 0) + nums[k]; grow(cx, cy); }
      else if (op === 'A') { cx = (rel ? cx : 0) + nums[k + 5]; cy = (rel ? cy : 0) + nums[k + 6]; grow(cx, cy); }
      else {
        for (let j = 0; j + 1 < step; j += 2) grow((rel ? cx : 0) + nums[k + j], (rel ? cy : 0) + nums[k + j + 1]);
        cx = (rel ? cx : 0) + nums[k + step - 2]; cy = (rel ? cy : 0) + nums[k + step - 1];
        if (op === 'M' && k === 0) { sx = cx; sy = cy; }
      }
    }
  }
}
export function plantumlBoxes(svg) {
  const out = new Map();
  for (const m of String(svg || '').matchAll(/<g id="(?:elem|cluster)_([^"]+)">([\s\S]*?)<\/g>/g)) {
    const id = decodeEntities(m[1]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
    const num = (tag, a) => Number(tag.match(new RegExp(`\\s${a}="([-\\d.]+)"`))?.[1]);
    for (const [tag] of m[2].matchAll(/<(rect|ellipse|path|polygon|line|text)\b[^>]*>/g)) {
      if (tag.startsWith('<rect')) { const x = num(tag, 'x'), y = num(tag, 'y'); grow(x, y); grow(x + num(tag, 'width'), y + num(tag, 'height')); }
      else if (tag.startsWith('<ellipse')) { const cx = num(tag, 'cx'), cy = num(tag, 'cy'), rx = num(tag, 'rx'), ry = num(tag, 'ry'); grow(cx - rx, cy - ry); grow(cx + rx, cy + ry); }
      else if (tag.startsWith('<line')) { grow(num(tag, 'x1'), num(tag, 'y1')); grow(num(tag, 'x2'), num(tag, 'y2')); }
      else if (tag.startsWith('<text')) { const x = num(tag, 'x'), y = num(tag, 'y'), w = num(tag, 'textLength') || 0; grow(x, y - 12); grow(x + w, y + 3); }
      else if (tag.startsWith('<path')) { tracePath(tag.match(/\sd="([^"]*)"/)?.[1], grow); }
      else {
        const nums = (tag.match(/\spoints="([^"]*)"/)?.[1] || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
        for (let k = 0; k + 1 < nums.length; k += 2) grow(nums[k], nums[k + 1]);
      }
    }
    if (Number.isFinite(x0)) {
      const box = [x0, y0, x1 - x0, y1 - y0];
      out.set(id, box);
      // PlantUML gives `note left/right/top/bottom of X` an auto id (`GMN…`); key it by its text too.
      if (id.startsWith('GMN')) {
        const text = [...m[2].matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((t) => decodeEntities(t[1]).trim()).filter(Boolean).join('\n');
        if (text) out.set(`note:${text.split('\n')[0]}`, box);
      }
    }
  }
  return out;
}

// Places a model's elements where PlantUML drew them (the first time a .puml opens here).
export function layoutFromPlantuml(model, svg) {
  const boxes = plantumlBoxes(svg);
  // A package is keyed by its alias, or by its name when it has none; notes may use GMN… ids.
  let placed = 0;
  for (const e of model.elements) {
    const firstLine = e.type === 'note' ? String(e.name || '').split('\n')[0].trim() : '';
    const b = boxes.get(e.id) || boxes.get(e.name) || (firstLine ? boxes.get(`note:${firstLine}`) : null);
    if (!b) continue;
    const def = ELEMENTS[e.type];
    if (def?.container || ['class', 'interface', 'enumeration', 'note'].includes(e.type)) e.bounds = b.map((v) => Math.round(v));
    else {
      // An actor or use case: its own size, centred where PlantUML put it.
      const w = Math.max(def.size[0], Math.round(b[2])), h = Math.max(def.size[1], Math.round(b[3]));
      e.bounds = [Math.round(b[0] + b[2] / 2 - w / 2), Math.round(b[1] + b[3] / 2 - h / 2), w, h];
    }
    placed++;
  }
  // Packages get a band on top for their name tab.
  for (const e of model.elements) if (ELEMENTS[e.type]?.container && Number.isFinite(e.bounds[0])) { e.bounds[1] -= 10; e.bounds[3] += 10; }
  return placed;
}

// ---------------------------------------------------------------------------------------
// Model → PlantUML

const quoted = (s) => `"${String(s ?? '').replace(/"/g, "'").replace(/\n/g, '\\n')}"`;
const plainId = (id) => /^[A-Za-z_][\w]*$/.test(id);
// A use case's or actor's long name over two lines (PlantUML does not wrap them).
function wrapped(name, at = 20) {
  const s = String(name || '');
  if (s.length <= at || s.includes('\n')) return s;
  const mid = s.lastIndexOf(' ', Math.ceil(s.length / 2) + 4);
  return mid > 0 ? `${s.slice(0, mid)}\n${s.slice(mid + 1)}` : s;
}

export function toPlantUml(input, { preamble = [], layout: withLayout = true } = {}) {
  const model = normalizeModel(input);
  if (!CODE_DIAGRAMS.has(model.diagram)) throw Error('Saving as PlantUML covers class, package and use case diagrams. Export this one as a picture or a NoteComplete diagram.');
  const ids = new Map(model.elements.map((e) => [e.id, plainId(e.id) ? e.id : slug(e.name || e.id)]));
  // Ids made from names stay unique.
  const used = new Set();
  for (const [k, v] of ids) { let id = v, n = 2; while (used.has(id)) id = `${v}_${n++}`; used.add(id); ids.set(k, id); }
  const out = [`@startuml${model.name ? ` ${model.name}` : ''}`, ...preamble];
  if (model.title) out.push(`title ${model.title}`);
  const kids = (parent) => model.elements.filter((e) => (e.parent || null) === parent && e.type !== 'note');
  const pad = (depth) => '  '.repeat(depth);
  // `Name` alone when the name is the id, else `"Shown name" as Id`.
  const named = (e, id, name = e.name) => (name === id && plainId(id) ? id : `${quoted(name)} as ${id}`);
  const emit = (e, depth) => {
    const id = ids.get(e.id), p = e.props || {};
    const st = (p.stereotypes || []).map((s) => ` <<${s}>>`).join('');
    if (ELEMENTS[e.type]?.container) {
      const word = e.type === 'system' ? 'rectangle' : 'package';
      out.push(`${pad(depth)}${word} ${named(e, id)}${st} {`);
      for (const k of kids(e.id)) emit(k, depth + 1);
      out.push(`${pad(depth)}}`);
      return;
    }
    if (e.type === 'actor') return out.push(`${pad(depth)}actor ${named(e, id, wrapped(e.name, 22))}${st}`);
    if (e.type === 'useCase') return out.push(`${pad(depth)}usecase ${named(e, id, wrapped(e.name))}${st}`);
    if (e.type === 'enumeration') {
      out.push(`${pad(depth)}enum ${named(e, id)} {`);
      for (const l of p.literals || []) out.push(`${pad(depth + 1)}${l.name}`);
      out.push(`${pad(depth)}}`);
      return;
    }
    if (e.type === 'class' || e.type === 'interface') {
      const word = e.type === 'interface' ? 'interface' : p.abstract ? 'abstract class' : 'class';
      const rows = [
        ...(p.attributes || []).map((a) => `${a.static ? '{static} ' : ''}${formatLine('attribute', a)}`),
        ...(p.operations || []).map((o) => `${o.abstract ? '{abstract} ' : ''}${o.static ? '{static} ' : ''}${formatLine('operation', o).replace(/\):\s*/, ') : ')}`),
      ];
      out.push(`${pad(depth)}${word} ${named(e, id)}${st}${rows.length ? ' {' : ''}`);
      if (rows.length) { for (const r of rows) out.push(`${pad(depth + 1)}${r}`); out.push(`${pad(depth)}}`); }
      return;
    }
    out.push(`${pad(depth)}rectangle ${quoted(e.name)} as ${id}`);
  };
  for (const e of kids(null)) emit(e, 0);
  for (const e of model.elements.filter((q) => q.type === 'note')) out.push(`note ${quoted(e.name)} as ${ids.get(e.id)}`);
  const byConnector = new Map(model.connectors.map((c) => [c.id, c]));
  for (const c of model.connectors) {
    const p = c.props || {}, a = ids.get(c.from), b = ids.get(c.to);
    const m = (end) => (end?.multiplicity ? ` "${end.multiplicity}"` : '');
    const name = p.name ? ` : ${p.name}${p.reading === 'forward' ? ' >' : p.reading === 'backward' ? ' <' : ''}` : '';
    if (c.type === 'associationClass') {
      const line = byConnector.get(c.to);
      if (line) out.push(`(${ids.get(line.from)}, ${ids.get(line.to)}) .. ${a}`);
      continue;
    }
    if (!a || !b) continue;
    let arrow = {
      association: p.toEnd?.navigable ? '-->' : '--', aggregation: 'o--', composition: '*--', generalization: '--|>', realization: '..|>',
      dependency: '..>', include: '..>', extend: '..>', anchor: '..',
    }[c.type] || '--';
    // Heads or a line chosen by hand (right-click): written as PlantUML draws them.
    if (p.headFrom || p.headTo || p.line) {
      const h = headsOf(c);
      const left = { none: '', open: '<', filled: '<', hollowTriangle: '<|', hollowDiamond: 'o', filledDiamond: '*' }[h.start];
      const right = { none: '', open: '>', filled: '>', hollowTriangle: '|>', hollowDiamond: 'o', filledDiamond: '*' }[h.end];
      arrow = `${left}${h.line === 'dashed' ? '..' : '--'}${right}`;
    }
    let label = name;
    if (c.type === 'include') label = ' : <<include>>';
    if (c.type === 'extend') label = ` : <<extend>>${p.condition ? `\\n(${p.condition})` : ''}`;
    if (c.type === 'dependency' && p.name) label = ` : ${p.name}`;
    const ends = CONNECTORS[c.type]?.ends;
    out.push(`${a}${ends ? m(p.fromEnd) : ''} ${arrow}${ends ? m(p.toEnd) : ''} ${b}${['generalization', 'realization', 'anchor'].includes(c.type) ? '' : label}`);
  }
  // Where everything sits in the editor, for the next time it opens (PlantUML ignores it).
  if (!withLayout) { out.push('@enduml', ''); return out.join('\n'); }
  const keys = connectorKeys(model);
  const layout = { e: Object.fromEntries(model.elements.map((e) => [ids.get(e.id), e.bounds.map(Math.round)])) };
  if (model.diagram === 'package') layout.d = 'package';
  const ways = model.connectors.filter((c) => c.waypoints?.length);
  if (ways.length) layout.w = Object.fromEntries(ways.map((c) => [keyFor(keys.get(c), ids), c.waypoints]));
  const offsets = model.connectors.filter((c) => c.props?.labelOffset);
  if (offsets.length) layout.l = Object.fromEntries(offsets.map((c) => [keyFor(keys.get(c), ids), c.props.labelOffset]));
  out.push(`' notecomplete-layout ${JSON.stringify(layout)}`, '@enduml', '');
  return out.join('\n');
}
// A layout key written with the ids the file uses.
function keyFor(key, ids) {
  return key.replace(/:([^>]+)>([^#]+)/, (_, a, b) => `:${ids.get(a) || a}>${ids.get(b) || b}`);
}
