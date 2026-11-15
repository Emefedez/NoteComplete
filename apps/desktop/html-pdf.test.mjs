import test from 'node:test';
import assert from 'node:assert/strict';
import { A4_UNITS, PAGINATE_AND_MEASURE_SCRIPT, renderHtmlToPdfWithTapes, tapeLinesFromNormalized } from './html-pdf.js';

test('tapeLinesFromNormalized scales normalized coordinates to Noteful A4 units and distinguishes colors', () => {
  const lines = tapeLinesFromNormalized([
    { page: 0, rx: 0.1, ry: 0.25, rw: 0.8, rh: 0.1, kind: 'solution' },
    { page: 1, rx: 0.05, ry: 0.5, rw: 0.9, rh: 0.08, kind: 'theory' },
    { page: -1, rx: 0, ry: 0, rw: 0.5, rh: 0.1, kind: 'solution' },
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].page, 0);
  assert.ok(lines[0].x < 0.1 * A4_UNITS[0]);
  assert.ok(lines[0].w > 0.8 * A4_UNITS[0]);
  assert.notDeepEqual(lines[0].rgba, lines[1].rgba);
});

test('renderHtmlToPdfWithTapes loads data HTML, measures tapes, prints PDF and destroys window', async () => {
  let destroyed = false;
  let loadedUrl = '';
  let executedScript = '';
  let printedOptions = null;
  class FakeWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        async loadURL(url) { loadedUrl = url; },
        async executeJavaScript(script) {
          executedScript = script;
          return {
            pageCount: 2,
            tapes: [{ page: 0, rx: 0.1, ry: 0.2, rw: 0.7, rh: 0.09, kind: 'solution' }],
          };
        },
        async printToPDF(opts) {
          printedOptions = opts;
          return Buffer.from('%PDF-1.4\n%%EOF\n');
        },
      };
    }
    isDestroyed() { return destroyed; }
    destroy() { destroyed = true; }
  }
  const result = await renderHtmlToPdfWithTapes({ BrowserWindow: FakeWindow, html: '<html><body>Hi</body></html>' });
  assert.ok(destroyed);
  assert.ok(loadedUrl.startsWith('data:text/html;charset=utf-8,'));
  assert.equal(executedScript, PAGINATE_AND_MEASURE_SCRIPT);
  assert.equal(printedOptions.preferCSSPageSize, true);
  assert.equal(printedOptions.printBackground, true);
  assert.equal(result.pageCount, 2);
  assert.equal(result.sizes.length, 2);
  assert.equal(result.tapes.length, 1);
  assert.equal(new TextDecoder().decode(result.pdf), '%PDF-1.4\n%%EOF\n');
});
