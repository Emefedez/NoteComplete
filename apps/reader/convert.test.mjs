import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsFrom, LOOK_FIELDS, SAMPLE, aiPrompt, answerMarkdown, titleOf } from './convert.js';

test('only known look options reach the core, and defaults are left out', () => {
  assert.deepEqual(optionsFrom({ look: 'classic', theme: 'dark', paper: 'ruled', hand: '', pen: 'ballpoint', size: '13' }), { look: 'classic', theme: 'dark', paper: 'ruled', pen: 'ballpoint', size: 13 });
  assert.deepEqual(optionsFrom({ look: '<script>', paper: 'lava', size: '11' }), {});
  assert.deepEqual(optionsFrom({ size: '200' }), {});
  for (const [key, options] of Object.entries(LOOK_FIELDS)) assert.ok(options.length > 1, key);
  assert.match(SAMPLE, /^# /);
});

test("the AI is asked for handwriting Markdown only, about the request, in the chosen look", () => {
  const prompt = aiPrompt({ request: "  el ciclo cardíaco, primer curso  ", dialect: "DIALECT-TEXT", look: "classic" });
  assert.match(prompt, /Markdown only/);
  assert.match(prompt, /classic/);
  assert.match(prompt, /DIALECT-TEXT/);
  assert.ok(prompt.endsWith("The request:\nel ciclo cardíaco, primer curso"));
  assert.match(prompt, /\\pagebreak/);
});

test("answers lose code fences; the note is named after its first heading", () => {
  assert.equal(answerMarkdown("```markdown\n# TEMA\n- a\n```\n"), "# TEMA\n- a");
  assert.equal(answerMarkdown("# TEMA\n- a\n"), "# TEMA\n- a");
  assert.equal(titleOf("_sub_\n# THE **CARDIAC** CYCLE :heart:\n## x"), "THE CARDIAC CYCLE");
  assert.equal(titleOf("# SOLAR & TERRESTRIAL // RADIATION"), "SOLAR & TERRESTRIAL RADIATION");
  assert.equal(titleOf("no heading"), "");
});
