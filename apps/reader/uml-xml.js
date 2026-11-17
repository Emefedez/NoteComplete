// UML diagrams in and out of files: XMI 2.1 (what StarUML, Papyrus, Modelio and Visual
// Paradigm all exchange) and Visual Paradigm's own project XML. Both walkers are driven by the
// `xmi` and `vp` names of the registry in uml.js, so a type added there is read and written
// here too. Anything a file has that the model has no field for is kept in `source.extra`,
// and the file's own ids in `source.ids`, so a diagram that goes out and comes back keeps them.
//
// The Visual Paradigm names (element tags, attributes) are a first draft from its documentation
// and are meant to be checked against exported samples: they all live in the registry (`vp`)
// and in VP below, so fixing one is a change of a name, not of this code.
import { ELEMENTS, CONNECTORS, DIAGRAMS, normalizeModel, parseLine, formatLine, UML_VERSION } from './uml.js';

// ---------------------------------------------------------------------------------------
// A small XML reader and writer (the same in the browser and in Node, for the tests).

export function parseXml(source) {
  const s = String(source || '').replace(/^﻿/, '');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(s));) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const node = { name: m[3], attrs: {}, children: [], text: '', parent: top };
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[2] ?? a[3]);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += decode(m[6]);
  }
  const doc = root.children.find((c) => c.name) || null;
  if (!doc) throw Error('This is not an XML file.');
  return doc;
}

