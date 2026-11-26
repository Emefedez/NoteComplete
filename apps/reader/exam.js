// File / Study -> Create exam (AI)...
// Multi-source exam builder: generates an A4 HTML exam (MCQ, fill-in, calculations,
// open-ended, tables, code), prints it to PDF, and pre-applies Noteful Tape over
// every answer/theory box so it opens ready to study in NoteComplete or Noteful.
import { icon } from './icons.js';
import { optionsFrom } from './convert.js';
import { jsonFrom, saveAiDraft, loadAiDraft, clearAiDraft, buildContinuationPrompt, mergePartialExamJson } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { createDocOrchestrator } from './ai-failover.js';
import { createSourcePicker } from './source-picker.js';
import {
  resolveSources,
  formatSourceBundle,
  collectVisualCandidates,
  resolveExamVisualCutouts,
  dataUrlToBytes,
} from './source-extract.js';
import {
  PROBLEM_TYPES,
  FOCUS_MODES,
  ensureExamMathRenderer,
  examPrompt,
  cleanExamData,
  buildPaginatedExamHtml,
  buildSourceCatalog,
  buildFallbackExamPlan,
  examPlanPrompt,
  cleanExamPlan,
  mergeExamSections,
  solveSplitPrompt,
  cleanSplitExercises,
  solveChunkPrompt,
  cleanSolvedExercise,
  buildSolvedExamHtml,
  buildSolvedExamMcpMarkdown,
} from './exam-html.js';
import { renderExamPdfAndTapes } from './exam-pdf.js';
import { recordExam, listExams, resourceKeysFor } from './exam-index.js';

const PARALLEL_WORKERS = 4;

const STORE = 'notecomplete-exam-prefs';
const DRAFT_KEY = 'notecomplete-exam-draft';

export function safeFileBase(title = 'Exam') {
  return String(title || 'Exam').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'Exam';
}

const stripExamExt = (name) => String(name || '').replace(/\.(nfedit|noteful|notepart|notecomp|notecomplete|pdf|html?)$/i, '').trim();

/**
 * Picks a unique exam title that will not collide with existing exam titles or
 * `.nfedit` filenames, appending ` (2)`, ` (3)`, ... when needed.
 * @param {string} baseTitle
 * @param {Iterable<string>} existingNames
 * @returns {string}
 */
export function uniqueExamTitle(baseTitle, existingNames = []) {
  const clean = stripExamExt(baseTitle) || 'Exam';
  const taken = new Set();
  for (const name of existingNames || []) {
    const stem = stripExamExt(name);
    if (!stem) continue;
    taken.add(stem.toLowerCase());
    taken.add(safeFileBase(stem).toLowerCase());
  }
  const isTaken = (candidate) => {
    const stem = stripExamExt(candidate);
    return taken.has(stem.toLowerCase()) || taken.has(safeFileBase(stem).toLowerCase());
  };
  if (!isTaken(clean)) return clean;

  const numbered = clean.match(/^(.*?)\s*\((\d+)\)$/);
  const stem = (numbered ? numbered[1].trim() : clean).slice(0, 70).trim() || 'Exam';
  let n = numbered ? Math.max(2, Number(numbered[2]) + 1) : 2;
  while (isTaken(`${stem} (${n})`)) n++;
  return `${stem} (${n})`;
}

/**
 * Resolves a unique exam title against saved library entries, the exam index,
 * and files already present on disk in the library folder so a newly generated
 * or solved exam never overwrites an existing one.
 * @param {string} baseTitle
 * @param {{ library?: object }} [deps]
 * @returns {Promise<string>}
 */
export async function resolveUniqueExamTitle(baseTitle, { library } = {}) {
  const used = [];
  if (library?.store) {
    try {
      const entries = await library.store.values('entries');
      for (const e of entries || []) {
        if (e?.title) used.push(e.title);
        if (e?.name) used.push(e.name);
        if (e?.filename) used.push(e.filename);
      }
    } catch { /* Optional library store lookup. */ }
    try {
      const indexed = await listExams(library.store);
      for (const x of indexed || []) {
        if (x?.title) used.push(x.title);
        if (x?.fileName) used.push(x.fileName);
      }
    } catch { /* Optional exam index lookup. */ }
  }
  let candidate = uniqueExamTitle(baseTitle, used);
  if (library?.location) {
    try {
      const loc = await library.location();
      if (loc?.read) {
        let guard = 0;
        while (guard < 100) {
          const fileName = `${safeFileBase(candidate)}.nfedit`;
          const existing = await loc.read(fileName).catch(() => null);
          if (!existing) break;
          used.push(candidate);
          candidate = uniqueExamTitle(baseTitle, used);
          guard++;
        }
      }
    } catch { /* Optional disk folder check. */ }
  }
  return candidate;
}

