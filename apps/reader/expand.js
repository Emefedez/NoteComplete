// Pages / Study -> Expand with AI...
// Expands the currently open note or exam by adding new pages generated from selected
// Recents, folders, local PDFs/Docs, Drive files, or topic prompts:
// - Note mode: generates Markdown and inserts real handwritten ink pages via MCP (insertHandwritten).
// - Exam mode: generates A4 HTML exam problems -> PDF -> inserts pages + Noteful answer tape.
import { icon } from './icons.js';
import { LOOK_FIELDS, titleOf } from './convert.js';
import { jsonFrom, saveAiDraft, loadAiDraft, clearAiDraft, buildContinuationPrompt, mergePartialExamJson } from './ai-context.js';
import { modelPicker } from './model-picker.js';
import { compactDialect, runAI } from './small-model.js';
import { createSourcePicker } from './source-picker.js';
import { resolveSources, formatSourceBundle } from './source-extract.js';
import { PROBLEM_TYPES, FOCUS_MODES, ensureExamMathRenderer, examPrompt, cleanExamData, buildPaginatedExamHtml } from './exam-html.js';
import { renderExamPdfAndTapes } from './exam-pdf.js';
import { pdfPages, insertAt, UNITS_PER_POINT } from './insert-pages.js';
import { batchNotePrompt } from './batch-notes.js';
import { listExams, examsForResource, recordExam } from './exam-index.js';
import { collectSourceLinks } from './exam.js';

const STORE = 'notecomplete-expand-prefs';
const DRAFT_KEY = 'notecomplete-expand-draft';
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

const COMPARE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'how', 'when', 'why', 'are', 'was',
  'were', 'been', 'being', 'have', 'has', 'had', 'into', 'about', 'using', 'used', 'give', 'explain', 'define',
  'calculate', 'compute', 'find', 'show', 'list', 'which', 'following', 'option', 'answer', 'true', 'false',
  'que', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas', 'por', 'para', 'con', 'sobre', 'como', 'cual',
  'cuales', 'entre', 'son', 'hay', 'esta', 'este', 'estos', 'estas', 'respuesta', 'explica', 'calcula',
  'determina', 'indica', 'cual', 'problema', 'pregunta', 'apartado',
]);

function normCompareText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compareTokens(s) {
  return new Set(normCompareText(s).split(/\s+/).filter((w) => w.length >= 3 && !COMPARE_STOPWORDS.has(w)));
}

function isNearDuplicateText(candidateText, existingNorms, existingTokenSets) {
  const norm = normCompareText(candidateText);
  if (norm.length < 18) return false;
  for (const ex of existingNorms) {
    if (ex.length >= 24 && (ex.includes(norm) || norm.includes(ex))) return true;
  }
  const candToks = compareTokens(norm);
  if (candToks.size < 4) return false;
  for (const exToks of existingTokenSets) {
    if (exToks.size < 4) continue;
    let shared = 0;
    for (const w of candToks) if (exToks.has(w)) shared += 1;
    if (shared < 4) continue;
    const containment = shared / Math.min(candToks.size, exToks.size);
    const union = candToks.size + exToks.size - shared;
    const jaccard = union > 0 ? shared / union : 0;
    if (jaccard >= 0.5 || containment >= 0.72) return true;
  }
  return false;
}

function extractExistingBlocks(existingText) {
  const lines = String(existingText || '').split(/\r?\n/);
  const blocks = [];
  let buf = '';
  const flush = () => {
    const clean = buf.trim();
    if (clean.length >= 16) blocks.push(clean);
    buf = '';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^\[Page \d+\]$/i.test(line)) {
      flush();
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    if (/^(?:(?:\d+(?:\.\d+)*|[A-Za-z])[.):]\s+|(?:Pregunta|Problem|Exercise|Ejercicio|Bloque|Block|Section)\b)/i.test(line)) {
      flush();
      buf = line;
    } else {
      buf = buf ? `${buf} ${line}` : line;
    }
  }
  flush();
  return blocks;
}

/**
 * Condenses an entire multi-page open exam or note into an inventory across all pages
 * so expansion prompts see every existing section and question stem, not just page 1.
 * @param {string} existingText
 * @param {{ kind?: 'note'|'exam', maxChars?: number }} opts
 * @returns {string}
 */
