import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiagramName, isTextName, TEXT_NAME } from './text-types.js';
import { diagramMessage } from './text-view.js';

test('PlantUML files open as text documents that can be drawn', () => {
  for (const name of ['clases.puml', 'a.PlantUML', 'b.pu', 'estilo.iuml', 'c.wsd']) {
    assert.ok(isDiagramName(name), name);
    assert.ok(isTextName(name), name);
    assert.ok(TEXT_NAME.test(name), name);
  }
  assert.ok(!isDiagramName('notes.md'));
  assert.ok(!isDiagramName('puml'));
});

test('the Diagram view explains why it shows the source', () => {
  assert.match(diagramMessage({ unavailable: true }), /desktop app/);
  assert.match(diagramMessage({ missing: true }), /not installed/);
  assert.match(diagramMessage({ failed: 'PlantUML took too long' }), /could not draw.*too long/);
  assert.match(diagramMessage({ svg: '<svg/>', error: 'Syntax Error?' }), /problem: Syntax Error\?/);
  assert.equal(diagramMessage({ svg: '<svg/>' }), '');
});
