// File / Study -> Create exam (AI)...
// Multi-source exam builder: generates an A4 HTML exam (MCQ, fill-in, calculations,
// open-ended, tables, code), prints it to PDF, and pre-applies Noteful Tape over
// every answer/theory box so it opens ready to study in NoteComplete or Noteful.
import { icon } from './icons.js';
import { jsonFrom } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { runAI } from './small-model.js';
import { createSourcePicker } from './source-picker.js';
import { resolveSources, formatSourceBundle } from './source-extract.js';
import { PROBLEM_TYPES, FOCUS_MODES, examPrompt, cleanExamData, buildPaginatedExamHtml } from './exam-html.js';
import { renderExamPdfAndTapes } from './exam-pdf.js';
import { recordExam, resourceKeysFor } from './exam-index.js';

const STORE = 'notecomplete-exam-prefs';

export function safeFileBase(title = 'Exam') {
  return String(title || 'Exam').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Exam';
}

/**
 * Collects canonical resource keys and human-readable labels for the selected sources
 * (open note, Recents, folders, local files, Drive files) so Saved resources can
 * link exams back to any resource or folder used to create them.
 */
export function collectSourceLinks(sources, resolved, { groups = null, openDocResource = null } = {}) {
  const keys = [];
  const labels = [];
  const openRes = typeof openDocResource === 'function' ? (openDocResource() || {}) : {};
  for (const s of sources || []) {
    if (s.kind === 'open') {
      keys.push(...resourceKeysFor(openRes));
      if (openRes.title) labels.push(openRes.title);
    } else if (s.kind === 'recent' && s.entry) {
      keys.push(s.entry.key);
      if (s.entry.name) labels.push(s.entry.name);
      if (s.entry.title) labels.push(s.entry.title);
    } else if (s.kind === 'group' && s.group) {
      keys.push(...resourceKeysFor({ folderIds: [s.group.id] }));
      if (s.group.name) labels.push(s.group.name);
      for (const m of groups?.members?.(s.group) || []) {
        if (m?.key) keys.push(m.key);
        if (m?.name) labels.push(m.name);
      }
    } else if (s.kind === 'drive' && s.driveFile) {
      if (s.driveFile.id) keys.push(`drive:${s.driveFile.id}`);
      if (s.driveFile.name) labels.push(s.driveFile.name);
    } else if (s.label) {
      labels.push(s.label);
    }
  }
  for (const d of resolved || []) {
    if (d.title) labels.push(d.title);
    if (d.name) labels.push(d.name);
    if (d.folderName) labels.push(d.folderName);
  }
  return {
    resourceKeys: [...new Set(keys.filter(Boolean))],
    resourceLabels: [...new Set(labels.filter(Boolean))],
  };
}

