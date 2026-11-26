// "Create UML diagrams" from a Textual Analysis (pure, no DOM): its class candidates become a
// class diagram (each with the attributes and operations that belong to it, `owner`), its
// actors and use cases a use case diagram (a use case linked to its actor by an association),
// both in uml.js's own model, so they open in the diagram editor and go on the page like any
// UML prefab. Each diagram gets an `id` and an `origin` naming the analysis and the candidate
// of every element; the analysis gets, on each candidate, the elements made from it (`uml`).
import { makeElement, makeConnector, fitBounds, parseLine, UML_VERSION } from '../../uml.js';

const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blank = (diagram, name, analysis) => ({ type: 'uml', version: UML_VERSION, diagram, id: uid('uml'), name, badge: true, elements: [], connectors: [], origin: { module: 'textual-analysis', id: analysis.id, candidates: {} } });
// Names as UML wants them: no spaces in an attribute or operation.
export const memberName = (name) => String(name || '').trim().replace(/\s+(\p{L})/gu, (_, c) => c.toUpperCase()).replace(/\s+/g, '');
const member = memberName;
const classNameFromAttr = (name) => {
  const m = memberName(name);
  return m ? m[0].toUpperCase() + m.slice(1) : 'Class';
};
const foldKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const makeAttributeLine = (cand) => parseLine('attribute', `- ${memberName(cand.name || cand.text)}`);
export const makeOperationLine = (cand) => parseLine('operation', `+ ${memberName(cand.name || cand.text).replace(/\(.*$/, '')}()`);

// Groups candidates of a Textual Analysis for the UML sidebar & class-diagram builder:
// - classes: each class with its owned attributes & operations (plus soft suggestions for
//   unowned attributes whose name references that class, e.g. "nombreCliente" → Cliente)
// - looseAttributes / looseOperations: attributes & operations without an owner
// - actors, usecases, others
export function groupAnalysisCandidates(analysis) {
  const cands = Array.isArray(analysis?.candidates) ? analysis.candidates : [];
  const classes = cands.filter((c) => c.kind === 'class');
  const classNames = new Set(classes.map((c) => c.name));
  const attrs = cands.filter((c) => c.kind === 'attribute');
  const ops = cands.filter((c) => c.kind === 'operation');
  const classEntries = classes.map((c) => {
    const ck = foldKey(c.name);
    const ownedAttrs = attrs.filter((a) => a.owner === c.name);
    const ownedOps = ops.filter((o) => o.owner === c.name);
    const suggestedAttrs = ck.length >= 3
      ? attrs.filter((a) => !a.owner && foldKey(a.name).includes(ck) && foldKey(a.name) !== ck)
      : [];
    return { candidate: c, attributes: ownedAttrs, operations: ownedOps, suggestedAttributes: suggestedAttrs };
  });
  const looseAttributes = attrs.filter((a) => !a.owner || !classNames.has(a.owner));
  const looseOperations = ops.filter((o) => !o.owner || !classNames.has(o.owner));
  return {
    classes: classEntries,
    looseAttributes,
    looseOperations,
    actors: cands.filter((c) => c.kind === 'actor'),
    usecases: cands.filter((c) => c.kind === 'usecase'),
    others: cands.filter((c) => !['class', 'attribute', 'operation', 'actor', 'usecase'].includes(c.kind)),
  };
}

// Builds a UML class element from a class candidate and its attributes/operations.
export function makeClassFromCandidate(cand, { attributes = [], operations = [], at = [40, 40] } = {}, diagram = null) {
  const e = makeElement('class', at, {
    name: cand.name,
    modelId: cand.id,
    props: {
      attributes: attributes.map((a) => makeAttributeLine(a)),
      operations: operations.map((o) => makeOperationLine(o)),
    },
  }, diagram || { elements: [] });
  const [, , w, h] = fitBounds(e);
  e.bounds = [at[0], at[1], Math.max(e.bounds[2], Math.ceil(w)), Math.max(e.bounds[3], Math.ceil(h))];
  return e;
}

