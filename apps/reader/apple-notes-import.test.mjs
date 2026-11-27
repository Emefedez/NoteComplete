import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeAppleNoteProto,
  appleNotesHtmlToMarkdown,
  parseAppleNotesFiles,
  sanitizeNoteFilename,
} from './apple-notes-import.js';

// Minimal protobuf encoder helpers for tests
function encodeVarint(n) {
  const out = [];
  let v = n >>> 0;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
  return out;
}
function fieldVarint(num, val) {
  return [...encodeVarint((num << 3) | 0), ...encodeVarint(val)];
}
function fieldBytes(num, bytes) {
  const arr = typeof bytes === 'string' ? [...new TextEncoder().encode(bytes)] : [...bytes];
  return [...encodeVarint((num << 3) | 2), ...encodeVarint(arr.length), ...arr];
}

function buildAppleNoteProto(text, runs) {
  const runFields = runs.flatMap((r) => {
    const body = [...fieldVarint(1, r.length)];
    if (r.style) {
      const ps = [];
      if (r.style.styleType != null) ps.push(...fieldVarint(1, r.style.styleType));
      if (r.style.indent) ps.push(...fieldVarint(4, r.style.indent));
      if (r.style.checklist) ps.push(...fieldBytes(5, fieldVarint(2, r.style.checklist.done ? 1 : 0)));
      if (r.style.blockquote) ps.push(...fieldVarint(8, 1));
      body.push(...fieldBytes(2, ps));
    }
    if (r.fontWeight) body.push(...fieldVarint(5, r.fontWeight));
    if (r.strikethrough) body.push(...fieldVarint(7, 1));
    if (r.superscript) body.push(...fieldVarint(8, r.superscript));
    if (r.link) body.push(...fieldBytes(9, r.link));
    if (r.attachment) {
      const att = [...fieldBytes(1, r.attachment.id), ...fieldBytes(2, r.attachment.uti)];
      body.push(...fieldBytes(12, att));
    }
    if (r.emphasisStyle) body.push(...fieldVarint(14, r.emphasisStyle));
    return fieldBytes(5, body);
  });
  const noteMsg = [...fieldBytes(2, text), ...runFields];
  const docMsg = [...fieldVarint(2, 0), ...fieldBytes(3, noteMsg)];
  return new Uint8Array(fieldBytes(2, docMsg));
}

test('decodeAppleNoteProto decodes headings, bold/italic, highlights, checklists, links, and hashtags', () => {
  const text = 'Estadística Tema 4\nImportant formula\nDone item\nOpen item\n\uFFFC\n';
  const proto = buildAppleNoteProto(text, [
    { length: 19, style: { styleType: 0 } }, // "Estadística Tema 4\n" -> # heading
    { length: 9, fontWeight: 1, emphasisStyle: 1 }, // "Important" -> ==**Important**==
    { length: 9, link: 'https://uvigo.gal' }, // " formula\n" -> [formula](url)
    { length: 10, style: { styleType: 103, checklist: { done: true } } }, // "Done item\n"
    { length: 10, style: { styleType: 103, checklist: { done: false } } }, // "Open item\n"
    { length: 2, attachment: { id: 'att-1', uti: 'com.apple.notes.inlinetextattachment.hashtag' } },
  ]);
  const res = decodeAppleNoteProto(proto, {
    attachments: { 'att-1': { altText: '#estadistica', uti: 'com.apple.notes.inlinetextattachment.hashtag' } },
  });
  assert.equal(res.title, 'Estadística Tema 4');
  assert.match(res.markdown, /^# Estadística Tema 4/m);
  assert.match(res.markdown, /==\*\*Important\*\*==/);
  assert.match(res.markdown, /\[formula\]\(https:\/\/uvigo\.gal\)/);
  assert.match(res.markdown, /- \[x\] Done item/);
  assert.match(res.markdown, /- \[ \] Open item/);
  assert.match(res.markdown, /#estadistica/);
});

test('appleNotesHtmlToMarkdown converts Apple Notes HTML export cleanly', () => {
  const html = `<!doctype html><html><head><title>Lecture 1</title></head><body>
    <h1>Lecture 1</h1>
    <p>Hello <b>world</b> and <i>italics</i> with <a href="https://example.com">link</a>.</p>
    <ul><li><input type="checkbox" checked> First</li><li><input type="checkbox"> Second</li></ul>
  </body></html>`;
  const { title, markdown } = appleNotesHtmlToMarkdown(html);
  assert.equal(title, 'Lecture 1');
  assert.match(markdown, /# Lecture 1/);
  assert.match(markdown, /\*\*world\*\*/);
  assert.match(markdown, /\*italics\*/);
  assert.match(markdown, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(markdown, /- \[x\] First/);
  assert.match(markdown, /- \[ \] Second/);
});

test('parseAppleNotesFiles preserves folder hierarchy and sanitizes filenames', async () => {
  const f1 = new File(['# Note A\nBody A'], 'Note A.md', { type: 'text/markdown' });
  Object.defineProperty(f1, 'webkitRelativePath', { value: 'iCloud Notes/University/Note A.md' });
  const f2 = new File(['<h1>Note B</h1><p>Hello</p>'], 'Note B.html', { type: 'text/html' });
  Object.defineProperty(f2, 'webkitRelativePath', { value: 'iCloud Notes/Personal/Note B.html' });
  const res = await parseAppleNotesFiles([f1, f2]);
  assert.equal(res.notes.length, 2);
  assert.deepEqual(res.folders.sort(), ['Personal', 'University']);
  assert.equal(sanitizeNoteFilename('A/B:C?*  '), 'ABC.md');
});
