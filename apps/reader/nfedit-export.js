// Resource selection helpers and modal dialog for exporting a filtered .nfedit project.

export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n >= 102400 ? 0 : 1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const NFEDIT_RESOURCE_DEFS = [
  {
    key: 'include_history',
    bytesKey: 'history_bytes',
    countKey: 'history_count',
    countUnit: ['edit', 'edits'],
    label: 'Edit & undo history',
    detail: 'Undo/redo steps and edit timeline (unchecking flattens edits onto the note)',
  },
  {
    key: 'include_pdfs',
    bytesKey: 'pdf_bytes',
    countKey: 'pdf_count',
    countUnit: ['PDF', 'PDFs'],
    label: 'Embedded PDFs',
    detail: 'PDF page backgrounds inside this note (stripping also flattens edit history)',
  },
  {
    key: 'include_native_audio',
    bytesKey: 'native_audio_bytes',
    countKey: 'native_audio_count',
    countUnit: ['recording', 'recordings'],
    label: 'Note recordings',
    detail: 'Audio recordings embedded from Noteful (stripping also flattens edit history)',
  },
  {
    key: 'include_added_audio',
    bytesKey: 'added_audio_bytes',
    countKey: 'added_audio_count',
    countUnit: ['recording', 'recordings'],
    label: 'Added audio',
    detail: 'Recordings created or imported in NoteComplete',
  },
  {
    key: 'include_markdown',
    bytesKey: 'markdown_bytes',
    label: 'Markdown notes',
    detail: 'Notes written in the Notes panel',
  },
  {
    key: 'include_text',
    bytesKey: 'text_bytes',
    label: 'Handwriting & OCR text',
    detail: 'Searchable handwriting and recognized text per page',
  },
  {
    key: 'include_study',
    bytesKey: 'study_bytes',
    label: 'Flashcards, quizzes & scratchpad (.ncstudy)',
    detail: 'Study sets saved with this note (can also be exported standalone)',
  },
  {
    key: 'include_exam',
    bytesKey: 'exam_bytes',
    label: 'Embedded exam HTML',
    detail: 'Interactive HTML source kept inside .nfedit for viewing, manual editing, and AI expansion',
  },
];

export function normalizeExportOptions(options = {}) {
  const includePdfs = options.include_pdfs !== false;
  const includeNativeAudio = options.include_native_audio !== false;
  const historyLocked = !includePdfs || !includeNativeAudio;
  return {
    include_history: historyLocked ? false : options.include_history !== false,
    include_pdfs: includePdfs,
    include_native_audio: includeNativeAudio,
    include_added_audio: options.include_added_audio !== false,
    include_markdown: options.include_markdown !== false,
    include_text: options.include_text !== false,
    include_study: options.include_study !== false,
    include_exam: options.include_exam !== false,
    historyLocked,
  };
}

export function toCoreExportOptions(options = {}) {
  const n = normalizeExportOptions(options);
  return {
    include_history: n.include_history,
    include_pdfs: n.include_pdfs,
    include_native_audio: n.include_native_audio,
    include_added_audio: n.include_added_audio,
    include_markdown: n.include_markdown,
    include_ink_text: n.include_text,
    include_recognized_text: n.include_text,
    include_study: n.include_study,
    include_exam: n.include_exam,
  };
}

export function estimateExportBytes(breakdown = {}, options = {}) {
  const n = normalizeExportOptions(options);
  let total = Number(breakdown.base_bytes) || 0;
  if (n.include_history) total += Number(breakdown.history_bytes) || 0;
  if (n.include_pdfs) total += Number(breakdown.pdf_bytes) || 0;
  if (n.include_native_audio) total += Number(breakdown.native_audio_bytes) || 0;
  if (n.include_added_audio) total += Number(breakdown.added_audio_bytes) || 0;
  if (n.include_markdown) total += Number(breakdown.markdown_bytes) || 0;
  if (n.include_text) total += Number(breakdown.text_bytes) || 0;
  if (n.include_study) total += Number(breakdown.study_bytes) || 0;
  if (n.include_exam) total += Number(breakdown.exam_bytes) || 0;
  return total;
}

