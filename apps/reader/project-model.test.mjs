import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, makeElement } from './uml.js';
import { normalize as normalizeAnalysis } from './prefabs/textual-analysis/model.js';
import { umlFromAnalysis, withLinks } from './prefabs/textual-analysis/uml-from.js';
import {
  buildProjectModel,
  extractPrefabsFromPages,
  findElementForCandidate,
  findElementForUml,
  formatOccurrenceLabel,
  modelTree,
  otherOccurrences,
  planRename,
} from './project-model.js';

describe('UML modelId preservation and Textual Analysis linkage', () => {
  it('makeElement and normalizeModel preserve valid modelId on elements', () => {
    const e = makeElement('class', [10, 20], { name: 'Cliente', modelId: 'c-cliente' });
    assert.equal(e.modelId, 'c-cliente');
    const norm = normalizeModel({ type: 'uml', diagram: 'class', name: 'Dominio', elements: [e], connectors: [] });
    assert.equal(norm.elements[0].modelId, 'c-cliente');
    // Invalid modelId is dropped.
    const bad = normalizeModel({ type: 'uml', diagram: 'class', elements: [{ id: 'e1', type: 'class', name: 'X', modelId: 'bad id with spaces!' }], connectors: [] });
    assert.equal(bad.elements[0].modelId, undefined);
  });

  it('umlFromAnalysis stamps modelId = candidate.id on created UML elements', () => {
    const analysis = normalizeAnalysis({
      title: 'Reservas',
      text: 'El cliente realiza una reserva con su nombre.',
      candidates: [
        { id: 'c-cliente', name: 'Cliente', text: 'cliente', kind: 'class', folder: 'Clases' },
        { id: 'c-nombre', name: 'nombre', text: 'nombre', kind: 'attribute', owner: 'Cliente' },
        { id: 'c-usuario', name: 'Usuario', text: 'cliente', kind: 'actor', folder: 'Actores' },
        { id: 'c-reservar', name: 'Realizar reserva', text: 'realiza una reserva', kind: 'usecase', owner: 'Usuario' },
      ],
    });
    const { diagrams } = umlFromAnalysis(analysis);
    const classDiag = diagrams.find((d) => d.diagram === 'class');
    const ucDiag = diagrams.find((d) => d.diagram === 'useCase');
    assert.ok(classDiag);
    assert.ok(ucDiag);
    assert.equal(classDiag.elements.find((e) => e.name === 'Cliente')?.modelId, 'c-cliente');
    assert.equal(ucDiag.elements.find((e) => e.type === 'useCase')?.modelId, 'c-reservar');
  });
});

describe('extractPrefabsFromPages', () => {
  it('extracts UML and Textual Analysis prefabs from page view parts and ignores other prefabs', () => {
    const umlSpec = { type: 'uml', diagram: 'class', id: 'uml-1', name: 'Classes', elements: [], connectors: [] };
    const taSpec = { type: 'textual-analysis', id: 'ta-1', title: 'Problem', text: '', candidates: [] };
    const otherSpec = { type: 'stickynote', text: 'Hi' };
    const extracted = extractPrefabsFromPages([
      {
        pageIndex: 0,
        parts: [
          { id: 'p1', kind: 'prefab', item: 'new:1', spec: JSON.stringify(taSpec) },
          { id: 'p1', kind: 'prefab', item: 'new:2' },
          { id: 'p2', kind: 'prefab', item: 'new:3', spec: JSON.stringify(otherSpec) },
          { id: 'g1', kind: 'graph', item: 'new:4', spec: '{}' },
        ],
      },
      {
        pageIndex: 2,
        parts: [
          { id: 'p3', kind: 'prefab', item: 'new:5', spec: JSON.stringify(umlSpec) },
          { id: 'p3', kind: 'prefab', item: 'new:6' },
        ],
      },
    ]);
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0].pageIndex, 0);
    assert.equal(extracted[0].partId, 'p1');
    assert.deepEqual(extracted[0].items, ['new:1', 'new:2']);
    assert.equal(extracted[0].spec.type, 'textual-analysis');
    assert.equal(extracted[1].pageIndex, 2);
    assert.equal(extracted[1].partId, 'p3');
    assert.equal(extracted[1].spec.type, 'uml');
  });
});