export function summarizeExistingDocument(existingText, { kind = 'note', maxChars = 14000 } = {}) {
  const raw = String(existingText || '').trim();
  if (!raw) return '';
  if (raw.length <= maxChars) return raw;
  const blocks = extractExistingBlocks(raw);
  const picked = [];
  let total = 0;
  for (const b of blocks) {
    if (kind === 'exam' && /^(?:Answer|Solution|Trap|Watch out|Theory|Solución|Respuesta|Trampa):/i.test(b)) continue;
    const line = b.length > 220 ? `${b.slice(0, 217)}…` : b;
    if (total + line.length + 1 > maxChars) break;
    picked.push(line);
    total += line.length + 1;
  }
  return picked.length ? picked.join('\n') : raw.slice(0, maxChars);
}

/**
 * Compares newly generated exam problems against existing open document content (and each other),
 * removing near-duplicate questions so Expand does not re-ask what is already on the exam.
 * @param {object} examData
 * @param {string} existingText
 * @returns {{ exam: object, removed: number }}
 */
export function dedupeNewExamProblems(examData, existingText = '') {
  const blocks = extractExistingBlocks(existingText);
  const existingNorms = blocks.map(normCompareText).filter((s) => s.length >= 24);
  const existingTokenSets = blocks.map(compareTokens).filter((s) => s.size >= 4);
  let removed = 0;
  const sections = [];
  for (const sec of examData?.sections || []) {
    const kept = [];
    for (const p of sec.problems || []) {
      const candText = [
        p.prompt || '',
        (p.expressions || []).map((e) => e.label).join(' '),
        p.code || '',
      ].filter(Boolean).join(' ');
      if (isNearDuplicateText(candText, existingNorms, existingTokenSets)) {
        removed += 1;
        continue;
      }
      const candNorm = normCompareText(candText);
      const candToks = compareTokens(candText);
      if (candNorm.length >= 24) existingNorms.push(candNorm);
      if (candToks.size >= 4) existingTokenSets.push(candToks);
      kept.push(p);
    }
    if (kept.length) sections.push({ ...sec, problems: kept });
  }
  return { exam: { ...examData, sections }, removed };
}

/**
 * Filters generated Markdown sections that repeat headings or paragraphs already present in the open note.
 * @param {string} markdown
 * @param {string} existingText
 * @returns {{ markdown: string, removed: number }}
 */
