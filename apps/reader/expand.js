// Pages / Study -> Expand with AI...
// Expands the currently open note or exam by adding new pages generated from selected
// Recents, folders, local PDFs/Docs, Drive files, or topic prompts:
// - Note mode: generates Markdown and inserts real handwritten ink pages via MCP (insertHandwritten).
// - Exam mode: generates A4 HTML exam problems -> PDF -> inserts pages + Noteful answer tape.
import { icon } from './icons.js';
import { LOOK_FIELDS, titleOf } from './convert.js';
import { jsonFrom } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { compactDialect, runAI } from './small-model.js';
import { createSourcePicker } from './source-picker.js';
import { resolveSources, formatSourceBundle } from './source-extract.js';
import { PROBLEM_TYPES, FOCUS_MODES, examPrompt, cleanExamData, buildPaginatedExamHtml } from './exam-html.js';
import { renderExamPdfAndTapes } from './exam-pdf.js';
import { pdfPages, insertAt, UNITS_PER_POINT } from './insert-pages.js';
import { batchNotePrompt } from './batch-notes.js';
import { listExams, examsForResource, recordExam } from './exam-index.js';
import { collectSourceLinks } from './exam.js';

const STORE = 'notecomplete-expand-prefs';
const LOOK_LABELS = {
  look: 'Look',
  paper: 'Paper',
  theme: 'Theme',
  font: 'Handwriting',
  hand: 'Naturalness',
  pen: 'Pen',
  accent: 'Accent',
};

/**
 * Converts a Uint8Array cleanly in chunks to base64 for worker PDF insertion.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Builds concise guidance so AI generates expansion pages rather than repeating the open document.
 * @param {{ existingSummary?: string, instructions?: string, kind: 'note'|'exam', openTitle?: string, openPages?: number }} opts
 * @returns {string}
 */
export function buildExpandGuidance({ existingSummary = '', instructions = '', kind = 'note', openTitle = '', openPages = 0 } = {}) {
  const parts = [];
  if (kind === 'exam') {
    parts.push(`You are EXPANDING an existing exam "${openTitle || 'Exam'}" (currently ${openPages || 'several'} page(s)).`);
    parts.push('Generate ONLY NEW, complementary problems/sections from the selected source files that are NOT already covered in the existing pages.');
    if (existingSummary) parts.push(`Excerpt of existing exam content to avoid duplicating:\n${existingSummary.slice(0, 3500)}`);
  } else {
    parts.push(`You are EXPANDING an existing handwritten notebook "${openTitle || 'Note'}" (currently ${openPages || 'several'} page(s)) by writing NEW pages to append/insert.`);
    parts.push('Add clear headings, explanations, formulas, diagrams/lists from the selected source files without repeating material already in the existing pages.');
    if (existingSummary) parts.push(`Excerpt of existing notebook content:\n${existingSummary.slice(0, 3000)}`);
  }
  if (instructions?.trim()) parts.push(`User expansion instructions: ${instructions.trim()}`);
  return parts.join('\n\n');
}

/**
 * Detects whether the open document is best expanded as an exam (pre-applied tape PDF)
 * or as handwritten notebook ink pages.
 * @param {{ existingExam?: object|null, hasTapeOnPages?: boolean, openTitle?: string }} info
 * @returns {'exam'|'note'}
 */
export function detectExpandMode({ existingExam = null, hasTapeOnPages = false, openTitle = '' } = {}) {
  if (existingExam || hasTapeOnPages) return 'exam';
  if (/\bexam\b|\bexamen\b|\bsimulacro\b/i.test(String(openTitle || ''))) return 'exam';
  return 'note';
}