describe('buildProjectModel & reconciliation', () => {
  function sampleProject() {
    const baseAnalysis = normalizeAnalysis({
      id: 'ta-reservas',
      title: 'Sistema de Reservas',
      text: 'El cliente hace una reserva. El cliente tiene un correo.',
      candidates: [
        { id: 'c-cli', name: 'Cliente', text: 'cliente', kind: 'class', folder: 'Clases' },
        { id: 'c-res', name: 'Reserva', text: 'reserva', kind: 'class', folder: 'Clases' },
        { id: 'c-mail', name: 'correo', text: 'correo', kind: 'attribute', owner: 'Cliente', folder: 'Atributos' },
        { id: 'c-act', name: 'Recepcionista', text: 'recepcionista', kind: 'actor', folder: 'Actores' },
        { id: 'c-uc', name: 'Crear reserva', text: 'hace una reserva', kind: 'usecase', owner: 'Recepcionista', folder: 'Casos de uso' },
      ],
    });
    const { diagrams, links } = umlFromAnalysis(baseAnalysis);
    const analysis = withLinks(baseAnalysis, links);
    const classDiag = diagrams.find((d) => d.diagram === 'class');
    const ucDiag = diagrams.find((d) => d.diagram === 'useCase');

    // A second class diagram referencing Cliente by name (without modelId yet) and a Sequence diagram
    // with an actorLifeline for Recepcionista and a lifeline typed by Cliente.
    const secondClassDiag = {
      type: 'uml',
      version: 1,
      id: 'uml-pkg',
      diagram: 'class',
      name: 'Facturacion',
      elements: [
        makeElement('class', [20, 20], { id: 'e1', name: 'Cliente' }),
        makeElement('class', [240, 20], { id: 'e2', name: 'Factura' }),
      ],
      connectors: [],
    };
    const seqDiag = {
      type: 'uml',
      version: 1,
      id: 'uml-seq',
      diagram: 'sequence',
      name: 'Flujo reserva',
      elements: [
        makeElement('actorLifeline', [20, 20], { id: 's1', name: 'Recepcionista' }),
        makeElement('lifeline', [180, 20], { id: 's2', name: 'cli', props: { type: 'Cliente' } }),
      ],
      connectors: [],
    };

    const prefabs = [
      { pageIndex: 0, partId: 'part-ta', spec: analysis },
      { pageIndex: 1, partId: 'part-cls1', spec: classDiag },
      { pageIndex: 1, partId: 'part-uc', spec: ucDiag },
      { pageIndex: 2, partId: 'part-cls2', spec: secondClassDiag },
      { pageIndex: 3, partId: 'part-seq', spec: seqDiag },
    ];
    return { prefabs, analysis, classDiag, ucDiag, secondClassDiag, seqDiag };
  }

  it('reconciles Textual Analysis candidates, UML elements, multi-diagram classes, and sequence lifelines', () => {
    const { prefabs, classDiag, seqDiag } = sampleProject();
    const pm = buildProjectModel(prefabs);

    assert.equal(pm.diagrams.length, 5);
    const cliente = pm.byId.get('c-cli');
    assert.ok(cliente, 'Cliente should keep candidate id c-cli');
    // Appears in: TA (p.0), Class diagram 1 (p.1), Class diagram 2 (p.2), Sequence diagram lifeline (p.3)
    assert.equal(cliente.occurrences.length, 4);
    assert.deepEqual(
      cliente.occurrences.map((o) => [o.pageIndex, o.module, o.role]),
      [
        [0, 'textual-analysis', 'candidate'],
        [1, 'uml', 'element'],
        [2, 'uml', 'element'],
        [3, 'uml', 'lifeline'],
      ]
    );

    // Actor Recepcionista reconciled across TA, Use Case diagram, and Sequence actorLifeline.
    const recep = pm.byId.get('c-act');
    assert.ok(recep);
    assert.equal(recep.occurrences.length, 3);
    assert.deepEqual(
      recep.occurrences.map((o) => [o.pageIndex, o.diagramKind]),
      [
        [0, 'textual-analysis'],
        [1, 'useCase'],
        [3, 'sequence'],
      ]
    );

    // Attribute candidate `correo` has both TA occurrence and Class diagram member occurrence.
    const correo = pm.byId.get('c-mail');
    assert.ok(correo);
    assert.equal(correo.occurrences.length, 2);
    assert.equal(correo.occurrences[1].role, 'member');
    assert.equal(correo.occurrences[1].list, 'attributes');

    // Lookup helpers work from both UML editor and Textual Analysis editor.
    const fromUml = findElementForUml(pm, { diagramId: classDiag.id, elementId: classDiag.elements[0].id });
    assert.equal(fromUml?.modelId, 'c-cli');
    const fromSeq = findElementForUml(pm, { diagramId: seqDiag.id, elementId: 's1' });
    assert.equal(fromSeq?.modelId, 'c-act');
    const fromCand = findElementForCandidate(pm, { analysisId: 'ta-reservas', candidateId: 'c-cli' });
    assert.equal(fromCand?.modelId, 'c-cli');

    // otherOccurrences excludes the current diagram.
    const others = otherOccurrences(cliente, { partId: 'part-cls1' });
    assert.equal(others.length, 3);
    assert.ok(others.every((o) => o.partId !== 'part-cls1'));
    assert.match(formatOccurrenceLabel(others[0]), /Textual Analysis: Sistema de Reservas \(p\. 1\)/);
  });

  it('builds Model Explorer tree with Candidate Items folders, kind groups, and filtering', () => {
    const { prefabs } = sampleProject();
    const pm = buildProjectModel(prefabs);
    const tree = modelTree(pm);
    assert.ok(tree.candidateFolders.some((f) => f.folder === 'Clases'));
    assert.ok(tree.candidateFolders.some((f) => f.folder === 'Actores'));
    assert.ok(tree.groups.some((g) => g.id === 'class' && g.items.length === 3)); // Cliente, Reserva, Factura
    assert.ok(tree.groups.some((g) => g.id === 'actor' && g.items.length === 1));
    assert.ok(tree.groups.some((g) => g.id === 'usecase' && g.items.length === 1));
    assert.equal(tree.diagrams.length, 5);

    const filteredByDiag = modelTree(pm, { filter: 'factur' });
    assert.equal(filteredByDiag.groups.length, 1);
    assert.deepEqual(filteredByDiag.groups[0].items.map((x) => x.name), ['Cliente', 'Factura']);
    assert.equal(filteredByDiag.diagrams.length, 1);
    assert.equal(filteredByDiag.diagrams[0].name, 'Facturacion');

    const filteredByName = modelTree(pm, { filter: 'recep' });
    assert.deepEqual(filteredByName.groups[0].items.map((x) => x.name), ['Recepcionista']);
  });

  it('propagates renames across UML diagrams, sequence lifelines, Textual Analysis candidates, and owner references', () => {
    const { prefabs } = sampleProject();
    const pm = buildProjectModel(prefabs);

    // Rename Cliente -> Customer everywhere.
    const plan = planRename(prefabs, pm, 'c-cli', 'Customer');
    assert.equal(plan.oldName, 'Cliente');
    assert.equal(plan.newName, 'Customer');
    assert.equal(plan.totalDiagrams, 4);

    const taUpdate = plan.updates.find((u) => u.partId === 'part-ta');
    assert.ok(taUpdate);
    assert.equal(taUpdate.afterSpec.candidates.find((c) => c.id === 'c-cli').name, 'Customer');
    // Owner reference on `correo` attribute was updated too!
    assert.equal(taUpdate.afterSpec.candidates.find((c) => c.id === 'c-mail').owner, 'Customer');

    const cls1Update = plan.updates.find((u) => u.partId === 'part-cls1');
    assert.equal(cls1Update.afterSpec.elements.find((e) => e.modelId === 'c-cli').name, 'Customer');

    const cls2Update = plan.updates.find((u) => u.partId === 'part-cls2');
    assert.equal(cls2Update.afterSpec.elements[0].name, 'Customer');
    // Stamps stable modelId on the previously unlinked diagram element!
    assert.equal(cls2Update.afterSpec.elements[0].modelId, 'c-cli');

    const seqUpdate = plan.updates.find((u) => u.partId === 'part-seq');
    assert.equal(seqUpdate.afterSpec.elements.find((e) => e.id === 's2').props.type, 'Customer');

    // Rename an attribute candidate (`correo` -> `email`): updates TA and class diagram attribute list.
    const attrPlan = planRename(prefabs, pm, 'c-mail', 'email');
    assert.equal(attrPlan.totalDiagrams, 2);
    const clsAttrUpd = attrPlan.updates.find((u) => u.partId === 'part-cls1');
    assert.ok(clsAttrUpd.afterSpec.elements[0].props.attributes.some((a) => a.name === 'email'));

    // Single-diagram rename via onlyDiagramKey leaves other diagrams untouched.
    const onlyOne = planRename(prefabs, pm, 'c-cli', 'ClientLocal', { onlyDiagramKey: 'p2:part-cls2' });
    assert.equal(onlyOne.totalDiagrams, 1);
    assert.equal(onlyOne.updates[0].partId, 'part-cls2');
  });

  it('survives renames via modelId / origin.candidates on subsequent scans', () => {
    const { prefabs } = sampleProject();
    const pm1 = buildProjectModel(prefabs);
    // Suppose only Class diagram 1 was renamed from Cliente -> ClientA locally;
    // because it has modelId: 'c-cli' and origin.candidates, it STILL stays linked to TA candidate c-cli!
    const mutated = prefabs.map((p) => {
      if (p.partId !== 'part-cls1') return p;
      const copy = structuredClone(p.spec);
      copy.elements.find((e) => e.modelId === 'c-cli').name = 'ClientA';
      return { ...p, spec: copy };
    });
    const pm2 = buildProjectModel(mutated);
    const el = pm2.byId.get('c-cli');
    assert.ok(el);
    assert.ok(el.occurrences.some((o) => o.partId === 'part-ta'));
    assert.ok(el.occurrences.some((o) => o.partId === 'part-cls1'));
    assert.equal(pm1.byId.get('c-cli').modelId, el.modelId);
  });
});
