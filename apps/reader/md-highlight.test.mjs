import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { findHighlights, findMarkdownHighlights, highlightStyle, highlightElement, stripHighlights, wrapHighlight, highlightAt, tinyMdeHighlightGrammar } from './md-highlight.js';
import { plainText } from './rich-text.js';

const texts = (s) => findHighlights(s).map((h) => [h.tag, h.text]);

test('==text== and =={tag}text== are found with their tags', () => {
  assert.deepEqual(texts('a ==plain== and =={pink}coloured words== then =={_blue}under== =={.red}(a remark)=='), [['', 'plain'], ['pink', 'coloured words'], ['_blue', 'under'], ['.red', '(a remark)']]);
  const [h] = findHighlights('x =={mint}y== z');
  assert.deepEqual([h.start, h.from, h.to, h.end], [2, 10, 11, 13]);
});

test('what is not a highlight stays text', () => {
  for (const s of ['a == b', 'if (x == y) and (y == z)', '=== heading ===', 'a ==b ==', 'a == b==', '\\==not==', '====', '==\n\nsplit==', 'x === y === z']) {
    assert.deepEqual(findHighlights(s), [], s);
  }
  // One character, and a closer right before a word.
  assert.deepEqual(texts('==a==b'), [['', 'a']]);
  // A tag that is not a tag is part of the text.
  assert.deepEqual(texts('=={not a tag}x=='), [['', '{not a tag}x']]);
});

test('Markdown code is left alone, positions are the text\'s', () => {
  const md = 'one ==two==\n```\n==code==\n```\n`==inline==` and =={pink}three==';
  const found = findMarkdownHighlights(md);
  assert.deepEqual(found.map((h) => h.text), ['two', 'three']);
  assert.equal(md.slice(found[1].from, found[1].to), 'three');
  assert.equal(stripHighlights(md), 'one two\n```\n==code==\n```\n`==inline==` and three');
});

test('tags: colours, other names, hex, underline, text colour, unknown', () => {
  assert.equal(highlightStyle('').colour, '#fff169');
  assert.equal(highlightStyle('green').colour, highlightStyle('mint').colour);
  assert.equal(highlightStyle('sky').colour, highlightStyle('blue').colour);
  assert.deepEqual(highlightStyle('#ABC'), { colour: '#aabbcc', strong: '#aabbcc', underline: false, text: false, known: true });
  const u = highlightStyle('_pink');
  assert.equal(u.underline, true);
  assert.notEqual(u.strong, u.colour);
  const t = highlightStyle('.red');
  assert.deepEqual([t.text, t.strong], [true, '#d92d20']);
  assert.deepEqual([highlightStyle('nonsense').colour, highlightStyle('nonsense').known], ['#fff169', false]);
});

test('wrapping keeps spaces outside, and highlightAt finds the one at a column', () => {
  assert.equal(wrapHighlight(' library member ', 'pink'), ' =={pink}library member== ');
  assert.equal(wrapHighlight('NO es una clase', '.red'), '=={.red}NO es una clase==');
  assert.equal(wrapHighlight('word'), '==word==');
  assert.equal(wrapHighlight('word', 'bad tag!'), '==word==');
  assert.equal(highlightAt('a =={pink}bc== d', 6).text, 'bc');
  assert.equal(highlightAt('a =={pink}bc== d', 0), null);
});

test('plain text for text boxes drops the delimiters', () => {
  assert.equal(plainText('**Key**: =={pink}this== and ==that=='), 'Key: this and that');
});

test('the editor grammar marks highlights and leaves == comparisons', () => {
  const g = tinyMdeHighlightGrammar();
  assert.equal(g.highlightTagged.regexp.exec('=={pink}two words== rest')[4], 'two words');
  assert.equal(g.highlightTagged.regexp.exec('=={.red}remark==')[2], '.red');
  assert.equal(g.highlightPlain.regexp.exec('==word== x')[2], 'word');
  assert.equal(g.highlightPlain.regexp.exec('== spaced =='), null);
  assert.equal(g.highlightPlain.regexp.exec('===x==='), null);
  // TinyMDE's own rules are kept.
  assert.equal(g.default, undefined);
});

// The DOM pass on HTML as the core renders it (xmldom here, the browser in the app).
const parse = (html) => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/xml').documentElement;
const serialize = (el) => new XMLSerializer().serializeToString(el).replace(/^<div>|<\/div>$/g, '');
const marked = (html) => serialize(highlightElement(parse(html)));

test('rendered Markdown: highlights become <mark>, also around other inline elements', () => {
  assert.equal(marked('<p>a ==b== c</p>'), '<p>a <mark class="md-hl" style="--hl: #fff169; --hl-strong: #c99700">b</mark> c</p>');
  assert.equal(marked('<p>=={_blue}x==</p>'), '<p><mark class="md-hl md-ul" data-hl="_blue" style="--hl: #9ed6ff; --hl-strong: #2c7fd6">x</mark></p>');
  assert.equal(marked('<p>=={mint}a <strong>big</strong> book== now</p>'), '<p><mark class="md-hl" data-hl="mint" style="--hl: #99edc7; --hl-strong: #1e9a66">a <strong>big</strong> book</mark> now</p>');
  assert.equal(marked('<p>=={.red}(NO es una clase)==</p>'), '<p><mark class="md-hl md-tc" data-hl=".red" style="--hl: #ffb0a8; --hl-strong: #d92d20">(NO es una clase)</mark></p>');
  assert.equal(marked('<p><em>==in==</em> and ==two== ==three==</p>').match(/<mark/g).length, 3);
  // Code and maths keep their text.
  assert.equal(marked('<p><code>==x==</code></p><pre><code>==y==</code></pre><span class="math math-inline">a==b</span>'), '<p><code>==x==</code></p><pre><code>==y==</code></pre><span class="math math-inline">a==b</span>');
});

test('notes without highlights render exactly as before', async () => {
  const { default: init, markdown_html } = await import('./pkg/noteful_wasm.js');
  await init({ module_or_path: readFileSync(new URL('./pkg/noteful_wasm_bg.wasm', import.meta.url)) });
  const docs = new URL('../../docs/', import.meta.url);
  let checked = 0;
  for (const name of readdirSync(docs).filter((n) => n.endsWith('.md'))) {
    const md = readFileSync(new URL(name, docs), 'utf8');
    if (findMarkdownHighlights(md).length) continue;
    const html = markdown_html(md);
    let root;
    try { root = parse(html); } catch { continue; }
    if (!root || root.localName !== 'div') continue;
    const before = serialize(root);
    assert.equal(serialize(highlightElement(root)), before, name);
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} documents could be checked`);
  // And the comparisons a note may hold.
  const html = markdown_html('If `a == b` then x == y, and ====\n\n| a | b |\n|---|---|\n| == | x==y |');
  assert.equal(serialize(highlightElement(parse(html))), serialize(parse(html)));
});
