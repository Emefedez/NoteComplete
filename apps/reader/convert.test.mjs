import test from 'node:test';
import assert from 'node:assert/strict';
import { optionsFrom, LOOK_FIELDS, SAMPLE, CHEATSHEET, aiPrompt, aiEnrichPrompt, answerMarkdown, titleOf } from './convert.js';

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

test("making your Markdown richer keeps its content and asks for the dialect's means", () => {
  const prompt = aiEnrichPrompt({ markdown: "# Tema 2\n<!-- page 3 -->\n- uno", dialect: "DIALECT-TEXT" });
  assert.match(prompt, /Keep every fact/);
  assert.match(prompt, /==highlights==/);
  assert.match(prompt, /!draw/);
  assert.match(prompt, /<!-- page N -->/);
  assert.ok(prompt.endsWith("The note:\n# Tema 2\n<!-- page 3 -->\n- uno"));
});

test("interactive Markdown cheatsheet groups headings, emphasis and layout/SVG snippets", () => {
  assert.ok(CHEATSHEET.length >= 3);
  const codes = CHEATSHEET.flatMap((g) => g.items.map((i) => i.code));
  assert.ok(codes.some((c) => c.includes("!draw")));
  assert.ok(codes.some((c) => c.includes("=={pink}")));
  assert.ok(codes.some((c) => c.includes("\\pagebreak")));
});

test("New note with AI: documents, length, focus, level, language and instructions reach the prompt", () => {
  const prompt = aiPrompt({ request: "", dialect: "D", documents: "=== SOURCE: tema 1 ===\nla sístole", length: "detailed", focus: "formulas", level: "intro", language: "Spanish", diagrams: false, strict: true, instructions: " mnemonics " });
  assert.match(prompt, /three to five pages/);
  assert.match(prompt, /formulas, rules and methods/);
  assert.match(prompt, /beginner/);
  assert.match(prompt, /Write every word in Spanish/);
  assert.match(prompt, /do not add !draw diagrams/);
  assert.match(prompt, /Use only what the documents below say/);
  assert.match(prompt, /instructions \(follow them\):\nmnemonics/);
  assert.match(prompt, /The documents:\n=== SOURCE: tema 1 ===\nla sístole\n\nThe request:\nA study note that covers the documents above\.$/);
  // Without the options it asks what it always asked (Take notes with AI relies on it).
  const plain = aiPrompt({ request: "x", dialect: "D" });
  assert.doesNotMatch(plain, /documents|instructions/);
  assert.match(plain, /one or two pages/);
  assert.match(plain, /Write in the language of the request/);
});
