import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle,
  extractFileBytes,
  extractHtmlText,
  formatSourceBundle,
  isSupportedSourceName,
  parsePageRange,
  resolveSources,
} from './source-extract.js';

test('parsePageRange handles blank, single pages and clamped inverted ranges', () => {
  assert.deepEqual(parsePageRange('', 4), [0, 1, 2, 3]);
  assert.deepEqual(parsePageRange('2, 4-3, 99', 5), [1, 2, 3, 4]);
  assert.deepEqual(parsePageRange('1-2', 0), []);
});

test('isSupportedSourceName filters hidden files and binaries while keeping archives, HTML, PDFs, Office, images and code', () => {
  assert.equal(isSupportedSourceName('Examen.html'), true);
  assert.equal(isSupportedSourceName('Tema_1.noteful'), true);
  assert.equal(isSupportedSourceName('Resumen.nfedit'), true);
  assert.equal(isSupportedSourceName('slides.pdf'), true);
  assert.equal(isSupportedSourceName('notes.md'), true);
  assert.equal(isSupportedSourceName('diagram.png'), true);
  assert.equal(isSupportedSourceName('.DS_Store'), false);
  assert.equal(isSupportedSourceName('video.mp4'), false);
  assert.equal(cleanTitle('Tema_1_ACII.pdf'), 'Tema 1 ACII');
});

test('extractHtmlText strips scripts and styles cleanly while preserving structure', async () => {
  const html = `<!doctype html><html><head><style>body{color:red}</style><script>alert(1)</script></head><body><h1>Cache MESI</h1><p>Modified state owns the line.</p></body></html>`;
  const text = await extractHtmlText(html);
  assert.match(text, /Cache MESI/);
  assert.match(text, /Modified state owns the line/);
  assert.doesNotMatch(text, /alert\(1\)|color:red/);
});

test('extractFileBytes reads text, HTML, images and archives via worker call', async () => {
  const md = await extractFileBytes('tema.md', new TextEncoder().encode('# Pipeline\n5 stages'));
  assert.equal(md.title, 'tema');
  assert.match(md.text, /5 stages/);

  const png = await extractFileBytes('fig.png', new Uint8Array([1, 2, 3]));
  assert.equal(png.images.length, 1);
  assert.equal(png.images[0].type, 'image/png');

  const note = await extractFileBytes('apuntes.nfedit', new TextEncoder().encode('{}'), {
    call: async (op) => {
      if (op === 'extractNoteSummary') {
        return {
          title: 'ACII T1',
          page_count: 1,
          markdown: 'Key takeaway',
          pages: [{ page: 1, typed: 'RISC-V hazards', recognized: '', ink: '', pdf_background: null }],
          pdf_ids: [],
        };
      }
      throw Error(`unexpected ${op}`);
    },
  });
  assert.equal(note.title, 'ACII T1');
  assert.match(note.text, /Key takeaway/);
  assert.match(note.text, /RISC-V hazards/);
});

test('resolveSources expands entire folders cleanly and formatSourceBundle distributes budget fairly', async () => {
  const fakeLibrary = {
    async open(entry) {
      if (entry.name === 'a.md') return new File(['# Topic A\nAlpha content'], 'a.md');
      if (entry.name === 'b.html') return new File(['<h2>Topic B</h2><p>Beta content</p>'], 'b.html');
      return null;
    },
  };
  const fakeGroups = {
    async members() {
      return [
        { key: 'local:/dir/a.md', name: 'a.md', source: 'local', path: '/dir/a.md' },
        { key: 'local:/dir/b.html', name: 'b.html', source: 'local', path: '/dir/b.html' },
        { key: 'web:https://example.com', name: 'link', source: 'web' },
        { key: 'local:/dir/ignore.bin', name: 'ignore.zip', source: 'local' },
      ];
    },
  };
  const resolved = await resolveSources(
    [
      { id: 'group:1', kind: 'group', group: { id: '1', name: 'TEMARIO' } },
      { id: 'topic:1', kind: 'topic', label: 'Interrupts', text: 'Nested vector interrupt controller' },
      { id: 'topic:2', kind: 'topic', label: 'Structured', text: { markdown: 'Pipeline forwarding', pages: [{ typed: 'Hazard unit' }] } },
    ],
    { library: fakeLibrary, groups: fakeGroups },
  );
  assert.equal(resolved.length, 4);
  const bundled = formatSourceBundle(resolved);
  assert.match(bundled.promptText, /SOURCE: a \(TEMARIO\)/);
  assert.match(bundled.promptText, /Beta content/);
  assert.match(bundled.promptText, /Nested vector interrupt controller/);
  assert.match(bundled.promptText, /Pipeline forwarding/);
});
