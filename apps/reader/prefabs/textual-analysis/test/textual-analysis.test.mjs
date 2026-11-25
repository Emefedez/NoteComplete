import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, findOccurrences, occurrences, classify, candidateAt, removeCandidate, update, setText, merge, move, suggestName, nextColour, textBlocks, PALETTE } from '../model.js';
import { render } from '../render.js';

const card = JSON.parse(readFileSync(new URL('../module.json', import.meta.url))).prefabs[0].spec;

test('the sample statement: every candidate counted where its words appear', () => {
  const model = normalize(card);
  const counts = Object.fromEntries(model.candidates.map((c, i) => [c.name, occurrences(model)[i]]));
  assert.deepEqual(counts, { ActividadAventura: 3, Cliente: 6, ReservaPlaza: 1, nombreCliente: 1, DireccionPostal: 1, numeroTelefono: 1 });
  // Each candidate keeps its own colour.
  assert.equal(new Set(model.candidates.map((c) => c.colour)).size, model.candidates.length);
});

test('occurrences: whole words, any case, the longer text wins, marks and code skipped', () => {
  const model = normalize({ text: 'Cliente y CLIENTE, clientela. Nombre de cliente. **cliente** `cliente`', candidates: [{ text: 'cliente' }, { text: 'nombre de cliente', kind: 'attribute' }] });
  assert.deepEqual(occurrences(model), [3, 1]);
  const plural = normalize({ ...model, text: 'el cliente y los clientes', match: { plural: true } });
  assert.deepEqual(occurrences(plural), [2, 0]);
  const accents = normalize({ text: 'Teléfono y telefono', candidates: [{ text: 'teléfono' }] });
  assert.deepEqual([occurrences(accents)[0], occurrences({ ...accents, match: { accents: true } })[0]], [1, 2]);
  const [a] = findOccurrences(normalize({ text: 'un cliente', candidates: [{ text: 'cliente' }] }));
  assert.deepEqual([a.start, a.end], [3, 10]);
});

test('classifying makes a candidate with a suggested name and the next colour; the same words again only change its type', () => {
  let model = normalize({ text: 'Las reservas de los clientes. Cada cliente paga.' });
  const r = classify(model, 0, 28, 'class');
  assert.ok(r.added);
  model = r.model;
  assert.deepEqual([model.candidates[0].name, model.candidates[0].text, model.candidates[0].colour], ['ReservasClientes', 'Las reservas de los clientes', PALETTE[0]]);
  const again = classify(model, 0, 28, 'actor');
  assert.equal(again.added, false);
  assert.equal(again.model.candidates.length, 1);
  assert.equal(again.model.candidates[0].kind, 'actor');
  assert.equal(classify(model, 3, 3, 'class'), null);
  assert.equal(candidateAt(model, 5), 0);
  assert.equal(removeCandidate(model, 0).candidates.length, 0);
});

test('names suggested from the extracted text', () => {
  assert.equal(suggestName('Nombre de cliente', 'attribute'), 'nombreCliente');
  assert.equal(suggestName('dirección postal', 'class'), 'DireccionPostal');
  assert.equal(suggestName('actividades de aventura', 'class'), 'ActividadesAventura');
  assert.equal(suggestName('borrow a book', 'usecase'), 'Borrow a book');
  assert.equal(nextColour([{ colour: PALETTE[0] }]), PALETTE[1]);
});

test('duplicates merge, renames follow owners, texts merge, order moves', () => {
  const model = normalize({ text: 'a cliente and a client', candidates: [{ name: 'Cliente', text: 'cliente', order: 1 }, { name: 'X', text: 'Cliente ', order: 2, description: 'dup' }, { name: 'nombre', text: 'nombre', kind: 'attribute', owner: 'Cliente', order: 0 }] });
  assert.deepEqual(model.candidates.map((c) => c.name), ['nombre', 'Cliente']);
  assert.equal(model.candidates[1].description, 'dup');
  const renamed = update(model, 1, { name: 'Customer' });
  assert.equal(renamed.candidates[0].owner, 'Customer');
  const two = normalize({ ...model, candidates: [...model.candidates, { name: 'Client', text: 'client' }] });
  const merged = merge(two, 2, 1);
  assert.deepEqual([merged.candidates.length, merged.candidates[1].aliases, occurrences(merged)[1]], [2, ['client'], 2]);
  assert.equal(setText(two, 2, 'cliente').candidates.length, 2, 'the same text as another candidate merges them');
  assert.deepEqual(move(model, 0, 1).candidates.map((c) => [c.name, c.order]), [['Cliente', 0], ['nombre', 1]]);
});

test('text blocks keep styles, nesting, remarks and candidates', () => {
  const model = normalize({ text: 'Se quiere **una aplicación** =={.red}(NO es clase)==\n\n- De cada cliente:\n  - Nombre', candidates: [{ text: 'cliente' }] });
  const [p, item, sub] = textBlocks(model);
  assert.ok(p.runs.some((r) => r.bold && r.text === 'una aplicación'));
  assert.ok(p.runs.some((r) => r.tag === '.red' && r.text === '(NO es clase)'));
  assert.deepEqual([item.bullet, item.level, sub.bullet, sub.level], ['•', 0, '◦', 1]);
  assert.ok(item.runs.some((r) => r.cand === 0 && r.text === 'cliente'));
});

test('the figure: text, table or both, escaped, never throwing on odd specs', () => {
  const both = render(card), text = render({ ...card, show: 'text' }), table = render({ ...card, show: 'table' });
  for (const r of [both, text, table]) assert.ok(r.svg.startsWith('<svg') && r.width === 760 && r.height > 60);
  assert.ok(both.height > text.height && both.height > table.height);
  assert.match(both.svg, />Candidate Class</);
  assert.match(both.svg, /fill="#d92d20"[^>]*>\(la aplicación NO es una clase\)/);
  assert.match(render({ text: '<b>&', candidates: [{ name: 'A<B', text: 'b' }] }).svg, /A&lt;B/);
  for (const odd of [{}, null, { candidates: 'x', text: 5 }, { candidates: [null, { text: '' }, { name: 'n' }] }]) assert.ok(render(odd ?? {}).svg.startsWith('<svg'));
});
