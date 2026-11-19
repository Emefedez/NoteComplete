// Share several Recent notes at once (Home → Recent → Share), with the same selection mode as
// Batch transcribe and Batch OCR (batch-select.js). The notes are sent as they are kept in
// Recent (their saved copy), either:
//   - through the system share sheet, as separate files (where the browser can share files),
//   - packed in one .zip and sent by the usual Share note via QR window (Wi-Fi link, P2P QR,
//     offline QR; collab.js), whose receiver opens the .zip in the archive window,
//   - or saved as that .zip.
import { batchSelection, plural } from './batch-select.js';
import { zipFiles } from './zip.js';
import { formatSize } from './archive.js';
import { download as save } from './download.js';

// Recent entries that are a file this device keeps (not links, not archive members).
export const shareable = (entry) => Boolean(entry) && entry.source !== 'web' && entry.source !== 'archive';

// The names inside the .zip: unsafe characters replaced, and repeated names numbered
// ("Notes.nfedit", "Notes (2).nfedit").
export function zipNames(names) {
  const used = new Set();
  return names.map((raw) => {
    const clean = String(raw || 'Note').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Note';
    const dot = clean.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    let name = clean;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// The .zip's own name: "NoteComplete 3 notes 2026-11-19.zip" (plain characters: some browsers
// drop a download name with others).
export function bundleName(count, now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `NoteComplete ${plural(count, ['note', 'notes'])} ${day}.zip`;
}

// Files the system share sheet accepts as they are, or null (then only the .zip is offered).
export function shareSheetFiles(files, nav = globalThis.navigator) {
  if (!files.length || typeof nav?.share !== 'function' || typeof nav?.canShare !== 'function') return null;
  try { return nav.canShare({ files }) ? files : null; } catch { return null; }
}

// home.js: `shareZip(file)` opens the Share via QR window with { name, mime, bytes }.
export function setupBatchShare({ library, status = () => {}, shareZip = null, download = save, doc = document, onEnter = () => {} }) {
  const $ = (id) => doc.getElementById(id);
  let files = null; // The chosen notes read for the open dialog: [File].
  let readToken = 0;

  const selection = batchSelection({
    doc, status, onEnter,
    ids: { mode: 'batchShareMode', selectAll: 'batchShareSelectAll', start: 'batchShareStart', cancel: 'batchShareCancel' },
    // One item per note: the file itself. Its size when Recent knows it (nothing is read here).
    discover: async (entry) => (shareable(entry) ? [{ id: 'file', name: entry.name, detail: Number(entry.size) > 0 ? formatSize(Number(entry.size)) : '' }] : []),
    noun: ['note', 'notes'],
    startLabel: (notes) => (notes > 0 ? `Share (${plural(notes, ['note', 'notes'])})…` : 'Share (0)…'),
    pill: (info) => ({ text: info.items[0]?.detail ? `Share · ${info.items[0].detail}` : 'Share', title: 'This note is sent as it is saved in Recent' }),
    noItems: 'Links and files inside archives cannot be shared from here: open them first.',
    open: () => openDialog(),
  });

  const entries = () => selection.tasks().map(({ info }) => info.entry);
  const setBusy = (on) => { for (const id of ['bsSystem', 'bsQr', 'bsZip']) if ($(id)) $(id).disabled = on; };

  function openDialog() {
    const dlg = $('batchShareDialog');
    if (!dlg) return;
    files = null;
    $('bsStatus').textContent = '';
    setBusy(false);
    selection.renderChecklist({
      list: $('bsNotesList'), summary: $('bsSummary'), confirm: null, selectAll: $('bsSelectAll'),
      labels: (notes) => {
        files = null; // The choice changed: read again on the next action.
        for (const id of ['bsSystem', 'bsQr', 'bsZip']) if ($(id)) $(id).disabled = notes === 0;
        return { summary: `${plural(notes, ['note', 'notes'])} to share`, confirm: '' };
      },
    });
    // The share sheet button only where this browser can share files at all.
    const probe = typeof File === 'function' ? [new File([''], 'probe.nfedit', { type: 'application/octet-stream' })] : [];
    if ($('bsSystem')) $('bsSystem').hidden = !shareSheetFiles(probe);
    if ($('bsQr')) $('bsQr').hidden = !shareZip;
    dlg.showModal();
  }

  // The chosen notes' saved copies, read once per choice.
  async function read() {
    if (files) return files;
    const token = ++readToken;
    const chosen = entries();
    const out = [], missing = [];
    for (const [n, entry] of chosen.entries()) {
      $('bsStatus').textContent = `Reading ${n + 1} of ${chosen.length}: ${entry.name}…`;
      const file = await library.open(entry).catch(() => null);
      if (token !== readToken) throw Error('Cancelled.');
      if (file) out.push(file); else missing.push(entry.name);
    }
    if (!out.length) throw Error('None of the chosen notes is kept on this device.');
    $('bsStatus').textContent = missing.length ? `Not kept on this device, left out: ${missing.join(', ')}.` : '';
    files = out;
    return files;
  }
  async function zip() {
    const list = await read();
    const names = zipNames(list.map((f) => f.name));
    const parts = await Promise.all(list.map(async (f, i) => ({ name: names[i], bytes: new Uint8Array(await f.arrayBuffer()) })));
    return { name: bundleName(list.length), mime: 'application/zip', bytes: zipFiles(parts) };
  }

  async function act(run) {
    setBusy(true);
    try {
      await run();
    } catch (error) {
      if (error?.name === 'AbortError') { $('bsStatus').textContent = ''; return; }
      $('bsStatus').textContent = error?.message || String(error);
    } finally {
      setBusy(false);
    }
  }
  const done = (message) => { $('batchShareDialog')?.close(); selection.exit(); status(message); };

  if ($('bsSystem')) $('bsSystem').onclick = () => act(async () => {
    const list = await read();
    const ready = shareSheetFiles(list);
    if (!ready) throw Error('This browser cannot share these files together. Use the .zip instead.');
    await navigator.share({ files: ready, title: plural(ready.length, ['note', 'notes']) });
    done(`Shared ${plural(ready.length, ['note', 'notes'])}.`);
  });
  if ($('bsQr')) $('bsQr').onclick = () => act(async () => {
    const bundle = await zip();
    $('batchShareDialog')?.close();
    selection.exit();
    await shareZip(bundle);
  });
  if ($('bsZip')) $('bsZip').onclick = () => act(async () => {
    const bundle = await zip();
    await download(bundle.bytes, bundle.name, bundle.mime);
    done(`Saved ${bundle.name} (${formatSize(bundle.bytes.byteLength)}).`);
  });
  const close = () => { readToken++; $('batchShareDialog')?.close(); };
  if ($('bsCancel')) $('bsCancel').onclick = close;
  if ($('bsClose')) $('bsClose').onclick = close;
  return selection;
}