/**
 * Opens `#nfeditExportDialog` with resource checkboxes + live sizes and resolves with
 * `ProjectExportOptions` (or `null` when cancelled).
 */
export function chooseNfeditExport({ $, doc = globalThis.document, title = 'Note', breakdown, initialOptions = {}, actionLabel = 'Export .nfedit' }) {
  const dialog = $('nfeditExportDialog');
  if (!dialog) return Promise.resolve(toCoreExportOptions(initialOptions));

  const titleEl = $('nfeditExportNoteTitle');
  const listEl = $('nfeditExportList');
  const baseEl = $('nfeditExportBaseSize');
  const totalEl = $('nfeditExportTotalSize');
  const historyHintEl = $('nfeditExportHistoryHint');
  const confirmBtn = $('nfeditExportConfirm');
  const cancelBtn = $('nfeditExportCancel');

  if (titleEl) titleEl.textContent = title || 'Note';
  if (baseEl) baseEl.textContent = formatBytes(breakdown?.base_bytes || 0);
  const confirmLabelEl = $('nfeditExportConfirmLabel');
  if (confirmLabelEl) confirmLabelEl.textContent = actionLabel;
  else if (confirmBtn) confirmBtn.textContent = actionLabel;

  const state = normalizeExportOptions(initialOptions);
  const inputs = new Map();

  if (listEl && doc) {
    listEl.replaceChildren();
    for (const def of NFEDIT_RESOURCE_DEFS) {
      const bytes = Number(breakdown?.[def.bytesKey]) || 0;
      const count = def.countKey ? Number(breakdown?.[def.countKey]) || 0 : null;
      const present = bytes > 0 && (count === null || count > 0);
      if (!present) state[def.key] = false;

      const row = doc.createElement('label');
      row.className = `nfedit-row${present ? '' : ' is-empty'}`;

      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(state[def.key]);
      input.disabled = !present;
      input.dataset.key = def.key;

      const text = doc.createElement('span');
      text.className = 'nfedit-row-text';
      const head = doc.createElement('strong');
      head.textContent = def.label;
      const meta = doc.createElement('small');
      meta.className = 'muted';
      meta.textContent = def.detail;
      text.append(head, meta);

      const size = doc.createElement('span');
      size.className = 'nfedit-row-size';
      if (!present) {
        size.textContent = 'None';
      } else if (count !== null && def.countUnit) {
        size.textContent = `${count} ${count === 1 ? def.countUnit[0] : def.countUnit[1]} · ${formatBytes(bytes)}`;
      } else {
        size.textContent = formatBytes(bytes);
      }

      row.append(input, text, size);
      listEl.append(row);
      inputs.set(def.key, { input, present, row });
    }
  }

  let rememberedHistory = state.include_history;
  function sync() {
    const normalized = normalizeExportOptions(state);
    const histEntry = inputs.get('include_history');
    if (histEntry) {
      if (normalized.historyLocked) {
        histEntry.input.checked = false;
        histEntry.input.disabled = true;
        histEntry.row.classList.add('is-locked');
      } else {
        histEntry.input.disabled = !histEntry.present;
        histEntry.row.classList.remove('is-locked');
        histEntry.input.checked = histEntry.present && rememberedHistory;
        state.include_history = histEntry.input.checked;
      }
    }
    if (historyHintEl) historyHintEl.hidden = !normalized.historyLocked;
    if (totalEl) totalEl.textContent = formatBytes(estimateExportBytes(breakdown, state));
  }

  for (const [key, { input }] of inputs) {
    input.onchange = () => {
      state[key] = input.checked;
      if (key === 'include_history') rememberedHistory = input.checked;
      sync();
    };
  }
  sync();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.onclose = null;
      dialog.oncancel = null;
      dialog.onclick = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    confirmBtn.onclick = () => finish(toCoreExportOptions(state));
    cancelBtn.onclick = () => finish(null);
    dialog.oncancel = (e) => { e.preventDefault?.(); finish(null); };
    dialog.onclick = (e) => { if (e.target === dialog) finish(null); };
    dialog.showModal();
    confirmBtn.focus?.();
  });
}