export function dedupeNewMarkdownSections(markdown, existingText = '') {
  const src = String(markdown || '').trim();
  if (!src || !String(existingText || '').trim()) return { markdown: src, removed: 0 };
  const blocks = extractExistingBlocks(existingText);
  const existingNorms = blocks.map(normCompareText).filter((s) => s.length >= 24);
  const existingTokenSets = blocks.map(compareTokens).filter((s) => s.size >= 4);
  const existingHeadings = new Set(
    blocks.filter((b) => /^#{1,4}\s+/.test(b) || b.length < 90).map((b) => normCompareText(b.replace(/^#{1,4}\s+/, ''))).filter(Boolean),
  );

  const lines = src.split(/\r?\n/);
  const sections = [];
  let cur = { heading: '', lines: [] };
  for (const line of lines) {
    if (/^#{1,3}\s+\S/.test(line.trim())) {
      if (cur.lines.length) sections.push(cur);
      cur = { heading: line.trim().replace(/^#{1,3}\s+/, ''), lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.length) sections.push(cur);

  let removed = 0;
  const kept = [];
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim();
    const headNorm = normCompareText(sec.heading);
    const bodyWithoutHeading = sec.heading ? sec.lines.slice(1).join(' ') : body;
    const dupHead = headNorm.length >= 6 && existingHeadings.has(headNorm);
    const dupBody = isNearDuplicateText(bodyWithoutHeading || body, existingNorms, existingTokenSets);
    if ((dupHead && !bodyWithoutHeading.trim()) || (dupHead && dupBody) || (!sec.heading && dupBody)) {
      removed += 1;
      continue;
    }
    if (headNorm.length >= 6) existingHeadings.add(headNorm);
    const bodyToks = compareTokens(body);
    if (bodyToks.size >= 4) existingTokenSets.push(bodyToks);
    kept.push(body);
  }
  return { markdown: kept.join('\n\n').trim(), removed };
}

/**
 * Merges newly generated expansion problems into an existing `.nfedit` embedded
 * exam payload (`{ html, source }`), preserving structured exam JSON when available
 * or splicing rendered HTML sections into an existing interactive HTML document.
 * @param {object|null} currentExam
 * @param {object} newExam
 * @param {{ showTheory?: boolean }} [prefs]
 * @returns {{ html: string, source: object|null }}
 */
export function mergeEmbeddedExam(currentExam, newExam, prefs = {}) {
  const showTheory = Boolean(prefs.showTheory ?? currentExam?.source?.prefs?.includeTheory ?? true);
  if (currentExam?.source?.mode === 'create' && currentExam.source.exam?.sections) {
    const mergedExam = {
      ...currentExam.source.exam,
      sections: [...currentExam.source.exam.sections, ...(newExam?.sections || [])],
    };
    return {
      html: buildPaginatedExamHtml(mergedExam, { showTheory, interactiveFallback: true }),
      source: {
        ...currentExam.source,
        exam: mergedExam,
        prefs: { ...(currentExam.source.prefs || {}), includeTheory: showTheory },
      },
    };
  }
  const freshHtml = buildPaginatedExamHtml(newExam, { showTheory, interactiveFallback: true });
  const existingHtml = String(currentExam?.html || '');
  if (!existingHtml.trim()) {
    return {
      html: freshHtml,
      source: { mode: 'create', exam: newExam, prefs: { includeTheory: showTheory } },
    };
  }
  const flowMatch = freshHtml.match(/<div class="exam-flow">([\s\S]*?)<\/div>\s*<div class="exam-pages"><\/div>/i);
  const rawFragment = flowMatch ? flowMatch[1] : freshHtml;
  const fragment = rawFragment.replace(/^[\s\S]*?<\/header>/i, '').trim();
  const injection = `\n<div class="page-break"></div>\n${fragment}\n`;
  let mergedHtml = existingHtml;
  if (/<\/div>\s*<div class="exam-pages"><\/div>/i.test(existingHtml)) {
    mergedHtml = existingHtml.replace(/(<\/div>\s*<div class="exam-pages"><\/div>)/i, `${injection}$1`);
  } else if (/<\/body>/i.test(existingHtml)) {
    mergedHtml = existingHtml.replace(/<\/body>/i, `<div class="exam-flow">${injection}</div></body>`);
  } else {
    mergedHtml = `${existingHtml}${injection}`;
  }
  return {
    html: mergedHtml,
    source: currentExam?.source || null,
  };
}

/**
 * Builds concise guidance so AI generates expansion pages rather than repeating the open document.
 * @param {{ existingSummary?: string, instructions?: string, kind: 'note'|'exam', openTitle?: string, openPages?: number, selfOnly?: boolean }} opts
 * @returns {string}
 */
export function buildExpandGuidance({ existingSummary = '', instructions = '', kind = 'note', openTitle = '', openPages = 0, selfOnly = false } = {}) {
  const parts = [];
  const inventory = summarizeExistingDocument(existingSummary, { kind, maxChars: 14000 });
  if (kind === 'exam') {
    parts.push(`You are EXPANDING an existing exam "${openTitle || 'Exam'}" (currently ${openPages || 'several'} page(s)).`);
    parts.push(selfOnly
      ? 'Generate NEW, complementary exam problems on the syllabus and difficulty shown in the existing exam, covering angles, edge cases, or exercises NOT already asked in the existing pages.'
      : 'Generate ONLY NEW, complementary problems/sections from the selected source files that are NOT already covered in the existing pages.');
    if (inventory && !selfOnly) {
      parts.push(`COMPLETE INVENTORY OF EXISTING QUESTIONS & TOPICS ALREADY ON THE EXAM (DO NOT re-ask or paraphrase any of these):\n${inventory}`);
    } else if (inventory) {
      parts.push('Check every question already in the source exam above and DO NOT repeat, paraphrase, or ask the same exercise with trivial number swaps.');
    }
  } else {
    parts.push(`You are EXPANDING an existing handwritten notebook "${openTitle || 'Note'}" (currently ${openPages || 'several'} page(s)) by writing NEW pages to append/insert.`);
    parts.push('Add clear headings, explanations, formulas, diagrams/lists from the selected source files without repeating sections already covered in the existing pages.');
    if (inventory && !selfOnly) {
      parts.push(`EXISTING NOTEBOOK OUTLINE ALREADY COVERED (DO NOT repeat these sections):\n${inventory}`);
    } else if (inventory) {
      parts.push('Continue with complementary depth, new examples, or missing sections without duplicating topics already written above.');
    }
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
  markEmbeddedExamUpdated = null,
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

  function setMode(nextMode) {
    const mode = nextMode === 'exam' && canInsertPdf() ? 'exam' : 'note';
    el('expMode').value = mode;
    for (const pill of dialog.querySelectorAll('[data-exp-mode]')) {
      const on = pill.dataset.expMode === mode;
      pill.setAttribute('aria-pressed', String(on));
      if (pill.dataset.expMode === 'exam') pill.disabled = !canInsertPdf();
    }
    syncModeFields();
  }

  function syncModeFields() {
    const mode = el('expMode').value;
    el('expNoteOpts').hidden = mode !== 'note';
    el('expExamOpts').hidden = mode !== 'exam';
    el('expCountBox').hidden = mode !== 'exam' || el('expCountMode').value !== 'exact';
    const runBtn = el('expRun');
    if (runBtn) {
      const label = mode === 'exam' ? 'Add questions & insert' : 'Add handwritten pages';
      runBtn.replaceChildren(icon('plus'), document.createTextNode(` ${label}`));
    }
    const inst = el('expInstructions');
    if (inst) {
      inst.placeholder = mode === 'exam'
        ? 'Optional: e.g., add 6 harder problems on virtual memory, or emphasize C fork/exec trace questions…'
        : 'Optional: e.g., add worked examples on cache coherence, or expand section 3 with diagrams & summary…';
    }
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
          <h3 class="exam-sub">2. Expansion mode &amp; options</h3>
          <div class="expand-mode-bar">
            <span>Add as:</span>
            <div class="expand-mode-pills" role="group" aria-label="Expansion mode">
              <button type="button" data-exp-mode="exam" aria-pressed="false">Questions (Exam + tape)</button>
              <button type="button" data-exp-mode="note" aria-pressed="true">Notes (Handwritten)</button>
            </div>
            <select id="expMode" hidden aria-hidden="true">
              <option value="note">Handwritten pages (MCP ink)</option>
              <option value="exam">Exam PDF pages (with answer tape)</option>
            </select>
          </div>
          <div class="exam-row-2">
            <label class="exam-field">Where to insert
              <select id="expWhere" data-native>
                <option value="end" selected>At end of document</option>
                <option value="after">After current page</option>
                <option value="before">Before current page</option>
              </select>
            </label>
            <label class="exam-field">Language
              <select id="expLanguage" data-native>
                <option value="auto">Match source</option>
                <option value="English">English</option>
                <option value="Spanish">Español</option>
                <option value="French">Français</option>
                <option value="German">Deutsch</option>
              </select>
            </label>
          </div>
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
          <div id="expDraftBar" class="exam-ready" hidden>
            <strong id="expDraftLabel"></strong>
            <div class="exam-ready-btns">
              <button id="expContinueBtn" type="button" class="primary">Continue from saved progress</button>
              <button id="expRestartBtn" type="button">Restart from scratch</button>
              <button id="expDismissDraftBtn" type="button">Dismiss</button>
            </div>
          </div>
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

    picker = createSourcePicker(el('expSourceMount'), {
      library,
      groups,
      hasOpenDoc,
      openDocTitle,
      openDocPages,
      openDocKey: () => (typeof openDocResource === 'function' ? openDocResource()?.entryKey || '' : ''),
      onChange: () => { el('expStatus').textContent = ''; },
    });

    if (ai) {
      model = modelPicker(el('expModel'), el('expModelOther'), ai);
      el('expTool').onchange = () => { try { store?.setItem('notecomplete-expand-ai', el('expTool').value); } catch {} model.load(el('expTool').value); };
    }
    el('expMode').onchange = syncModeFields;
    for (const pill of dialog.querySelectorAll('[data-exp-mode]')) {
      pill.onclick = () => setMode(pill.dataset.expMode);
    }
    el('expCountMode').onchange = syncModeFields;
    // × only hides the window: a running expansion goes on in the background (job chip).
    // Stop (the Cancel button while running) is the one that cancels it.
    el('expCloseX').onclick = () => {
      if (running) status?.('Still expanding in the background; the job chip shows its progress.');
      dialog.close();
    };
    el('expCancel').onclick = () => {
      if (running) { running.abort(); running = null; return; }
      dialog.close();
    };
    el('expRun').onclick = () => runExpand({ resume: false });
    el('expContinueBtn').onclick = () => runExpand({ resume: true });
    el('expRestartBtn').onclick = () => {
      clearAiDraft(store, DRAFT_KEY);
      syncDraftBar();
      runExpand({ resume: false });
    };
    el('expDismissDraftBtn').onclick = () => {
      clearAiDraft(store, DRAFT_KEY);
      syncDraftBar();
    };
  }

  function currentOpenKey() {
    const res = typeof openDocResource === 'function' ? openDocResource() : null;
    return res?.entryKey || openDocTitle() || '';
  }

  function syncDraftBar() {
    const draft = loadAiDraft(store, DRAFT_KEY);
    if (!draft?.prompt || (draft.openKey && draft.openKey !== currentOpenKey())) {
      el('expDraftBar').hidden = true;
      return;
    }
    const chars = (draft.partialText || '').length;
    const detail = chars ? `${chars} chars saved` : 'sources ready';
    const modeLabel = draft.mode === 'exam' ? 'questions' : 'notes';
    el('expDraftLabel').textContent = `Saved ${modeLabel} progress for “${draft.title || openDocTitle()}” (${detail}) — continue or restart.`;
    el('expDraftBar').hidden = false;
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

  async function runExpand({ resume = false } = {}) {
    if (running) return;
    if (!hasOpenDoc()) { el('expStatus').textContent = 'Open a note or exam first to expand it.'; return; }
    if (!ai) { el('expStatus').textContent = 'Connect an AI tool first (Help → Connect AI tools…).'; return; }
    const openKey = currentOpenKey();
    const draft = resume ? loadAiDraft(store, DRAFT_KEY) : null;
    if (resume && (!draft?.prompt || (draft.openKey && draft.openKey !== openKey))) {
      el('expStatus').textContent = 'No saved progress for this document to continue.';
      return;
    }
    const mode = draft?.mode || el('expMode').value;
    if (mode === 'exam' && !canInsertPdf()) {
      el('expStatus').textContent = 'Infinite canvas documents only support handwritten ink expansion.';
      return;
    }
    const picked = picker.list();
    const selfOnly = picked.length === 0;
    const sources = selfOnly ? [{ kind: 'open', id: 'open:current', label: openDocTitle() }] : picked;
    const types = Array.from(dialog.querySelectorAll('input[name="expExamType"]:checked')).map((c) => c.value);
    if (!draft && mode === 'exam' && !types.length) { el('expStatus').textContent = 'Pick at least one problem type.'; return; }
    const provider = el('expTool').value || draft?.provider;
    if (!provider) { el('expStatus').textContent = 'No AI tool is available.'; return; }

    const style = draft?.prefs?.style || Object.fromEntries(Object.keys(LOOK_FIELDS).map((k) => [k, el(`exp-${k}`).value]));
    const prefs = draft?.prefs || {
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
    if (!draft) savePrefs(prefs);
    setMode(mode);

    const ac = new AbortController();
    running = ac;
    // Stopping also ends the AI tool's process, so it does not run on unseen.
    ac.signal.addEventListener('abort', () => {
      console.info('[NC] expand stopped by the user');
      try { ai?.cancel?.(mode === 'exam' ? 'expand-exam' : 'expand-note'); } catch { /* Optional. */ }
    });
    el('expRun').disabled = true;
    el('expContinueBtn').disabled = true;
    el('expRestartBtn').disabled = true;
    el('expCancel').textContent = 'Stop';
    el('expDraftBar').hidden = true;
    el('expStatus').textContent = draft ? 'Resuming from saved progress…' : 'Reading selected sources…';
    const job = jobs?.start?.(draft ? `Resuming “${openDocTitle()}”…` : `Expanding "${openDocTitle()}"…`, { onCancel: () => ac.abort() });

    let checkpoint = draft ? { ...draft } : null;
    let streamed = '';
    try {
      let existingSummary = draft?.existingSummary ?? '';
      let basePrompt = draft?.prompt || '';
      let headingFallback = draft?.headingFallback || openDocTitle();
      let sourceLinks = draft?.sourceLinks || null;
      let images = [];
      const at = insertAt(prefs.where, currentPage(), openDocPages());

      if (!draft) {
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
            el('expStatus').textContent = `Reading ${i + 1}/${n}: ${label}`;
            job?.progress?.(`Reading ${i + 1}/${n}`);
          },
        });
        if (ac.signal.aborted) throw Error('Cancelled.');
        console.info(`[NC] expand ${mode}: ${sources.length} source(s) → ${resolved.length} read: ${resolved.map((r) => `${r.title} (${String(r.text || '').length} chars, ${r.images?.length || 0} img)`).join('; ')}`);
        if (!resolved.length) throw Error('Could not extract readable content from the selected sources.');

        existingSummary = await sampleOpenContext();
        if (ac.signal.aborted) throw Error('Cancelled.');

        const bundle = formatSourceBundle(resolved);
        images = bundle.images;
        headingFallback = resolved[0]?.title || openDocTitle();
        const userNotes = el('expInstructions').value.trim();
        const guidance = buildExpandGuidance({
          existingSummary,
          instructions: userNotes,
          kind: mode,
          openTitle: openDocTitle(),
          openPages: openDocPages(),
          selfOnly,
        });

        if (mode === 'exam') {
          basePrompt = examPrompt({
            title: `${openDocTitle()} — Expansion`,
            sourcesText: bundle.promptText,
            types: prefs.types,
            countMode: prefs.countMode,
            count: prefs.count,
            difficulty: prefs.difficulty,
            focus: prefs.focus,
            language: prefs.language,
            includeTheory: prefs.includeTheory,
            instructions: guidance,
          });
          sourceLinks = await collectSourceLinks(sources, resolved, { groups, openDocResource });
        } else {
          const rawDialect = await call('dialect');
          const mPreview = model.value;
          const capsPreview = ai.capabilities?.(provider, mPreview) || {};
          const dialect = capsPreview.small ? compactDialect(rawDialect) : rawDialect;
          basePrompt = batchNotePrompt({
            request: bundle.promptText,
            title: headingFallback,
            dialect,
            look: style.look || 'study',
            language: prefs.language,
            instructions: guidance,
          });
        }

        checkpoint = {
          mode,
          openKey,
          title: openDocTitle(),
          headingFallback,
          prompt: basePrompt,
          existingSummary,
          partialText: '',
          prefs,
          provider,
          sourceLinks,
        };
        saveAiDraft(store, DRAFT_KEY, checkpoint);
      }

      const m = model.value;
      const caps = ai.capabilities?.(provider, m) || {};
      const finalPrompt = draft
        ? buildContinuationPrompt({ basePrompt, partialText: draft.partialText || '', kind: mode })
        : basePrompt;
      let lastSavedAt = 0;

      // A saved answer that is already complete JSON (stopped after it finished) is used as is.
      let complete = null;
      if (mode === 'exam' && draft?.partialText) {
        try { const p = jsonFrom(draft.partialText); if (p?.sections?.length) complete = draft.partialText; } catch { /* Incomplete: continue it. */ }
      }
      if (complete) console.info(`[NC] expand exam: reusing the saved complete answer (${complete.length} chars)`);

      if (mode === 'exam') {
        el('expStatus').textContent = complete ? 'Using the questions generated before…' : draft ? 'Continuing new exam problems with AI…' : 'Generating new exam problems with AI…';
        job?.progress?.('Writing expansion problems…');
        const res = complete ? { text: complete } : await runAI(
          ai,
          {
            provider,
            model: m,
            prompt: finalPrompt,
            images: caps.vision === false ? [] : images,
            tag: 'expand-exam',
            label: `Expand exam · ${openDocTitle()}`,
            peek: () => streamed,
            signal: ac.signal,
          },
          (chunk) => {
            streamed += chunk;
            const totalChars = (draft?.partialText || '').length + streamed.length;
            el('expStatus').textContent = `Generating exam questions… (${totalChars} chars received)`;
            if (checkpoint && Date.now() - lastSavedAt > 4000) {
              lastSavedAt = Date.now();
              saveAiDraft(store, DRAFT_KEY, { ...checkpoint, partialText: `${draft?.partialText || ''}${streamed}` });
            }
          },
          { vision: caps.vision !== false },
        );
        if (ac.signal.aborted) throw Error('Cancelled.');

        const parsed = complete ? jsonFrom(complete) : draft?.partialText
          ? mergePartialExamJson(draft.partialText, res.text)
          : jsonFrom(res.text);
        const rawExam = cleanExamData(parsed);
        const { exam, removed: dupRemoved } = dedupeNewExamProblems(rawExam, existingSummary);
        const count = (e) => (e?.sections || []).reduce((n, s) => n + (s.problems || []).length, 0);
        console.info(`[NC] expand exam: answer ${res.text?.length || 0} chars → ${count(rawExam)} problem(s), ${dupRemoved} duplicate(s) dropped, ${count(exam)} kept; doc "${openDocTitle()}" ${openDocPages()} pages, insert at ${at}`);
        if (!exam.sections.length) {
          throw Error('All generated questions already exist in this exam. Add extra sources or specific topics and try again.');
        }
        el('expStatus').textContent = 'Rendering A4 PDF pages and measuring answer tape…';
        job?.progress?.('Rendering PDF & tape…');
        await ensureExamMathRenderer();
        const printHtml = buildPaginatedExamHtml(exam, { showTheory: prefs.includeTheory, interactiveFallback: false });
        const rendered = await renderExamPdfAndTapes(printHtml, { title: exam.title, call });
        const sizesInPt = rendered.sizes.map(([w, h]) => [w / UNITS_PER_POINT, h / UNITS_PER_POINT]);
        const pdfId = 'pdf-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
        const pages = pdfPages(pdfId, sizesInPt, 0, sizesInPt.length - 1, 'none', UNITS_PER_POINT);
        console.info(`[NC] expand exam: rendered ${rendered.pageCount} page(s), ${rendered.tapes.length} tape(s), pdf ${rendered.pdf?.length || 0} bytes`);

        el('expStatus').textContent = 'Inserting pages & pre-applied tape into open exam…';
        await insertPdfPagesWithTapes({
          at,
          pages,
          pdf: { id: pdfId, base64: uint8ToBase64(rendered.pdf) },
          tapes: rendered.tapes,
        });

        if (call) {
          const currentExam = await call('getExam').catch(() => null);
          const nextEmbedded = mergeEmbeddedExam(currentExam, exam, { showTheory: prefs.includeTheory });
          await call('setExam', { exam: nextEmbedded });
          await markEmbeddedExamUpdated?.();
          console.info(`[NC] expand exam: embedded exam ${currentExam?.source?.mode || (currentExam?.html ? 'html' : 'none')} → ${count(nextEmbedded.source?.exam) || '?'} problem(s); doc now ${openDocPages()} pages`);
        }

        // Update linked exam metadata so Saved resources reflects any new source files used here.
        const openRes = openDocResource() || {};
        const exams = await listExams(library?.store);
        const linked = exams.find((x) => (openRes.entryKey && x.entryKey === openRes.entryKey) || (openRes.title && x.title === openRes.title));
        const added = sourceLinks || { resourceKeys: [], resourceLabels: [] };
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

        clearAiDraft(store, DRAFT_KEY);
        syncDraftBar();
        const dedupNote = dupRemoved ? ` (skipped ${dupRemoved} duplicate question${dupRemoved === 1 ? '' : 's'})` : '';
        const msg = `Added ${rendered.pageCount} exam page${rendered.pageCount === 1 ? '' : 's'} with ${rendered.tapes.length} taped answers${dedupNote}.`;
        console.info(`[NC] expand exam: ${msg}`);
        job?.done?.(msg);
        status?.(msg);
        dialog.close();
      } else {
        el('expStatus').textContent = draft ? 'Continuing handwritten pages with AI…' : 'Generating handwritten pages with AI…';
        job?.progress?.('Writing Markdown for MCP ink…');
        const res = await runAI(
          ai,
          {
            provider,
            model: m,
            prompt: finalPrompt,
            images: caps.vision === false ? [] : images,
            tag: 'expand-note',
            label: `Expand notes · ${openDocTitle()}`,
            peek: () => streamed,
            signal: ac.signal,
          },
          (chunk) => {
            streamed += chunk;
            const totalChars = (draft?.partialText || '').length + streamed.length;
            el('expStatus').textContent = `Writing handwritten content… (${totalChars} chars received)`;
            if (checkpoint && Date.now() - lastSavedAt > 4000) {
              lastSavedAt = Date.now();
              saveAiDraft(store, DRAFT_KEY, { ...checkpoint, partialText: `${draft?.partialText || ''}${streamed}` });
            }
          },
          { vision: caps.vision !== false },
        );
        if (ac.signal.aborted) throw Error('Cancelled.');

        const extractMd = (s) => {
          const text = String(s || '').trim();
          const fence = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
          return fence ? fence[1].trim() : text;
        };
        const rawCombined = draft?.partialText
          ? `${extractMd(draft.partialText)}\n\n${extractMd(res.text)}`.trim()
          : extractMd(res.text);
        const { markdown: uniqueMd, removed: dupSecRemoved } = dedupeNewMarkdownSections(rawCombined, existingSummary);
        const md = uniqueMd || rawCombined;
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
        clearAiDraft(store, DRAFT_KEY);
        syncDraftBar();
        const heading = titleOf(md) || 'new section';
        const secNote = dupSecRemoved ? ` (skipped ${dupSecRemoved} duplicate section${dupSecRemoved === 1 ? '' : 's'})` : '';
        const msg = `Expanded "${openDocTitle()}" with handwritten pages (${heading})${secNote}.`;
        job?.done?.(msg);
        status?.(msg);
        dialog.close();
      }
    } catch (e) {
      console.warn(`[NC] expand failed: ${e?.message || e}`);
      if (checkpoint) {
        saveAiDraft(store, DRAFT_KEY, {
          ...checkpoint,
          partialText: `${draft?.partialText || ''}${streamed}`,
          reason: e?.message || String(e),
        });
        syncDraftBar();
      }
      el('expStatus').textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      running = null;
      el('expRun').disabled = false;
      el('expContinueBtn').disabled = false;
      el('expRestartBtn').disabled = false;
      el('expCancel').textContent = 'Cancel';
    }
  }

  return {
    async open({ mode = null } = {}) {
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
      const initialMode = !canInsertPdf()
        ? 'note'
        : (mode === 'exam' || mode === 'note')
          ? (autoMode === 'exam' ? 'exam' : mode)
          : autoMode;
      setMode(initialMode);
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
      el('expTargetDesc').textContent = `Add new questions or handwritten notes to “${openDocTitle()}” (${openDocPages()} page${openDocPages() === 1 ? '' : 's'}). Leave sources empty to expand directly from this open document, or add extra notes/folders/topics below.`;
      el('expStatus').textContent = '';
      syncDraftBar();
      dialog.showModal();
      await picker.refresh({ preselectOpen: false });
      const select = el('expTool');
      if (!select.options.length) {
        const providers = (await ai?.providers?.()) || [];
        select.replaceChildren(...providers.map((p) => {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.available ? p.label : `${p.label} (not installed)`;
          o.disabled = !p.available;
          return o;
        }));
        let savedTool = '';
        try { savedTool = store?.getItem('notecomplete-expand-ai') || ''; } catch {}
        if (savedTool && select.querySelector(`option[value="${savedTool}"]:not([disabled])`)) select.value = savedTool;
        else select.value = select.querySelector('option:not([disabled])')?.value || '';
        if (select.value) await model.load(select.value);
        else el('expStatus').textContent = 'No AI tool found. Install or connect an AI tool under Help → Connect AI tools…';
      }
    },
    get visible() { return !!dialog?.open; },
  };
}
