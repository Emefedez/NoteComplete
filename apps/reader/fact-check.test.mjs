import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { factCheckPrompt, cleanFindings, findingsMarkdown, referenceText } from './fact-check.js';

test('the request names the pages, asks for every page once, and carries the other pages for consistency', () => {
  const prompt = factCheckPrompt({ title: 'Memoria', language: 'Spanish', pages: [0, 1], reference: '[Page 7]\nLa caché es lenta' });
  assert.match(prompt, /: 1, 2\./);
  assert.match(prompt, /Every page in the list must appear once/);
  assert.match(prompt, /Write in Spanish/);
  assert.match(prompt, /For consistency[\s\S]*\[Page 7\]/);
  assert.doesNotMatch(factCheckPrompt({ title: 'x', pages: [0] }), /For consistency/);
  assert.match(factCheckPrompt({ title: 'x', pages: [2], unit: 'section' }), /numbered sections/);
});

test('findings keep only the pages asked, with sane fields; pages with nothing stay listed', () => {
  const value = { pages: [
    { page: 2, issues: [{ kind: 'error', quote: ' 2+2=5 ', problem: 'Arithmetic', correction: '2+2=4', confidence: 'high' }, { kind: 'weird', problem: 'Kind unknown' }, { kind: 'unclear' }] },
    { page: 3, issues: [{ kind: 'inconsistency', problem: 'Disagrees', correction: 'Use 4 KB', related: 2 }] },
    { page: 9, issues: [{ kind: 'error', problem: 'Not asked' }] },
  ] };
  const found = cleanFindings(value, [0, 1, 2]);
  assert.deepEqual(found.map(f => [f.page, f.issues.length]), [[1, 0], [2, 2], [3, 1]]);
  assert.equal(found[1].issues[0].quote, '2+2=5');
  assert.equal(found[1].issues[1].kind, 'error', 'an unknown kind counts as an error');
  assert.equal(found[2].issues[0].related, 2);
  assert.deepEqual(cleanFindings(null, [0]), [{ page: 1, issues: [] }]);
});

test('the notes get a heading, a page badge per page with findings, corrections, and the clean pages', () => {
  const md = findingsMarkdown([
    { page: 3, issues: [{ kind: 'inconsistency', quote: 'páginas de 8 KB', problem: 'Page 2 says 4 KB', correction: 'Páginas de 4 KB', related: 2, confidence: 'high' }] },
    { page: 1, issues: [] },
    { page: 2, issues: [{ kind: 'error', quote: '2+2=5', problem: 'Arithmetic', correction: '2+2=4', related: null, confidence: 'low' }] },
  ], { provider: 'Claude Code', date: new Date(2026, 10, 3) });
  assert.match(md, /^## AI fact check · .*2026 · p\. 1–3\n_Suggestions by Claude Code/);
  assert.ok(md.indexOf('<!-- page 2 -->') < md.indexOf('<!-- page 3 -->'), 'in page order');
  assert.match(md, /<!-- page 2 -->\n- ❌ \*\*Error:\*\* “2\+2=5” — Arithmetic _\(unsure\)_\n  - \*\*Correction:\*\* 2\+2=4/);
  assert.match(md, /- ⚠️ \*\*Inconsistency with p\. 2:\*\* “páginas de 8 KB” — Page 2 says 4 KB/);
  assert.match(md, /✅ Nothing to correct on p\. 1\.$/);
  assert.doesNotMatch(md, /<!-- page 1 -->/);
  // Text documents: sections, without page markers.
  const sections = findingsMarkdown([{ page: 4, issues: [{ kind: 'missing', quote: '', problem: 'No units', correction: 'Add ms', related: null, confidence: 'medium' }] }], { unit: 'section' });
  assert.match(sections, /\*\*§ 4\*\*\n- ➕ \*\*Missing:\*\* — No units/);
  assert.doesNotMatch(sections, /<!--/);
});

test('the reference text is shared out between pages and capped', () => {
  const ref = referenceText(Array.from({ length: 10 }, (_, i) => ({ label: `Page ${i + 1}`, text: 'x'.repeat(10000) })), 20000);
  assert.ok(ref.length <= 20000);
  assert.match(ref, /\[Page 10\]/, 'every page gets a share');
  assert.equal(referenceText([{ label: 'Page 1', text: '  ' }]), '');
});
