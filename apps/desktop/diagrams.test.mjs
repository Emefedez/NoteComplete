import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramRenderer, plantumlError, MAX_SOURCE } from './diagrams.js';

const tool = { binary: '/usr/bin/plantuml', env: {} };

test('draws in the document folder, or in an empty folder of its own', async () => {
  const calls = [];
  const diagrams = diagramRenderer({
    folderOf: async file => `/notes/${file.split('/').at(-2)}`,
    locate: async () => tool,
    run: async (found, text, folder) => { calls.push({ found, text, folder }); return { svg: '<svg/>' }; },
  });
  assert.deepEqual(await diagrams.plantuml('@startuml\nA -> B\n@enduml', '/notes/uml/a.puml'), { svg: '<svg/>' });
  assert.equal(calls[0].folder, '/notes/uml');
  assert.equal(calls[0].found, tool);
  await diagrams.plantuml('@startuml\n@enduml');
  assert.match(calls[1].folder, /notecomplete-uml-/);
});

test('a file not opened from this device is refused', async () => {
  const diagrams = diagramRenderer({
    folderOf: async () => { throw Error('That file was not opened from this device.'); },
    locate: async () => tool,
    run: async () => assert.fail('must not run'),
  });
  await assert.rejects(diagrams.plantuml('x', '/etc/a.puml'), /not opened/);
});

test('without PlantUML it says so and looks again next time', async () => {
  let looks = 0;
  const diagrams = diagramRenderer({ folderOf: async () => '/x', locate: async () => { looks++; return { binary: null, env: {} }; }, run: async () => assert.fail() });
  assert.deepEqual(await diagrams.plantuml('x'), { missing: true });
  await diagrams.plantuml('x');
  assert.equal(looks, 2);
});

test('refuses sources that are too large', async () => {
  const diagrams = diagramRenderer({ folderOf: async () => '/x', locate: async () => tool, run: async () => ({ svg: '' }) });
  await assert.rejects(diagrams.plantuml('a'.repeat(MAX_SOURCE + 1)), /too large/);
  await assert.rejects(diagrams.plantuml(42), /too large/);
});

test('PlantUML errors keep their own words', () => {
  assert.equal(plantumlError('ERROR\n3\nSyntax Error?\nSome diagram description contains errors\n'), 'ERROR\n3\nSyntax Error?');
  assert.equal(plantumlError(''), 'PlantUML could not draw this diagram.');
});
