import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.document = { createElement: () => ({}) };
const { normalizeMarkdown, resolveAiLink } = await import('./rich-text.js');
test('LaTeX delimiters become dollars, code is left alone', () => {
  assert.equal(normalizeMarkdown('a \\(x^2\\) `\\(y\\)`'), 'a $x^2$ `\\(y\\)`');
  assert.match(normalizeMarkdown('\\[\nE=mc^2\n\\]'), /^\$\$\nE=mc\^2\n\$\$$/);
  assert.equal(normalizeMarkdown('$ a_1 $'), '$a_1$');
});
test('links to pages, images and the web are recognised', () => {
  assert.equal(resolveAiLink('p. 3', '#page-3').page, 3);
  assert.equal(resolveAiLink('page 5', '#').page, 5);
  assert.equal(resolveAiLink('x', 'https://a.b/c').external, true);
  assert.equal(resolveAiLink('x', '01-page-2.jpg').page, 2);
  assert.equal(resolveAiLink('x', 'region-1.png').aiFile, 'region-1');
});
