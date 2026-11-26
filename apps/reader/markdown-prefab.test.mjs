import test from 'node:test';
import assert from 'node:assert/strict';
import { prefabMarkdown, markdownForOffice, PREFAB_LINE, MARKDOWN_TABLE, insertPrefabInto, prefabCommand } from './markdown-prefab.js';
import { extractPrefabSpecFromDataUri } from './chinese/zh-menu.js';
import { cards } from './prefab-registry.js';

const card = (id) => cards().find((c) => c.id === id);

test('every picture prefab goes into Markdown as one line that keeps its spec', async () => {
  for (const c of cards().filter((x) => x.spec && (x.kind === 'prefab' || x.kind === 'uml'))) {
    const md = await prefabMarkdown({ spec: c.spec });
    const m = md.trim().match(PREFAB_LINE);
    assert.ok(m, c.id);
    assert.ok(md.startsWith('\n\n') && md.endsWith('\n'), c.id);
    // Edit… opens the same figure again.
    if (c.id !== 'hanzi') assert.deepEqual(extractPrefabSpecFromDataUri(m[2], m[1]), c.spec, c.id);
  }
});

test('a UML class diagram keeps its name in the pill and its model for Edit…', async () => {
  const spec = card('uml-class').spec;
  const md = (await prefabMarkdown({ spec })).trim();
  const [, alt, uri] = md.match(PREFAB_LINE);
  assert.ok(alt.length > 0 && !/[[\]]/.test(alt));
  assert.ok(!uri.slice(uri.indexOf(',')).includes('(') && !uri.includes(')'));
  assert.equal(extractPrefabSpecFromDataUri(uri, alt).type, 'uml');
});

test('the Table card gives a Markdown table, nothing chosen gives nothing', async () => {
  assert.equal(await prefabMarkdown({ kind: 'table' }), `\n\n${MARKDOWN_TABLE}\n`);
  assert.equal(await prefabMarkdown(null), '');
  assert.equal(await prefabMarkdown({}), '');
});

test('markdownForOffice swaps prefab SVGs for PNGs, once per figure, and leaves the rest', async () => {
  const line = (await prefabMarkdown({ spec: card('histogram').spec })).trim();
  const [, alt, uri] = line.match(PREFAB_LINE);
  const md = `# Title\n\n${line}\n\ntext ![photo](img/a.png) and ${line}\n`;
  const drawn = [];
  const out = await markdownForOffice(md, async (u) => { drawn.push(u); return 'data:image/png;base64,AAAA'; });
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0], uri);
  assert.equal(out, `# Title\n\n![${alt}](data:image/png;base64,AAAA)\n\ntext ![photo](img/a.png) and ![${alt}](data:image/png;base64,AAAA)\n`);
  // A figure that cannot be drawn stays as it was; no prefab, no change.
  assert.equal(await markdownForOffice(md, async () => null), md);
  assert.equal(await markdownForOffice('plain', async () => { throw Error('not called'); }), 'plain');
});

test('insertPrefabInto pastes after the selection, at the caret kept before the picker', async () => {
  const pasted = [];
  const editor = {
    sel: { focus: { row: 1, col: 2 }, anchor: { row: 3, col: 0 } },
    getSelection(anchor) { return anchor ? this.sel.anchor : this.sel.focus; },
    getContent() { return 'a\nbb\n\nline three\nfour'; },
    paste(text, a, f) { pasted.push([text, a, f]); },
  };
  let after = 0;
  assert.equal(await insertPrefabInto(editor, async () => ({ kind: 'table' }), () => { after++; }), true);
  assert.deepEqual(pasted[0], [`\n\n${MARKDOWN_TABLE}\n`, { row: 3, col: 10 }, { row: 3, col: 10 }]);
  assert.equal(after, 1);
  // A right-click's place wins; a cancelled picker pastes nothing.
  await insertPrefabInto(editor, async () => ({ kind: 'table' }), () => {}, { row: 0, col: 0 });
  assert.deepEqual(pasted[1].slice(1), [{ row: 0, col: 1 }, { row: 0, col: 1 }]);
  await insertPrefabInto(editor, async () => ({ kind: 'table' }), () => {}, { row: 1, col: 0 });
  assert.equal(pasted.at(-1)[0], `\n\n${MARKDOWN_TABLE}`, 'a blank line follows bb');
  pasted.pop();
  // On an empty line: no blank lines before it.
  await insertPrefabInto(editor, async () => ({ kind: 'table' }), () => {}, { row: 2, col: 0 });
  assert.equal(pasted[2][0], `\n${MARKDOWN_TABLE}\n`, 'bb above: one blank line');
  assert.equal(await insertPrefabInto(editor, async () => null), false);
  assert.equal(pasted.length, 3);
  const cmd = prefabCommand(() => {});
  assert.equal(cmd.name, 'prefab');
  assert.match(cmd.innerHTML, /^<svg/);
});

test('svgUriSize reads a figure size from width/height or the viewBox', async () => {
  const { svgUriSize } = await import('./markdown-prefab.js');
  const uri = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  assert.deepEqual(svgUriSize(uri('<svg width="120" height="80px"></svg>')), [120, 80]);
  assert.deepEqual(svgUriSize(uri('<svg viewBox="0 0 640 360"></svg>')), [640, 360]);
  assert.equal(svgUriSize(uri('<svg></svg>')), null);
  const line = (await prefabMarkdown({ spec: card('uml-class').spec })).trim();
  assert.ok(svgUriSize(line.match(PREFAB_LINE)[2])?.every((n) => n > 0));
});
