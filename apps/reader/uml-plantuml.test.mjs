import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlantUml, toPlantUml, plantumlBoxes, layoutFromPlantuml } from './uml-plantuml.js';
import { renderUml, connectorLabel, connectorPath, normalizeModel } from './uml.js';

const CLASSES = `@startuml editorial
!include estilo.iuml
skinparam class {
  BackgroundColor #EAF2FB
}
title Editorial
abstract class Usuario {
  nombre : String
  + validar() : Boolean
}
class "Edición" as Edicion
enum TipoArbitro {
  PRINCIPAL
  APOYO
}
package "Gestión de Usuarios" as PU {
  class Editor
}
Editorial "1" *-- "1..*" Revista : publica >
Edicion "0..1" o-- "10" Articulo : contiene >
Editor --|> Usuario
Articulo "*" -- "3..5" Evaluador : evaluado por >
(Articulo, Evaluador) .. Evaluacion
Socio "1" --> "*" Compra
note right of Usuario : abstracta
PU ..> Otro : usa
@enduml`;

test('a class diagram becomes the editor model', () => {
  const { model, preamble } = parsePlantUml(CLASSES);
  assert.equal(model.diagram, 'class');
  assert.equal(model.name, 'editorial');
  assert.equal(model.title, 'Editorial');
  assert.deepEqual(preamble.map((l) => l.trim()), ['!include estilo.iuml', 'skinparam class {', 'BackgroundColor #EAF2FB', '}']);
  const by = Object.fromEntries(model.elements.map((e) => [e.id, e]));
  assert.equal(by.Usuario.props.abstract, true);
  assert.deepEqual(by.Usuario.props.attributes.map((a) => [a.name, a.type]), [['nombre', 'String']]);
  assert.equal(by.Usuario.props.operations[0].name, 'validar');
  assert.equal(by.Usuario.props.operations[0].returns, 'Boolean');
  assert.equal(by.Edicion.name, 'Edición');
  assert.equal(by.TipoArbitro.type, 'enumeration');
  assert.deepEqual(by.TipoArbitro.props.literals.map((l) => l.name), ['PRINCIPAL', 'APOYO']);
  assert.equal(by.PU.type, 'package');
  assert.equal(by.Editor.parent, 'PU');
  const link = (type, from, to) => model.connectors.find((c) => c.type === type && c.from === from && c.to === to);
  const comp = link('composition', 'Editorial', 'Revista');
  assert.equal(comp.props.fromEnd.multiplicity, '1');
  assert.equal(comp.props.toEnd.multiplicity, '1..*');
  assert.equal(comp.props.reading, 'forward');
  assert.ok(link('aggregation', 'Edicion', 'Articulo'));
  assert.ok(link('generalization', 'Editor', 'Usuario'));
  assert.equal(link('association', 'Socio', 'Compra').props.toEnd.navigable, true);
  assert.ok(link('dependency', 'PU', 'Otro'));
  const evaluado = link('association', 'Articulo', 'Evaluador');
  assert.ok(link('associationClass', 'Evaluacion', evaluado.id), 'the association class names its association');
  assert.ok(model.connectors.some((c) => c.type === 'anchor' && c.to === 'Usuario'));
});

test('a use case diagram keeps actors, the system, include and extend', () => {
  const { model } = parsePlantUml(`@startuml
left to right direction
actor "Socio" as SO
actor "Presidente" as PR
PR -up-|> SO
rectangle "Club" {
  usecase "Comprar Munición" as U9
  usecase "Enviar Copia" as U11
  (Pagar) as U12
}
SO -- U9
U9 ..> U12 : <<include>>
U11 .> U9 : <<extend>>\\n(más de 3 cajas)
@enduml`);
  assert.equal(model.diagram, 'useCase');
  const by = Object.fromEntries(model.elements.map((e) => [e.id, e]));
  assert.equal(by.SO.type, 'actor');
  assert.equal(by.Club.type, 'system');
  assert.equal(by.U9.parent, 'Club');
  assert.equal(by.U12.name, 'Pagar');
  assert.ok(model.connectors.find((c) => c.type === 'generalization' && c.from === 'PR' && c.to === 'SO'));
  assert.ok(model.connectors.find((c) => c.type === 'include' && c.from === 'U9' && c.to === 'U12'));
  const ext = model.connectors.find((c) => c.type === 'extend');
  assert.deepEqual([ext.from, ext.to, ext.props.condition], ['U11', 'U9', 'más de 3 cajas']);
});

