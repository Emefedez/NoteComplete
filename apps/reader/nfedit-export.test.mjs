import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  normalizeExportOptions,
  toCoreExportOptions,
  estimateExportBytes,
  chooseNfeditExport,
} from './nfedit-export.js';

const sampleBreakdown = {
  base_bytes: 2048,
  history_bytes: 4096,
  history_count: 12,
  pdf_bytes: 1024 * 1024,
  pdf_count: 2,
  native_audio_bytes: 512 * 1024,
  native_audio_count: 1,
  added_audio_bytes: 256 * 1024,
  added_audio_count: 1,
  markdown_bytes: 1024,
  text_bytes: 512,
  study_bytes: 8192,
  total_bytes: 2048 + 4096 + 1024 * 1024 + 512 * 1024 + 256 * 1024 + 1024 + 512 + 8192,
};

test('formatBytes formats bytes, KB, MB cleanly', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(200 * 1024), '200 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
});

test('stripping PDFs or native audio forces edit history flattened', () => {
  assert.equal(normalizeExportOptions({ include_history: true, include_pdfs: false }).include_history, false);
  assert.equal(normalizeExportOptions({ include_history: true, include_pdfs: false }).historyLocked, true);
  assert.equal(normalizeExportOptions({ include_history: true, include_native_audio: false }).include_history, false);
  assert.equal(normalizeExportOptions({ include_history: true, include_added_audio: false }).include_history, true);
  assert.equal(normalizeExportOptions({ include_history: true, include_added_audio: false }).historyLocked, false);
});

test('estimateExportBytes sums base and selected resource sizes accurately', () => {
  assert.equal(estimateExportBytes(sampleBreakdown, {}), sampleBreakdown.total_bytes);
  assert.equal(
    estimateExportBytes(sampleBreakdown, { include_pdfs: false }),
    sampleBreakdown.total_bytes - sampleBreakdown.pdf_bytes - sampleBreakdown.history_bytes,
  );
  assert.equal(
    estimateExportBytes(sampleBreakdown, {
      include_history: false,
      include_pdfs: false,
      include_native_audio: false,
      include_added_audio: false,
      include_markdown: false,
      include_text: false,
      include_study: false,
      include_exam: false,
    }),
    sampleBreakdown.base_bytes,
  );
  assert.deepEqual(
    toCoreExportOptions({ include_text: false, include_study: false, include_exam: false }),
    {
      include_history: true,
      include_pdfs: true,
      include_native_audio: true,
      include_added_audio: true,
      include_markdown: true,
      include_ink_text: false,
      include_recognized_text: false,
      include_study: false,
      include_exam: false,
    },
  );
});

test('chooseNfeditExport populates checkboxes, couples history to PDFs/native audio, and returns selection', async () => {
  const els = new Map();
  const makeEl = (tag, id = '') => {
    const node = {
      tag,
      id,
      children: [],
      className: '',
      classList: {
        set: new Set(),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
      },
      dataset: {},
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      open: false,
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() {},
    };
    if (id) els.set(id, node);
    return node;
  };
  for (const id of ['nfeditExportDialog', 'nfeditExportNoteTitle', 'nfeditExportList', 'nfeditExportBaseSize', 'nfeditExportTotalSize', 'nfeditExportHistoryHint', 'nfeditExportConfirm', 'nfeditExportCancel']) {
    makeEl(id === 'nfeditExportDialog' ? 'dialog' : 'div', id);
  }
  const doc = { createElement: (tag) => makeEl(tag) };

  const promise = chooseNfeditExport({
    $: (id) => els.get(id),
    doc,
    title: 'Biology 101',
    breakdown: { ...sampleBreakdown, markdown_bytes: 0 },
  });

  const rows = els.get('nfeditExportList').children;
  const inputFor = (key) => rows.flatMap((r) => r.children).find((n) => n.dataset?.key === key);
  assert.equal(els.get('nfeditExportDialog').open, true);
  assert.equal(els.get('nfeditExportNoteTitle').textContent, 'Biology 101');
  assert.equal(inputFor('include_markdown').disabled, true);
  assert.equal(inputFor('include_markdown').checked, false);
  assert.equal(inputFor('include_pdfs').checked, true);

  // Uncheck PDFs -> locks & unchecks history
  inputFor('include_pdfs').checked = false;
  inputFor('include_pdfs').onchange();
  assert.equal(inputFor('include_history').checked, false);
  assert.equal(inputFor('include_history').disabled, true);
  assert.equal(els.get('nfeditExportHistoryHint').hidden, false);

  // Uncheck study too, then confirm
  inputFor('include_study').checked = false;
  inputFor('include_study').onchange();
  els.get('nfeditExportConfirm').onclick();

  const chosen = await promise;
  assert.equal(els.get('nfeditExportDialog').open, false);
  assert.deepEqual(chosen, {
    include_history: false,
    include_pdfs: false,
    include_native_audio: true,
    include_added_audio: true,
    include_markdown: false,
    include_ink_text: true,
    include_recognized_text: true,
    include_study: false,
    include_exam: false,
  });
});
