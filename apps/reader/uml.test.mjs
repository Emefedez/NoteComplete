// UML diagrams (uml.js, uml-xml.js): the registry is complete, variables read and write as
// UML lines, every diagram kind draws, and diagrams survive XMI and Visual Paradigm XML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAMS, ELEMENTS, CONNECTORS, LISTS, ENUMS, SHAPE_ICONS, starterModel, normalizeModel, renderUml, parseLine, formatLine, makeElement, makeConnector, fitBounds, iconPath, umlName, connectorPath } from './uml.js';
import { exportXmi, importXmi, exportVp, importVp, importUml, parseXml, writeXml, detectFormat, vpDiagrams } from './uml-xml.js';

test('every type in a diagram is in the registry, with a shape, an icon, and file names', () => {
  for (const [kind, d] of Object.entries(DIAGRAMS)) {
    assert.ok(d.label && (d.vp || d.notUml), kind);
    for (const t of d.elements) {
      const def = ELEMENTS[t];
      assert.ok(def, `${kind}: element ${t}`);
      assert.ok(SHAPE_ICONS[def.shape], `${t}: an icon for shape ${def.shape}`);
      assert.ok(def.vp?.element && def.xmi?.type, `${t}: Visual Paradigm and XMI names`);
      assert.equal(def.size.length, 2, t);
      for (const [field, k] of Object.entries(def.fields)) assert.ok(['text', 'bool', 'tags', 'number', 'longText'].includes(k) || ENUMS[k] || LISTS[k?.list], `${t}.${field}: field kind ${JSON.stringify(k)}`);
    }
    for (const t of d.connectors) {
      const def = CONNECTORS[t];
      assert.ok(def && def.vp?.element && def.xmi?.type, `${kind}: connector ${t}`);
      assert.ok(iconPath('connector', t), t);
    }
  }
});

test('variables read from and write back to one UML line', () => {
  const cases = [
    ['attribute', '- isbn: String [1] = "0"'],
    ['attribute', 'static # count: int'],
    ['attribute', '+ tags: String [0..*]'],
    ['operation', '+ lend(to: Member, out ok: Boolean): void'],
    ['operation', 'abstract ~ run()'],
    ['operation', 'static + of(items: List<Map<K, V>>): Set'],
    ['literal', 'RED'],
    ['action', 'entry / start timer'],
    ['action', 'do / count'],
  ];
  for (const [list, line] of cases) assert.equal(formatLine(list, parseLine(list, line)), line, `${list}: ${line}`);
  const op = parseLine('operation', 'static + of(items: List<Map<K, V>>): Set');
  assert.equal(op.params.length, 1, 'commas inside <> stay in one parameter');
  assert.equal(op.static, true);
  assert.deepEqual(parseLine('attribute', '- name'), { visibility: '-', name: 'name', type: '', multiplicity: '', default: '', static: false });
  // Drawn, static and abstract are shown by underline and italics, not words.
  assert.equal(formatLine('attribute', parseLine('attribute', 'static # count: int'), { keywords: false }), '# count: int');
});