export function examController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc = () => false,
  openDocTitle = () => 'Current note',
  openDocPages = () => 0,
  openDocResource = () => ({}),
  pageText,
  pageCanvas,
  notesText,
  jobs,
  ai,
  status,
  download,
  openGeneratedFile,
  refreshHome,
  store = globalThis.localStorage,
}) {
  let dialog = null;
  let picker = null;
  let model = null;
  let running = null;
  let lastResult = null;

  const el = (id) => dialog.querySelector(`#${id}`);
  const loadPrefs = () => { try { return JSON.parse(store?.getItem(STORE) || '{}'); } catch { return {}; } };
  const savePrefs = (p) => { try { store?.setItem(STORE, JSON.stringify(p)); } catch { /* Optional. */ } };

  function build() {
    dialog = document.createElement('dialog');
    dialog.id = 'examDialog';
    dialog.className = 'ocr-dialog exam-dialog';
    dialog.setAttribute('aria-labelledby', 'examDialogTitle');

    const typeChecks = PROBLEM_TYPES.map(([id, label]) =>
      `<label class="exam-type-opt"><input type="checkbox" name="examType" value="${id}" checked /><span>${label}</span></label>`).join('');
    const focusOpts = FOCUS_MODES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');

    dialog.innerHTML = `
      <div class="exam-dlg-head">
        <h2 id="examDialogTitle"></h2>
        <button id="examCloseX" type="button" class="dlg-close" aria-label="Close"></button>
      </div>
      <p class="muted">Select Recents, entire folders, PDFs, notes, Drive files or topics. Generates a printable A4 exam PDF with pre-applied Noteful answer tape instead of dropdowns.</p>
      <div class="exam-dlg-grid">
        <section class="exam-col">
          <h3 class="exam-sub">1. Study sources</h3>
          <div id="examSourceMount"></div>
        </section>
        <section class="exam-col exam-opts">
          <h3 class="exam-sub">2. Exam structure</h3>
          <label class="exam-field">Exam title
            <input id="examTitle" type="text" placeholder="Auto from selected sources" spellcheck="false" />
          </label>
          <fieldset class="exam-types">
            <legend>Problem types</legend>
            <div class="exam-types-grid">${typeChecks}</div>
          </fieldset>
          <div class="exam-row-2">
            <label class="exam-field">Coverage focus
              <select id="examFocus" data-native>${focusOpts}</select>
            </label>
            <label class="exam-field">Difficulty
              <select id="examDifficulty" data-native>
                <option value="easy">Foundation / easy</option>
                <option value="exam" selected>Exam level</option>
                <option value="hard">Challenging</option>
              </select>
            </label>
          </div>
          <div class="exam-row-2">
            <label class="exam-field">Number of questions
              <select id="examCountMode" data-native>
                <option value="auto">As many as AI decides</option>
                <option value="exact" selected>Exact count…</option>
              </select>
            </label>
            <label class="exam-field" id="examCountBox">Questions
              <input id="examCount" type="number" min="1" max="60" value="12" />
            </label>
          </div>
          <div class="exam-row-2">
            <label class="exam-field">Language
              <select id="examLanguage" data-native>
                <option value="auto">Match sources</option>
                <option value="English">English</option>
                <option value="Spanish">Español</option>
                <option value="French">Français</option>
                <option value="German">Deutsch</option>
              </select>
            </label>
            <label class="exam-field">Save to folder
              <select id="examFolder" data-native><option value="">Recent only</option></select>
            </label>
          </div>
          <label class="sp-check exam-theory-toggle">
            <input id="examIncludeTheory" type="checkbox" checked />
            <span>Include blue-taped Theory foundation boxes</span>
          </label>
          <label class="exam-field">Extra instructions
            <textarea id="examInstructions" rows="2" placeholder="Optional focus: e.g., weight timing diagrams 40%, include tricky unit conversions…"></textarea>
          </label>
          <div id="examAiRow" class="hw-ai-row hw-tools"${ai ? '' : ' hidden'}>
            <select id="examTool" data-native aria-label="AI tool"></select>
            <select id="examModel" data-native aria-label="Model"></select>
            <input id="examModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden />
          </div>
          <p id="examStatus" class="muted hw-ai-status" role="status"></p>
          <div id="examReadyBar" class="exam-ready" hidden>
            <strong id="examReadyLabel"></strong>
            <div class="exam-ready-btns">
              <button id="examOpenBtn" type="button" class="primary"></button>
              <button id="examPdfBtn" type="button"></button>
              <button id="examHtmlBtn" type="button"></button>
            </div>
          </div>
        </section>
      </div>
      <div class="ocr-actions">
        <button id="examCancel" type="button">Cancel</button>
        <button id="examGenerate" type="button" class="primary"></button>
      </div>
    `;
    document.body.append(dialog);

    el('examDialogTitle').replaceChildren(icon('exam'), document.createTextNode(' Create exam with AI'));
    el('examCloseX').replaceChildren(icon('close'));
    el('examGenerate').replaceChildren(icon('spark'), document.createTextNode(' Create exam'));
    el('examOpenBtn').replaceChildren(icon('open'), document.createTextNode(' Open taped exam'));
    el('examPdfBtn').replaceChildren(icon('pdf'), document.createTextNode(' Save .pdf'));
    el('examHtmlBtn').replaceChildren(icon('text'), document.createTextNode(' Save .html'));

    el('examCloseX').onclick = () => dialog.close();
    el('examCancel').onclick = () => {
      if (running) running.abort();
      else dialog.close();
    };
    el('examCountMode').onchange = () => {
      el('examCountBox').hidden = el('examCountMode').value !== 'exact';
    };

    picker = createSourcePicker(el('examSourceMount'), {
      library,
      groups,
      hasOpenDoc,
      openDocTitle,
      openDocPages,
      openDocKey: () => (typeof openDocResource === 'function' ? openDocResource()?.entryKey || '' : ''),
      allowTopics: true,
    });

    if (ai) {
      model = modelPicker(el('examModel'), el('examModelOther'), ai);
      el('examTool').onchange = () => {
        try { store?.setItem('notecomplete-ai-provider', el('examTool').value); } catch { /* Optional. */ }
        model.load(el('examTool').value);
      };
    }

    el('examGenerate').onclick = () => generate();
    el('examOpenBtn').onclick = async () => {
      if (!lastResult?.file) return;
      dialog.close();
      await openGeneratedFile?.(lastResult.file, lastResult.entry);
    };
    el('examPdfBtn').onclick = async () => {
      if (!lastResult?.pdf) return;
      await download(lastResult.pdf, `${safeFileBase(lastResult.title)}.pdf`, 'application/pdf');
    };
    el('examHtmlBtn').onclick = async () => {
      if (!lastResult?.interactiveHtml) return;
      await download(lastResult.interactiveHtml, `${safeFileBase(lastResult.title)}.html`, 'text/html');
    };
  }

  async function fillFoldersAndTools() {
    const folderSel = el('examFolder');
    const prev = folderSel.value;
    folderSel.innerHTML = '<option value="">Recent only</option>';
    const all = (await groups?.folders?.().catch(() => [])) || [];
    for (const g of all) {
      if (!g.folder) folderSel.add(new Option(g.name || 'Folder', g.id));
    }
    if (prev && folderSel.querySelector(`option[value="${prev}"]`)) folderSel.value = prev;

    if (!ai) return;
    const select = el('examTool');
    if (select.options.length) return;
    for (const p of await ai.providers()) {
      const opt = new Option(p.available ? p.label : `${p.label} (not installed)`, p.id);
      opt.disabled = !p.available;
      select.add(opt);
    }
    let saved = '';
    try { saved = store?.getItem('notecomplete-ai-provider') || ''; } catch { /* Optional. */ }
    if (saved && select.querySelector(`option[value="${saved}"]:not([disabled])`)) select.value = saved;
    else select.value = select.querySelector('option:not([disabled])')?.value || '';
    if (select.value) await model.load(select.value);
    else el('examStatus').textContent = 'No AI tool found. Install or connect an AI tool under Help → Connect AI tools…';
  }

  async function generate() {
    if (running) return;
    if (!ai) { el('examStatus').textContent = 'Connect an AI tool first (Help → Connect AI tools…).'; return; }
    const sources = picker.list();
    if (!sources.length) { el('examStatus').textContent = 'Select at least one note, folder, file or topic first.'; return; }
    const types = Array.from(dialog.querySelectorAll('input[name="examType"]:checked')).map((c) => c.value);
    if (!types.length) { el('examStatus').textContent = 'Pick at least one problem type.'; return; }
    const provider = el('examTool').value;
    if (!provider) { el('examStatus').textContent = 'No AI tool is available.'; return; }

    const prefs = {
      focus: el('examFocus').value,
      difficulty: el('examDifficulty').value,
      countMode: el('examCountMode').value,
      count: Number(el('examCount').value) || 12,
      language: el('examLanguage').value,
      includeTheory: el('examIncludeTheory').checked,
      types,
    };
    savePrefs(prefs);

    const ac = new AbortController();
    running = ac;
    el('examGenerate').disabled = true;
    el('examCancel').textContent = 'Stop';
    el('examReadyBar').hidden = true;
    el('examStatus').textContent = 'Reading selected sources…';
    const job = jobs?.start?.('Creating exam…', { onCancel: () => ac.abort() });

    try {
      const resolved = await resolveSources(sources, {
        call,
        openPdf,
        library,
        groups,
        openDocResource,
        pageText,
        pageCanvas,
        notesText,
        documentInfo: () => ({ pages: openDocPages(), title: openDocTitle() }),
        onProgress: (i, n, label) => {
          el('examStatus').textContent = `Reading ${i + 1}/${n}: ${label}`;
          job?.progress?.(`Reading ${i + 1}/${n}`);
        },
      });
      if (ac.signal.aborted) throw Error('Cancelled.');
      if (!resolved.length) throw Error('Could not extract readable text or images from the selected sources.');

      const { promptText, images } = formatSourceBundle(resolved);
      const userTitle = el('examTitle').value.trim();
      const defaultTitle = userTitle || `${resolved[0].title}${resolved.length > 1 ? ` + ${resolved.length - 1} more` : ''} — Exam`;
      const prompt = examPrompt({
        title: userTitle || defaultTitle,
        sourcesText: promptText,
        types: prefs.types,
        countMode: prefs.countMode,
        count: prefs.count,
        difficulty: prefs.difficulty,
        focus: prefs.focus,
        language: prefs.language,
        includeTheory: prefs.includeTheory,
        instructions: el('examInstructions').value.trim(),
      });

      el('examStatus').textContent = 'Generating exam problems with AI…';
      job?.progress?.('Writing exam questions…');
      const m = model.value;
      const caps = ai.capabilities?.(provider, m) || {};
      const res = await runAI(
        ai,
        { provider, model: m, prompt, images: caps.vision === false ? [] : images, tag: 'exam', signal: ac.signal },
        (chunk) => {
          el('examStatus').textContent = `Generating exam… (${chunk.length} chars received)`;
        },
        { small: model.small, vision: caps.vision !== false },
      );

      if (ac.signal.aborted) throw Error('Cancelled.');
      const exam = cleanExamData(jsonFrom(res.text));
      if (userTitle) exam.title = userTitle;

      el('examStatus').textContent = 'Laying out A4 PDF and measuring answer tape…';
      job?.progress?.('Rendering PDF & tape…');
      const printHtml = buildPaginatedExamHtml(exam, { showTheory: prefs.includeTheory, interactiveFallback: false });
      const interactiveHtml = buildPaginatedExamHtml(exam, { showTheory: prefs.includeTheory, interactiveFallback: true });
      const rendered = await renderExamPdfAndTapes(printHtml, { title: exam.title, call });

      el('examStatus').textContent = 'Applying Noteful tape to exam pages…';
      const pdfTransfer = rendered.pdf.slice().buffer;
      const projectJson = await call('createPdfNoteWithTapes', {
        title: exam.title,
        sizes: rendered.sizes,
        pdf: pdfTransfer,
        tapes: rendered.tapes,
      }, [pdfTransfer]);

      const fileName = `${safeFileBase(exam.title)}.nfedit`;
      const outFile = new File([projectJson], fileName, { type: 'application/json' });
      const targetFolderId = el('examFolder').value;
      const targetGroup = targetFolderId ? (await groups?.folders?.())?.find((g) => g.id === targetFolderId) : null;
      let entry = null;
      if (library?.rememberImported) {
        entry = await library.rememberImported(outFile, {
          origin: 'AI Exam',
          folder: targetGroup?.name || '',
        });
        if (targetGroup && groups?.move && entry) {
          await groups.move({ key: entry.key, name: entry.name, source: 'imported' }, targetGroup);
        }
        const { resourceKeys, resourceLabels } = collectSourceLinks(sources, resolved, { groups, openDocResource });
        if (targetGroup?.id) resourceKeys.push(...resourceKeysFor({ folderIds: [targetGroup.id] }));
        await recordExam(library?.store, {
          id: entry?.key || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          entryKey: entry?.key || '',
          title: exam.title,
          fileName,
          pageCount: rendered.pageCount,
          tapeCount: rendered.tapes.length,
          created: Date.now(),
          resourceKeys,
          resourceLabels,
        }).catch(() => {});
        refreshHome?.();
      }

      lastResult = {
        title: exam.title,
        file: outFile,
        entry,
        pdf: rendered.pdf,
        interactiveHtml,
        pageCount: rendered.pageCount,
        tapeCount: rendered.tapes.length,
      };
      el('examReadyLabel').textContent = `Ready: ${rendered.pageCount} A4 page${rendered.pageCount === 1 ? '' : 's'} · ${rendered.tapes.length} taped answer${rendered.tapes.length === 1 ? '' : 's'} — saved to Recent!`;
      el('examReadyBar').hidden = false;
      el('examStatus').textContent = '';
      job?.done?.(`Created exam "${exam.title}" (${rendered.pageCount} pages, ${rendered.tapes.length} answer tapes).`);
      status?.(`Created exam "${exam.title}" (${rendered.tapeCount} taped answers) and saved to Recent.`);
    } catch (e) {
      el('examStatus').textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      running = null;
      el('examGenerate').disabled = false;
      el('examCancel').textContent = 'Cancel';
    }
  }

  return {
    async open({ preselectOpen = false } = {}) {
      if (!dialog) build();
      const prefs = loadPrefs();
      if (prefs.focus) el('examFocus').value = prefs.focus;
      if (prefs.difficulty) el('examDifficulty').value = prefs.difficulty;
      if (prefs.countMode) el('examCountMode').value = prefs.countMode;
      if (prefs.count) el('examCount').value = prefs.count;
      if (prefs.language) el('examLanguage').value = prefs.language;
      if (typeof prefs.includeTheory === 'boolean') el('examIncludeTheory').checked = prefs.includeTheory;
      if (Array.isArray(prefs.types) && prefs.types.length) {
        for (const cb of dialog.querySelectorAll('input[name="examType"]')) cb.checked = prefs.types.includes(cb.value);
      }
      el('examCountBox').hidden = el('examCountMode').value !== 'exact';
      el('examReadyBar').hidden = true;
      el('examStatus').textContent = '';
      dialog.showModal();
      await picker.refresh({ preselectOpen });
      await fillFoldersAndTools();
    },
    get visible() { return !!dialog?.open; },
  };
}