// Promotes an attribute candidate (e.g. "numeroTelefono") into a UML class ("NumeroTelefono")
// containing itself as a private attribute ("- numeroTelefono").
export function makeClassFromAttribute(cand, { at = [40, 40] } = {}, diagram = null) {
  const e = makeElement('class', at, {
    name: classNameFromAttr(cand.name || cand.text),
    modelId: cand.id,
    props: {
      attributes: [makeAttributeLine(cand)],
      operations: [],
    },
  }, diagram || { elements: [] });
  const [, , w, h] = fitBounds(e);
  e.bounds = [at[0], at[1], Math.max(e.bounds[2], Math.ceil(w)), Math.max(e.bounds[3], Math.ceil(h))];
  return e;
}

// Syncs an existing UML diagram with a linked Textual Analysis: links `origin`, adds any
// missing classes (or actors/use cases for useCase diagrams) and missing owned attributes/operations.
// Returns { addedElements, addedMembers }.
export function syncDiagramWithAnalysis(diagram, analysis) {
  if (!diagram || !analysis) return { addedElements: 0, addedMembers: 0 };
  diagram.origin = {
    module: 'textual-analysis',
    id: analysis.id,
    candidates: { ...(diagram.origin?.candidates || {}) },
  };
  const grouped = groupAnalysisCandidates(analysis);
  let addedElements = 0, addedMembers = 0;
  const existingByCand = new Map();
  const existingByName = new Map();
  for (const el of diagram.elements) {
    const cid = diagram.origin.candidates[el.id] || el.modelId;
    if (cid) existingByCand.set(cid, el);
    existingByName.set(foldKey(el.name), el);
  }
  const nextSpot = () => {
    const maxY = diagram.elements.reduce((m, e) => Math.max(m, (e.bounds?.[1] || 0) + (e.bounds?.[3] || 0)), 0);
    const col = addedElements % 3;
    const row = Math.floor(addedElements / 3);
    return [30 + col * 240, (maxY ? maxY + 40 : 30) + row * 180];
  };
  if (diagram.diagram === 'useCase') {
    for (const a of grouped.actors) {
      if (existingByCand.has(a.id) || existingByName.has(foldKey(a.name))) continue;
      const e = makeElement('actor', nextSpot(), { name: a.name, modelId: a.id }, diagram);
      diagram.elements.push(e);
      diagram.origin.candidates[e.id] = a.id;
      existingByCand.set(a.id, e);
      addedElements++;
    }
    for (const u of grouped.usecases) {
      if (existingByCand.has(u.id) || existingByName.has(foldKey(u.name))) continue;
      const e = makeElement('useCase', nextSpot(), { name: u.name, modelId: u.id }, diagram);
      diagram.elements.push(e);
      diagram.origin.candidates[e.id] = u.id;
      existingByCand.set(u.id, e);
      addedElements++;
    }
    return { addedElements, addedMembers };
  }
  for (const entry of grouped.classes) {
    const c = entry.candidate;
    let el = existingByCand.get(c.id) || existingByName.get(foldKey(c.name));
    if (!el) {
      el = makeClassFromCandidate(c, { attributes: entry.attributes, operations: entry.operations, at: nextSpot() }, diagram);
      diagram.elements.push(el);
      diagram.origin.candidates[el.id] = c.id;
      existingByCand.set(c.id, el);
      addedElements++;
      continue;
    }
    diagram.origin.candidates[el.id] = c.id;
    if (!el.modelId) el.modelId = c.id;
    el.props ||= {};
    el.props.attributes ||= [];
    el.props.operations ||= [];
    for (const a of entry.attributes) {
      const m = memberName(a.name);
      if (!el.props.attributes.some((x) => foldKey(x.name) === foldKey(m))) {
        el.props.attributes.push(makeAttributeLine(a));
        addedMembers++;
      }
    }
    for (const o of entry.operations) {
      const m = memberName(o.name).replace(/\(.*$/, '');
      if (!el.props.operations.some((x) => foldKey(x.name) === foldKey(m))) {
        el.props.operations.push(makeOperationLine(o));
        addedMembers++;
      }
    }
    const [, , w, h] = fitBounds(el);
    el.bounds[2] = Math.max(el.bounds[2], Math.ceil(w));
    el.bounds[3] = Math.max(el.bounds[3], Math.ceil(h));
  }
  return { addedElements, addedMembers };
}

// { diagrams: [uml specs], links: { candidateId: [{ diagram, element, list? }] }, skipped:
// [names of attributes/operations with no class] }.
export function umlFromAnalysis(analysis) {
  const cands = analysis.candidates || [];
  const links = {};
  const link = (c, diagram, element, list) => (links[c.id] ||= []).push({ diagram: diagram.id, element: element.id, ...(list ? { list } : {}) });
  const diagrams = [], skipped = [];
  const title = String(analysis.title || '').trim();

  const classes = cands.filter((c) => c.kind === 'class');
  if (classes.length) {
    const d = blank('class', title ? `${title}: classes` : 'Classes', analysis);
    const byName = new Map();
    for (const c of classes) {
      const mine = (kind) => cands.filter((x) => x.kind === kind && x.owner === c.name);
      const e = makeElement('class', [0, 0], {
        name: c.name,
        modelId: c.id,
        props: {
          attributes: mine('attribute').map((a) => parseLine('attribute', `- ${member(a.name)}`)),
          operations: mine('operation').map((o) => parseLine('operation', `+ ${member(o.name).replace(/\(.*$/, '')}()`)),
        },
      }, d);
      const [, , w, h] = fitBounds(e);
      e.bounds = [0, 0, Math.max(e.bounds[2], Math.ceil(w)), Math.max(e.bounds[3], Math.ceil(h))];
      d.elements.push(e);
      d.origin.candidates[e.id] = c.id;
      link(c, d, e);
      byName.set(c.name, e);
    }
    for (const x of cands.filter((q) => q.kind === 'attribute' || q.kind === 'operation')) {
      const owner = byName.get(x.owner);
      if (owner) link(x, d, owner, x.kind === 'attribute' ? 'attributes' : 'operations');
      else skipped.push(x.name);
    }
    // Rows of three, each row as tall as its tallest class.
    let y = 30;
    for (let i = 0; i < d.elements.length; i += 3) {
      const row = d.elements.slice(i, i + 3);
      let x = 30;
      for (const e of row) { e.bounds[0] = x; e.bounds[1] = y; x += e.bounds[2] + 60; }
      y += Math.max(...row.map((e) => e.bounds[3])) + 60;
    }
    diagrams.push(d);
  }

  const actors = cands.filter((c) => c.kind === 'actor'), cases = cands.filter((c) => c.kind === 'usecase');
  if (actors.length || cases.length) {
    const d = blank('useCase', title ? `${title}: use cases` : 'Use cases', analysis);
    const gap = 90;
    const sysH = Math.max(140, cases.length * gap + 40);
    const sys = cases.length ? makeElement('system', [200, 30], { name: title || 'System', bounds: [200, 30, 300, sysH] }, d) : null;
    if (sys) d.elements.push(sys);
    const actorEl = new Map();
    const step = actors.length > 1 ? Math.max(130, (sysH - 100) / (actors.length - 1)) : 0;
    actors.forEach((a, i) => {
      const e = makeElement('actor', [40, 40 + i * step], { name: a.name, modelId: a.id }, d);
      d.elements.push(e);
      d.origin.candidates[e.id] = a.id;
      link(a, d, e);
      actorEl.set(a.name, e);
    });
    cases.forEach((u, i) => {
      const e = makeElement('useCase', [275, 60 + i * gap], { name: u.name, modelId: u.id, parent: sys?.id ?? null }, d);
      d.elements.push(e);
      d.origin.candidates[e.id] = u.id;
      link(u, d, e);
      const actor = actorEl.get(u.owner);
      if (actor) d.connectors.push(makeConnector('association', actor.id, e.id, {}, d));
    });
    diagrams.push(d);
  }
  return { diagrams, links, skipped };
}

// The analysis with the new links on its candidates (added to any it had).
export function withLinks(analysis, links) {
  return { ...analysis, candidates: analysis.candidates.map((c) => (links[c.id] ? { ...c, uml: [...(c.uml || []), ...links[c.id]] } : c)) };
}
