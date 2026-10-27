// Find in note: one box over typed text, the PDF text layer, OCR results and
// transcripts. The index is built on first use and kept per note fingerprint;
// OCR runs only when the user starts it from the Recognize text dialog.
import { SearchIndex } from './search-index.js';
import { ocrWorker, recognizePage, OCR_LANGUAGES } from './ocr.js';

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

export function findController({ call, library, backgrounds, panels, jump, audio, status, pageCanvas, documentInfo }) {
  let index = new SearchIndex(), fingerprint = '', stored = { pdf: {}, ocr: {} };
  let building = null, generation = 0, hits = [], current = -1, debounce = 0, ocrRun = null;

  function reset(nextFingerprint) {
    generation++; building = null; ocrRun?.cancel();
    index = new SearchIndex(); fingerprint = nextFingerprint || ''; stored = { pdf: {}, ocr: {} };
    hits = []; current = -1;
    close();
  }
  const persist = () => fingerprint && library.saveSearchData(fingerprint, stored);

  // Index every page once: typed text, PDF text (kept), OCR (kept) and transcripts.
  function build() {
    if (building) return building;
    const token = generation;
    building = (async () => {
      const kept = fingerprint ? await library.searchData(fingerprint) : null;
      if (token !== generation) return;
      if (kept?.pdf) stored = { pdf: kept.pdf || {}, ocr: kept.ocr || {} };
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
        if (stored.ocr[slot]) index.add({ page, source: 'ocr', words: stored.ocr[slot] });
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
  function run() {
    hits = index.search($('findInput').value);
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
    if (!p?.el) return;
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

  // Recognize text: chosen pages only, with progress and Cancel. Results are kept.
  const languages = $('ocrLanguage');
  for (const [code, name] of Object.entries(OCR_LANGUAGES)) {
    const option = document.createElement('option');
    option.value = code; option.textContent = name;
    languages.append(option);
  }
  try { for (const option of languages.options) option.selected = (localStorage.getItem('notecomplete-ocr-languages') || 'spa,eng').split(',').includes(option.value); }
  catch { languages.options[0].selected = languages.options[1].selected = true; }
  function openOcr(currentPage) {
    const { pages } = documentInfo();
    $('ocrFrom').max = $('ocrTo').max = pages;
    $('ocrFrom').value = $('ocrTo').value = currentPage + 1;
    $('ocrStatus').textContent = Object.keys(stored.ocr).length ? `${Object.keys(stored.ocr).length} pages already recognized in this note.` : 'Recognition runs on this device. Language data downloads once on first use.';
    $('ocrProgress').hidden = true;
    $('ocrStart').disabled = false; $('ocrCancel').hidden = true;
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
    const chosen = [...languages.selectedOptions].map(o => o.value);
    if (!chosen.length) { $('ocrStatus').textContent = 'Choose at least one language.'; return; }
    try { localStorage.setItem('notecomplete-ocr-languages', chosen.join(',')); } catch { /* Optional. */ }
    await build();
    const skipPdf = $('ocrSkipPdf').checked;
    const slots = new Map();
    for (const p of selectedPages()) slots.set(p, (await call('view', { page: p })).slot ?? p);
    const pages = selectedPages().filter(p => !(skipPdf && (stored.pdf[slots.get(p)]?.length || 0) > 20));
    if (!pages.length) { $('ocrStatus').textContent = 'Those pages already have PDF text. Untick “Skip pages with PDF text” to recognize them anyway.'; return; }
    const token = generation;
    let cancelled = false, worker = null;
    ocrRun = { cancel() { cancelled = true; worker?.terminate(); } };
    $('ocrStart').disabled = true; $('ocrCancel').hidden = false; $('ocrProgress').hidden = false;
    $('ocrProgress').removeAttribute('value');
    try {
      $('ocrStatus').textContent = 'Loading the recognition engine…';
      worker = await ocrWorker(chosen.join('+'), message => {
        if (message.status === 'loading language traineddata' && message.progress < 1) $('ocrStatus').textContent = `Downloading language data… ${Math.round(message.progress * 100)}%`;
      });
      for (const [n, page] of pages.entries()) {
        if (cancelled || token !== generation) break;
        $('ocrStatus').textContent = `Recognizing page ${page + 1} (${n + 1} of ${pages.length})…`;
        $('ocrProgress').value = n / pages.length;
        const { canvas, scale } = await pageCanvas(page);
        const words = await recognizePage(worker, canvas, scale);
        canvas.width = canvas.height = 0;
        if (cancelled || token !== generation) break;
        stored.ocr[slots.get(page)] = words;
        index.remove(u => u.source === 'ocr' && u.page === page);
        index.add({ page, source: 'ocr', words });
        persist();
      }
      $('ocrProgress').value = 1;
      $('ocrStatus').textContent = cancelled ? 'Stopped. Pages recognized so far are kept and searchable.' : `Done. ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} recognized and added to Find.`;
      refresh();
    } catch (error) {
      if (!cancelled) $('ocrStatus').textContent = `Could not recognize text: ${error.message}`;
    } finally {
      await worker?.terminate().catch?.(() => {});
      ocrRun = null;
      $('ocrStart').disabled = false; $('ocrCancel').hidden = true;
    }
  };
  $('ocrCancel').onclick = () => ocrRun?.cancel();
  $('ocrClose').onclick = () => { ocrRun?.cancel(); $('ocrDialog').close(); };
  $('ocrDialog').addEventListener('close', () => ocrRun?.cancel());

  // Pages were inserted or removed: rebuild positions, keep the stored text.
  function restructure() {
    generation++; building = null; ocrRun?.cancel();
    index = new SearchIndex(); hits = []; current = -1;
    if (!$('findBar').hidden) { build(); run(); }
  }
  return {
    reset, open, close, paint, openOcr, restructure,
    find(query) { open(); $('findInput').value = query; current = 0; build().then(run); run(); $('findResults').hidden = false; },
    // A transcript finished while the note is open: make it searchable right away.
    transcribed(entry, words) { if (building && words.length) { addTranscript(entry, words); refresh(); } },
    get visible() { return !$('findBar').hidden; },
  };
}
