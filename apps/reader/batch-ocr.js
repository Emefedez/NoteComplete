// Batch OCR over Recent, like Batch transcribe: pick notes, PDFs and pictures, then their
// handwriting and scanned pages are recognized in the background (one job chip with Stop),
// each note read in an engine worker of its own so the open note is untouched. Results are
// kept per note exactly as Recognize text keeps them (find.js), so Find in the note, the
// AI's page text and the content search of Recent all use them. The same reading without
// recognition (`indexNotes`) makes notes searchable from Recent without opening them.
import { batchSelection, plural } from './batch-select.js';
import { ocrWorker, recognizePage, lineWords, voteWords, ocrPasses, readPagePasses, pageHasInk, hasPdfText, OCR_LANGUAGES } from './ocr.js';
import { loadDictionary, releaseDictionaries, correctWords, isWord as isLexiconWord, DICTIONARY_LANGUAGES } from './ocr-dictionary.js';
import { sideDocument } from './side-document.js';
import { pdfSource, plainText } from './find.js';
import { PAGED, entryFingerprint, normalizeContent } from './content-search.js';
import { discoverNoteRecordings, cachedTranscriptFor } from './batch-transcribe.js';

const STOPPED = Symbol('stopped');
// Tesseract's memory only grows: a fresh engine every few pages (as Recognize text does).
const RECYCLE = 12;
const written = (view) => [...(view.ink_text || []), ...(view.recognized_text || [])];

// Read one Recent note page by page: typed text, handwriting it knows, PDF words and, with
// `ocr`, recognition of the pages not done yet. Kept after every page. `wait(promise)` lets a
// Stop interrupt any step; `progress(done, total)` reports pages; `onKept(fingerprint, data)`.
export async function processNote(entry, { library, pageCanvas, ocr = null, alive = () => true, wait = (p) => p, progress = () => {}, onKept = () => {} }) {
  const file = await library.open(entry).catch(() => null);
  if (!file) throw Error('not on this device');
  const fingerprint = await entryFingerprint(library, entry, file);
  if (!fingerprint) throw Error('could not be read');
  const data = normalizeContent(await library.searchData(fingerprint));
  const side = sideDocument();
  let recognized = 0;
  try {
    const first = await wait(side.open(file));
    if (!first) return { pages: 0, recognized };
    const pages = Number(first.pages) || 1;
    const source = { view: (i) => (i === 0 ? first : side.view(i)), backgrounds: side.backgrounds };
    const canvasOf = (page, width, options) => pageCanvas(page, width, options, source);
    const save = () => library.saveSearchData(fingerprint, data).then(() => onKept(fingerprint, data));
    let worker = null, used = 0, busy = Promise.resolve();
    const shut = async () => { const w = worker; worker = null; if (w) await busy.catch(() => {}).then(() => w.terminate()).catch(() => {}); };
    try {
      for (let page = 0; page < pages && alive(); page++) {
        progress(page, pages);
        const view = await wait(source.view(page));
        const slot = view.slot ?? page;
        data.pages[slot] = page;
        const typed = (view.texts || []).map((t) => (t.runs || []).map((r) => r.text).join('')).join('\n').trim();
        const ink = plainText(written(view));
        if (typed || ink) data.text[slot] = { typed, ink };
        if (view.pdf_background && data.pdfFrom[slot] !== pdfSource(view)) {
          data.pdf[slot] = await wait(side.backgrounds.words(view.pdf_background, view.size).catch(() => []));
          data.pdfFrom[slot] = pdfSource(view);
        }
        if (!ocr) continue;
        const inked = pageHasInk(view), whole = !(ocr.skipPdf && hasPdfText(data.pdf[slot]));
        if ((data.ocr[slot] && !ocr.redo) || (!whole && !inked)) continue;
        // A fresh engine (and the shared word lists) on first need and every few pages.
        if (!worker || used >= RECYCLE) { await shut(); worker = await wait(ocrWorker(ocr.languages.join('+'))); used = 0; }
        used++;
        const readings = await readPagePasses(page, ocrPasses(ocr.quality), {
          pageCanvas: canvasOf, whole, inked, alive, wait,
          read: (canvas, scale, options) => (busy = recognizePage(worker, canvas, scale, options)),
          readLines: (canvas, scale, lines) => (busy = lineWords(worker, canvas, scale, lines)),
        });
        if (!alive() || !readings.length) continue;
        const deep = ocr.quality === 'high';
        const merged = voteWords(readings, { isWord: deep && ocr.dictionary ? (text) => isLexiconWord(text, ocr.dictionary) : null });
        data.ocr[slot] = ocr.dictionary ? correctWords(merged, ocr.dictionary, { deep }) : merged;
        recognized++;
        await save();
      }
    } finally {
      await shut();
    }
    // Transcripts made earlier (in the note or by Batch transcribe), if any were not kept yet.
    if (alive() && !Object.keys(data.audio).length) {
      for (const rec of await discoverNoteRecordings(entry, library).catch(() => [])) {
        const words = await cachedTranscriptFor(await rec.readBytes()).catch(() => null);
        if (words?.length) data.audio[rec.assetId] = { label: rec.name, text: plainText(words) };
      }
    }
    await save();
    return { pages, recognized };
  } finally {
    side.close();
  }
}