/**
 * Collects canonical resource keys and human-readable labels for the selected sources
 * (open note, Recents, folders, local files, Drive files) so Saved resources can
 * link exams back to any resource or folder used to create them.
 */
export async function collectSourceLinks(sources, resolved, { groups = null, openDocResource = null } = {}) {
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
      const members = (typeof groups?.members === 'function'
        ? await groups.members(s.group).catch(() => [])
        : s.group.members) || [];
      for (const m of members) {
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
      <div class="expand-mode-bar exam-mode-bar">
        <input id="examMode" type="hidden" value="create" />
        <div class="exam-mode-row">
          <span class="exam-mode-label">Mode:</span>
          <div class="expand-mode-pills" role="group" aria-label="Exam mode">
            <button type="button" data-exam-mode="create" aria-pressed="true">Create exam</button>
            <button type="button" data-exam-mode="solve" aria-pressed="false">Solve fed exam</button>
          </div>
        </div>
        <p id="examModeDesc" class="muted exam-mode-desc"></p>
      </div>
      <div class="exam-dlg-grid">
        <section class="exam-col">
          <h3 id="examSourceHeading" class="exam-sub">1. Study sources</h3>
          <div id="examSourceMount"></div>
        </section>
        <section class="exam-col exam-opts">
          <h3 id="examOptsHeading" class="exam-sub">2. Exam structure</h3>
          <label class="exam-field">Exam title
            <input id="examTitle" type="text" placeholder="Auto from selected sources" spellcheck="false" />
          </label>
          <div id="examCreateOpts">
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
          </div>
          <div id="examSolveOpts" hidden>
            <label class="exam-field">Solved layout &amp; format
              <select id="examSolveFormat" data-native>
                <option value="pdf" selected>Exercise → New Page → Solution (A4 PDF + KaTeX math .nfedit)</option>
                <option value="mcp">Handwritten Notebook + MCP Math Boxes (.nfedit)</option>
              </select>
            </label>
            <label class="sp-check exam-theory-toggle">
              <input id="examSolveTape" type="checkbox" />
              <span>Cover Solution pages with scratch-to-reveal Noteful tape</span>
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
            <span>Include blue Theory / Formula boxes</span>
          </label>
          <label class="exam-field">Extra instructions
            <textarea id="examInstructions" rows="2" placeholder="Optional focus or solving instructions…"></textarea>
          </label>
          <div id="examAiRow" class="hw-ai-row hw-tools"${ai ? '' : ' hidden'}>
            <select id="examTool" data-native aria-label="AI tool"></select>
            <select id="examModel" data-native aria-label="Model"></select>
            <input id="examModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden />
          </div>
          <p id="examStatus" class="muted hw-ai-status" role="status"></p>
          <div id="examDraftBar" class="exam-ready" hidden>
            <strong id="examDraftLabel"></strong>
            <div class="exam-ready-btns">
              <button id="examContinueBtn" type="button" class="primary">Continue from saved progress</button>
              <button id="examRestartBtn" type="button">Restart from scratch</button>
              <button id="examDismissDraftBtn" type="button">Dismiss</button>
            </div>
          </div>
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

    el('examDialogTitle').replaceChildren(icon('exam'), document.createTextNode(' Create / Solve exam with AI'));
    el('examCloseX').replaceChildren(icon('close'));
    el('examGenerate').replaceChildren(icon('spark'), document.createTextNode(' Create exam'));
    el('examOpenBtn').replaceChildren(icon('open'), document.createTextNode(' Open exam'));
    el('examPdfBtn').replaceChildren(icon('pdf'), document.createTextNode(' Save .pdf'));
    el('examHtmlBtn').replaceChildren(icon('text'), document.createTextNode(' Save .html'));

    for (const pill of dialog.querySelectorAll('[data-exam-mode]')) {
      pill.onclick = () => setExamMode(pill.dataset.examMode);
    }
    setExamMode('create');

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

    el('examGenerate').onclick = () => generate({ resume: false });
    el('examContinueBtn').onclick = () => generate({ resume: true });
    el('examRestartBtn').onclick = () => {
      clearAiDraft(store, DRAFT_KEY);
      syncDraftBar();
      generate({ resume: false });
    };
    el('examDismissDraftBtn').onclick = () => {
      clearAiDraft(store, DRAFT_KEY);
      syncDraftBar();
    };
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

  function setExamMode(nextMode) {
    const mode = nextMode === 'solve' ? 'solve' : 'create';
    el('examMode').value = mode;
    for (const pill of dialog.querySelectorAll('[data-exam-mode]')) {
      pill.setAttribute('aria-pressed', String(pill.dataset.examMode === mode));
    }
    const isSolve = mode === 'solve';
    el('examCreateOpts').hidden = isSolve;
    el('examSolveOpts').hidden = !isSolve;
    el('examSourceHeading').textContent = isSolve ? '1. Exam to solve (+ optional reference notes)' : '1. Study sources';
    el('examOptsHeading').textContent = isSolve ? '2. Solution format & layout' : '2. Exam structure';
    el('examModeDesc').textContent = isSolve
      ? 'An orchestrator cuts the exam into logical exercises, parallel subagents solve each one, and each Exercise (with Steps) is followed on a NEW PAGE by Solution (Exercise N).'
      : 'Splits large source sets into parallel topic blocks, generates multi-format questions with KaTeX math, and renders printable A4 PDF + Noteful tape.';
    el('examGenerate').replaceChildren(
      icon('spark'),
      document.createTextNode(isSolve ? ' Split & solve exam' : ' Create exam'),
    );
    syncDraftBar();
  }

  function syncDraftBar() {
    const draft = loadAiDraft(store, DRAFT_KEY);
    if (!draft || (!draft.prompt && !draft.chunkTasks?.length && !draft.exercises?.length)) {
      el('examDraftBar').hidden = true;
      return;
    }
    let detail = 'sources ready';
    if (draft.mode === 'solve' && Array.isArray(draft.exercises)) {
      const done = (draft.solved || []).filter(Boolean).length;
      detail = `${done}/${draft.exercises.length} exercises solved`;
    } else if (Array.isArray(draft.chunkTasks)) {
      const done = (draft.completed || []).filter(Boolean).length;
      detail = `${done}/${draft.chunkTasks.length} blocks done`;
    } else if (draft.partialText?.length) {
      detail = `${draft.partialText.length} chars saved`;
    }
    el('examDraftLabel').textContent = `Saved ${draft.mode === 'solve' ? 'solve' : 'exam'} progress for “${draft.title || 'Exam'}” (${detail}) — continue or restart from scratch.`;
    el('examDraftBar').hidden = false;
  }

  async function saveFinalExamArchive({ title, fileName, outFile, pageCount, tapeCount, resolved, sources, draft, origin = 'AI Exam' }) {
    const targetFolderId = el('examFolder').value;
    const targetGroup = targetFolderId ? (await groups?.folders?.())?.find((g) => g.id === targetFolderId) : null;
    let entry = null;
    if (library?.rememberImported) {
      entry = await library.rememberImported(outFile, {
        origin,
        folder: targetGroup?.name || '',
      });
      if (targetGroup && groups?.move && entry) {
        await groups.move({ key: entry.key, name: entry.name, source: 'imported' }, targetGroup);
      }
      const { resourceKeys, resourceLabels } = draft
        ? { resourceKeys: [...(draft.resourceKeys || [])], resourceLabels: [...(draft.resourceLabels || [])] }
        : await collectSourceLinks(sources, resolved, { groups, openDocResource });
      if (targetGroup?.id) resourceKeys.push(...resourceKeysFor({ folderIds: [targetGroup.id] }));
      await recordExam(library?.store, {
        id: entry?.key || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        entryKey: entry?.key || '',
        title,
        fileName,
        pageCount,
        tapeCount,
        created: Date.now(),
        resourceKeys,
        resourceLabels,
      }).catch(() => {});
      refreshHome?.();
    }
    return entry;
  }

  async function generate({ resume = false } = {}) {
    if (running) return;
    if (!ai) { el('examStatus').textContent = 'Connect an AI tool first (Help → Connect AI tools…).'; return; }
    const draft = resume ? loadAiDraft(store, DRAFT_KEY) : null;
    if (resume && !draft) { el('examStatus').textContent = 'No saved exam progress to continue.'; return; }
    const mode = draft?.mode || el('examMode').value || 'create';
    if (draft?.mode) setExamMode(draft.mode);

    const sources = picker.list();
    if (!draft && !sources.length) { el('examStatus').textContent = 'Select at least one note, folder, file or topic first.'; return; }
    const types = Array.from(dialog.querySelectorAll('input[name="examType"]:checked')).map((c) => c.value);
    if (!draft && mode === 'create' && !types.length) { el('examStatus').textContent = 'Pick at least one problem type.'; return; }
    const provider = el('examTool').value || draft?.provider;
    if (!provider) { el('examStatus').textContent = 'No AI tool is available.'; return; }

    const prefs = draft?.prefs || {
      mode,
      focus: el('examFocus').value,
      difficulty: el('examDifficulty').value,
      countMode: el('examCountMode').value,
      count: Number(el('examCount').value) || 12,
      language: el('examLanguage').value,
      includeTheory: el('examIncludeTheory').checked,
      solveFormat: el('examSolveFormat').value,
      tapeSolutions: el('examSolveTape').checked,
      types,
    };
    if (!draft) savePrefs(prefs);

    const ac = new AbortController();
    running = ac;
    el('examGenerate').disabled = true;
    el('examContinueBtn').disabled = true;
    el('examRestartBtn').disabled = true;
    el('examCancel').textContent = 'Stop';
    el('examReadyBar').hidden = true;
    el('examDraftBar').hidden = true;
    el('examStatus').textContent = draft ? 'Resuming from saved progress…' : 'Reading selected sources…';
    const job = jobs?.start?.(
      draft
        ? (mode === 'solve' ? 'Resuming exam solve…' : 'Resuming exam…')
        : (mode === 'solve' ? 'Solving exam…' : 'Creating exam…'),
      { onCancel: () => ac.abort() },
    );

    let checkpoint = draft ? { ...draft } : null;
    let streamed = '';
    try {
      const m = model.value;
      const orch = await createDocOrchestrator({
        ai,
        primaryProvider: provider,
        primaryModel: m,
        store,
        signal: ac.signal,
        onStatus: (msg) => {
          el('examStatus').textContent = msg;
          job?.progress?.(msg);
        },
        onSwitch: (info) => {
          status?.(`${info.fromLabel} failed — handing off to ${info.toLabel}.`);
        },
      });
      const caps = orch.capabilities();
      const userTitle = el('examTitle').value.trim() || draft?.title || '';
      const extraInstructions = el('examInstructions').value.trim();

      let resolved = [];
      if (!draft) {
        resolved = await resolveSources(sources, {
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
      }

      if (mode === 'solve') {
        if (!checkpoint?.exercises?.length) {
          const bundle = formatSourceBundle(resolved, { maxChars: 90000 });
          const vis = await collectVisualCandidates(resolved, { maxImages: 6, maxWidth: 1000, renderMissing: caps.vision !== false });
          const defaultTitle = userTitle || `${resolved[0].title} — Solved`;
          const sourceLinks = await collectSourceLinks(sources, resolved, { groups, openDocResource });

          // Stage 1: Splitter cuts fed exam verbatim into self-contained exercises.
          let splitStream = '';
          el('examStatus').textContent = 'Stage 1/3 · Splitting exam into logical exercises…';
          job?.progress?.('Stage 1/3 · Splitting exam');
          const splitPromptText = solveSplitPrompt({
            title: defaultTitle,
            sourcesText: bundle.promptText,
            visualCatalogText: vis.manifest,
            language: prefs.language,
            instructions: extraInstructions,
          });
          const splitRes = await orch.runStage({
            prompt: splitPromptText,
            images: caps.vision === false ? [] : (vis.images.length ? vis.images : bundle.images),
            tag: 'solve-split',
            label: 'Splitter · cut exam into exercises',
            kind: 'exam',
            small: model.small,
            vision: caps.vision !== false,
            onDelta: (chunk) => {
              splitStream += chunk;
              el('examStatus').textContent = `Stage 1/3 · Splitting exam… (${splitStream.length} chars)`;
            },
          });
          if (ac.signal.aborted) throw Error('Cancelled.');

          let splitRaw = null;
          try { splitRaw = jsonFrom(splitRes.text); } catch { splitRaw = null; }
          const rawSplitData = cleanSplitExercises(splitRaw, bundle.promptText, userTitle || defaultTitle);
          const resolvedSplit = await resolveExamVisualCutouts(
            { exercises: rawSplitData.exercises },
            resolved,
            { preloadedImages: vis.images },
          );
          const splitData = { ...rawSplitData, exercises: resolvedSplit.exercises || rawSplitData.exercises };
          checkpoint = {
            mode: 'solve',
            title: userTitle || splitData.title || defaultTitle,
            language: prefs.language !== 'auto' ? prefs.language : (splitData.language || 'auto'),
            exercises: splitData.exercises,
            solved: Array(splitData.exercises.length).fill(null),
            referenceText: resolved.length > 1
              ? formatSourceBundle(resolved.slice(1), { maxChars: 14000 }).promptText
              : '',
            prefs,
            provider: orch.provider,
            resourceKeys: sourceLinks.resourceKeys,
            resourceLabels: sourceLinks.resourceLabels,
          };
          saveAiDraft(store, DRAFT_KEY, checkpoint);
        }

        // Stage 2: Solve every exercise concurrently across up to PARALLEL_WORKERS subagents.
        const exercises = checkpoint.exercises;
        const initialSolved = [...(checkpoint.solved || Array(exercises.length).fill(null))];
        const initialDone = initialSolved.filter(Boolean).length;

        el('examStatus').textContent = `Stage 2/3 · Solving ${exercises.length} exercise${exercises.length === 1 ? '' : 's'} in parallel…`;
        job?.progress?.(`Solving ${initialDone}/${exercises.length} exercises`);

        const solved = await orch.runSubagents({
          items: exercises,
          concurrency: PARALLEL_WORKERS,
          initialResults: initialSolved,
          small: model.small,
          buildRequest: (ex, idx, { caps: wCaps }) => {
            const exImages = [];
            if (wCaps.vision !== false && ex.visual?.type === 'cutout' && ex.visual.dataUrl) {
              const dec = dataUrlToBytes(ex.visual.dataUrl);
              if (dec?.bytes?.length) {
                exImages.push({ bytes: dec.bytes, type: dec.type, label: ex.visual.caption || `exercise-${ex.number || idx + 1}` });
              }
            }
            const prompt = solveChunkPrompt({
              exercise: ex,
              examTitle: checkpoint.title,
              referenceText: checkpoint.referenceText || '',
              language: checkpoint.language || prefs.language,
              instructions: extraInstructions,
            });
            return {
              prompt,
              images: exImages,
              tag: 'solve-chunk',
              label: `Solver · Ex ${ex.number || idx + 1}`,
            };
          },
          parseResult: async (text, ex, idx) => {
            const cleanedEx = cleanSolvedExercise(jsonFrom(text), ex, idx);
            return resolved.length
              ? (await resolveExamVisualCutouts({ exercises: [cleanedEx] }, resolved)).exercises[0]
              : cleanedEx;
          },
          onItemDone: (idx, parsed, { done, total, provider: p, providerLabel: pLabel }) => {
            initialSolved[idx] = parsed;
            checkpoint.solved = [...initialSolved];
            checkpoint.provider = p;
            saveAiDraft(store, DRAFT_KEY, checkpoint);
            el('examStatus').textContent = `Stage 2/3 · Solved ${done}/${total} exercises (${pLabel})…`;
            job?.progress?.(`Solved ${done}/${total} exercises`);
          },
        });
        if (ac.signal.aborted) throw Error('Cancelled.');

        // Stage 3: Deterministic Composer (Exercise N + Steps -> NEW PAGE -> Solution N)
        const finalSolvedTitle = await resolveUniqueExamTitle(userTitle || checkpoint.title, { library });
        const solvedExam = {
          title: finalSolvedTitle,
          exercises: solved.filter(Boolean),
        };
        el('examStatus').textContent = 'Stage 3/3 · Composing alternating Exercise / Solution pages…';
        job?.progress?.('Composing solved exam…');

        const fileName = `${safeFileBase(solvedExam.title)}.nfedit`;
        let outFile;
        let pdfBytes = null;
        let interactiveHtml = '';
        let pageCount = 0;
        let tapeCount = 0;

        if (prefs.solveFormat === 'mcp') {
          await ensureExamMathRenderer();
          interactiveHtml = buildSolvedExamHtml(solvedExam, {
            showTheory: prefs.includeTheory,
            tapeSolutions: prefs.tapeSolutions,
            interactiveFallback: true,
          });
          const md = buildSolvedExamMcpMarkdown(solvedExam, {
            tapeSolutions: prefs.tapeSolutions,
            showTheory: prefs.includeTheory,
          });
          const composeOpts = optionsFrom({
            look: 'classic',
            paper: 'lined',
            theme: 'ivory',
            font: 'patrick',
            hand: 'natural',
            pen: 'fountain',
            accent: 'navy',
          });
          const composed = await call('composeNoteFile', {
            title: solvedExam.title,
            markdown: md,
            options: composeOpts,
            exam: { html: interactiveHtml, source: { mode: 'solve', exam: solvedExam, prefs } },
          });
          outFile = new File([composed.project], fileName, { type: 'application/octet-stream' });
          pageCount = composed.pages || solvedExam.exercises.length * 2;
        } else {
          await ensureExamMathRenderer();
          const printHtml = buildSolvedExamHtml(solvedExam, {
            showTheory: prefs.includeTheory,
            tapeSolutions: prefs.tapeSolutions,
            interactiveFallback: false,
          });
          interactiveHtml = buildSolvedExamHtml(solvedExam, {
            showTheory: prefs.includeTheory,
            tapeSolutions: prefs.tapeSolutions,
            interactiveFallback: true,
          });
          const rendered = await renderExamPdfAndTapes(printHtml, { title: solvedExam.title, call });
          const pdfTransfer = rendered.pdf.slice().buffer;
          const projectJson = await call('createPdfNoteWithTapes', {
            title: solvedExam.title,
            sizes: rendered.sizes,
            pdf: pdfTransfer,
            tapes: prefs.tapeSolutions ? rendered.tapes : [],
            exam: { html: interactiveHtml, source: { mode: 'solve', exam: solvedExam, prefs } },
          }, [pdfTransfer]);
          outFile = new File([projectJson], fileName, { type: 'application/octet-stream' });
          pdfBytes = rendered.pdf;
          pageCount = rendered.pageCount;
          tapeCount = prefs.tapeSolutions ? rendered.tapes.length : 0;
        }

        const entry = await saveFinalExamArchive({
          title: solvedExam.title,
          fileName,
          outFile,
          pageCount,
          tapeCount,
          resolved,
          sources,
          draft,
          origin: 'AI Solved Exam',
        });

        clearAiDraft(store, DRAFT_KEY);
        syncDraftBar();
        lastResult = {
          title: solvedExam.title,
          file: outFile,
          entry,
          pdf: pdfBytes,
          interactiveHtml,
          pageCount,
          tapeCount,
        };
        el('examPdfBtn').hidden = !pdfBytes;
        el('examHtmlBtn').hidden = !interactiveHtml;
        el('examOpenBtn').replaceChildren(icon('open'), document.createTextNode(' Open solved exam'));
        el('examReadyLabel').textContent = `Solved: ${solvedExam.exercises.length} exercise${solvedExam.exercises.length === 1 ? '' : 's'} · ${pageCount} pages${tapeCount ? ` · ${tapeCount} taped answers` : ''} — saved to Recent!`;
        el('examReadyBar').hidden = false;
        el('examStatus').textContent = '';
        job?.done?.(`Solved "${solvedExam.title}" (${solvedExam.exercises.length} exercises, ${pageCount} pages).`);
        status?.(`Solved "${solvedExam.title}" and saved to Recent.`);
        return;
      }

      // ---- CREATE EXAM MODE (Stage 1 Planner -> Stage 2 Parallel Writers -> Stage 3 Composer) ----
      let exam = null;
      const totalChars = resolved.reduce((s, d) => s + String(d?.text || '').length, 0);
      const useParallelCreate = draft?.parallel
        || resolved.length >= 2
        || totalChars >= 16000;

      if (useParallelCreate) {
        if (!checkpoint?.chunkTasks?.length) {
          const defaultTitle = userTitle || `${resolved[0].title}${resolved.length > 1 ? ` + ${resolved.length - 1} more` : ''} — Exam`;
          const sourceLinks = await collectSourceLinks(sources, resolved, { groups, openDocResource });

          let plan;
          if (resolved.length >= 3) {
            el('examStatus').textContent = `Stage 1/3 · Planning parallel blocks across ${resolved.length} sources…`;
            job?.progress?.('Stage 1/3 · Planning blocks');
            const catalogText = buildSourceCatalog(resolved);
            const planRes = await orch.runStage({
              prompt: examPlanPrompt({
                title: defaultTitle,
                catalogText,
                docCount: resolved.length,
                countMode: prefs.countMode,
                count: prefs.count,
                focus: prefs.focus,
                language: prefs.language,
              }),
              images: [],
              tag: 'exam-plan',
              label: 'Planner · organize blocks',
              kind: 'exam',
              small: model.small,
              vision: false,
            });
            if (ac.signal.aborted) throw Error('Cancelled.');
            let parsedPlan = null;
            try { parsedPlan = jsonFrom(planRes.text); } catch { parsedPlan = null; }
            plan = cleanExamPlan(parsedPlan, resolved, { countMode: prefs.countMode, count: prefs.count });
          } else {
            plan = {
              title: defaultTitle,
              subtitle: '',
              chunks: buildFallbackExamPlan(resolved, { countMode: prefs.countMode, count: prefs.count }),
            };
          }

          const chunkTasks = await Promise.all(plan.chunks.map(async (chunk) => {
            const docs = chunk.docIndices.map((idx) => resolved[idx]).filter(Boolean);
            const chunkBundle = formatSourceBundle(docs, { maxChars: 26000 });
            const chunkVis = await collectVisualCandidates(docs, { maxImages: 4, maxWidth: 1000, renderMissing: caps.vision !== false });
            const chunkImages = caps.vision === false ? [] : (chunkVis.images.length ? chunkVis.images : chunkBundle.images);
            const chunkCountMode = chunk.count > 0 ? 'exact' : prefs.countMode;
            const chunkCount = chunk.count > 0 ? chunk.count : prefs.count;
            const prompt = examPrompt({
              title: `${userTitle || plan.title || defaultTitle} — ${chunk.heading}`,
              sourcesText: chunkBundle.promptText,
              visualCatalogText: chunkVis.manifest,
              types: prefs.types,
              countMode: chunkCountMode,
              count: chunkCount,
              difficulty: prefs.difficulty,
              focus: prefs.focus,
              language: prefs.language,
              includeTheory: prefs.includeTheory,
              instructions: [
                `Write ONE cohesive section titled "${chunk.heading}" (badge "${chunk.badge}", badgeKind "${chunk.badgeKind}").`,
                chunk.focusNote ? `Block emphasis: ${chunk.focusNote}` : '',
                extraInstructions,
              ].filter(Boolean).join('\n'),
            });
            return {
              heading: chunk.heading,
              badge: chunk.badge,
              prompt,
              imageCount: chunkImages.length,
              images: chunkImages,
              docs,
            };
          }));

          checkpoint = {
            mode: 'create',
            parallel: true,
            title: userTitle || plan.title || defaultTitle,
            subtitle: plan.subtitle || '',
            chunkTasks: chunkTasks.map(({ images: _imgs, docs: _docs, ...rest }) => rest),
            completed: Array(chunkTasks.length).fill(null),
            prefs,
            provider,
            resourceKeys: sourceLinks.resourceKeys,
            resourceLabels: sourceLinks.resourceLabels,
            _runtimeImages: chunkTasks.map((t) => t.images),
            _runtimeDocs: chunkTasks.map((t) => t.docs),
          };
          saveAiDraft(store, DRAFT_KEY, { ...checkpoint, _runtimeImages: undefined, _runtimeDocs: undefined });
        }

        const chunkTasks = checkpoint.chunkTasks;
        const initialCompleted = [...(checkpoint.completed || Array(chunkTasks.length).fill(null))];
        const runtimeImages = checkpoint._runtimeImages || [];
        const runtimeDocs = checkpoint._runtimeDocs || [];
        const initialFinished = initialCompleted.filter(Boolean).length;

        el('examStatus').textContent = `Stage 2/3 · Running ${chunkTasks.length} parallel exam subagents…`;
        job?.progress?.(`Blocks ${initialFinished}/${chunkTasks.length}`);

        const completed = await orch.runSubagents({
          items: chunkTasks,
          concurrency: PARALLEL_WORKERS,
          initialResults: initialCompleted,
          small: model.small,
          buildRequest: (task, ci) => ({
            prompt: task.prompt,
            images: runtimeImages[ci] || [],
            tag: 'exam',
            label: `Block ${ci + 1}/${chunkTasks.length} · ${task.heading}`,
          }),
          parseResult: async (text, _task, ci) => {
            const cleanedChunk = cleanExamData(jsonFrom(text));
            return resolveExamVisualCutouts(
              cleanedChunk,
              runtimeDocs[ci] || resolved,
              { preloadedImages: runtimeImages[ci] || [] },
            );
          },
          onItemDone: (ci, parsed, { done, total, provider: p, providerLabel: pLabel }) => {
            initialCompleted[ci] = parsed;
            checkpoint.completed = [...initialCompleted];
            checkpoint.provider = p;
            saveAiDraft(store, DRAFT_KEY, { ...checkpoint, _runtimeImages: undefined, _runtimeDocs: undefined });
            el('examStatus').textContent = `Stage 2/3 · Finished ${done}/${total} exam blocks (${pLabel})…`;
            job?.progress?.(`Blocks ${done}/${total}`);
          },
        });
        if (ac.signal.aborted) throw Error('Cancelled.');

        el('examStatus').textContent = 'Stage 3/3 · Composing exam blocks & laying out PDF…';
        exam = mergeExamSections(completed, {
          title: userTitle || checkpoint.title,
          subtitle: checkpoint.subtitle,
        });
      } else {
        // Single short source path with streaming + resume support.
        let basePrompt = draft?.prompt || '';
        let images = [];
        let visImages = [];
        if (!draft) {
          const bundle = formatSourceBundle(resolved);
          const vis = await collectVisualCandidates(resolved, { maxImages: 6, maxWidth: 1000, renderMissing: caps.vision !== false });
          visImages = vis.images;
          images = vis.images.length ? vis.images : bundle.images;
          const defaultTitle = userTitle || `${resolved[0].title} — Exam`;
          basePrompt = examPrompt({
            title: userTitle || defaultTitle,
            sourcesText: bundle.promptText,
            visualCatalogText: vis.manifest,
            types: prefs.types,
            countMode: prefs.countMode,
            count: prefs.count,
            difficulty: prefs.difficulty,
            focus: prefs.focus,
            language: prefs.language,
            includeTheory: prefs.includeTheory,
            instructions: extraInstructions,
          });
          const sourceLinks = await collectSourceLinks(sources, resolved, { groups, openDocResource });
          checkpoint = {
            mode: 'create',
            title: userTitle || defaultTitle,
            prompt: basePrompt,
            partialText: '',
            prefs,
            provider,
            resourceKeys: sourceLinks.resourceKeys,
            resourceLabels: sourceLinks.resourceLabels,
          };
          saveAiDraft(store, DRAFT_KEY, checkpoint);
        }

        const finalPrompt = draft
          ? buildContinuationPrompt({ basePrompt, partialText: draft.partialText || '', kind: 'exam' })
          : basePrompt;

        el('examStatus').textContent = draft ? 'Continuing exam generation with AI…' : 'Generating exam problems with AI…';
        job?.progress?.('Writing exam questions…');
        let lastSavedAt = 0;
        const res = await orch.runStage({
          prompt: finalPrompt,
          images: caps.vision === false ? [] : images,
          tag: 'exam',
          label: 'Exam generator',
          kind: 'exam',
          initialPartialText: draft?.partialText || '',
          small: model.small,
          vision: caps.vision !== false,
          onDelta: (chunk, { totalStreamed }) => {
            streamed += chunk;
            el('examStatus').textContent = `Generating exam… (${totalStreamed} chars received)`;
            if (checkpoint && Date.now() - lastSavedAt > 4000) {
              lastSavedAt = Date.now();
              saveAiDraft(store, DRAFT_KEY, { ...checkpoint, provider: orch.provider, partialText: `${draft?.partialText || ''}${streamed}` });
            }
          },
        });
        if (ac.signal.aborted) throw Error('Cancelled.');
        const priorPartial = res.partialText || draft?.partialText || '';
        const parsed = priorPartial
          ? mergePartialExamJson(priorPartial, res.text)
          : jsonFrom(res.text);
        exam = await resolveExamVisualCutouts(
          cleanExamData(parsed),
          resolved,
          { preloadedImages: visImages },
        );
      }

      if (userTitle) exam.title = userTitle;
      exam.title = await resolveUniqueExamTitle(exam.title, { library });
      el('examStatus').textContent = 'Laying out A4 PDF and measuring answer tape…';
      job?.progress?.('Rendering PDF & tape…');
      await ensureExamMathRenderer();
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
        exam: { html: interactiveHtml, source: { mode: 'create', exam, prefs } },
      }, [pdfTransfer]);

      const fileName = `${safeFileBase(exam.title)}.nfedit`;
      const outFile = new File([projectJson], fileName, { type: 'application/octet-stream' });
      const entry = await saveFinalExamArchive({
        title: exam.title,
        fileName,
        outFile,
        pageCount: rendered.pageCount,
        tapeCount: rendered.tapes.length,
        resolved,
        sources,
        draft,
        origin: 'AI Exam',
      });

      clearAiDraft(store, DRAFT_KEY);
      syncDraftBar();
      lastResult = {
        title: exam.title,
        file: outFile,
        entry,
        pdf: rendered.pdf,
        interactiveHtml,
        pageCount: rendered.pageCount,
        tapeCount: rendered.tapes.length,
      };
      el('examPdfBtn').hidden = false;
      el('examHtmlBtn').hidden = false;
      el('examOpenBtn').replaceChildren(icon('open'), document.createTextNode(' Open taped exam'));
      el('examReadyLabel').textContent = `Ready: ${rendered.pageCount} A4 page${rendered.pageCount === 1 ? '' : 's'} · ${rendered.tapes.length} taped answer${rendered.tapes.length === 1 ? '' : 's'} — saved to Recent!`;
      el('examReadyBar').hidden = false;
      el('examStatus').textContent = '';
      job?.done?.(`Created exam "${exam.title}" (${rendered.pageCount} pages, ${rendered.tapes.length} answer tapes).`);
      status?.(`Created exam "${exam.title}" (${rendered.tapes.length} taped answers) and saved to Recent.`);
    } catch (e) {
      if (checkpoint) {
        const cleanCheckpoint = { ...checkpoint };
        delete cleanCheckpoint._runtimeImages;
        delete cleanCheckpoint._runtimeDocs;
        if (!cleanCheckpoint.parallel && cleanCheckpoint.mode !== 'solve') {
          cleanCheckpoint.partialText = `${draft?.partialText || ''}${streamed}`;
        }
        cleanCheckpoint.reason = e?.message || String(e);
        saveAiDraft(store, DRAFT_KEY, cleanCheckpoint);
        syncDraftBar();
      }
      el('examStatus').textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      running = null;
      el('examGenerate').disabled = false;
      el('examContinueBtn').disabled = false;
      el('examRestartBtn').disabled = false;
      el('examCancel').textContent = 'Cancel';
    }
  }

  return {
    async open({ preselectOpen = false, mode = 'create' } = {}) {
      if (!dialog) build();
      const prefs = loadPrefs();
      if (prefs.focus) el('examFocus').value = prefs.focus;
      if (prefs.difficulty) el('examDifficulty').value = prefs.difficulty;
      if (prefs.countMode) el('examCountMode').value = prefs.countMode;
      if (prefs.count) el('examCount').value = prefs.count;
      if (prefs.language) el('examLanguage').value = prefs.language;
      if (typeof prefs.includeTheory === 'boolean') el('examIncludeTheory').checked = prefs.includeTheory;
      if (prefs.solveFormat) el('examSolveFormat').value = prefs.solveFormat;
      if (typeof prefs.tapeSolutions === 'boolean') el('examSolveTape').checked = prefs.tapeSolutions;
      if (Array.isArray(prefs.types) && prefs.types.length) {
        for (const cb of dialog.querySelectorAll('input[name="examType"]')) cb.checked = prefs.types.includes(cb.value);
      }
      setExamMode(mode === 'solve' ? 'solve' : 'create');
      el('examCountBox').hidden = el('examCountMode').value !== 'exact';
      el('examReadyBar').hidden = true;
      el('examStatus').textContent = '';
      syncDraftBar();
      dialog.showModal();
      await picker.refresh({ preselectOpen });
      await fillFoldersAndTools();
    },
    get visible() { return !!dialog?.open; },
  };
}