const escAttr = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/\n/g, '&#10;');
// { name, attrs, children } → text, indented.
export function writeXml(node, depth = 0) {
  const pad = '  '.repeat(depth);
  const attrs = Object.entries(node.attrs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  const kids = (node.children || []).filter(Boolean);
  if (!kids.length && !node.text) return `${pad}<${node.name}${attrs}/>`;
  if (!kids.length) return `${pad}<${node.name}${attrs}>${escAttr(node.text)}</${node.name}>`;
  return `${pad}<${node.name}${attrs}>\n${kids.map((k) => writeXml(k, depth + 1)).join('\n')}\n${pad}</${node.name}>`;
}
const el = (name, attrs = {}, children = [], text = '') => ({ name, attrs, children, text });
// Only the fields a connector type has (the readers fill in a few in common).
const ownProps = (type, props) => Object.fromEntries(Object.entries(props).filter(([k, v]) => k in (CONNECTORS[type]?.fields || {}) || k === 'fromEnd' || k === 'toEnd' || k === 'y' || (v !== '' && v != null)));
const local = (name) => String(name).replace(/^.*:/, '');
function* walk(node) { for (const c of node.children) { yield c; yield* walk(c); } }
const kids = (node, name) => node.children.filter((c) => local(c.name) === name);

// Which format a file is in.
export function detectFormat(text) {
  const head = String(text).slice(0, 4000);
  if (/xmi:XMI|xmlns:xmi=|<XMI[\s>]|xmi:version/.test(head)) return 'xmi';
  if (/<Project[\s>]/.test(head)) return 'vp-xml';
  if (/^\s*\{/.test(head)) return 'json';
  return null;
}

// A file's text → a model (normalized), or an error that says what is wrong.
export function importUml(text, options = {}) {
  const format = detectFormat(text);
  if (format === 'json') return normalizeModel(JSON.parse(text));
  if (format === 'xmi') return importXmi(text);
  if (format === 'vp-xml') return importVp(text, options);
  throw Error('Not a UML file this can read: XMI, Visual Paradigm XML or a NoteComplete diagram (JSON).');
}

// ---------------------------------------------------------------------------------------
// XMI 2.1

const XMI_NS = { 'xmlns:xmi': 'http://schema.omg.org/spec/XMI/2.1', 'xmlns:uml': 'http://schema.omg.org/spec/UML/2.1', 'xmlns:nc': 'https://notecomplete.app/xmi/layout' };
const PRIMITIVES = new Set(['String', 'Integer', 'Boolean', 'Real', 'UnlimitedNatural']);
const VISIBILITY = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };
const VISIBILITY_BACK = Object.fromEntries(Object.entries(VISIBILITY).map(([k, v]) => [v, k]));
const CONTEXT = { class: 'uml:Package', useCase: 'uml:Package', state: 'uml:StateMachine', activity: 'uml:Activity', sequence: 'uml:Interaction' };
// Multiplicity text ↔ lower and upper values.
function multiplicity(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // "*" alone is written as an upper bound only, so it reads back as "*" (not "0..*").
  if (t === '*') return { lower: '', upper: '*' };
  const [lo, hi] = t.includes('..') ? t.split('..') : [t, t];
  return { lower: lo, upper: hi };
}

// A node graph is not UML: it has no place in these files.
function umlOnly(model) {
  if (DIAGRAMS[model.diagram]?.notUml) throw Error(`A ${DIAGRAMS[model.diagram].label.toLowerCase()} is not a UML diagram: export it as a picture or a NoteComplete diagram instead.`);
  return model;
}

export function exportXmi(input) {
  const model = umlOnly(normalizeModel(input));
  const ids = { ...(model.source?.format === 'xmi' ? model.source.ids : {}) };
  const xid = (id) => ids[id] || id;
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const types = new Map(); // type name → id of a DataType made for it
  const typeRef = (name) => {
    const t = String(name || '').trim();
    if (!t) return null;
    const cls = model.elements.find((e) => e.name === t && ELEMENTS[e.type]?.shape === 'compartments');
    if (cls) return { attr: xid(cls.id) };
    if (PRIMITIVES.has(t)) return { href: `http://schema.omg.org/spec/UML/2.1/uml.xml#${t}` };
    if (!types.has(t)) types.set(t, `t_${types.size + 1}`);
    return { attr: types.get(t) };
  };
  const typed = (node, name) => {
    const r = typeRef(name);
    if (r?.attr) node.attrs.type = r.attr;
    else if (r?.href) node.children.push(el('type', { 'xmi:type': 'uml:PrimitiveType', href: r.href }));
    return node;
  };
  const value = (tag, v, owner) => (v === undefined || v === '' ? null : el(tag, { 'xmi:type': v === '*' ? 'uml:LiteralUnlimitedNatural' : 'uml:LiteralInteger', 'xmi:id': `${owner}_${tag === 'lowerValue' ? 'lo' : 'hi'}`, value: v === '*' ? '*' : v }));
  const kidsOf = (parentId) => model.elements.filter((e) => (e.parent || null) === parentId);
  const sequence = model.diagram === 'sequence', activity = model.diagram === 'activity', state = model.diagram === 'state';
  const nested = new Map(); // element id → extra children (generalizations, includes...)
  const add = (id, child) => { if (!nested.has(id)) nested.set(id, []); nested.get(id).push(child); };
  const top = [], regionEdges = [];
  for (const c of model.connectors) {
    const def = CONNECTORS[c.type] || {};
    // An association class's link is kept only in NoteComplete's layout section (nc:connector).
    if (def.toConnector) continue;
    const A = byId.get(c.from), B = byId.get(c.to);
    const cid = xid(c.id), p = c.props || {};
    if (c.type === 'generalization') add(A.id, el('generalization', { 'xmi:type': 'uml:Generalization', 'xmi:id': cid, general: xid(B.id) }));
    else if (c.type === 'realization') add(A.id, el('interfaceRealization', { 'xmi:type': 'uml:InterfaceRealization', 'xmi:id': cid, client: xid(A.id), supplier: xid(B.id), contract: xid(B.id) }));
    else if (c.type === 'include') add(A.id, el('include', { 'xmi:type': 'uml:Include', 'xmi:id': cid, addition: xid(B.id) }));
    else if (c.type === 'extend') add(A.id, el('extend', { 'xmi:type': 'uml:Extend', 'xmi:id': cid, extendedCase: xid(B.id) }, p.condition ? [el('condition', { 'xmi:type': 'uml:Constraint', 'xmi:id': `${cid}_c` }, [el('specification', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${cid}_s`, body: p.condition })])] : []));
    else if (c.type === 'dependency') top.push(el('packagedElement', { 'xmi:type': 'uml:Dependency', 'xmi:id': cid, name: p.name, client: xid(A.id), supplier: xid(B.id) }));
    else if (def.ends) {
      const end = (side, of) => {
        const e = p[side] || {}, m = multiplicity(e.multiplicity);
        const agg = side === 'fromEnd' ? undefined : def.xmi.aggregation;
        return el('ownedEnd', { 'xmi:type': 'uml:Property', 'xmi:id': `${cid}_${side}`, name: e.role, type: xid(of.id), association: cid, aggregation: agg, isNavigable: e.navigable ? 'true' : undefined }, [m && value('lowerValue', m.lower, `${cid}_${side}`), m && value('upperValue', m.upper, `${cid}_${side}`)].filter(Boolean));
      };
      // Each end is typed by the element it reaches; the part's end (our "to") carries the
      // aggregation, as UML has it (the whole owns a composite property typed by the part).
      top.push(el('packagedElement', { 'xmi:type': 'uml:Association', 'xmi:id': cid, name: p.name, memberEnd: `${cid}_fromEnd ${cid}_toEnd` }, [end('fromEnd', A), end('toEnd', B)]));
    } else if (c.type === 'transition') {
      const kidsT = [];
      if (p.trigger) kidsT.push(el('trigger', { 'xmi:type': 'uml:Trigger', 'xmi:id': `${cid}_t`, name: p.trigger }));
      if (p.guard) kidsT.push(el('guard', { 'xmi:type': 'uml:Constraint', 'xmi:id': `${cid}_g` }, [el('specification', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${cid}_gs`, body: p.guard })]));
      if (p.effect) kidsT.push(el('effect', { 'xmi:type': 'uml:OpaqueBehavior', 'xmi:id': `${cid}_e`, body: p.effect }));
      regionEdges.push(el('transition', { 'xmi:type': 'uml:Transition', 'xmi:id': cid, source: xid(A.id), target: xid(B.id) }, kidsT));
    } else if (c.type === 'controlFlow' || c.type === 'objectFlow') {
      regionEdges.push(el('edge', { 'xmi:type': def.xmi.type, 'xmi:id': cid, name: p.name, source: xid(A.id), target: xid(B.id) }, p.guard ? [el('guard', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${cid}_g`, body: p.guard })] : []));
    } else if (def.message) {
      const send = `${cid}_send`, recv = `${cid}_recv`;
      regionEdges.push(el('fragment', { 'xmi:type': 'uml:MessageOccurrenceSpecification', 'xmi:id': send, covered: xid(A.id), message: cid }));
      regionEdges.push(el('fragment', { 'xmi:type': 'uml:MessageOccurrenceSpecification', 'xmi:id': recv, covered: xid(B.id), message: cid }));
      regionEdges.push(el('message', { 'xmi:type': 'uml:Message', 'xmi:id': cid, name: p.name, messageSort: def.xmi.sort, sendEvent: send, receiveEvent: recv }, p.args ? [el('argument', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${cid}_a`, body: p.args })] : []));
    } else if (c.type === 'anchor') {
      if (A.type === 'note') add(A.id, el('annotatedElement', { 'xmi:idref': xid(B.id) }));
      else if (B.type === 'note') add(B.id, el('annotatedElement', { 'xmi:idref': xid(A.id) }));
    }
  }
  const tagOf = (e) => {
    if (sequence) return e.type === 'fragment' ? 'fragment' : e.type === 'note' ? 'ownedComment' : 'lifeline';
    if (state) return e.type === 'note' ? 'ownedComment' : 'subvertex';
    if (activity) return e.type === 'note' ? 'ownedComment' : e.type === 'partition' ? 'group' : 'node';
    return e.type === 'note' ? 'ownedComment' : 'packagedElement';
  };
  const elementNode = (e) => {
    const def = ELEMENTS[e.type] || {};
    const x = def.xmi || {};
    let type = x.type || 'uml:Class';
    if (activity && x.activity) type = x.activity;
    const attrs = { 'xmi:type': type, 'xmi:id': xid(e.id), name: def.noName ? undefined : e.name };
    if (type === 'uml:Pseudostate') attrs.kind = e.type === 'history' && e.props?.historyKind === 'deep' ? 'deepHistory' : x.kind;
    if (e.props?.abstract) attrs.isAbstract = 'true';
    if (e.type === 'fragment') attrs.interactionOperator = e.props?.operator || 'alt';
    const children = [];
    if (e.type === 'note') { delete attrs.name; children.push(el('body', {}, [], e.name)); }
    for (const s of e.props?.stereotypes || []) children.push(el('nc:stereotype', { name: s }));
    for (const a of e.props?.attributes || []) {
      const m = multiplicity(a.multiplicity);
      children.push(typed(el('ownedAttribute', { 'xmi:type': 'uml:Property', 'xmi:id': `${xid(e.id)}_a_${a.name}`, name: a.name, visibility: VISIBILITY[a.visibility], isStatic: a.static ? 'true' : undefined }, [m && value('lowerValue', m.lower, `${xid(e.id)}_a_${a.name}`), m && value('upperValue', m.upper, `${xid(e.id)}_a_${a.name}`), a.default ? el('defaultValue', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${xid(e.id)}_a_${a.name}_d`, body: a.default }) : null].filter(Boolean)), a.type));
    }
    for (const o of e.props?.operations || []) {
      const params = (o.params || []).map((p, i) => typed(el('ownedParameter', { 'xmi:type': 'uml:Parameter', 'xmi:id': `${xid(e.id)}_o_${o.name}_${i}`, name: p.name, direction: p.direction && p.direction !== 'in' ? p.direction : undefined }), p.type));
      if (o.returns) params.push(typed(el('ownedParameter', { 'xmi:type': 'uml:Parameter', 'xmi:id': `${xid(e.id)}_o_${o.name}_r`, direction: 'return' }), o.returns));
      children.push(el('ownedOperation', { 'xmi:type': 'uml:Operation', 'xmi:id': `${xid(e.id)}_o_${o.name}`, name: o.name, visibility: VISIBILITY[o.visibility], isStatic: o.static ? 'true' : undefined, isAbstract: o.abstract ? 'true' : undefined }, params));
    }
    for (const l of e.props?.literals || []) children.push(el('ownedLiteral', { 'xmi:type': 'uml:EnumerationLiteral', 'xmi:id': `${xid(e.id)}_l_${l.name}`, name: l.name }));
    for (const a of e.props?.actions || []) children.push(el(a.kind === 'do' ? 'doActivity' : a.kind || 'doActivity', { 'xmi:type': 'uml:OpaqueBehavior', 'xmi:id': `${xid(e.id)}_${a.kind}_${children.length}`, body: a.body }));
    if (e.type === 'fragment' && e.props?.guard) children.push(el('operand', { 'xmi:type': 'uml:InteractionOperand', 'xmi:id': `${xid(e.id)}_op` }, [el('guard', { 'xmi:type': 'uml:InteractionConstraint', 'xmi:id': `${xid(e.id)}_g` }, [el('specification', { 'xmi:type': 'uml:OpaqueExpression', 'xmi:id': `${xid(e.id)}_gs`, body: e.props.guard })])]));
    if (e.props?.type && (e.type === 'lifeline' || e.type === 'actorLifeline' || e.type === 'objectNode')) children.push(el('nc:type', { name: e.props.type }));
    if (e.type === 'actorLifeline') children.push(el('nc:actor', {}));
    children.push(...(nested.get(e.id) || []));
    // What it holds: use cases in a system, states in a composite (in a region), etc.
    const inner = kidsOf(e.id);
    if (inner.length) {
      if (e.type === 'compositeState') children.push(el('region', { 'xmi:type': 'uml:Region', 'xmi:id': `${xid(e.id)}_r` }, inner.map(elementNode)));
      else if (e.type === 'partition') attrs.node = inner.map((q) => xid(q.id)).join(' ');
      else children.push(...inner.map(elementNode));
    }
    return el(tagOf(e), attrs, children);
  };
  // In an activity every node sits in the activity; partitions only name theirs.
  const roots = activity ? [...model.elements.filter((e) => e.type !== 'partition'), ...model.elements.filter((e) => e.type === 'partition')].map(elementNode) : kidsOf(null).map(elementNode);
  for (const [name, id] of types) top.push(el('packagedElement', { 'xmi:type': 'uml:DataType', 'xmi:id': id, name }));
  // Layout, which XMI has no place for: an extension the other tools skip.
  const layout = el('xmi:Extension', { extender: 'NoteComplete' }, [el('nc:diagram', { kind: model.diagram, name: model.name, title: model.title, badge: model.badge ? undefined : 'false' }, [
    ...model.elements.map((e) => el('nc:shape', { element: xid(e.id), type: e.type, x: Math.round(e.bounds[0]), y: Math.round(e.bounds[1]), width: Math.round(e.bounds[2]), height: Math.round(e.bounds[3]), parent: e.parent ? xid(e.parent) : undefined })),
    ...model.connectors.map((c) => el('nc:connector', { element: xid(c.id), type: c.type, from: xid(c.from), to: xid(c.to), y: Number.isFinite(c.props?.y) ? Math.round(c.props.y) : undefined, waypoints: (c.waypoints || []).map((p) => p.map(Math.round).join(',')).join(' ') || undefined })),
  ])]);
  let content;
  const name = model.name || DIAGRAMS[model.diagram].label;
  if (state) content = [el('packagedElement', { 'xmi:type': 'uml:StateMachine', 'xmi:id': 'sm1', name }, [el('region', { 'xmi:type': 'uml:Region', 'xmi:id': 'sm1_r' }, [...roots, ...regionEdges])]), ...top];
  else if (activity) content = [el('packagedElement', { 'xmi:type': 'uml:Activity', 'xmi:id': 'act1', name }, [...roots, ...regionEdges]), ...top];
  else if (sequence) content = [el('packagedElement', { 'xmi:type': 'uml:Collaboration', 'xmi:id': 'col1', name }, [el('ownedBehavior', { 'xmi:type': 'uml:Interaction', 'xmi:id': 'int1', name }, [...roots, ...regionEdges])]), ...top];
  else content = [...roots, ...top];
  const doc = el('xmi:XMI', { 'xmi:version': '2.1', ...XMI_NS }, [
    el('xmi:Documentation', { exporter: 'NoteComplete', exporterVersion: String(UML_VERSION) }),
    el('uml:Model', { 'xmi:type': 'uml:Model', 'xmi:id': 'model1', name }, content),
    layout,
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${writeXml(doc)}\n`;
}

// Reverse maps: an XMI type (and pseudostate kind) → our element / connector type.
function xmiElementType(node, diagram) {
  const t = node.attrs['xmi:type'];
  if (!t) return null;
  if (t === 'uml:Pseudostate') {
    const kind = node.attrs.kind || 'initial';
    if (kind === 'deepHistory' || kind === 'shallowHistory') return 'history';
    return { initial: 'initial', choice: 'choice', junction: 'choice', fork: 'fork', join: 'join' }[kind] || 'choice';
  }
  if (t === 'uml:State') return node.children.some((c) => local(c.name) === 'region') ? 'compositeState' : 'state';
  if (t === 'uml:Lifeline') return node.children.some((c) => c.name === 'nc:actor') ? 'actorLifeline' : 'lifeline';
  if (t === 'uml:Comment') return 'note';
  if (diagram === 'activity') {
    if (t === 'uml:InitialNode') return 'initial';
    if (t === 'uml:ForkNode') return 'fork';
    if (t === 'uml:JoinNode') return 'join';
    if (/Action$/.test(t) && !ELEMENTS.action.xmi.type.endsWith(t)) return 'action';
    if (t === 'uml:ObjectNode' || t === 'uml:DataStoreNode') return 'objectNode';
  }
  for (const [type, def] of Object.entries(ELEMENTS)) if (def.xmi?.type === t && !def.xmi.composite && !def.xmi.kind && !def.xmi.actor) return type;
  for (const [type, def] of Object.entries(ELEMENTS)) if (def.xmi?.activity === t) return type;
  return null;
}
const SKIP = new Set(['ownedAttribute', 'ownedOperation', 'ownedParameter', 'ownedLiteral', 'generalization', 'include', 'extend', 'interfaceRealization', 'ownedEnd', 'lowerValue', 'upperValue', 'type', 'defaultValue', 'trigger', 'guard', 'effect', 'entry', 'exit', 'doActivity', 'specification', 'body', 'argument', 'operand', 'condition']);

export function importXmi(text) {
  const doc = parseXml(text);
  const all = [...walk(doc)];
  const byXid = new Map(all.filter((n) => n.attrs['xmi:id']).map((n) => [n.attrs['xmi:id'], n]));
  const ncDiagram = all.find((n) => n.name === 'nc:diagram');
  // The diagram kind: ours when we wrote it, otherwise from what the file holds.
  const has = (re) => all.some((n) => re.test(n.attrs['xmi:type'] || ''));
  const diagram = ncDiagram?.attrs.kind && DIAGRAMS[ncDiagram.attrs.kind] ? ncDiagram.attrs.kind
    : has(/^uml:(StateMachine|State|Pseudostate|FinalState)$/) ? 'state'
    : has(/^uml:(Activity|OpaqueAction|ControlFlow|DecisionNode)$/) ? 'activity'
    : has(/^uml:(Interaction|Lifeline|Message)$/) ? 'sequence'
    : has(/^uml:(UseCase|Actor)$/) ? 'useCase' : 'class';
  const model = { type: 'uml', version: UML_VERSION, diagram, name: ncDiagram?.attrs.name || doc.children.find((c) => local(c.name) === 'Model')?.attrs.name || '', title: ncDiagram?.attrs.title || '', badge: ncDiagram?.attrs.badge !== 'false', elements: [], connectors: [], source: { format: 'xmi', ids: {}, extra: {} } };
  const idOf = new Map(); // xmi id → our id
  const ourId = (xid) => { if (!idOf.has(xid)) { const id = `x${idOf.size + 1}`; idOf.set(xid, id); model.source.ids[id] = xid; } return idOf.get(xid); };
  const typeName = (node) => {
    const ref = node.attrs.type;
    if (ref) return byXid.get(ref)?.attrs.name || ref;
    const t = kids(node, 'type')[0];
    return t ? (t.attrs.href || '').replace(/^.*#/, '') || t.attrs.name || '' : '';
  };
  const bound = (node, tag) => { const v = kids(node, tag)[0]; return v ? (v.attrs.value ?? (v.attrs['xmi:type'] === 'uml:LiteralUnlimitedNatural' ? '*' : '0')) : ''; };
  const mult = (node) => { const lo = bound(node, 'lowerValue'), hi = bound(node, 'upperValue'); return !lo && !hi ? '' : !lo ? hi : lo === hi ? lo : `${lo}..${hi || '*'}`; };
  const body = (node) => node?.attrs.body ?? kids(node || { children: [] }, 'body')[0]?.text ?? kids(node || { children: [] }, 'specification')[0]?.attrs.body ?? '';
  const elementByX = new Map();
  for (const node of all) {
    if (SKIP.has(local(node.name))) continue;
    const type = xmiElementType(node, diagram);
    if (!type) continue;
    const id = ourId(node.attrs['xmi:id'] || `anon${elementByX.size}`);
    const e = { id, type, name: type === 'note' ? (kids(node, 'body')[0]?.text || node.attrs.body || '') : node.attrs.name || '', props: {}, bounds: [NaN, NaN, ...ELEMENTS[type].size], parent: null };
    if (node.attrs.isAbstract === 'true') e.props.abstract = true;
    const st = node.children.filter((c) => c.name === 'nc:stereotype').map((c) => c.attrs.name);
    if (st.length) e.props.stereotypes = st;
    const ncType = node.children.find((c) => c.name === 'nc:type');
    if (ncType) e.props.type = ncType.attrs.name;
    if (type === 'history') e.props.historyKind = node.attrs.kind === 'deepHistory' ? 'deep' : 'shallow';
    if (type === 'fragment') { e.props.operator = node.attrs.interactionOperator || 'alt'; e.props.guard = body(kids(kids(kids(node, 'operand')[0] || { children: [] }, 'guard')[0] || { children: [] }, 'specification')[0]); }
    const attrs = kids(node, 'ownedAttribute').filter((a) => !a.attrs.association);
    if (attrs.length) e.props.attributes = attrs.map((a) => ({ visibility: VISIBILITY_BACK[a.attrs.visibility] || '', name: a.attrs.name || '', type: typeName(a), multiplicity: mult(a), default: body(kids(a, 'defaultValue')[0]) || kids(a, 'defaultValue')[0]?.attrs.value || '', static: a.attrs.isStatic === 'true' }));
    const ops = kids(node, 'ownedOperation');
    if (ops.length) e.props.operations = ops.map((o) => {
      const ps = kids(o, 'ownedParameter');
      const ret = ps.find((p) => p.attrs.direction === 'return');
      return { visibility: VISIBILITY_BACK[o.attrs.visibility] || '', name: o.attrs.name || '', params: ps.filter((p) => p !== ret).map((p) => ({ direction: p.attrs.direction || '', name: p.attrs.name || '', type: typeName(p), default: '' })), returns: ret ? typeName(ret) : '', static: o.attrs.isStatic === 'true', abstract: o.attrs.isAbstract === 'true' };
    });
    const lits = kids(node, 'ownedLiteral');
    if (lits.length) e.props.literals = lits.map((l) => ({ name: l.attrs.name || '' }));
    const acts = node.children.filter((c) => ['entry', 'exit', 'doActivity'].includes(local(c.name)));
    if (acts.length) e.props.actions = acts.map((a) => ({ kind: local(a.name) === 'doActivity' ? 'do' : local(a.name), body: body(a) || a.attrs.name || '' }));
    // Unknown attributes, kept for the way back.
    const known = new Set(['xmi:type', 'xmi:id', 'name', 'isAbstract', 'kind', 'interactionOperator', 'visibility', 'node']);
    const extra = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !known.has(k)));
    if (Object.keys(extra).length) model.source.extra[id] = extra;
    model.elements.push(e);
    elementByX.set(node.attrs['xmi:id'], { e, node });
  }
  // Parents: the nearest enclosing element (system, package, composite state), or the
  // partition that names a node.
  for (const { e, node } of elementByX.values()) {
    for (let p = node.parent; p; p = p.parent) { const owner = elementByX.get(p.attrs?.['xmi:id']); if (owner && ELEMENTS[owner.e.type]?.container) { e.parent = owner.e.id; break; } }
    if (e.type === 'partition') for (const x of String(node.attrs.node || '').split(/\s+/).filter(Boolean)) { const k = elementByX.get(x); if (k) k.e.parent = e.id; }
  }
  const conn = (type, fromX, toX, props = {}, xid = null) => {
    const a = elementByX.get(fromX), b = elementByX.get(toX);
    if (!a || !b) return;
    model.connectors.push({ id: xid ? ourId(xid) : `c${model.connectors.length + 1}`, type, from: a.e.id, to: b.e.id, props: ownProps(type, props), waypoints: [] });
  };
  // Some tools leave out xmi:type where the tag already says what it is.
  const BY_TAG = { generalization: 'uml:Generalization', include: 'uml:Include', extend: 'uml:Extend', interfaceRealization: 'uml:InterfaceRealization', transition: 'uml:Transition', message: 'uml:Message' };
  for (const node of all) {
    const t = node.attrs['xmi:type'] || BY_TAG[local(node.name)], owner = node.parent?.attrs?.['xmi:id'], xid = node.attrs['xmi:id'];
    if (t === 'uml:Generalization') conn('generalization', owner, node.attrs.general, {}, xid);
    else if (t === 'uml:InterfaceRealization' || t === 'uml:Realization') conn('realization', node.attrs.client || owner, node.attrs.supplier || node.attrs.contract, {}, xid);
    else if (t === 'uml:Include') conn('include', owner, node.attrs.addition, {}, xid);
    else if (t === 'uml:Extend') conn('extend', owner, node.attrs.extendedCase, { condition: body(kids(kids(node, 'condition')[0] || { children: [] }, 'specification')[0]) }, xid);
    else if (t === 'uml:Dependency' || t === 'uml:Usage') conn('dependency', node.attrs.client, node.attrs.supplier, { name: node.attrs.name || '' }, xid);
    else if (t === 'uml:Transition') {
      const g = kids(node, 'guard')[0];
      conn('transition', node.attrs.source, node.attrs.target, { trigger: kids(node, 'trigger').map((q) => q.attrs.name || byXid.get(q.attrs.event)?.attrs.name || '').join(', '), guard: body(kids(g || { children: [] }, 'specification')[0]) || g?.attrs.body || '', effect: body(kids(node, 'effect')[0]) || kids(node, 'effect')[0]?.attrs.name || '' }, xid);
    } else if (t === 'uml:ControlFlow' || t === 'uml:ObjectFlow') {
      const g = kids(node, 'guard')[0];
      conn(t === 'uml:ControlFlow' ? 'controlFlow' : 'objectFlow', node.attrs.source, node.attrs.target, { name: node.attrs.name || '', guard: body(g) || g?.attrs.value || '' }, xid);
    } else if (t === 'uml:Message') {
      const lifeline = (ev) => byXid.get(byXid.get(ev)?.attrs.covered)?.attrs['xmi:id'] || byXid.get(ev)?.attrs.covered;
      const sort = node.attrs.messageSort || 'synchCall';
      const type = Object.entries(CONNECTORS).find(([, d]) => d.xmi?.sort === sort)?.[0] || 'syncMessage';
      conn(type, lifeline(node.attrs.sendEvent), lifeline(node.attrs.receiveEvent), { name: node.attrs.name || '', args: kids(node, 'argument').map((a) => body(a) || a.attrs.name || '').join(', ') }, xid);
    } else if (t === 'uml:Association') {
      const ends = String(node.attrs.memberEnd || '').split(/\s+/).map((id) => byXid.get(id)).filter(Boolean);
      if (ends.length !== 2) continue;
      // The end with aggregation is typed by the part; the whole is the other end's type.
      const agg = ends.find((q) => q.attrs.aggregation && q.attrs.aggregation !== 'none');
      const kind = agg?.attrs.aggregation === 'composite' ? 'composition' : agg ? 'aggregation' : 'association';
      const [fromE, toE] = agg ? [ends.find((q) => q !== agg), agg] : ends;
      const endProps = (q) => ({ role: q.attrs.name || '', multiplicity: mult(q), navigable: q.attrs.isNavigable === 'true' || q.parent?.attrs?.['xmi:id'] !== node.attrs['xmi:id'] });
      conn(kind, fromE.attrs.type, toE.attrs.type, { name: node.attrs.name || '', fromEnd: endProps(fromE), toEnd: endProps(toE) }, xid);
    } else if (t === 'uml:Comment') {
      for (const a of kids(node, 'annotatedElement')) conn('anchor', xid, a.attrs['xmi:idref'] || a.attrs.idref, {});
      for (const x of String(node.attrs.annotatedElement || '').split(/\s+/).filter(Boolean)) conn('anchor', xid, x, {});
    }
  }
  // Layout written by us (or nothing: autoLayout places them).
  if (ncDiagram) {
    for (const s of ncDiagram.children.filter((c) => c.name === 'nc:shape')) {
      const k = elementByX.get(s.attrs.element);
      if (!k) continue;
      k.e.bounds = ['x', 'y', 'width', 'height'].map((a) => Number(s.attrs[a]));
      if (s.attrs.type && ELEMENTS[s.attrs.type]) k.e.type = s.attrs.type;
      if (s.attrs.parent) k.e.parent = elementByX.get(s.attrs.parent)?.e.id || k.e.parent;
    }
    for (const s of ncDiagram.children.filter((c) => c.name === 'nc:connector')) {
      const c = model.connectors.find((q) => model.source.ids[q.id] === s.attrs.element);
      if (!c) continue;
      if (s.attrs.type && CONNECTORS[s.attrs.type]) c.type = s.attrs.type;
      if (s.attrs.y) c.props.y = Number(s.attrs.y);
      if (s.attrs.waypoints) c.waypoints = s.attrs.waypoints.split(' ').map((p) => p.split(',').map(Number));
    }
  }
  if (!model.elements.length) throw Error('No UML elements found in this XMI file.');
  return normalizeModel(model);
}

// ---------------------------------------------------------------------------------------
// Visual Paradigm project XML (File → Export → XML; "simple" structure).
// Model elements sit under <Models> with Id and Name attributes and their children under
// <ModelChildren>; relationships sit in <ModelRelationshipContainer>s with From and To; each
// diagram under <Diagrams> lists <Shapes> (MetaModelElement, X, Y, Width, Height) and
// <Connectors>. The names below and the registry's `vp` entries are what to check against
// real exports.

const VP = {
  project: 'Project', models: 'Models', diagrams: 'Diagrams', children: 'ModelChildren', relationships: 'ModelRelationshipContainer',
  shapes: 'Shapes', connectors: 'Connectors', id: 'Id', name: 'Name', from: 'From', to: 'To', element: 'MetaModelElement',
  x: 'X', y: 'Y', w: 'Width', h: 'Height', attribute: 'Attribute', operation: 'Operation', parameter: 'Parameter',
  literal: 'EnumerationLiteral', stereotypes: 'Stereotypes', stereotype: 'Stereotype', type: 'Type', visibility: 'Visibility',
  multiplicity: 'Multiplicity', initial: 'InitialValue', returnType: 'ReturnType', scope: 'Scope', abstract: 'Abstract',
  documentation: 'Documentation_plain', fromEnd: 'FromEnd', toEnd: 'ToEnd', end: 'AssociationEnd', aggregation: 'AggregationKind',
  navigable: 'Navigable', role: 'Name', guard: 'Guard', trigger: 'Trigger', effect: 'Effect', condition: 'Condition',
  activity: 'StateActivity', entry: 'Entry', exit: 'Exit', doActivity: 'DoActivity', operator: 'InteractionOperator',
};
const VP_VIS = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };
// Plain fields of a type (text, a choice, yes or no) that have no place of their own above
// go out and come back as an attribute of the element: the registry's `vp.attrs` names it,
// or the field's own name.
const VP_OWN = new Set(['abstract', 'operator', 'guard', 'historyKind', 'stereotypes']);
const vpPlainFields = (def) => Object.entries(def?.fields || {}).filter(([k, kind]) => !VP_OWN.has(k) && typeof kind === 'string' && kind !== 'tags').map(([k, kind]) => [k, def.vp?.attrs?.[k] || k[0].toUpperCase() + k.slice(1), kind]);
const VP_VIS_BACK = Object.fromEntries(Object.entries(VP_VIS).map(([k, v]) => [v, k]));

// The stereotypes written on this element itself (not on what it holds).
const vpStereotypes = (node) => (kids(node, VP.stereotypes)[0]?.children || []).filter((c) => local(c.name) === VP.stereotype).map((c) => c.attrs[VP.name] || c.attrs.Idref || c.text || '').filter(Boolean);
function vpElementType(node) {
  const tag = local(node.name);
  const st = vpStereotypes(node).map((s) => s.toLowerCase());
  // Types told apart by a stereotype (interface, enumeration) or by what they hold (a
  // composite state) first, then the plain one.
  const rank = (d) => (d.vp?.stereotype ? 2 : 0) + (d.vp?.composite ? 1 : 0);
  const order = Object.entries(ELEMENTS).sort(([, a], [, b]) => rank(b) - rank(a));
  for (const [type, def] of order) {
    if (def.vp?.element !== tag && !def.vp?.also?.includes(tag)) continue;
    if (def.vp.stereotype && !st.includes(def.vp.stereotype.toLowerCase())) continue;
    if (def.vp.composite && !kids(node, VP.children)[0]?.children.length) continue;
    return type;
  }
  if (tag === 'State2' || tag === 'State') return 'state';
  if (tag === 'DeepHistoryPseudoState') return 'history';
  if (tag === 'InteractionLifeLine') return 'lifeline';
  return null;
}
function vpConnectorType(node) {
  const tag = local(node.name);
  if (tag === 'Association') {
    const ends = [...walk(node)].filter((c) => local(c.name) === VP.end);
    const kinds = ends.map((e) => (e.attrs[VP.aggregation] || '').toLowerCase());
    if (kinds.includes('composited') || kinds.includes('composite')) return 'composition';
    if (kinds.includes('shared') || kinds.includes('aggregation')) return 'aggregation';
    return 'association';
  }
  if (tag === 'Message') {
    const kind = (node.attrs.Type || node.attrs.ActionType || '').toLowerCase();
    if (kind.includes('return') || kind.includes('reply')) return 'replyMessage';
    if (kind.includes('create')) return 'createMessage';
    if (kind.includes('async')) return 'asyncMessage';
    return 'syncMessage';
  }
  for (const [type, def] of Object.entries(CONNECTORS)) if (def.vp?.element === tag && !def.vp.aggregation && !def.vp.kind) return type;
  return null;
}

// The diagrams of a Visual Paradigm project this can open, in the file's order.
export function vpDiagrams(text) {
  const doc = typeof text === 'string' ? parseXml(text) : text;
  const diagrams = [...walk(doc)].find((n) => local(n.name) === VP.diagrams);
  return (diagrams?.children || []).map((d, index) => ({ index, node: d, kind: Object.entries(DIAGRAMS).find(([, k]) => k.vp && k.vp === local(d.name))?.[0] || null, name: d.attrs[VP.name] || '', shapes: [...walk(d)].filter((s) => s.attrs[VP.element] || s.attrs.Model).length }))
    .filter((d) => d.kind).map(({ node, ...d }) => Object.defineProperty(d, 'node', { value: node, enumerable: false }));
}

// VP's own sizes are for an 11 px font; ours is 13 px, so a diagram comes in this much larger
// (and goes back out this much smaller) to keep its text inside its shapes.
const VP_SCALE = 1.2;
// Relationships VP stores the other way round from ours (its From is the arrow's head).
const VP_REVERSED = new Set(['generalization', 'realization', 'extend']);

// A Visual Paradigm project → the model of one of its diagrams (`diagram`: its index among
// vpDiagrams, or the first one that has shapes): what that diagram shows, where it shows it.
export function importVp(text, { diagram } = {}) {
  const doc = parseXml(text);
  const all = [...walk(doc)];
  const models = all.find((n) => local(n.name) === VP.models) || doc;
  const list = vpDiagrams(doc);
  const chosen = (diagram !== undefined ? list.find((d) => d.index === diagram) : null) || list.find((d) => d.shapes) || list[0];
  const dg = chosen?.node || null;
  const model = { type: 'uml', version: UML_VERSION, diagram: chosen?.kind || 'class', name: chosen?.name || doc.attrs[VP.name] || '', badge: true, elements: [], connectors: [], source: { format: 'vp-xml', ids: {}, extra: {}, scale: VP_SCALE } };
  // What the diagram shows: its shapes by the element they show, and its lines.
  const shapeOf = new Map(), shapeModel = new Map(), lineOf = new Map();
  const dgShapes = dg ? [...walk(kids(dg, VP.shapes)[0] || { children: [] })] : [];
  for (const s of dgShapes) {
    const m = s.attrs[VP.element] || s.attrs.Model;
    if (s.attrs[VP.id] && m) shapeModel.set(s.attrs[VP.id], m);
    if (m && s.attrs[VP.x] !== undefined && !shapeOf.has(m)) shapeOf.set(m, s);
  }
  for (const c of kids(dg || { children: [] }, VP.connectors)[0]?.children || []) { const m = c.attrs[VP.element] || c.attrs.Model; if (m) lineOf.set(m, c); }
  const shown = (id) => !shapeOf.size || shapeOf.has(id);
  const byVp = new Map();
  const value = (node, key) => node.attrs[key] ?? kids(node, key)[0]?.attrs[VP.name] ?? kids(node, key)[0]?.text ?? '';
  const typeOf = (node) => { const t = node.attrs[VP.type]; if (t) return byVp.get(t)?.e.name || t; const k = kids(node, VP.type)[0]; return k ? (k.attrs[VP.name] || k.children[0]?.attrs[VP.name] || k.text || '') : ''; };
  const childList = (node, tag) => (kids(node, VP.children)[0]?.children || []).filter((c) => local(c.name) === tag);
  const mult = (m) => (!m || m === 'Unspecified' ? '' : m);
  for (const node of walk(models)) {
    const type = vpElementType(node);
    if (!type || !node.attrs[VP.id] || !shown(node.attrs[VP.id])) continue;
    const id = `v${byVp.size + 1}`;
    model.source.ids[id] = node.attrs[VP.id];
    const e = { id, type, name: type === 'note' ? node.attrs[VP.documentation] || node.attrs[VP.name] || '' : node.attrs[VP.name] || '', props: {}, bounds: [NaN, NaN, ...ELEMENTS[type].size], parent: null };
    if (node.attrs[VP.abstract] === 'true') e.props.abstract = true;
    // VP marks every use case «UseCase» (and so on): that one is the type itself, not shown.
    const st = vpStereotypes(node).filter((s) => ![ELEMENTS[type].vp.stereotype || '', local(node.name)].some((x) => x.toLowerCase() === s.toLowerCase()));
    if (st.length) e.props.stereotypes = st;
    const attrs = childList(node, VP.attribute);
    if (attrs.length && type !== 'enumeration') e.props.attributes = attrs.map((a) => ({ visibility: VP_VIS_BACK[a.attrs[VP.visibility]] || '', name: a.attrs[VP.name] || '', type: typeOf(a), multiplicity: mult(a.attrs[VP.multiplicity]), default: a.attrs[VP.initial] || '', static: a.attrs[VP.scope] === 'classifier' }));
    const lits = [...childList(node, VP.literal), ...(type === 'enumeration' ? attrs : [])];
    if (lits.length) e.props.literals = lits.map((l) => ({ name: l.attrs[VP.name] || '' }));
    const ops = childList(node, VP.operation);
    if (ops.length) e.props.operations = ops.map((o) => ({ visibility: VP_VIS_BACK[o.attrs[VP.visibility]] || '', name: o.attrs[VP.name] || '', params: childList(o, VP.parameter).map((p) => ({ direction: (p.attrs.Kind || '').toLowerCase() === 'in' ? '' : (p.attrs.Kind || '').toLowerCase(), name: p.attrs[VP.name] || '', type: typeOf(p), default: p.attrs.DefaultValue || '' })), returns: o.attrs[VP.returnType] ? (byVp.get(o.attrs[VP.returnType])?.e.name || o.attrs[VP.returnType]) : value(o, VP.returnType), static: o.attrs[VP.scope] === 'classifier', abstract: o.attrs[VP.abstract] === 'true' }));
    const acts = [VP.entry, VP.exit, VP.doActivity].flatMap((k) => { const v = value(node, k); return v ? [{ kind: k === VP.doActivity ? 'do' : k.toLowerCase(), body: v }] : []; });
    if (acts.length) e.props.actions = acts;
    if (type === 'fragment') { e.props.operator = (node.attrs[VP.operator] || 'alt').toLowerCase(); e.props.guard = value(node, VP.guard); }
    if (type === 'history') e.props.historyKind = local(node.name).startsWith('Deep') ? 'deep' : 'shallow';
    const plain = vpPlainFields(ELEMENTS[type]);
    for (const [k, attr, kind] of plain) if (node.attrs[attr] !== undefined) e.props[k] = kind === 'bool' ? node.attrs[attr] === 'true' : kind === 'number' ? Number(node.attrs[attr]) : node.attrs[attr];
    const known = new Set([VP.id, VP.name, VP.abstract, VP.documentation, VP.operator, ...plain.map(([, a]) => a)]);
    const extra = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !known.has(k)));
    if (Object.keys(extra).length) model.source.extra[id] = extra;
    model.elements.push(e);
    byVp.set(node.attrs[VP.id], { e, node });
  }
  for (const { e, node } of byVp.values()) for (let p = node.parent; p; p = p.parent) { const o = byVp.get(p.attrs?.[VP.id]); if (o && ELEMENTS[o.e.type]?.container) { e.parent = o.e.id; break; } }
  // Relationships: anything with two ends among the elements shown (From and To, or the
  // ends of an association), and on the diagram when it draws lines.
  const seen = new Set();
  for (const node of all) {
    if (!node.attrs[VP.id] || seen.has(node.attrs[VP.id])) continue;
    if (local(node.parent?.name || '') === VP.connectors) continue; // a diagram's view of one
    const ends = [...walk(node)].filter((c) => local(c.name) === VP.end);
    let from = node.attrs[VP.from] || node.attrs.EndRelationshipFromMetaModelElement || ends[0]?.attrs.EndModelElement;
    let to = node.attrs[VP.to] || node.attrs.EndRelationshipToMetaModelElement || ends[1]?.attrs.EndModelElement;
    if (!from || !to || !byVp.has(from) || !byVp.has(to)) continue;
    if (lineOf.size && !lineOf.has(node.attrs[VP.id])) continue;
    const type = vpConnectorType(node);
    if (!type) continue;
    seen.add(node.attrs[VP.id]);
    const id = `r${model.connectors.length + 1}`;
    model.source.ids[id] = node.attrs[VP.id];
    const props = { name: node.attrs[VP.name] || '' };
    if (CONNECTORS[type].ends) {
      const endOf = (q) => ({ role: q?.attrs[VP.role] || '', multiplicity: mult(q?.attrs[VP.multiplicity]), navigable: (q?.attrs[VP.navigable] || '').toLowerCase() === 'navigable' || q?.attrs[VP.navigable] === 'true' });
      props.fromEnd = endOf(ends[0]); props.toEnd = endOf(ends[1]);
      // Navigable both ways is drawn with no arrows at all.
      if (props.fromEnd.navigable && props.toEnd.navigable) props.fromEnd.navigable = props.toEnd.navigable = false;
    }
    if (type === 'transition') Object.assign(props, { trigger: value(node, VP.trigger), guard: value(node, VP.guard), effect: value(node, VP.effect) });
    if (type === 'controlFlow' || type === 'objectFlow') props.guard = value(node, VP.guard);
    if (type === 'extend') props.condition = value(node, VP.condition);
    if (CONNECTORS[type].message) props.args = node.attrs.Arguments || '';
    if (VP_REVERSED.has(type)) [from, to] = [to, from];
    model.connectors.push({ id, type, from: byVp.get(from).e.id, to: byVp.get(to).e.id, props: ownProps(type, props), waypoints: [] });
  }
  // Layout from the diagram's shapes, VP's sizes made ours.
  const k = VP_SCALE;
  const box = (s) => [VP.x, VP.y, VP.w, VP.h].map((a) => Math.round(Number(s.attrs[a]) * k));
  for (const [vpId, s] of shapeOf) {
    const o = byVp.get(vpId);
    if (!o) continue;
    const b = box(s);
    if (b.every(Number.isFinite)) o.e.bounds = b;
  }
  // Swimlanes: VP draws a lane as a header plus a compartment below it, side by side; what
  // sits in a compartment is in that lane.
  for (const lanes of dgShapes.filter((s) => /^ActivitySwimlane/.test(local(s.name)) && !/Compartment$/.test(local(s.name)))) {
    const inner = kids(lanes, 'DiagramElementChildren')[0]?.children || [];
    const comps = inner.filter((c) => /Compartment$/.test(local(c.name)));
    for (const h of inner.filter((c) => byVp.get(c.attrs[VP.element] || c.attrs.Model)?.e.type === 'partition')) {
      const lane = byVp.get(h.attrs[VP.element] || h.attrs.Model).e;
      const hb = box(h);
      const vertical = !h.attrs[VP.w] || Number(h.attrs[VP.w]) >= Number(h.attrs[VP.h]);
      const comp = comps.find((c) => (vertical ? Math.abs(Number(c.attrs[VP.x]) * k - hb[0]) < 2 : Math.abs(Number(c.attrs[VP.y]) * k - hb[1]) < 2));
      if (comp) { const cb = box(comp); lane.bounds = vertical ? [hb[0], hb[1], hb[2], cb[1] + cb[3] - hb[1]] : [hb[0], hb[1], cb[0] + cb[2] - hb[0], hb[3]]; }
      for (const s of comp ? walk(comp) : []) { const o = byVp.get(s.attrs[VP.element] || s.attrs.Model); if (o && o.e !== lane && !o.e.parent) o.e.parent = lane.id; }
    }
  }
  // Lines: their bends (VP's points, less the two ends), and a message's height.
  for (const c of model.connectors) {
    const line = lineOf.get(model.source.ids[c.id]);
    if (!line) continue;
    let pts = [...walk(line)].filter((p) => local(p.name) === 'Point').map((p) => [Math.round(Number(p.attrs.X) * k), Math.round(Number(p.attrs.Y) * k)]).filter((p) => p.every(Number.isFinite));
    // Drawn from our `to` to our `from`: the bends go the other way.
    const drawnFrom = shapeModel.get(line.attrs[VP.from]);
    if (drawnFrom && byVp.get(drawnFrom)?.e.id === c.to && c.from !== c.to) pts = pts.reverse();
    if (CONNECTORS[c.type]?.message) { if (line.attrs[VP.y]) c.props.y = Math.round(Number(line.attrs[VP.y]) * k); continue; }
    if (pts.length > 2) c.waypoints = pts.slice(1, -1);
  }
  if (!model.elements.length) throw Error('No UML elements found in this Visual Paradigm file.');
  return normalizeModel(model);
}

export function exportVp(input) {
  const model = umlOnly(normalizeModel(input));
  const ids = { ...(model.source?.format === 'vp-xml' ? model.source.ids : {}) };
  const vid = (id) => ids[id] || `NC_${id}`;
  const kidsOf = (parentId) => model.elements.filter((e) => (e.parent || null) === parentId);
  const elementNode = (e) => {
    const def = ELEMENTS[e.type] || ELEMENTS.note;
    const attrs = { [VP.id]: vid(e.id), [VP.name]: e.type === 'note' ? undefined : e.name, [VP.abstract]: e.props?.abstract ? 'true' : undefined, ...(model.source?.extra?.[e.id] || {}) };
    if (e.type === 'note') attrs[VP.documentation] = e.name;
    if (e.type === 'fragment') attrs[VP.operator] = e.props?.operator;
    for (const [k, attr, kind] of vpPlainFields(def)) { const v = e.props?.[k]; if (v !== undefined && v !== null && v !== '' && !(kind === 'bool' && !v)) attrs[attr] = String(v); }
    const children = [];
    const st = [...(def.vp.stereotype ? [def.vp.stereotype] : []), ...(e.props?.stereotypes || [])];
    if (st.length) children.push(el(VP.stereotypes, {}, st.map((s) => el(VP.stereotype, { [VP.name]: s }))));
    const inner = [];
    for (const a of e.props?.attributes || []) inner.push(el(VP.attribute, { [VP.id]: `${vid(e.id)}_a_${a.name}`, [VP.name]: a.name, [VP.type]: a.type, [VP.visibility]: VP_VIS[a.visibility], [VP.multiplicity]: a.multiplicity, [VP.initial]: a.default, [VP.scope]: a.static ? 'classifier' : undefined }));
    for (const l of e.props?.literals || []) inner.push(el(VP.literal, { [VP.id]: `${vid(e.id)}_l_${l.name}`, [VP.name]: l.name }));
    for (const o of e.props?.operations || []) inner.push(el(VP.operation, { [VP.id]: `${vid(e.id)}_o_${o.name}`, [VP.name]: o.name, [VP.visibility]: VP_VIS[o.visibility], [VP.returnType]: o.returns, [VP.scope]: o.static ? 'classifier' : undefined, [VP.abstract]: o.abstract ? 'true' : undefined }, (o.params || []).length ? [el(VP.children, {}, o.params.map((p, i) => el(VP.parameter, { [VP.id]: `${vid(e.id)}_o_${o.name}_${i}`, [VP.name]: p.name, [VP.type]: p.type, Kind: p.direction || undefined, DefaultValue: p.default || undefined })))] : []));
    for (const a of e.props?.actions || []) attrs[a.kind === 'do' ? VP.doActivity : a.kind === 'exit' ? VP.exit : VP.entry] = a.body;
    if (e.type === 'fragment' && e.props?.guard) attrs[VP.guard] = e.props.guard;
    inner.push(...kidsOf(e.id).map(elementNode));
    if (inner.length) children.push(el(VP.children, {}, inner));
    const tag = e.type === 'history' && e.props?.historyKind === 'deep' ? 'DeepHistoryPseudoState' : model.diagram === 'activity' && def.vp.activity ? def.vp.activity : def.vp.element;
    return el(tag, attrs, children);
  };
  const rel = (c) => {
    const def = CONNECTORS[c.type] || CONNECTORS.association;
    const p = c.props || {};
    const [a, b] = VP_REVERSED.has(c.type) ? [c.to, c.from] : [c.from, c.to];
    const attrs = { [VP.id]: vid(c.id), [VP.from]: vid(a), [VP.to]: vid(b), [VP.name]: p.name };
    const children = [];
    if (def.ends) {
      const end = (side, agg) => el(VP.end, { [VP.role]: p[side]?.role, [VP.multiplicity]: p[side]?.multiplicity, [VP.navigable]: p[side]?.navigable ? 'Navigable' : 'Unspecified', [VP.aggregation]: agg });
      const agg = def.vp.aggregation === 'composite' ? 'Composited' : def.vp.aggregation === 'shared' ? 'Shared' : undefined;
      children.push(el(VP.fromEnd, {}, [end('fromEnd', agg)]), el(VP.toEnd, {}, [end('toEnd', undefined)]));
    }
    if (c.type === 'transition') Object.assign(attrs, { [VP.trigger]: p.trigger, [VP.guard]: p.guard, [VP.effect]: p.effect });
    if (c.type === 'controlFlow' || c.type === 'objectFlow') attrs[VP.guard] = p.guard;
    if (c.type === 'extend') attrs[VP.condition] = p.condition;
    if (def.message) Object.assign(attrs, { Type: def.vp.kind, Arguments: p.args });
    return el(def.vp.element, attrs, children);
  };
  // Back to VP's sizes (see VP_SCALE).
  const k = model.source?.format === 'vp-xml' && model.source.scale ? model.source.scale : VP_SCALE;
  const r = (v) => Math.round(v / k);
  const shapes = model.elements.map((e) => el(model.diagram === 'activity' && ELEMENTS[e.type]?.vp.activity ? ELEMENTS[e.type].vp.activity : ELEMENTS[e.type]?.vp.element || 'Shape', { [VP.id]: `S_${vid(e.id)}`, [VP.element]: vid(e.id), [VP.x]: r(e.bounds[0]), [VP.y]: r(e.bounds[1]), [VP.w]: r(e.bounds[2]), [VP.h]: r(e.bounds[3]) }));
  // Visual Paradigm draws an association class from its own model, which this export does not write.
  const vpLinks = model.connectors.filter((c) => !CONNECTORS[c.type]?.toConnector);
  const lines = vpLinks.map((c) => {
    const [a, b] = VP_REVERSED.has(c.type) ? [c.to, c.from] : [c.from, c.to];
    const way = VP_REVERSED.has(c.type) ? [...(c.waypoints || [])].reverse() : c.waypoints || [];
    return el(CONNECTORS[c.type]?.vp.element || 'Connector', { [VP.id]: `C_${vid(c.id)}`, [VP.element]: vid(c.id), [VP.from]: `S_${vid(a)}`, [VP.to]: `S_${vid(b)}`, [VP.y]: CONNECTORS[c.type]?.message && Number.isFinite(c.props?.y) ? r(c.props.y) : undefined }, way.length ? [el('Points', {}, way.map(([x, y]) => el('Point', { X: r(x), Y: r(y) })))] : []);
  });
  const doc = el(VP.project, { Xml_structure: 'simple', UmlVersion: '2.x', Name: model.name || DIAGRAMS[model.diagram].label, Author: 'NoteComplete' }, [
    el(VP.models, {}, [...kidsOf(null).map(elementNode), el(VP.relationships, { [VP.id]: 'NC_relationships' }, [el(VP.children, {}, vpLinks.map(rel))])]),
    el(VP.diagrams, {}, [el(DIAGRAMS[model.diagram].vp, { [VP.id]: 'NC_diagram', [VP.name]: model.name || DIAGRAMS[model.diagram].label }, [el(VP.shapes, {}, shapes), el(VP.connectors, {}, lines)])]),
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${writeXml(doc)}\n`;
}

// For the editor's text fields: a list as lines and back (re-exported for convenience).
export { parseLine, formatLine };