// Notes read for the content search, one after the other, as one job. Resolves when done.
export async function indexNotes(entries, { library, pageCanvas, jobs, onKept }) {
  let stopped = false, stop;
  const halt = new Promise((resolve) => { stop = resolve; });
  const wait = (promise) => Promise.race([promise, halt.then(() => { throw STOPPED; })]);
  const job = jobs?.start(`Index ${plural(entries.length, ['note', 'notes'])} for search`, { kind: 'ocr', cancel: () => { stopped = true; stop(); } });
  let done = 0;
  for (const [n, entry] of entries.entries()) {
    if (stopped) break;
    try {
      await processNote(entry, {
        library, pageCanvas, onKept, wait, alive: () => !stopped,
        progress: (page, pages) => job?.set((n + page / pages) / entries.length, `${entry.title || entry.name}: page ${page + 1} of ${pages}`),
      });
      done++;
    } catch (error) {
      if (error === STOPPED) break;
      console.warn('Index for search:', entry.name, error);
    }
  }
  if (stopped) job?.fail(`Indexing stopped: ${plural(done, ['note', 'notes'])} indexed.`);
  else job?.finish(`${plural(done, ['note', 'notes'])} indexed for search.`);
  return done;
}

export function setupBatchOcr({ library, status = () => {}, jobs = null, pageCanvas, onKept = () => {}, doc = document, onEnter = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  const selection = batchSelection({
    doc, status, onEnter,
    ids: { mode: 'batchOcrMode', selectAll: 'batchOcrSelectAll', start: 'batchOcrStart', cancel: 'batchOcrCancel' },
    // One item per document: its pages. Pages recognized before are said, and skipped.
    discover: async (entry) => {
      if (!PAGED.test(entry.name || '') || entry.source === 'web' || entry.source === 'archive') return [];
      // Only a fingerprint known already: discovery must not read every note in Recent.
      const fingerprint = await entryFingerprint(library, entry, null, { cachedOnly: true }).catch(() => '');
      const kept = fingerprint ? await library.searchData(fingerprint) : null;
      const done = Object.keys(kept?.ocr || {}).length;
      return [{ id: 'pages', name: 'All pages', detail: done ? `${plural(done, ['page', 'pages'])} done before` : 'all pages' }];
    },
    noun: ['document', 'documents'],
    startLabel: (notes) => (notes > 0 ? `Recognize (${plural(notes, ['note', 'notes'])})…` : 'Recognize (0)…'),
    pill: (info) => ({ text: info.items[0]?.detail === 'all pages' ? 'OCR' : `OCR · ${info.items[0]?.detail}`, title: 'Handwriting and scanned pages in this note are recognized' }),
    noItems: 'Only notes, notebooks, PDFs and pictures can be recognized.',
    open: () => openDialog(),
  });

  // The same languages and quality as Recognize text, remembered on this device.
  const languages = $('boLanguage');
  if (languages) for (const [code, name] of Object.entries(OCR_LANGUAGES)) languages.append(new Option(name, code));
  function loadChoices() {
    let chosen = ['spa', 'eng'], quality = 'normal';
    try { chosen = (localStorage.getItem('notecomplete-ocr-languages') || 'spa,eng').split(','); quality = localStorage.getItem('notecomplete-ocr-quality') || 'normal'; } catch { /* Optional. */ }
    for (const option of languages?.options || []) option.selected = chosen.includes(option.value);
    const radio = doc.querySelector(`input[name="boQuality"][value="${quality}"]`);
    if (radio) radio.checked = true;
  }
  function openDialog() {
    const dlg = $('batchOcrDialog');
    if (!dlg) return;
    loadChoices();
    $('boStatus').textContent = '';
    selection.renderChecklist({
      list: $('boNotesList'), summary: $('boSummary'), confirm: $('boConfirm'), selectAll: $('boSelectAll'),
      labels: (notes) => ({ summary: `${plural(notes, ['document', 'documents'])} queued`, confirm: notes > 0 ? `Recognize ${plural(notes, ['document', 'documents'])}` : 'Recognize' }),
    });
    dlg.showModal();
  }

  async function run() {
    const chosen = [...(languages?.selectedOptions || [])].map((o) => o.value);
    if (!chosen.length) { $('boStatus').textContent = 'Choose at least one language.'; return; }
    const quality = doc.querySelector('input[name="boQuality"]:checked')?.value || 'normal';
    try { localStorage.setItem('notecomplete-ocr-languages', chosen.join(',')); localStorage.setItem('notecomplete-ocr-quality', quality); } catch { /* Optional. */ }
    const entries = selection.tasks().map(({ info }) => ({ ...info.entry, title: info.title }));
    if (!entries.length) return;
    const options = { languages: chosen, quality, skipPdf: $('boSkipPdf')?.checked !== false, redo: !!$('boRedo')?.checked, dictionary: null };
    $('batchOcrDialog')?.close();
    selection.exit();

    let stopped = false, stop;
    const halt = new Promise((resolve) => { stop = resolve; });
    const wait = (promise) => Promise.race([promise, halt.then(() => { throw STOPPED; })]);
    const job = jobs?.start(`Batch OCR · ${plural(entries.length, ['document', 'documents'])}`, { kind: 'ocr', cancel: () => { stopped = true; stop(); } });
    let pages = 0, failed = 0;
    try {
      if (chosen.some((l) => DICTIONARY_LANGUAGES.includes(l))) {
        job?.set(0, 'loading the word lists');
        options.dictionary = await wait(loadDictionary(chosen)).catch((error) => { if (error === STOPPED) throw error; return null; });
      }
      for (const [n, entry] of entries.entries()) {
        if (stopped) break;
        const prefix = `[${n + 1}/${entries.length}] ${entry.title}`;
        status(`Batch OCR: ${prefix}…`);
        try {
          const result = await processNote(entry, {
            library, pageCanvas, ocr: options, onKept, wait, alive: () => !stopped,
            progress: (page, total) => job?.set((n + page / total) / entries.length, `${prefix}: page ${page + 1} of ${total}`),
          });
          pages += result.recognized;
        } catch (error) {
          if (error === STOPPED) break;
          failed++;
          console.warn('Batch OCR:', entry.name, error);
        }
      }
      const summary = `${plural(pages, ['page', 'pages'])} recognized${failed ? `; ${plural(failed, ['document', 'documents'])} could not be read` : ''}`;
      if (stopped) job?.fail(`Batch OCR stopped: ${summary}. They are kept; the next run continues from there.`);
      else job?.finish(`Batch OCR: ${summary}. Find and the content search use them.`);
      status(`Batch OCR finished: ${summary}.`);
    } catch (error) {
      if (error === STOPPED || stopped) job?.fail(`Batch OCR stopped: ${plural(pages, ['page', 'pages'])} recognized and kept.`);
      else { job?.fail(`Batch OCR failed: ${error.message}`); status(`Batch OCR failed: ${error.message}`, true); }
    } finally {
      releaseDictionaries();
    }
  }

  if ($('boCancel')) $('boCancel').onclick = () => $('batchOcrDialog')?.close();
  if ($('boClose')) $('boClose').onclick = () => $('batchOcrDialog')?.close();
  if ($('boConfirm')) $('boConfirm').onclick = () => { void run(); };
  return selection;
}
