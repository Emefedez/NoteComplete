import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.equal(
    resolveAiLink('Prefab Ejercicio 1 - Planificación.noteful', 'file:///home/m1-max/Documents/NoteComplete/ink/Prefab%20Ejercicio%201%20-%20Planificaci%C3%B3n.noteful').localFile,
    '/home/m1-max/Documents/NoteComplete/ink/Prefab Ejercicio 1 - Planificación.noteful',
  );
  assert.deepEqual(
    resolveAiLink('Resumen T1+T3.noteful', '/home/m1-max/Documents/NoteComplete/Resumen T1+T3.noteful#page=6'),
    {
      href: '/home/m1-max/Documents/NoteComplete/Resumen T1+T3.noteful#page=6',
      localFile: '/home/m1-max/Documents/NoteComplete/Resumen T1+T3.noteful',
      page: 6,
    },
  );
  assert.deepEqual(
    resolveAiLink('Manual.pdf', 'file:///tmp/Manual%20(1).pdf#page=10'),
    {
      href: 'file:///tmp/Manual%20(1).pdf#page=10',
      localFile: '/tmp/Manual (1).pdf',
      page: 10,
    },
  );
});

test('local file links in AI answers survive markdown_html sanitization', async () => {
  const { default: init, markdown_html } = await import('./pkg/noteful_wasm.js');
  await init({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });
  const md = [
    '[Resumen](file:///home/m1-max/Documents/NoteComplete/Resumen%20T1+T3.noteful)',
    '[Page 6](/home/m1-max/Documents/NoteComplete/Tema 3 (12oD0v).noteful#page=6)',
    '[Web](https://example.com/docs)',
  ].join(' · ');
  const html = markdown_html(normalizeMarkdown(md));
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(hrefs.length, 3);
  assert.equal(resolveAiLink('Resumen', hrefs[0]).localFile, '/home/m1-max/Documents/NoteComplete/Resumen T1+T3.noteful');
  assert.deepEqual(resolveAiLink('Page 6', hrefs[1]), {
    href: hrefs[1],
    localFile: '/home/m1-max/Documents/NoteComplete/Tema 3 (12oD0v).noteful',
    page: 6,
  });
  assert.equal(resolveAiLink('Web', hrefs[2]).external, true);
});
