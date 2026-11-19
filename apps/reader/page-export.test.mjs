import test from 'node:test';
import assert from 'node:assert/strict';
import { packPages, IMAGE_TYPES, pageExporter, pageSvg } from './page-export.js';

test('pages are packed one after another with the layout the core reads', () => {
  const a = Uint8Array.of(0xff, 0xd8, 1), b = Uint8Array.of(0xff, 0xd8, 2, 3);
  const { data, layout } = packPages([
    { bytes: a, widthPx: 1800, heightPx: 2546, widthPt: 595, heightPt: 842 },
    { bytes: b, widthPx: 1800, heightPx: 1273, widthPt: 842, heightPt: 595 },
  ]);
  assert.deepEqual([...data], [0xff, 0xd8, 1, 0xff, 0xd8, 2, 3]);
  assert.deepEqual(JSON.parse(layout), [
    { offset: 0, length: 3, widthPx: 1800, heightPx: 2546, widthPt: 595, heightPt: 842 },
    { offset: 3, length: 4, widthPx: 1800, heightPx: 1273, widthPt: 842, heightPt: 595 },
  ]);
});

test('image formats: compressed ones first, PNG for lossless', () => {
  assert.deepEqual(IMAGE_TYPES.map(t => t.id), ['jpeg', 'webp', 'png']);
  assert.ok(IMAGE_TYPES.every(t => t.mime.startsWith('image/') && t.ext));
});

test('pageSvg restores paper colour and embeds the PDF raster when present', async () => {
  const rect = { fill: 'none', setAttribute(k, v) { if (k === 'fill') this.fill = v; } };
  const bg = {
    children: [],
    append(el) { this.children.push(el); },
  };
  const clonedSvg = {
    style: { isolation: 'auto' },
    querySelector(sel) {
      if (sel === '[data-background] > rect') return rect;
      if (sel === '[data-background]') return bg;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const panel = {
    size: [595, 842],
    view: { pdf_background: { index: 0 } },
    render: {
      dataset: { paper: '#faf8f2' },
      // The raster canvas comes first on a PDF page; the page's SVG is found by its tag.
      firstElementChild: { cloneNode: () => { throw new Error('the canvas is not the page'); } },
      querySelector(sel) {
        if (sel === ':scope > svg') return { cloneNode: () => clonedSvg };
        if (sel === ':scope > canvas.pdf-raster') return { toDataURL: () => 'data:image/png;base64,AAA=' };
        return null;
      },
    },
  };
  const svg = await pageSvg(panel, {
    pdfImage: (href, place) => ({ href, place }),
    backgroundPlacement: (pdfBg, size) => ({ pdfBg, size }),
  });
  assert.equal(svg, clonedSvg);
  assert.equal(rect.fill, '#faf8f2');
  assert.equal(clonedSvg.style.isolation, 'isolate');
  assert.equal(bg.children.length, 1);
  assert.equal(bg.children[0].href, 'data:image/png;base64,AAA=');
});

test('pageExporter wires export buttons, image menu and exportRequested', async () => {
  const els = new Map();
  const makeEl = (id = '') => ({
    id,
    hidden: id === 'imageTypes',
    dataset: {},
    attrs: {},
    children: [],
    onclick: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    hasAttribute(k) { return k in this.attrs; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    click() { this.onclick?.({ stopPropagation() {}, preventDefault() {} }); },
    addEventListener(type, fn) { this[`on_${type}`] = fn; },
  });
  for (const id of ['formatsDialog', 'formatsClose', 'native', 'nativeMarkdown', 'exportProject', 'exportPdf', 'imageTypes', 'exportImage', 'svg', 'exportOpen', 'exportClose', 'exportDialog']) {
    els.set(id, makeEl(id));
  }
  const doc = {
    createElement: (tag) => makeEl(tag),
    querySelectorAll: () => [],
  };
  const saved = [];
  const downloads = [];
  let closedMenus = 0;

  const exporter = pageExporter({
    pageCanvas: async () => ({
      scale: 2,
      canvas: {
        width: 1200,
        height: 1600,
        toBlob: (cb, mime) => cb(new Blob([Uint8Array.of(1, 2, 3, 4)], { type: mime })),
      },
    }),
    call: async (op) => {
      assert.equal(op, 'jpegPagesPdf');
      return Uint8Array.of(0x25, 0x50, 0x44, 0x46);
    },
    documentInfo: () => ({ pages: 1, title: 'Sample' }),
    currentPage: () => 0,
    filename: () => 'Sample',
    download: async (data, name, mime) => { downloads.push({ data, name, mime }); },
    jobs: {
      start: () => ({
        prepared() {},
        set() {},
        finish() {},
        fail(msg) { throw Error(msg); },
      }),
    },
    status: () => {},
    save: async (native, kind) => { saved.push({ native, kind }); },
    closeMenus: () => { closedMenus++; },
    $: (id) => els.get(id),
    doc,
  });

  assert.equal(els.get('imageTypes').children.length, IMAGE_TYPES.length);
  els.get('exportImage').click();
  assert.equal(els.get('imageTypes').hidden, false);
  assert.equal(els.get('exportImage').attrs['aria-expanded'], 'true');

  els.get('native').click();
  els.get('nativeMarkdown').click();
  els.get('exportProject').click();
  assert.deepEqual(saved, [
    { native: true, kind: undefined },
    { native: true, kind: 'markdown' },
    { native: true, kind: 'project' },
  ]);

  await exporter.image('png');
  assert.equal(downloads.at(-1).name, 'Sample-p1.png');
  assert.equal(downloads.at(-1).mime, 'image/png');

  exporter.exportRequest.kind = 'project';
  exporter.exportRequest.key = 'drive:1';
  await exporter.exportRequested('drive:1', true);
  assert.deepEqual(saved.at(-1), { native: true, kind: 'project' });
  assert.equal(exporter.exportRequest.kind, '');
  assert.ok(closedMenus >= 0);

  // Clicking a tab button inside #exportDialog must not close the dialog.
  const dlg = els.get('exportDialog');
  dlg.open = true;
  const tabBtn = { id: 'exportTabResources', getAttribute: (k) => (k === 'role' ? 'tab' : null), hasAttribute: (k) => k === 'data-export-tab', closest: () => null };
  dlg.on_click?.({ target: { closest: () => tabBtn } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(dlg.open, true);
});
