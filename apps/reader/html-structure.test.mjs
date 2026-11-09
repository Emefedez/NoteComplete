import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Rows of buttons are written as `…</button` with the next one's line starting `><button`, so
// no space falls between them. A line left as `</button` with no `>` after it swallows the
// next tag (a `</div>`: the rest of the page ends up inside that row), and a `</button>`
// followed by a line starting `>` shows a stray ">". Both happened when buttons were moved.
test('chained buttons in index.html close every tag', () => {
  const lines = readFileSync(new URL('./index.html', import.meta.url), 'utf8').split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    const next = (lines[i + 1] ?? '').trimStart();
    if (/<\/(button|label|select|a|span)$/.test(line.trimEnd()) && !next.startsWith('>')) bad.push(`${i + 1}: unclosed end tag`);
    if (/<\/(button|label|select|a|span)>\s*$/.test(line) && /^>/.test(next)) bad.push(`${i + 2}: stray ">"`);
  });
  assert.deepEqual(bad, []);
});

// The main structure, read as a browser does (an end tag runs to the next ">", across lines):
// the tool bar and the navigation row are siblings, so neither is inside the other.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
function parents(html, marks) {
  const stack = [], found = {};
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, end, tag, attrs] = m;
    if (end) { const at = stack.map((s) => s.tag).lastIndexOf(tag.toLowerCase()); if (at >= 0) stack.length = at; continue; }
    for (const mark of marks) if (attrs.includes(mark)) found[mark] = stack.map((s) => s.tag + (s.id ? '#' + s.id : '')).join(' > ');
    if (!VOID.has(tag.toLowerCase()) && !/\/\s*$/.test(attrs)) stack.push({ tag: tag.toLowerCase(), id: /id="([^"]+)"/.exec(attrs)?.[1] });
  }
  return found;
}
test('the tool bar does not swallow the rows after it', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const found = parents(html, ['id="toolbar"', 'class="navigation"', 'class="workspace"']);
  assert.equal(found['class="navigation"'], found['id="toolbar"'], 'the navigation row beside the tool bar');
  assert.equal(found['class="workspace"'], found['id="toolbar"'], 'the workspace beside the tool bar');
});