test('other PlantUML diagrams are left to be drawn as pictures', () => {
  assert.throws(() => parsePlantUml('@startuml\nstart\n:Hacer algo;\nstop\n@enduml'), /picture/);
  assert.throws(() => parsePlantUml('@startuml\nparticipant A\nA -> B : hola\n@enduml'), /picture/);
});

test('saved PlantUML reads back the same, with the layout in a comment', () => {
  const { model, preamble } = parsePlantUml(CLASSES);
  for (const [i, e] of model.elements.entries()) e.bounds = [i * 10, i * 20, 120, 60];
  model.connectors[0].waypoints = [[5, 6]];
  const text = toPlantUml(model, { preamble });
  assert.match(text, /^@startuml editorial\n!include estilo.iuml/);
  assert.match(text, /abstract class Usuario \{/);
  assert.match(text, /class "Edición" as Edicion/);
  assert.match(text, /Editorial "1" \*-- "1..\*" Revista : publica >/);
  assert.match(text, /\(Articulo, Evaluador\) \.\. Evaluacion/);
  assert.match(text, /^' notecomplete-layout \{/m);
  const back = parsePlantUml(text);
  assert.equal(back.laidOut, true);
  const rows = (m) => m.elements.map((e) => [e.id, e.type, e.name, e.parent, e.bounds]).sort((x, y) => x[0].localeCompare(y[0]));
  assert.deepEqual(rows(back.model), rows(normalizeModel(model)));
  assert.deepEqual(back.model.connectors.map((c) => [c.type, c.from, c.props.name || '']), normalizeModel(model).connectors.map((c) => [c.type, c.from, c.props.name || '']));
  assert.deepEqual(back.model.connectors[0].waypoints, [[5, 6]]);
  assert.doesNotMatch(toPlantUml(model, { layout: false }), /notecomplete-layout/);
});

test('boxes come from where PlantUML drew them', () => {
  const svg = '<svg><g id="cluster_PU"><path d="M10,20 L210,20 L210,220 L10,220 Z"/></g><g id="elem_Editor"><rect x="30" y="40" width="80" height="50"/><text x="35" y="60" textLength="40">Editor</text></g><g id="elem_SO"><ellipse cx="300" cy="100" rx="8" ry="8"/><path d="M300,108 L300,135"/></g></svg>';
  const boxes = plantumlBoxes(svg);
  assert.deepEqual(boxes.get('Editor'), [30, 40, 80, 50]);
  const { model } = parsePlantUml('@startuml\npackage "P" as PU {\nclass Editor\n}\nactor SO\n@enduml');
  assert.equal(layoutFromPlantuml(model, svg), 3);
  assert.deepEqual(model.elements.find((e) => e.id === 'Editor').bounds, [30, 40, 80, 50]);
  assert.deepEqual(model.elements.find((e) => e.id === 'PU').bounds, [10, 10, 200, 210]);
});

test('an association class is a dashed line to the middle of its association', () => {
  const { model } = parsePlantUml('@startuml\nclass A\nclass B\nclass C\nA "*" -- "3..5" B : evaluado por >\n(A, B) .. C\n@enduml');
  const m = normalizeModel(model);
  m.elements[0].bounds = [0, 0, 100, 60]; m.elements[1].bounds = [400, 0, 100, 60]; m.elements[2].bounds = [200, 200, 100, 60];
  const assoc = m.connectors.find((c) => c.type === 'association');
  const link = m.connectors.find((c) => c.type === 'associationClass');
  const line = connectorPath(m, assoc), dash = connectorPath(m, link);
  assert.equal(Math.round(dash.at(-1)[0]), Math.round((line[0][0] + line.at(-1)[0]) / 2));
  assert.equal(connectorLabel(assoc), 'evaluado por ▸');
  assert.match(renderUml(m).svg, /stroke-dasharray/);
  // Without its association, the link goes too.
  assert.equal(normalizeModel({ ...m, connectors: [link] }).connectors.length, 0);
});

test('heads chosen by hand: drawn, swapped with the line and written to PlantUML', async () => {
  const { headsOf } = await import('./uml.js');
  const { model } = parsePlantUml('@startuml\nclass A\nclass B\nA -- B\n@enduml');
  const c = model.connectors[0];
  assert.deepEqual(headsOf(c), { start: 'none', end: 'none', line: 'solid' });
  Object.assign(c.props, { headFrom: 'filledDiamond', headTo: 'open', line: 'dashed' });
  assert.deepEqual(headsOf(c), { start: 'filledDiamond', end: 'open', line: 'dashed' });
  const m = normalizeModel(model);
  m.elements[0].bounds = [0, 0, 100, 60]; m.elements[1].bounds = [300, 0, 100, 60];
  const svg = renderUml(m).svg;
  assert.match(svg, /stroke-dasharray="7 5"/);
  assert.match(toPlantUml(m), /^A \*\.\.> B$/m);
});

test('package diagrams parse as package kind, round-trip layout, and GMN notes get placed', () => {
  const pkgPuml = `@startuml paquetes\nhide members\nhide circle\npackage "Dominio" {\n  package "Usuarios" as PU {\n    class Usuario\n  }\n  package "Tiradas" as PT {\n    class Tirada\n  }\n}\nPT ..> PU : Socio\n@enduml`;
  const parsed = parsePlantUml(pkgPuml);
  assert.equal(parsed.model.diagram, 'package');
  parsed.model.elements[0].bounds = [10, 20, 400, 300];
  parsed.model.elements[1].bounds = [30, 60, 150, 140];
  const saved = toPlantUml(parsed.model, { preamble: parsed.preamble });
  const back = parsePlantUml(saved);
  assert.equal(back.model.diagram, 'package');
  assert.deepEqual(back.model.elements[0].bounds, [10, 20, 400, 300]);
  assert.deepEqual(back.model.elements[1].bounds, [30, 60, 150, 140]);

  const noteSvg = '<svg><g id="elem_Inscripcion"><rect x="100" y="100" width="120" height="50"/></g><g id="elem_GMN45"><path d="M260,100 L380,100 L380,150 L260,150 Z"/><text x="266" y="120" textLength="90">Max 10 entries</text></g></svg>';
  const noteParsed = parsePlantUml('@startuml\nclass Inscripcion\nnote right of Inscripcion : Max 10 entries\n@enduml');
  assert.equal(layoutFromPlantuml(noteParsed.model, noteSvg), 2);
  const n = noteParsed.model.elements.find((e) => e.type === 'note');
  assert.deepEqual(n.bounds, [260, 100, 120, 50]);
});

test('UML clipboard preserves positioning across PlantUML text, note specs, and editors', async () => {
  const { writeUmlClip, readUmlClipFromText, saveNoteUmlClip, getSharedUmlClip, clipFitsDiagram } = await import('./uml-clipboard.js');
  const { starterModel } = await import('./uml.js');
  const pkg = starterModel('package');
  pkg.elements[0].bounds = [50, 60, 440, 240];
  pkg.connectors[0].waypoints = [[220, 145]];
  const { text } = writeUmlClip({ diagram: pkg.diagram, elements: pkg.elements, connectors: pkg.connectors });
  assert.match(text, /notecomplete-layout/);
  const back = readUmlClipFromText(text);
  assert.equal(back.diagram, 'package');
  assert.equal(back.laidOut, true);
  assert.deepEqual(back.elements[0].bounds, [50, 60, 440, 240]);
  assert.deepEqual(back.connectors[0].waypoints, [[220, 145]]);
  assert.ok(clipFitsDiagram(back, 'class'));

  saveNoteUmlClip(pkg);
  assert.equal(getSharedUmlClip().elements.length, pkg.elements.length);
  const seq = starterModel('sequence');
  const seqClip = writeUmlClip({ diagram: seq.diagram, elements: seq.elements, connectors: seq.connectors });
  const seqBack = readUmlClipFromText(seqClip.text);
  assert.equal(seqBack.diagram, 'sequence');
  assert.deepEqual(seqBack.elements.map((e) => e.bounds), seq.elements.map((e) => e.bounds));
});