export function expandController({
  call,
  openPdf,
  library,
  groups,
  hasOpenDoc = () => false,
  canInsertPdf = () => true,
  openDocTitle = () => 'Current note',
  openDocPages = () => 0,
  currentPage = () => 0,
  openDocResource = () => ({}),
  openDocHasTape = () => false,
  pageText,
  pageCanvas,
  notesText,
  insertHandwrittenPages,
  insertPdfPagesWithTapes,
  jobs,
  ai,
  status,
  store = globalThis.localStorage,
}) {
  let dialog = null;
  let picker = null;
  let model = null;
  let running = null;

  const el = (id) => dialog.querySelector(`#${id}`);
  const loadPrefs = () => { try { return JSON.parse(store?.getItem(STORE) || '{}'); } catch { return {}; } };
  const savePrefs = (p) => { try { store?.setItem(STORE, JSON.stringify(p)); } catch { /* Optional. */ } };

  function syncModeFields() {
    const mode = el('expMode').value;
    el('expNoteOpts').hidden = mode !== 'note';
    el('expExamOpts').hidden = mode !== 'exam';
    el('expCountBox').hidden = mode !== 'exam' || el('expCountMode').value !== 'exact';
  }

  function build() {
    dialog = document.createElement('dialog');
    dialog.id = 'expandDialog';
    dialog.className = 'ocr-dialog expand-dialog';
    dialog.setAttribute('aria-labelledby', 'expDialogTitle');

    const lookSelects = Object.entries(LOOK_FIELDS).map(([key, opts]) =>
      `<label class="exam-field">${LOOK_LABELS[key]}<select id="exp-${key}" data-native>${opts.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>`).join('');
    const typeChecks = PROBLEM_TYPES.map(([id, label]) =>
      `<label class="exam-type-opt"><input type="checkbox" name="expExamType" value="${id}" checked /><span>${label}</span></label>`).join('');
    const focusOpts = FOCUS_MODES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');

    dialog.innerHTML = `
      <div class="exam-dlg-head">
        <h2 id="expDialogTitle"></h2>
        <button id="expCloseX" type="button" class="dlg-close" aria-label="Close"></button>
      </div>
      <p id="expTargetDesc" class="muted">Add AI-generated pages from selected Recents, folders, PDFs, Office docs, Drive files, or topics directly into the open document.</p>
      <div class="exam-dlg-grid">
        <section class="exam-col">
          <h3 class="exam-sub">1. Sources to expand from</h3>
          <div id="expSourceMount"></div>
        </section>
        <section class="exam-col exam-opts">
          <h3 class="exam-sub">2. Pages to add</h3>
          <div class="exam-row-2">
            <label class="exam-field">Add pages as
              <select id="expMode" data-native>
                <option value="note">Handwritten pages (MCP ink)</option>
                <option value="exam">Exam PDF pages (with answer tape)</option>
              </select>
            </label>
            <label class="exam-field">Where to insert
              <select id="expWhere" data-native>
                <option value="end" selected>At end of document</option>
                <option value="after">After current page</option>
                <option value="before">Before current page</option>
              </select>
            </label>
          </div>
          <label class="exam-field">Language
            <select id="expLanguage" data-native>
              <option value="auto">Match source</option>
              <option value="English">English</option>
              <option value="Spanish">Español</option>
              <option value="French">Français</option>
              <option value="German">Deutsch</option>
            </select>
          </label>
          <div id="expNoteOpts">
            <div class="hw-fields">${lookSelects}</div>
          </div>
          <div id="expExamOpts" hidden>
            <fieldset class="exam-types">
              <legend>Problem types</legend>
              <div class="exam-types-grid">${typeChecks}</div>
            </fieldset>
            <div class="exam-row-2">
              <label class="exam-field">Coverage focus
                <select id="expFocus" data-native>${focusOpts}</select>
              </label>
              <label class="exam-field">Difficulty
                <select id="expDifficulty" data-native>
                  <option value="easy">Foundation / easy</option>
                  <option value="exam" selected>Exam level</option>
                  <option value="hard">Challenging</option>
                </select>
              </label>
            </div>
            <div class="exam-row-2">
              <label class="exam-field">Number of new questions
                <select id="expCountMode" data-native>
                  <option value="auto">As many as AI decides</option>
                  <option value="exact" selected>Exact count…</option>
                </select>
              </label>
              <label class="exam-field" id="expCountBox">Questions
                <input id="expCount" type="number" min="1" max="40" value="8" />
              </label>
            </div>
            <label class="exam-check"><input id="expIncludeTheory" type="checkbox" checked /> Include high-yield theory review / cheat boxes (covered by blue tape)</label>
          </div>
          <label class="exam-field">Instructions for what to add
            <textarea id="expInstructions" rows="2" placeholder="Optional: e.g., add worked examples on cache coherence, or expand section 3 with edge-case problems…"></textarea>
          </label>
          <div id="expAiRow" class="hw-ai-row hw-tools"${ai ? '' : ' hidden'}>
            <select id="expTool" data-native aria-label="AI tool"></select>
            <select id="expModel" data-native aria-label="Model"></select>
            <input id="expModelOther" type="text" placeholder="Model name" aria-label="Model name" hidden />
          </div>
          <p id="expStatus" class="muted hw-ai-status" role="status"></p>
        </section>
      </div>
      <div class="ocr-actions">
        <span class="spacer"></span>
        <button id="expCancel" type="button">Cancel</button>
        <button id="expRun" type="button" class="primary">Expand &amp; insert pages</button>
      </div>
    `;

    el('expDialogTitle').append(icon('spark'), document.createTextNode(' Expand with AI'));
    el('expCloseX').append(icon('close'));
    el('expCancel').prepend(icon('close'));
    el('expRun').prepend(icon('plus'));
    document.body.append(dialog);

    picker = createSourcePicker({
      mount: el('expSourceMount'),
      library,
      groups,
      hasOpenDoc,
      openDocTitle,
      openDocPages,
      onChange: () => { el('expStatus').textContent = ''; },
    });

    model = modelPicker({
      ai,
      tool: el('expTool'),
      model: el('expModel'),
      custom: el('expModelOther'),
      store,
      key: 'notecomplete-expand-model',
    });

    el('expTool').onchange = () => { try { store?.setItem('notecomplete-expand-ai', el('expTool').value); } catch {} model.load(el('expTool').value); };
    el('expMode').onchange = syncModeFields;
    el('expCountMode').onchange = syncModeFields;
    el('expCloseX').onclick = () => el('expCancel').click();
    el('expCancel').onclick = () => {
      if (running) { running.abort(); running = null; return; }
      dialog.close();
    };
    el('expRun').onclick = runExpand;
  }

  async function sampleOpenContext() {
    if (!hasOpenDoc()) return '';
    try {
      const [openDoc] = await resolveSources([{ kind: 'open', id: 'ctx-open' }], {
        call, openPdf, library, groups, pageText, pageCanvas, notesText,
        documentInfo: () => ({ pages: openDocPages(), title: openDocTitle() }),
      });
      return openDoc?.text || '';
    } catch {
      return '';
    }
  }

  async function runExpand() {
    if (running) return;
    if (!hasOpenDoc()) { el('expStatus').textContent = 'Open a note or exam first to expand it.'; return; }
    if (!ai) { el('expStatus').textContent = 'Connect an AI tool first (Help → Connect AI tools…).'; return; }
    const mode = el('expMode').value;
    if (mode === 'exam' && !canInsertPdf()) {
      el('expStatus').textContent = 'Infinite canvas documents only support handwritten ink expansion.';
      return;
    }
    const sources = picker.list();
    if (!sources.length) { el('expStatus').textContent = 'Select at least one note, folder, file or topic to expand from.'; return; }
    const types = Array.from(dialog.querySelectorAll('input[name="expExamType"]:checked')).map((c) => c.value);
    if (mode === 'exam' && !types.length) { el('expStatus').textContent = 'Pick at least one problem type.'; return; }
    const provider = el('expTool').value;
    if (!provider) { el('expStatus').textContent = 'No AI tool is available.'; return; }

    const style = Object.fromEntries(Object.keys(LOOK_FIELDS).map((k) => [k, el(`exp-${k}`).value]));
    const prefs = {
      mode,
      where: el('expWhere').value,
      language: el('expLanguage').value,
      focus: el('expFocus').value,
      difficulty: el('expDifficulty').value,
      countMode: el('expCountMode').value,
      count: Number(el('expCount').value) || 8,
      includeTheory: el('expIncludeTheory').checked,
      types,
      style,
    };
    savePrefs(prefs);

    const ac = new AbortController();
    running = ac;
    el('expRun').disabled = true;
    el('expCancel').textContent = 'Stop';
    el('expStatus').textContent = 'Reading selected sources…';
    const job = jobs?.start?.(`Expanding "${openDocTitle()}"…`, { onCancel: () => ac.abort() });

    try {
      const resolved = await resolveSources(sources, {
        call,
        openPdf,
        library,
        groups,
        pageText,
        pageCanvas,
        notesText,
        documentInfo: () => ({ pages: openDocPages(), title: openDocTitle() }),
        onProgress: (i, n, label) => {
          el('expStatus').textContent = `Reading ${i + 1}/${n}: ${label}`;
          job?.progress?.(`Reading ${i + 1}/${n}`);
        },
      });
      if (ac.signal.aborted) throw Error('Cancelled.');
      if (!resolved.length) throw Error('Could not extract readable content from the selected sources.');

      const existingSummary = await sampleOpenContext();
      if (ac.signal.aborted) throw Error('Cancelled.');

      const at = insertAt(prefs.where, currentPage(), openDocPages());
      const { promptText, images } = formatSourceBundle(resolved);
      const userNotes = el('expInstructions').value.trim();
      const guidance = buildExpandGuidance({
        existingSummary,
        instructions: userNotes,
        kind: mode,
        openTitle: openDocTitle(),
        openPages: openDocPages(),
      });
      const m = model.value();
      const caps = ai.capabilities?.(provider, m) || {};

      if (mode === 'exam') {
        el('expStatus').textContent = 'Generating new exam problems with AI…';
        job?.progress?.('Writing expansion problems…');
        const prompt = examPrompt({
          title: `${openDocTitle()} — Expansion`,
          sourcesText: promptText,
          types: prefs.types,
          countMode: prefs.countMode,
          count: prefs.count,
          difficulty: prefs.difficulty,
          focus: prefs.focus,
          language: prefs.language,
          includeTheory: prefs.includeTheory,
          instructions: guidance,
        });
        const res = await runAI(
          ai,
          { provider, model: m, prompt, images: caps.vision === false ? [] : images, tag: 'expand-exam', signal: ac.signal },
          (chunk) => { el('expStatus').textContent = `Generating exam questions… (${chunk.length} chars)`; },
          { vision: caps.vision !== false },
        );
        if (ac.signal.aborted) throw Error('Cancelled.');

        const exam = cleanExamData(jsonFrom(res.text));
        el('expStatus').textContent = 'Rendering A4 PDF pages and measuring answer tape…';
        job?.progress?.('Rendering PDF & tape…');
        const printHtml = buildPaginatedExamHtml(exam, { showTheory: prefs.includeTheory, interactiveFallback: false });
        const rendered = await renderExamPdfAndTapes(printHtml, { title: exam.title, call });
        const sizesInPt = rendered.sizes.map(([w, h]) => [w / UNITS_PER_POINT, h / UNITS_PER_POINT]);
        const pdfId = 'pdf-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
        const pages = pdfPages(pdfId, sizesInPt, 0, sizesInPt.length - 1, 'none', UNITS_PER_POINT);

        el('expStatus').textContent = 'Inserting pages & pre-applied tape into open exam…';
        await insertPdfPagesWithTapes({
          at,
          pages,
          pdf: { id: pdfId, base64: uint8ToBase64(rendered.pdf) },
          tapes: rendered.tapes,
        });

        // Update linked exam metadata so Saved resources reflects any new source files used here.
        const openRes = openDocResource() || {};
        const exams = await listExams(library?.store);
        const linked = exams.find((x) => (openRes.entryKey && x.entryKey === openRes.entryKey) || (openRes.title && x.title === openRes.title));
        const added = collectSourceLinks(sources, resolved, { groups, openDocResource });
        if (linked) {
          await recordExam(library?.store, {
            ...linked,
            pageCount: (linked.pageCount || openDocPages()) + rendered.pageCount,
            tapeCount: (linked.tapeCount || 0) + rendered.tapes.length,
            resourceKeys: [...(linked.resourceKeys || []), ...added.resourceKeys],
            resourceLabels: [...(linked.resourceLabels || []), ...added.resourceLabels],
          }).catch(() => {});
        } else if (openRes.entryKey || openRes.fingerprint) {
          await recordExam(library?.store, {
            id: openRes.entryKey || openRes.fingerprint || `${Date.now()}`,
            entryKey: openRes.entryKey || '',
            title: openDocTitle(),
            fileName: `${openDocTitle()}.nfedit`,
            pageCount: openDocPages() + rendered.pageCount,
            tapeCount: rendered.tapes.length,
            created: Date.now(),
            resourceKeys: added.resourceKeys,
            resourceLabels: added.resourceLabels,
          }).catch(() => {});
        }

        const msg = `Added ${rendered.pageCount} exam page${rendered.pageCount === 1 ? '' : 's'} with ${rendered.tapes.length} taped answers.`;
        job?.done?.(msg);
        status?.(msg);
        dialog.close();
      } else {
        el('expStatus').textContent = 'Generating handwritten pages with AI…';
        job?.progress?.('Writing Markdown for MCP ink…');
        const rawDialect = await call('dialect');
        const dialect = caps.small ? compactDialect(rawDialect) : rawDialect;
        const prompt = batchNotePrompt({
          request: promptText,
          title: resolved[0]?.title || openDocTitle(),
          dialect,
          look: style.look || 'study',
          language: prefs.language,
          instructions: guidance,
        });
        const res = await runAI(
          ai,
          { provider, model: m, prompt, images: caps.vision === false ? [] : images, tag: 'expand-note', signal: ac.signal },
          (chunk) => { el('expStatus').textContent = `Writing handwritten content… (${chunk.length} chars)`; },
          { vision: caps.vision !== false },
        );
        if (ac.signal.aborted) throw Error('Cancelled.');

        let md = String(res.text || '').trim();
        const fence = md.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
        if (fence) md = fence[1].trim();
        if (!md) throw Error('AI returned empty content.');

        el('expStatus').textContent = 'Rendering handwriting ink onto new pages…';
        const options = {
          paper: style.paper || 'lined',
          theme: style.theme || 'ivory',
          font: style.font || 'patrick',
          hand: style.hand || 'natural',
          pen: style.pen || 'fountain',
          ink: style.accent || 'navy',
        };
        await insertHandwrittenPages({ at, markdown: md, options, focus: at });
        const heading = titleOf(md) || 'new section';
        const msg = `Expanded "${openDocTitle()}" with handwritten pages (${heading}).`;
        job?.done?.(msg);
        status?.(msg);
        dialog.close();
      }
    } catch (e) {
      el('expStatus').textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      running = null;
      el('expRun').disabled = false;
      el('expCancel').textContent = 'Cancel';
    }
  }

  return {
    async open() {
      if (!hasOpenDoc()) { status?.('Open a note or exam first to expand it.', true); return; }
      if (!dialog) build();
      const prefs = loadPrefs();
      const openRes = openDocResource() || {};
      const exams = await listExams(library?.store).catch(() => []);
      const matching = examsForResource(exams, openRes);
      const isThisExam = exams.some((e) => (openRes.entryKey && e.entryKey === openRes.entryKey)) || (matching.some((e) => e.title === openDocTitle()));
      const autoMode = detectExpandMode({
        existingExam: isThisExam ? {} : null,
        hasTapeOnPages: openDocHasTape(),
        openTitle: openDocTitle(),
      });
      el('expMode').value = canInsertPdf() ? (prefs.mode || autoMode) : 'note';
      if (prefs.where) el('expWhere').value = prefs.where;
      if (prefs.language) el('expLanguage').value = prefs.language;
      if (prefs.focus) el('expFocus').value = prefs.focus;
      if (prefs.difficulty) el('expDifficulty').value = prefs.difficulty;
      if (prefs.countMode) el('expCountMode').value = prefs.countMode;
      if (prefs.count) el('expCount').value = prefs.count;
      if (typeof prefs.includeTheory === 'boolean') el('expIncludeTheory').checked = prefs.includeTheory;
      if (Array.isArray(prefs.types) && prefs.types.length) {
        for (const cb of dialog.querySelectorAll('input[name="expExamType"]')) cb.checked = prefs.types.includes(cb.value);
      }
      for (const k of Object.keys(LOOK_FIELDS)) {
        el(`exp-${k}`).value = prefs.style?.[k] ?? LOOK_FIELDS[k][0][0];
      }
      el('expTargetDesc').textContent = `Add pages to “${openDocTitle()}” (${openDocPages()} page${openDocPages() === 1 ? '' : 's'}) using selected notes, folders, PDFs, Drive files, or topics.`;
      el('expStatus').textContent = '';
      syncModeFields();
      dialog.showModal();
      await picker.refresh({ preselectOpen: false });
      const select = el('expTool');
      select.replaceChildren(...(ai?.providers() || []).map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.label + (p.available ? '' : ' — not found');
        o.disabled = !p.available;
        return o;
      }));
      let savedTool = '';
      try { savedTool = store?.getItem('notecomplete-expand-ai') || ''; } catch {}
      if (savedTool && select.querySelector(`option[value="${savedTool}"]:not([disabled])`)) select.value = savedTool;
      else select.value = select.querySelector('option:not([disabled])')?.value || '';
      if (select.value) await model.load(select.value);
      else el('expStatus').textContent = 'No AI tool found. Install or connect an AI tool under Help → Connect AI tools…';
    },
    get visible() { return !!dialog?.open; },
  };
}