test('each diagram kind draws an SVG with its elements, and the badge can be turned off', () => {
  for (const kind of Object.keys(DIAGRAMS)) {
    const m = normalizeModel(starterModel(kind));
    assert.ok(m.elements.length >= 3 && m.connectors.length >= 2, kind);
    const out = renderUml(m, { ids: true });
    assert.ok(out.width > 100 && out.height > 60, `${kind}: ${out.width} × ${out.height}`);
    assert.match(out.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    // The root has no font-family (prefabs.js adds one when it draws the picture).
    assert.doesNotMatch(out.svg.slice(0, out.svg.indexOf('>')), /font-family/);
    for (const e of m.elements) assert.ok(out.svg.includes(`data-uml-id="${e.id}"`), `${kind}: ${e.type} drawn`);
    if (DIAGRAMS[kind].notUml) continue;
    assert.match(out.svg, /class="uml-badge"/);
    assert.doesNotMatch(renderUml({ ...m, badge: false }).svg, /uml-badge/);
    assert.match(umlName(m), /^UML .* diagram$/);
  }
  // Special characters are escaped.
  const m = normalizeModel({ diagram: 'class', elements: [makeElement('class', [0, 0], { name: 'List<T> & "x"' })], connectors: [] });
  assert.match(renderUml(m).svg, /List&lt;T&gt; &amp; &quot;x&quot;/);
});

test('a class grows to show its attributes and operations', () => {
  const e = makeElement('class', [0, 0], { props: { attributes: Array.from({ length: 8 }, (_, i) => parseLine('attribute', `- field${i}: AVeryLongTypeName${i}`)), operations: [] } });
  const [, , w, h] = fitBounds(e);
  assert.ok(w > e.bounds[2] && h > e.bounds[3], `${w} × ${h}`);
});

test('a model read from anywhere is made whole: unknown types kept, broken links dropped, no position placed', () => {
  const m = normalizeModel({ diagram: 'nonsense', elements: [{ id: 'a', type: 'class', name: 'A' }, { id: 'b', type: 'futureThing', name: 'B', props: { colour: 'red' } }], connectors: [{ id: 'c', type: 'association', from: 'a', to: 'b' }, { id: 'd', type: 'association', from: 'a', to: 'gone' }] });
  assert.equal(m.diagram, 'class');
  assert.equal(m.elements[1].props.colour, 'red');
  assert.deepEqual(m.connectors.map((c) => c.id), ['c']);
  for (const e of m.elements) assert.ok(e.bounds.every(Number.isFinite), 'placed');
  assert.notDeepEqual(m.elements[0].bounds.slice(0, 2), m.elements[1].bounds.slice(0, 2));
  assert.ok(renderUml(m).svg.includes('B'), 'an unknown type draws as a box with its name');
});

// Compares what matters: types, names, positions, nesting, props; order aside.
// `grid`: VP files hold whole numbers at VP's own scale, so a trip there moves a shape by up to
// a couple of pixels.
function same(a, b, grid = 1) {
  const nameOf = (m, id) => { const e = m.elements.find((q) => q.id === id); return `${e.type}:${e.name}`; };
  const key = (m) => ({
    diagram: m.diagram,
    elements: m.elements.map((e) => JSON.stringify([e.type, e.name, grid > 1 ? null : e.bounds.map(Math.round), e.parent ? nameOf(m, e.parent) : null, Object.entries(e.props).sort()])).sort(),
    connectors: m.connectors.map((c) => JSON.stringify([c.type, nameOf(m, c.from), nameOf(m, c.to), Object.entries(c.props).sort()])).sort(),
  });
  assert.deepEqual(key(b), key(a));
  if (grid > 1) for (const e of a.elements) {
    const o = b.elements.find((q) => q.type === e.type && q.name === e.name);
    assert.ok(o.bounds.every((v, i) => Math.abs(v - e.bounds[i]) <= grid / 2), `${e.name}: ${o.bounds} ≈ ${e.bounds}`);
  }
}

// A diagram of everything a kind has, nested where it can be.
function everything() {
  const out = [];
  for (const kind of Object.keys(DIAGRAMS)) {
    const m = starterModel(kind);
    const add = (type, extra = {}) => { const e = makeElement(type, [40 + m.elements.length * 30, 400 + m.elements.length * 10], extra, m); m.elements.push(e); return e; };
    const link = (type, a, b, extra = {}) => { const c = makeConnector(type, a.id, b.id, extra, m); m.connectors.push(c); return c; };
    if (kind === 'class') {
      const en = add('enumeration', { name: 'Colour', props: { literals: [{ name: 'RED' }, { name: 'GREEN' }] } });
      const i = add('interface', { name: 'Lendable', props: { operations: [parseLine('operation', '+ lend(): void')] } });
      const pk = add('package', { name: 'model' });
      const inner = add('class', { name: 'Shelf', parent: pk.id, props: { abstract: true, stereotypes: ['entity'], attributes: [parseLine('attribute', 'static - count: Integer [0..1] = 0')], operations: [parseLine('operation', 'abstract # place(b: Book): Boolean')] } });
      const book = m.elements.find((e) => e.name === 'Book');
      link('composition', inner, book, { props: { name: 'holds', fromEnd: { role: 'shelf', multiplicity: '1', navigable: false }, toEnd: { role: 'books', multiplicity: '*', navigable: true } } });
      link('aggregation', inner, en);
      link('realization', book, i);
      link('dependency', inner, i, { props: { name: 'uses', stereotypes: [] } });
      const note = add('note', { name: 'Books are lent\nfor 14 days' });
      link('anchor', note, book);
    }
    if (kind === 'useCase') {
      const a = m.elements.find((e) => e.name === 'Borrow book');
      const ext = add('useCase', { name: 'Pay fine', parent: m.elements[0].id });
      link('extend', ext, a, { props: { condition: 'late' } });
      const admin = add('actor', { name: 'Admin' });
      link('generalization', admin, m.elements.find((e) => e.type === 'actor'));
    }
    if (kind === 'state') {
      const comp = add('compositeState', { name: 'Active', props: { actions: [parseLine('action', 'entry / log')] } });
      const s1 = add('state', { name: 'Idle', parent: comp.id });
      const ch = add('choice'); const h = add('history', { props: { historyKind: 'deep' } }); const fk = add('fork'); const jn = add('join');
      link('transition', s1, ch, { props: { trigger: 'tick', guard: 'n > 0', effect: 'n--' } });
      link('transition', ch, h); link('transition', fk, jn);
    }
    if (kind === 'activity') {
      const lane = add('partition', { name: 'Warehouse' });
      const pick = add('action', { name: 'Pick items', parent: lane.id });
      const obj = add('objectNode', { name: 'Order', props: { type: 'Order' } });
      const ff = add('flowFinal'); const mg = add('merge'); const fk = add('fork'); const jn = add('join');
      link('objectFlow', pick, obj); link('controlFlow', obj, mg, { props: { guard: 'ok', name: '' } }); link('controlFlow', mg, ff); link('controlFlow', fk, jn);
    }
    if (kind === 'sequence') {
      const lib = m.elements.find((e) => e.name === ':Library');
      const frag = add('fragment', { props: { operator: 'loop', guard: 'for each book' } });
      const late = add('lifeline', { name: 'log', props: { type: 'Logger' } });
      link('asyncMessage', lib, late, { props: { name: 'write', args: 'line', y: 260 } });
      link('createMessage', lib, late, { props: { name: 'new', y: 280 } });
      assert.ok(frag);
    }
    out.push(normalizeModel(m));
  }
  return out;
}

test('every diagram kind survives XMI and Visual Paradigm XML, there and back', () => {
  for (const m of everything().filter((q) => !DIAGRAMS[q.diagram].notUml)) {
    same(m, importXmi(exportXmi(m)));
    same(m, importVp(exportVp(m)), 4);
    same(m, importUml(JSON.stringify(m)));
    // And again: the second trip keeps the file's ids.
    const back = importXmi(exportXmi(m));
    assert.equal(exportXmi(back), exportXmi(importXmi(exportXmi(back))), `${m.diagram}: stable`);
  }
});

test('XMI from another tool: elements, members and relations without layout are placed', () => {
  const xmi = `<?xml version="1.0"?>
<xmi:XMI xmi:version="2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
  <uml:Model xmi:id="m" name="Shop">
    <packagedElement xmi:type="uml:Class" xmi:id="C1" name="Order" isAbstract="true" customAttr="kept">
      <ownedAttribute xmi:id="a1" name="total" visibility="private" type="T1"><lowerValue xmi:type="uml:LiteralInteger" value="1"/><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/></ownedAttribute>
      <ownedOperation xmi:id="o1" name="pay" visibility="public"><ownedParameter xmi:id="p1" name="card" type="C2"/><ownedParameter xmi:id="p2" direction="return"><type href="http://schema.omg.org/spec/UML/2.1/uml.xml#Boolean"/></ownedParameter></ownedOperation>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="C2" name="Card"><generalization xmi:id="g1" general="C1"/></packagedElement>
    <packagedElement xmi:type="uml:DataType" xmi:id="T1" name="Money"/>
    <packagedElement xmi:type="uml:Association" xmi:id="as1" memberEnd="e1 e2">
      <ownedEnd xmi:id="e1" type="C1" association="as1"/>
      <ownedEnd xmi:id="e2" type="C2" association="as1" aggregation="composite" name="cards"><upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/></ownedEnd>
    </packagedElement>
  </uml:Model>
</xmi:XMI>`;
  assert.equal(detectFormat(xmi), 'xmi');
  const m = importUml(xmi);
  assert.equal(m.diagram, 'class');
  const order = m.elements.find((e) => e.name === 'Order');
  assert.equal(order.props.abstract, true);
  assert.equal(formatLine('attribute', order.props.attributes[0]), '- total: Money [1..*]');
  assert.equal(formatLine('operation', order.props.operations[0]), '+ pay(card: Card): Boolean');
  assert.equal(m.source.extra[order.id].customAttr, 'kept');
  const comp = m.connectors.find((c) => c.type === 'composition');
  assert.equal(m.elements.find((e) => e.id === comp.from).name, 'Order', 'the whole is the start');
  assert.equal(comp.props.toEnd.role, 'cards');
  assert.ok(m.connectors.some((c) => c.type === 'generalization'));
  for (const e of m.elements) assert.ok(e.bounds.every(Number.isFinite));
  assert.ok(exportXmi(m).includes('xmi:id="C1"'), 'their ids go back out');
});

test('the XML reader handles entities, CDATA, comments and self-closing tags', () => {
  const doc = parseXml('<?xml version="1.0"?><!-- x --><a k="1 &amp; 2"><b/><c><![CDATA[<raw>]]></c><d>&lt;&#65;&#x42;</d></a>');
  assert.equal(doc.attrs.k, '1 & 2');
  assert.deepEqual(doc.children.map((c) => c.name), ['b', 'c', 'd']);
  assert.equal(doc.children[1].text, '<raw>');
  assert.equal(doc.children[2].text, '<AB');
  assert.equal(writeXml({ name: 'x', attrs: { q: 'a"b' }, children: [] }), '<x q="a&quot;b"/>');
  assert.throws(() => importUml('just text'), /Not a UML file/);
});

test('node graphs: no UML badge or files, start and accepting nodes, tree layout, arrows both ways apart', () => {
  const m = normalizeModel(starterModel('graph'));
  assert.equal(m.badge, false);
  assert.equal(umlName(m), 'Node graph');
  assert.throws(() => exportXmi(m), /not a UML diagram/);
  assert.throws(() => exportVp(m), /not a UML diagram/);
  same(m, importUml(JSON.stringify(m)));
  // The tree: each child below its parent, the root centred over its children.
  const at = (name) => m.elements.find((e) => e.name === name).bounds;
  assert.ok(at('5')[1] > at('10')[1] && at('3')[1] > at('5')[1]);
  const mid = (b) => b[0] + b[2] / 2;
  assert.ok(Math.abs(mid(at('10')) - (mid(at('5')) + mid(at('15'))) / 2) < 1);
  assert.ok(Math.abs(mid(at('5')) - (mid(at('3')) + mid(at('7'))) / 2) < 1);
  // An automaton: q0 → q1 and q1 → q0 are drawn apart; start and accepting are drawn.
  const a = { type: 'uml', diagram: 'graph', elements: [], connectors: [] };
  const q0 = makeElement('node', [0, 0], { name: 'q0', props: { start: true } }, a), q1 = makeElement('node', [200, 0], { name: 'q1', props: { accepting: true } }, a);
  a.elements.push(q0, q1);
  a.connectors.push(makeConnector('edge', q0.id, q1.id, { props: { name: 'a' } }, a), makeConnector('edge', q1.id, q0.id, { props: { name: 'b' } }, a));
  const g = normalizeModel(a);
  const [p, q] = g.connectors.map((c) => connectorPath(g, c));
  assert.ok(Math.abs(p[0][1] - q[0][1]) > 8, 'two lines, not one');
  const svg = renderUml(g).svg;
  assert.equal((svg.match(/<ellipse/g) || []).length, 3, 'q1 has a second ring');
  assert.match(svg, />q0</);
});

test('Visual Paradigm projects from VP 16: the diagram chosen, its swimlanes, bends and arrows', async () => {
  const { readFileSync } = await import('node:fs');
  const sample = (d) => readFileSync(new URL(`../../samples/diagrams/${d}/project.xml`, import.meta.url), 'utf8');
  // An activity diagram in two swimlanes.
  const a = importUml(sample('a'));
  assert.equal(a.diagram, 'activity');
  const lanes = a.elements.filter((e) => e.type === 'partition');
  assert.deepEqual(lanes.map((e) => e.name), ['Usuario Registrado', 'Sistema']);
  assert.ok(lanes.every((l) => l.bounds[3] > 600), 'lanes run the height of the diagram');
  const busca = a.elements.find((e) => e.name === 'Busca');
  assert.equal(busca.parent, lanes[1].id);
  assert.ok(a.elements.some((e) => e.type === 'initial'), 'an activity\'s InitialNode');
  assert.equal(a.connectors.length, 21);
  assert.ok(a.connectors.some((c) => c.waypoints.length >= 2), 'bends kept');
  // A project with three diagrams: the first, or the one asked for.
  assert.deepEqual(vpDiagrams(sample('b')).map((d) => d.kind), ['useCase', 'activity']);
  const uc = importUml(sample('b'));
  assert.equal(uc.diagram, 'useCase');
  assert.ok(!uc.elements.some((e) => e.type === 'partition' || e.type === 'action'), 'only what the use case diagram shows');
  const act = importUml(sample('b'), { diagram: vpDiagrams(sample('b'))[1].index });
  assert.equal(act.diagram, 'activity');
  assert.equal(act.elements.filter((e) => e.type === 'partition').length, 3);
  assert.equal(act.elements.filter((e) => e.type === 'fork' || e.type === 'join').length, 2);
  // Use cases: no «UseCase» on every one, actors linked by their association ends, and
  // generalization and extend pointing where VP draws them.
  const c = importUml(sample('c'));
  const named = (s) => c.elements.find((e) => e.name === s);
  assert.ok(c.elements.every((e) => !(e.props.stereotypes || []).length));
  assert.equal(c.connectors.filter((q) => q.type === 'association').length, 7);
  const gen = c.connectors.find((q) => q.type === 'generalization');
  assert.equal(gen.to, named('Visitante').id);
  const ext = c.connectors.filter((q) => q.type === 'extend');
  assert.ok(ext.every((q) => q.from === named('Gestionar permisos de un usuario').id));
  // And back out: VP's sizes and directions again.
  const again = importVp(exportVp(c));
  assert.equal(again.connectors.find((q) => q.type === 'generalization').to, again.elements.find((e) => e.name === 'Visitante').id);
});

test('connector labels go beside the line, move by their offset, and are drawn over every line', async () => {
  const { renderUml, labelBox, normalizeModel } = await import('./uml.js');
  const at = labelBox([[0, 0], [200, 0]], 'name');
  assert.ok(at.y < 0, 'above a level line');
  const moved = labelBox([[0, 0], [200, 0]], 'name', [10, 30]);
  assert.equal(moved.x - at.x, 10);
  assert.equal(moved.y - at.y, 30);
  const model = normalizeModel({ diagram: 'useCase', elements: [{ id: 'a', type: 'actor', name: 'A', bounds: [0, 0, 60, 100] }, { id: 'u', type: 'useCase', name: 'U', bounds: [300, 20, 150, 64] }, { id: 'v', type: 'useCase', name: 'V', bounds: [300, 200, 150, 64] }], connectors: [{ id: 'c1', type: 'include', from: 'u', to: 'v' }, { id: 'c2', type: 'association', from: 'a', to: 'v' }] });
  const { svg } = renderUml(model, { ids: true });
  const label = svg.indexOf('data-uml-kind="label"'), lastLine = svg.lastIndexOf('data-uml-kind="connector"');
  assert.ok(label > lastLine, 'labels after every connector');
  assert.match(svg, /«include»/);
});
