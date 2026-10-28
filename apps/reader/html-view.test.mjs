import test from 'node:test';
import assert from 'node:assert/strict';
import { isHtmlName, prepareHtml, htmlViewer } from './html-view.js';
import { fileKind, prepareDocument } from './media-import.js';

test('isHtmlName identifies html and htm extensions', () => {
  assert.equal(isHtmlName('exercise.html'), true);
  assert.equal(isHtmlName('exam.htm'), true);
  assert.equal(isHtmlName('EXAM.HTML'), true);
  assert.equal(isHtmlName('notes.noteful'), false);
  assert.equal(isHtmlName('document.pdf'), false);
  assert.equal(isHtmlName(''), false);
});

test('fileKind identifies html files and keeps pdf detection strict', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(fileKind('exam.html', enc('<!doctype html><html><body>Test</body></html>')), 'html');
  assert.equal(fileKind('exam.htm', enc('<html><body>Test</body></html>')), 'html');
  assert.equal(fileKind('opaque', enc('<!doctype html><html><body>Test</body></html>')), 'html');
  assert.equal(fileKind('opaque', enc('<html><body>Test</body></html>')), 'html');
  // Strict non-html extension should throw if content is html
  assert.throws(() => fileKind('looks-like-a.pdf', enc('<html>not a PDF')));
});

test('prepareDocument prepares html document with text content', async () => {
  const htmlContent = '<!doctype html><html><head><title>ACII</title></head><body>Examen</body></html>';
  const file = new File([htmlContent], 'Examen_Extenso_Temario_1_ACII.html', { type: 'text/html' });
  const doc = await prepareDocument(file);
  assert.equal(doc.kind, 'html');
  assert.equal(doc.title, 'Examen_Extenso_Temario_1_ACII');
  assert.equal(doc.text, htmlContent);
  assert.ok(doc.bytes instanceof ArrayBuffer);
});

test('prepareHtml injects localStorage shim into head or html without breaking markup', () => {
  const src = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Exam</title></head><body><h1>ACII</h1></body></html>';
  const prepared = prepareHtml(src, { acii_chuleta_theme: 'dark' });
  assert.match(prepared, /<script>\(function\(\)\{var seed=\{"acii_chuleta_theme":"dark"\};/);
  assert.match(prepared, /Object\.defineProperty\(window,'localStorage'/);
  assert.ok(prepared.includes('<h1>ACII</h1>'));
  assert.ok(prepared.indexOf('seed=') > prepared.indexOf('<head>'));
});

test('htmlViewer configures sandbox and manages document lifecycle', () => {
  const events = [];
  const root = { hidden: true };
  const frame = {
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    srcdoc: '',
    contentWindow: {},
  };
  const title = { textContent: '' };
  const reload = { onclick: null };
  const clear = { onclick: null };

  const viewer = htmlViewer({
    root,
    frame,
    title,
    reload,
    clear,
    status: (msg) => events.push(msg),
  });

  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-modals allow-forms');
  assert.ok(frame.attributes.csp.includes("default-src 'none'"));
  assert.equal(viewer.hasDocument, false);
  assert.equal(viewer.visible, false);

  viewer.open({
    text: '<html><head></head><body>ACII Exam</body></html>',
    fingerprint: 'test-doc-123',
    name: 'Examen ACII',
  });

  assert.equal(viewer.hasDocument, true);
  assert.equal(viewer.visible, true);
  assert.equal(root.hidden, false);
  assert.equal(title.textContent, 'Examen ACII');
  assert.equal(viewer.name, 'Examen ACII');
  assert.ok(frame.srcdoc.includes('ACII Exam'));

  viewer.hide();
  assert.equal(viewer.visible, false);
  assert.equal(root.hidden, true);
  assert.equal(viewer.hasDocument, true);

  viewer.show();
  assert.equal(viewer.visible, true);
  assert.equal(root.hidden, false);

  viewer.close();
  assert.equal(viewer.visible, false);
  assert.equal(viewer.hasDocument, false);
  assert.equal(frame.srcdoc, '');
});

test('htmlViewer renders each document into a new iframe', () => {
  const made = [];
  const element = () => {
    const el = {
      attrs: {}, srcdoc: '', contentWindow: {}, replacedBy: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      replaceWith(next) { this.replacedBy = next; },
    };
    el.ownerDocument = { createElement: () => { const next = element(); made.push(next); return next; } };
    return el;
  };
  const first = element();
  first.setAttribute('id', 'htmlFrame');
  first.setAttribute('title', 'HTML document');
  const viewer = htmlViewer({ root: { hidden: true }, frame: first });
  viewer.open({ text: '<html><head></head><body>One</body></html>', fingerprint: 'a', name: 'One' });
  assert.equal(made.length, 1);
  assert.equal(first.replacedBy, made[0]);
  assert.equal(first.srcdoc, '');
  assert.equal(made[0].attrs.id, 'htmlFrame');
  assert.equal(made[0].attrs.sandbox, 'allow-scripts allow-modals allow-forms');
  assert.ok(made[0].attrs.csp.includes("default-src 'none'"));
  assert.ok(made[0].srcdoc.includes('One'));
  viewer.open({ text: '<html><head></head><body>Two</body></html>', fingerprint: 'b', name: 'Two' });
  assert.equal(made[0].replacedBy, made[1]);
  assert.ok(made[1].srcdoc.includes('Two'));
  viewer.close();
  assert.equal(made[2].srcdoc, '');
});
