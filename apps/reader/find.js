// Find in note: one box over typed text, the PDF text layer, OCR results and
// transcripts. The index is built on first use and kept per note fingerprint;
// OCR runs only when the user starts it from the Recognize text dialog, then
// continues in the background as a job chip in the bar.
import { SearchIndex } from './search-index.js';
import { ocrWorker, recognizePage, lineWords, uniqueLines, voteWords, ocrPasses, OCR_LANGUAGES } from './ocr.js';
import { loadDictionary, releaseDictionaries, correctWords, isWord as isLexiconWord, DICTIONARY_LANGUAGES } from './ocr-dictionary.js';
import { textLayer } from './text-layer.js';

const $ = id => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const BADGE = { text: 'Text', pdf: 'PDF', ocr: 'OCR', audio: 'Audio' };
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Cheap content fingerprint: size plus the first and last 64 KiB (the index).
export async function noteFingerprint(file) {
  if (!globalThis.crypto?.subtle) return `${file.name}|${file.size}`;
  const head = await file.slice(0, 65536).arrayBuffer(), tail = await file.slice(Math.max(0, file.size - 65536)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', await new Blob([String(file.size), head, tail]).arrayBuffer());
  return 'note-v1:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function findController({ call, library, backgrounds, panels, jump, audio, status, pageCanvas, documentInfo, jobs }) {
  let index = new SearchIndex(), fingerprint = '', stored = { pdf: {}, ocr: {} };
  let building = null, generation = 0, hits = [], current = -1, debounce = 0, ocrRun = null, loading = null;
  // Sources to search, any combination; remembered on this device.
  let sources = new Set(['text', 'pdf', 'ocr', 'audio']);
  try { const saved = JSON.parse(localStorage.getItem('notecomplete-find-sources')); if (Array.isArray(saved) && saved.length) sources = new Set(saved); } catch { /* Optional. */ }

  function reset(nextFingerprint) {
    generation++; building = null; loading = null; ocrRun?.cancel();
    index = new SearchIndex(); fingerprint = nextFingerprint || ''; stored = { pdf: {}, ocr: {} };
    hits = []; current = -1;
    close();
  }
  const persist = () => fingerprint && library.saveSearchData(fingerprint, stored);
  // Words read while scrolling are written once scrolling settles: writing the whole store
  // for every page shown made a long PDF quadratic (each write clones every page so far).
  let persistTimer = 0;
  const persistSoon = () => {
    clearTimeout(persistTimer);
    const note = fingerprint, data = stored;
    persistTimer = setTimeout(() => { if (note) library.saveSearchData(note, data); }, 2000);
  };
  // PDF and OCR words kept for this note, read once.
  function load() {
    const token = generation;
    return loading ||= (async () => {
      const kept = fingerprint ? await library.searchData(fingerprint) : null;
      if (token === generation && kept?.pdf) stored = { pdf: kept.pdf || {}, ocr: kept.ocr || {} };
    })();
  }

  // Index every page once: typed text, PDF text (kept), OCR (kept) and transcripts.
  function build() {
    if (building) return building;
    const token = generation;
    building = (async () => {
      await load();
      if (token !== generation) return;
      const { pages } = documentInfo();
      const timings = new Map();
      let extracted = false;
      for (let page = 0; page < pages; page++) {
        if (token !== generation) return;
        if (page % 8 === 0) progress(`Indexing page ${page + 1} of ${pages}…`);
        const view = await call('view', { page });
        const slot = view.slot ?? page;
        for (const text of view.texts || []) {
          const content = (text.runs || []).map(r => r.text).join('');
          index.add({ page, source: 'text', words: content.split(/\s+/).filter(Boolean).map(t => ({ text: t, box: text.bounds })) });
        }
        if (view.pdf_background) {
          if (!stored.pdf[slot]) {
            stored.pdf[slot] = await backgrounds().words(view.pdf_background, view.size).catch(() => []);
            extracted = true;
          }
          index.add({ page, source: 'pdf', words: stored.pdf[slot] });
        }
        const recognized = stored.ocr[slot] || written(view);
        if (recognized.length) index.add({ page, source: 'ocr', words: recognized });
        for (const t of view.timings || []) {
          if (!timings.has(t.recording_id)) timings.set(t.recording_id, []);
          timings.get(t.recording_id).push({ page, start: t.start });
        }
        if (page % 16 === 15) refresh();
      }
      if (extracted) persist();
      pageTimes = timings;
      await addTranscripts(token);
      if (token === generation) { progress(''); refresh(); }
    })();
    return building;
  }
  // Audio hits open on the page whose ink was being written at that moment.
  let pageTimes = new Map();
  function pageAt(recordingId, time) {
    const list = (pageTimes.get(recordingId) || []).filter(t => t.start <= time).sort((a, b) => b.start - a.start);
    return list[0]?.page ?? audio.entries.find(e => e.recording?.id === recordingId)?.recording?.pages?.[0] ?? 0;
  }
  function addTranscript(entry, words) {
    const recordingId = entry.recording?.id, label = audio.label?.(entry) || 'Recording';
    index.remove(u => u.source === 'audio' && u.assetId === entry.asset.id);
    // Units per ~40 words so audio hits land on the right page as the lecture moves on.
    for (let i = 0; i < words.length; i += 40) {
      const chunk = words.slice(i, i + 48);
      index.add({ page: pageAt(recordingId, chunk[0].start), source: 'audio', assetId: entry.asset.id, recordingId, label, words: chunk.map(w => ({ text: w.text, time: w.start })) });
    }
  }
  async function addTranscripts(token) {
    for (const entry of audio.entries || []) {
      if (!entry.asset) continue;
      const words = audio.transcript.results.get(entry.asset.id) || await audio.transcript.cached(entry.asset).catch(() => null);
      if (token !== generation) return;
      if (words?.length) addTranscript(entry, words);
    }
  }

  function progress(text) { $('findProgress').textContent = text; $('findProgress').hidden = !text; }
  function refresh() { if (!$('findBar').hidden) run(); }
  function renderSources(all) {
    const counts = {};
    for (const h of all) counts[h.source] = (counts[h.source] || 0) + 1;
    $('findSources').replaceChildren(...Object.entries(BADGE).map(([source, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `find-source ${source}`;
      b.setAttribute('aria-pressed', String(sources.has(source)));
      b.textContent = counts[source] ? `${label} ${counts[source]}` : label;
      b.onclick = () => {
        if (sources.has(source) && sources.size > 1) sources.delete(source); else sources.add(source);
        try { localStorage.setItem('notecomplete-find-sources', JSON.stringify([...sources])); } catch { /* Optional. */ }
        run();
      };
      return b;
    }));
  }
  function run() {
    const all = index.search($('findInput').value);
    renderSources(all);
    hits = all.filter(h => sources.has(h.source));
    current = hits.length ? Math.max(0, Math.min(current, hits.length - 1)) : -1;
    render();
    for (const p of panels()) paint(p);
  }
  function render() {
    $('findCount').textContent = !$('findInput').value.trim() ? '' : hits.length ? `${current + 1} of ${hits.length}` : 'No matches';
    $('findPrev').disabled = $('findNext').disabled = !hits.length;
    const list = $('findResults'), fragment = document.createDocumentFragment();
    hits.slice(0, 200).forEach((hit, i) => {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-current', String(i === current));
      const badge = document.createElement('span');
      badge.className = `find-badge ${hit.source}`;
      badge.textContent = BADGE[hit.source];
      const where = document.createElement('span');
      where.className = 'find-where';
      where.textContent = hit.source === 'audio' ? `p. ${hit.page + 1} · ${hit.label} ${clock(hit.time)}` : `p. ${hit.page + 1}`;
      const snippet = document.createElement('span');
      snippet.className = 'find-snippet';
      const marks = new Set(hit.matched);
      for (const [n, word] of hit.snippet.split(' ').entries()) {
        if (n) snippet.append(' ');
        if (marks.has(word)) { const m = document.createElement('mark'); m.textContent = word; snippet.append(m); }
        else snippet.append(word);
      }
      button.append(badge, where, snippet);
      button.onclick = () => go(i);
      item.append(button);
      fragment.append(item);
    });
    list.replaceChildren(fragment);
  }
  // Highlight boxes for the hits on one rendered page.
  function paint(p) {
    // Only on a page that is shown (an unloaded page is only a placeholder).
    if (!p?.el || !p.render) return;
    let layer = p.findLayer;
    if (!layer || !layer.isConnected) {
      layer = document.createElementNS(ns, 'svg');
      layer.classList.add('find-layer');
      layer.setAttribute('viewBox', `0 0 ${p.size.join(' ')}`);
      layer.setAttribute('aria-hidden', 'true');
      p.el.append(layer);
      p.findLayer = layer;
    }
    const rects = [];
    hits.forEach((hit, i) => {
      if (hit.page !== p.index || $('findBar').hidden) return;
      for (const [x, y, w, h] of hit.boxes) {
        const rect = document.createElementNS(ns, 'rect');
        const pad = Math.max(2, h * 0.12);
        for (const [k, v] of Object.entries({ x: x - pad, y: y - pad, width: w + pad * 2, height: h + pad * 2, rx: pad }))
          rect.setAttribute(k, v);
        rect.setAttribute('class', i === current ? 'find-hit current' : 'find-hit');
        rects.push(rect);
      }
    });
    layer.replaceChildren(...rects);
  }
  // Handwriting NoteComplete wrote from Markdown comes with its text (the core keeps
  // the words and their boxes), so it is found without recognizing anything.
  // Text the note already knows: written from Markdown, or recognized earlier and saved with it.
  const written = (view) => [...(view.ink_text || []), ...(view.recognized_text || [])].map((w) => ({ text: w.text, box: w.bounds, link: w.link }));
  // Selectable PDF and recognized text over a rendered page (Pan tool).
  async function selectable(p) {
    const view = p?.view, token = generation;
    if (!view) return;
    await load();
    const slot = view.slot ?? p.index;
    if (view.pdf_background && !stored.pdf[slot]) {
      stored.pdf[slot] = await backgrounds().words(view.pdf_background, view.size).catch(() => []);
      if (token === generation) persistSoon();
    }
    if (token !== generation || p.view !== view || !p.el) return;
    const recognized = stored.ocr[slot] || written(view);
    // The same words as the layer already made (a stroke redrew the page): it goes back as it
    // is, instead of hundreds of text elements made again for every stroke.
    const pdf = stored.pdf[slot], key = [view.size.join(), stored.ocr[slot] ? '' : JSON.stringify(recognized)].join('|');
    const layer = p.textLayer;
    if (layer && layer.pdf === pdf && layer.ocr === stored.ocr[slot] && layer.key === key) {
      if (layer.parentNode !== p.el) p.el.append(layer);
      return;
    }
    layer?.remove();
    p.textLayer = Object.assign(textLayer(view.size, { pdf, ocr: recognized.length ? recognized : undefined }), { pdf, ocr: stored.ocr[slot], key });
    p.el.append(p.textLayer);
  }
  function go(i) {
    if (!hits.length) return;
    current = (i + hits.length) % hits.length;
    const hit = hits[current];
    render();
    for (const p of panels()) paint(p);
    jump(hit.page, hit.boxes[0]);
    if (hit.source === 'audio') audio.seekRecording(hit.recordingId, hit.time);
    $('findResults').querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }
  function open() {
    if (!documentInfo().pages) return;
    $('findBar').hidden = false;
    $('findInput').focus(); $('findInput').select();
    build();
    run();
  }
  function close() {
    $('findBar').hidden = true;
    $('findResults').hidden = true;
    for (const p of panels()) paint(p);
  }
  $('findInput').oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => { current = 0; run(); $('findResults').hidden = !hits.length; }, 120); };
  $('findInput').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); go(current + (event.shiftKey ? -1 : 1)); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  };
  $('findNext').onclick = () => go(current + 1);
  $('findPrev').onclick = () => go(current - 1);
  $('findListToggle').onclick = () => { $('findResults').hidden = !$('findResults').hidden || !hits.length; };
  $('findClose').onclick = close;

  // Recognize text: chosen pages only. The dialog only starts it; the work
  // runs as a background job with a chip and Stop. Results are kept per page.
  const languages = $('ocrLanguage');
  for (const [code, name] of Object.entries(OCR_LANGUAGES)) {
    const option = document.createElement('option');
    option.value = code; option.textContent = name;
    languages.append(option);
  }
  try { for (const option of languages.options) option.selected = (localStorage.getItem('notecomplete-ocr-languages') || 'spa,eng').split(',').includes(option.value); }
  catch { languages.options[0].selected = languages.options[1].selected = true; }
  // Quality: remembered like the languages.
  const qualityPicked = () => document.querySelector('input[name="ocrQuality"]:checked')?.value || 'normal';
  try { const q = document.querySelector(`input[name="ocrQuality"][value="${localStorage.getItem('notecomplete-ocr-quality') || 'normal'}"]`); if (q) q.checked = true; } catch { /* Optional. */ }
  // Quick result first: only for high quality.
  try { $('ocrProgressive').checked = localStorage.getItem('notecomplete-ocr-progressive') !== '0'; } catch { /* Optional. */ }
  const progressiveShown = () => { $('ocrProgressiveRow').hidden = qualityPicked() !== 'high'; };
  for (const radio of document.querySelectorAll('input[name="ocrQuality"]')) radio.addEventListener('change', progressiveShown);
  progressiveShown();
  function openOcr(currentPage) {
    const { pages } = documentInfo();
    $('ocrFrom').max = $('ocrTo').max = pages;
    $('ocrFrom').value = $('ocrTo').value = currentPage + 1;
    $('ocrStatus').textContent = ocrRun ? 'Recognition is running in the background; its progress is in the bar. Stop it there to start another.'
      : Object.keys(stored.ocr).length ? `${Object.keys(stored.ocr).length} ${Object.keys(stored.ocr).length === 1 ? 'page' : 'pages'} already recognized in this note.` : 'Recognition runs on this device. Language data downloads once on first use, with word lists that correct misread words (every language but Chinese).';
    $('ocrStart').disabled = !!ocrRun;
    $('ocrDialog').showModal();
  }
  function selectedPages() {
    const { pages } = documentInfo();
    const scope = document.querySelector('input[name="ocrScope"]:checked').value;
    if (scope === 'all') return [...Array(pages).keys()];
    const from = Math.max(1, Math.min(pages, Number($('ocrFrom').value) || 1));
    const to = scope === 'page' ? from : Math.max(from, Math.min(pages, Number($('ocrTo').value) || from));
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  }
  $('ocrStart').onclick = async () => {
    if (ocrRun) return;
    const chosen = [...languages.selectedOptions].map(o => o.value);
    if (!chosen.length) { $('ocrStatus').textContent = 'Choose at least one language.'; return; }
    const quality = qualityPicked(), progressive = $('ocrProgressive').checked;
    try { localStorage.setItem('notecomplete-ocr-languages', chosen.join(',')); localStorage.setItem('notecomplete-ocr-quality', quality); localStorage.setItem('notecomplete-ocr-progressive', progressive ? '1' : '0'); } catch { /* Optional. */ }
    $('ocrStart').disabled = true;
    $('ocrStatus').textContent = 'Checking the pages…';
    await build();
    const skipPdf = $('ocrSkipPdf').checked, selected = selectedPages();
    const slots = new Map(), inked = new Set();
    for (const p of selected) {
      const view = await call('view', { page: p });
      slots.set(p, view.slot ?? p);
      if (/data-item="stroke:/.test(view.svg)) inked.add(p);
    }
    // Pages with PDF text skip the whole-page pass, but their handwriting is still read.
    // Pages recognized before are kept, so a stopped run carries on from there.
    const whole = p => !(skipPdf && (stored.pdf[slots.get(p)]?.length || 0) > 20);
    const wanted = selected.filter(p => whole(p) || inked.has(p));
    const pages = $('ocrRedo').checked ? wanted : wanted.filter(p => !stored.ocr[slots.get(p)]);
    const skipped = wanted.length - pages.length;
    $('ocrStart').disabled = false;
    if (!wanted.length) { $('ocrStatus').textContent = 'Those pages already have PDF text and no handwriting. Untick “Skip the printed text of PDF pages” to recognize them anyway.'; return; }
    if (!pages.length) { $('ocrStatus').textContent = `All ${skipped} ${skipped === 1 ? 'page is' : 'pages are'} already recognized. Tick “Recognize again” to redo them.`; return; }
    $('ocrDialog').close();
    const token = generation;
    let cancelled = false, worker = null, done = 0, improved = 0, quick = false, stop;
    // Stop ends the run at once: every wait (engine, page raster, recognition)
    // races against it, so a page in progress cannot keep the job alive.
    const stopped = new Promise(resolve => { stop = resolve; });
    const STOPPED = Symbol('stopped');
    const race = promise => Promise.race([promise, stopped.then(() => { throw STOPPED; })]);
    // The engine is shut down once, after the page it is reading settles:
    // Tesseract errors if it is terminated mid-job. Stop does not wait for it.
    let busy = Promise.resolve();
    const shut = () => {
      const w = worker;
      worker = null;
      return w ? busy.catch(() => {}).then(() => w.terminate()).catch(() => {}) : Promise.resolve();
    };
    const read = (canvas, scale, options) => (busy = recognizePage(worker, canvas, scale, options));
    ocrRun = { cancel() { cancelled = true; stop(); shut(); } };
    const job = jobs().start('Recognize text', { kind: 'ocr', cancel: () => ocrRun?.cancel() });
    // With a quick result first, pages not improved yet keep it: Recognize again improves them.
    const kept = () => `${done} ${done === 1 ? 'page' : 'pages'} recognized${skipped ? ` (${skipped} done before)` : ''}${quick && improved < done ? `; ${done - improved} with the quick result only (Recognize again, ticked, improves them)` : ''}`;
    // Tesseract's memory only grows: a fresh engine every few pages keeps a
    // whole-note run from piling it up.
    const RECYCLE = 12;
    const engine = async () => {
      await shut();
      worker = await race(ocrWorker(chosen.join('+'), message => {
        if (message.status === 'loading language traineddata' && message.progress < 1) job.set(done / pages.length, `downloading language data ${Math.round(message.progress * 100)}%`);
      }));
    };
    try {
      job.set(0, `${quality === 'high' ? 'high quality: ' : ''}${skipped ? `loading the engine; ${skipped} pages already done` : 'loading the engine'}`);
      await engine();
      // Spelling help from the word lists of every chosen language that has them.
      let dictionary = null;
      if (chosen.some(l => DICTIONARY_LANGUAGES.includes(l))) {
        job.set(0, 'loading the word lists');
        dictionary = await race(loadDictionary(chosen)).catch(error => { if (error === STOPPED) throw error; return null; });
      }
      const deep = quality === 'high', isWord = dictionary ? text => isLexiconWord(text, dictionary) : null;
      // One page read with some passes, added to readings it already has.
      const readPage = async (page, set, readings = []) => {
        if (whole(page)) for (const { width, sparse } of set.whole) {
          if (cancelled || token !== generation) return readings;
          const { canvas, scale } = await race(pageCanvas(page, width));
          try { readings.push(await race(read(canvas, scale, { sparse }))); }
          finally { canvas.width = canvas.height = 0; }
        }
        if (inked.has(page)) for (const { width, sparse, bold } of set.ink) {
          if (cancelled || token !== generation) return readings;
          const ink = await race(pageCanvas(page, width, { inkOnly: true, bold }));
          if (!ink) break;
          try { readings.push(await race(read(ink.canvas, ink.scale, { sparse }))); }
          finally { ink.canvas.width = ink.canvas.height = 0; }
        }
        // High quality: every line found, read again on its own.
        if (set.lines && inked.has(page) && !cancelled && token === generation) {
          const lines = uniqueLines(...readings.map(r => r.lines || []));
          const ink = lines.length ? await race(pageCanvas(page, set.lines.width, { inkOnly: true })) : null;
          if (ink) try { readings.push(await race(busy = lineWords(worker, ink.canvas, ink.scale, lines))); }
          finally { ink.canvas.width = ink.canvas.height = 0; }
        }
        return readings;
      };
      // The readings of a page voted into words, corrected, kept and searchable at once.
      const keep = async (page, readings, { deep: thorough }) => {
        const merged = voteWords(readings, { isWord: thorough ? isWord : null });
        const words = dictionary ? correctWords(merged, dictionary, { deep: thorough }) : merged;
        stored.ocr[slots.get(page)] = words;
        index.remove(u => u.source === 'ocr' && u.page === page);
        index.add({ page, source: 'ocr', words });
        await persist();
        const panel = panels().find(p => p.index === page);
        if (panel) selectable(panel);
      };
      // Phases: one with every pass of the quality; or, quick result first, the normal
      // passes over every page (kept and searchable), then the rest, voting with them.
      const phases = deep && progressive
        ? [{ set: ocrPasses('normal'), deep: false, label: 'quick pass' }, { set: ocrPasses('high', { extra: true }), deep: true, label: 'improving' }]
        : [{ set: ocrPasses(quality), deep, label: '' }];
      quick = phases.length > 1;
      const earlier = new Map();
      let step = 0;
      const steps = phases.length * pages.length;
      for (const [phase, { set, deep: thorough, label }] of phases.entries()) {
        for (const [n, page] of pages.entries()) {
          if (cancelled || token !== generation) break;
          if (step && step % RECYCLE === 0) await engine();
          job.set(step / steps, `${label ? `${label}: ` : ''}${pages.length === 1 ? `page ${page + 1}` : `page ${page + 1} (${n + 1} of ${pages.length})`}`);
          step++;
          const readings = await readPage(page, set, earlier.get(page) || []);
          if (cancelled || token !== generation) break;
          await keep(page, readings, { deep: thorough });
          if (phase < phases.length - 1) earlier.set(page, readings);
          else earlier.delete(page);
          if (phase === 0) done++;
          if (phase === phases.length - 1 && phases.length > 1) improved++;
        }
      }
      refresh();
      if (token !== generation) job.fail(`Recognition stopped: another note was opened. ${kept()} are kept.`);
      else if (cancelled) job.fail(`Recognition stopped. ${kept()}; they are kept, and the next run continues from there.`);
      else job.finish(`Text recognized: ${kept()}, added to Find.`);
    } catch (error) {
      refresh();
      job.fail(cancelled || error === STOPPED ? `Recognition stopped. ${kept()}; they are kept, and the next run continues from there.` : `Could not recognize text: ${error.message}. ${kept()} are kept.`);
    } finally {
      shut();
      releaseDictionaries();
      ocrRun = null;
    }
  };
  $('ocrClose').onclick = () => $('ocrDialog').close();

  // Pages were inserted or removed: rebuild positions, keep the stored text.
  function restructure() {
    generation++; building = null; ocrRun?.cancel();
    index = new SearchIndex(); hits = []; current = -1;
    if (!$('findBar').hidden) { build(); run(); }
  }
  // A page's text by source (text, pdf, ocr, audio) for AI context.
  async function pageText(page) {
    await build();
    const parts = {};
    for (const unit of index.units)
      if (unit.page === page) (parts[unit.source] ||= []).push(unit.words.map(w => w.text).join(' '));
    return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.join('\n')]));
  }
  // Text inside a page region (page units), in reading order: PDF, OCR and typed words.
  async function wordsIn(page, [rx, ry, rw, rh]) {
    await build();
    const picked = [];
    for (const unit of index.units) {
      if (unit.page !== page || unit.source === 'audio') continue;
      for (const w of unit.words) {
        const [x, y, bw, bh] = w.box || [];
        const cx = x + bw / 2, cy = y + bh / 2;
        if (w.box && cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) picked.push({ text: w.text, x, y: cy, h: bh, source: unit.source });
      }
    }
    // Prefer one source where both cover the region (PDF text over OCR of the same words).
    const sources = new Set(picked.map(w => w.source));
    const use = sources.has('pdf') ? picked.filter(w => w.source !== 'ocr' || !picked.some(p => p.source === 'pdf' && Math.abs(p.y - w.y) < w.h)) : picked;
    use.sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.6 ? a.x - b.x : a.y - b.y));
    let out = '', last = null;
    for (const w of use) {
      out += !last ? w.text : Math.abs(w.y - last.y) < Math.min(w.h, last.h) * 0.6 ? ` ${w.text}` : `\n${w.text}`;
      last = w;
    }
    return out;
  }
  return {
    reset, open, close, paint, selectable, openOcr, restructure, pageText, wordsIn,
    // OCR results of this note by page slot, as the core keeps them ({text, bounds}).
    recognizedText() {
      const out = {};
      for (const [slot, words] of Object.entries(stored.ocr || {}))
        out[slot] = (words || []).filter((w) => w?.text && Array.isArray(w.box)).slice(0, 5000)
          .map((w) => ({ text: String(w.text).slice(0, 100), bounds: w.box.map(Number) }));
      return out;
    },
    find(query) { open(); $('findInput').value = query; current = 0; build().then(run); run(); $('findResults').hidden = false; },
    // A transcript finished while the note is open: make it searchable right away.
    transcribed(entry, words) { if (building && words.length) { addTranscript(entry, words); refresh(); } },
    get visible() { return !$('findBar').hidden; },
    get fingerprint() { return fingerprint; },
  };
}
