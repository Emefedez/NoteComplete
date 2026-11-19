// Browser check of code highlighting (Chromium, after a web build): fenced code in a Markdown
// document is coloured by its language with a label and a copy button that copies; a .java
// file opened as a text document is coloured; its editor (code-highlight.js codeEditor) keeps
// colours while typing, Tab inserts four spaces, Enter keeps the indentation (one more after
// "{"), Shift+Tab outdents; Find still finds text in coloured code. Dark theme.
//   node tools/code_highlight_e2e.mjs [screenshots folder]
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium, startReader, openReader } from './e2e_common.mjs';

const MD = `# Sorting notes

Quicksort in Java:

\`\`\`java
public class Sort {
    // Sorts a[lo..hi] in place.
    static void quick(int[] a, int lo, int hi) {
        if (lo >= hi || hi < 0) return;
        String s = "pivot <b>";
    }
}
\`\`\`

And a shell line:

\`\`\`bash
for f in *.java; do javac "$f"; done # compile
\`\`\`

\`\`\`
no language here
\`\`\`
`;

const JAVA = `import java.util.List;

/** A small class. */
public class Hello {
    @Override
    public String toString() {
        return "Hello, " + 42;
    }
}
`;

const DIR = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : '';
if (DIR) mkdirSync(DIR, { recursive: true });
const server = await startReader();
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: 'dark' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  const p = await ctx.newPage();
  const errors = [], requests = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('request', (r) => { if (!r.url().startsWith(server.origin) && !/^(data|blob):/.test(r.url())) requests.push(r.url()); });
  p.on('dialog', (d) => d.accept());
  await openReader(p, server.origin);

  const open = async (name, text) => {
    await p.setInputFiles('#file', { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await p.waitForFunction((title) => !document.getElementById('textView').hidden && document.getElementById('textTitle').textContent.startsWith(title)
      && document.querySelector('#textBody')?.childNodes.length > 0, name.replace(/\.[^.]+$/, ''), { timeout: 20000 });
  };
  const color = (selector) => p.$eval(selector, (el) => getComputedStyle(el).color);

  // 1. A Markdown document: coloured fences, labels, copy.
  await open('Sorting.md', MD);
  await p.waitForSelector('#textBody pre.code-block code.code-highlighted');
  const blocks = await p.$$eval('#textBody pre.code-block', (pres) => pres.map((pre) => ({
    lang: pre.dataset.lang || '', label: getComputedStyle(pre, '::before').content, copy: !!pre.querySelector(':scope > .code-copy'),
    kinds: [...new Set([...pre.querySelectorAll('[class^="tk-"]')].map((s) => s.className))].sort(),
  })));
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].lang, 'Java');
  assert.equal(blocks[0].label, '"Java"');
  for (const k of ['tk-com', 'tk-fn', 'tk-kw', 'tk-num', 'tk-op', 'tk-str', 'tk-type']) assert.ok(blocks[0].kinds.includes(k), `java block has ${k}: ${blocks[0].kinds}`);
  assert.equal(blocks[1].lang, 'Shell');
  for (const k of ['tk-com', 'tk-fn', 'tk-kw', 'tk-str']) assert.ok(blocks[1].kinds.includes(k), `bash block has ${k}`);
  assert.equal(blocks[2].lang, '', 'a block without a language has no label');
  assert.deepEqual(blocks[2].kinds, []);
  assert.ok(blocks.every((x) => x.copy), 'every block has a copy button');
  // Code stays text: the <b> in the Java string is not an element.
  assert.equal(await p.$$eval('#textBody pre b', (x) => x.length), 0);
  assert.match(await p.textContent('#textBody pre.code-block code'), /"pivot <b>"/);
  // Distinct colours, readable in the dark theme.
  const kw = await color('#textBody pre.code-block .tk-kw'), str = await color('#textBody pre.code-block .tk-str'), com = await color('#textBody pre.code-block .tk-com');
  assert.notEqual(kw, str);
  assert.notEqual(str, com);
  assert.equal(kw, 'rgb(209, 151, 232)', 'dark keyword colour');
  // The label and the button add no text: Find sees only the code.
  assert.ok(!(await p.textContent('#textBody')).includes('Java\npublic'));
  if (DIR) await p.screenshot({ path: DIR + 'markdown-code.png' });
  await p.hover('#textBody pre.code-block');
  await p.click('#textBody pre.code-block > .code-copy');
  await p.waitForSelector('#textBody pre.code-block > .code-copy.copied');
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.startsWith('public class Sort {\n    // Sorts a[lo..hi] in place.'), copied);
  assert.ok(copied.endsWith('}') && !copied.endsWith('\n'));
  console.log('· Markdown: java and bash fences coloured, labelled, copy works; no label for plain fences');

  // 2. A .java file as a text document: coloured.
  await open('Hello.java', JAVA);
  await p.waitForSelector('#textBody.text-code .tk-kw');
  assert.equal(await p.getAttribute('#textBody', 'data-lang'), 'java');
  const kinds = await p.$$eval('#textBody [class^="tk-"]', (s) => [...new Set(s.map((x) => x.className))].sort());
  for (const k of ['tk-anno', 'tk-com', 'tk-fn', 'tk-kw', 'tk-num', 'tk-str', 'tk-type']) assert.ok(kinds.includes(k), `java doc has ${k}`);
  assert.equal(await p.textContent('#textBody'), JAVA);
  // Find (Ctrl F) still finds words split across coloured spans.
  await p.click('#textBody');
  await p.keyboard.press('Control+f');
  await p.waitForSelector('#textFindBar:not([hidden])');
  await p.fill('#textFindInput', 'String toString');
  await p.waitForFunction(() => /1 of 1/.test(document.getElementById('textFindCount').textContent));
  await p.keyboard.press('Escape');
  if (DIR) await p.screenshot({ path: DIR + 'java-document.png' });
  console.log('· a .java text document is coloured, and Find works across its tokens');

  // 3. Editing it: the code editor.
  await p.click('#textEdit');
  await p.waitForSelector('#textEditor .code-editor textarea.doc-editor-plain');
  const area = '#textEditor .code-editor textarea';
  // Caret at the end of "public String toString() {" (line 6), then Enter: one level more.
  await p.$eval(area, (ta) => { const at = ta.value.indexOf('toString() {') + 'toString() {'.length; ta.focus(); ta.setSelectionRange(at, at); });
  await p.keyboard.press('Enter');
  await p.keyboard.type('int x = 1;');
  let value = await p.inputValue(area);
  assert.match(value, /toString\(\) \{\n {8}int x = 1;\n {8}return/, 'Enter after { indents one level more');
  // Enter again keeps the indentation; Tab inserts four spaces; Shift+Tab takes them away.
  await p.keyboard.press('Enter');
  await p.keyboard.press('Tab');
  await p.keyboard.type('y();');
  value = await p.inputValue(area);
  assert.match(value, /int x = 1;\n {12}y\(\);\n/, 'Enter keeps 8 spaces, Tab adds 4');
  await p.keyboard.press('Shift+Tab');
  value = await p.inputValue(area);
  assert.match(value, /int x = 1;\n {8}y\(\);\n/, 'Shift+Tab outdents');
  // Brackets close themselves, and typing the closer steps over it.
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.keyboard.type('f(');
  assert.match(await p.inputValue(area), /\n {8}f\(\)\n/);
  await p.keyboard.type('2)');
  assert.match(await p.inputValue(area), /\n {8}f\(2\)\n/);
  // Undo works on these edits (they go through the browser's own editing).
  await p.keyboard.press('Control+z');
  // The backdrop follows: the new words are coloured behind the textarea.
  await p.waitForFunction(() => [...document.querySelectorAll('#textEditor .code-editor-back .tk-fn')].some((s) => s.textContent === 'y'));
  const sameText = await p.$eval('#textEditor .code-editor', (w) => w.querySelector('.code-editor-back').textContent.replace(/ $/, '') === w.querySelector('textarea').value);
  assert.ok(sameText, 'the coloured copy matches the text');
  // Its metrics match: the textarea's first line and the copy's first line start at the same place.
  const offsets = await p.$eval('#textEditor .code-editor', (w) => {
    const ta = w.querySelector('textarea'), code = w.querySelector('.code-editor-text');
    const a = getComputedStyle(ta), c = getComputedStyle(w.querySelector('.code-editor-back'));
    return [a.paddingLeft, c.paddingLeft, a.paddingTop, c.paddingTop, a.fontSize, c.fontSize, a.lineHeight, c.lineHeight, code.getBoundingClientRect().left - w.getBoundingClientRect().left];
  });
  assert.equal(offsets[0], offsets[1]); assert.equal(offsets[2], offsets[3]); assert.equal(offsets[4], offsets[5]); assert.equal(offsets[6], offsets[7]);
  // Scrolling moves the coloured copy with the text.
  await p.$eval(area, (ta) => { ta.value += '\n'.repeat(200) + '// end'; ta.dispatchEvent(new Event('input')); ta.scrollTop = 300; ta.dispatchEvent(new Event('scroll')); });
  assert.match(await p.$eval('#textEditor .code-editor-text', (c) => c.style.transform), /translate\(.*-300px\)/);
  await p.$eval(area, (ta) => { ta.scrollTop = 0; ta.dispatchEvent(new Event('scroll')); });
  if (DIR) await p.screenshot({ path: DIR + 'java-editor.png' });
  // Leaving Edit shows the coloured document again, with the edits.
  await p.click('#textEdit');
  await p.waitForSelector('#textBody.text-code .tk-kw');
  assert.match(await p.textContent('#textBody'), /int x = 1;/);
  assert.equal(await p.$$eval('#textEditor .code-editor', (x) => x.length), 0, 'the editor is gone');
  console.log('· the code editor: Enter keeps/adds indentation, Tab/Shift+Tab, auto-closing brackets, colours follow typing and scrolling');

  // (The app's own Google sign-in script aside.)
  assert.deepEqual(requests.filter((u) => !u.startsWith('https://accounts.google.com/')), [], 'nothing is fetched from the network');
  assert.deepEqual(errors, []);
  console.log('code highlight e2e: ok');
} finally {
  await b.close();
  await server.stop();
}
