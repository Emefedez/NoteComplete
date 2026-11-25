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
const member = (name) => String(name).trim().replace(/\s+(\p{L})/gu, (_, c) => c.toUpperCase()).replace(/\s+/g, '');

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
