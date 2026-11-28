// Files sent from the browser (the NoteComplete Send extension; desktop send-main.js). This tab
// tells the app what it shows (so the extension can list open notebooks, the focused one first)
// and its Recent notebooks, takes the files sent to it, and adds them by kind:
//   pictures (GIF, PNG, JPEG, WebP, HEIC…) → onto the current page (importImages);
//   PDFs → their pages after the last page (appendPdf);
//   Markdown, text, HTML and Office files → the notebook's Markdown notes, under a heading;
// anything else is reported back as not added. "Choose in NoteComplete…" sends them here with
// `pick`: a dialog lists the open notebooks and Recent ones, this one chosen first.
import { decodeText, isImageName, isOfficeName, TEXT_EXTENSIONS } from './text-types.js';
import { pictureFormat } from './media-import.js';

const NOTEBOOK = /\.(noteful|nfedit|notecomp|notecomplete|notepart|goodnotes|ntb|rnote|pdf)$/i;
const TEXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join('|')})$`, 'i');

// What one sent file becomes here: 'picture', 'pdf', 'text', 'html', 'office' or null.
export function sentKind(file, head = new Uint8Array()) {
  const name = file.name || '', type = file.type || '';
  if (isImageName(name) || /^image\//.test(type) || pictureFormat(head)) return /svg/i.test(type) || /\.svg$/i.test(name) ? null : 'picture';
  if (/\.pdf$/i.test(name) || type === 'application/pdf' || new TextDecoder().decode(head.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (/\.html?$/i.test(name) || type === 'text/html') return 'html';
  if (isOfficeName(name)) return 'office';
  if (TEXT.test(name) || /^text\//.test(type)) return 'text';
  return null;
}

// Recent entries the app can open again by path: notebooks and PDFs on this computer.
export function recentTargets(entries) {
  return (entries || []).filter((e) => e?.source === 'local' && e.path && NOTEBOOK.test(e.name || e.path))
    .map((e) => ({ path: e.path, title: e.title || (e.name || '').replace(/\.[^.]+$/, '') }));
}

export function sendIn({ bridge = globalThis.notecompleteSend, getDoc, getTitle, getPath, library, importImages, appendPdf, notes, status, ready }) {
  if (!bridge) return { publish() {}, publishRecent() {}, take() {} };
  let lastState = '';
  function publish() {
    const doc = getDoc();
    const state = doc ? { kind: 'note', title: getTitle() || 'Untitled', path: getPath() || '' } : { kind: null };
    const key = JSON.stringify(state);
    if (key === lastState) return;
    lastState = key;
    bridge.state(state).catch(() => {});
  }
  let recentTimer = 0;
  function publishRecent() {
    clearTimeout(recentTimer);
    recentTimer = setTimeout(async () => {
      try { bridge.recent(recentTargets(await library.recent(40))); } catch { /* the list stays as it was */ }
    }, 300);
  }

  async function toMarkdown(file, kind) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === 'office') {
      const { officeDocument } = await import('./office.js');
      return (await officeDocument(file.name, bytes)).markdown;
    }
    const text = kind === 'text' ? decodeText(bytes) : new TextDecoder().decode(bytes);
    if (kind === 'html') return (new DOMParser().parseFromString(text, 'text/html').body?.innerText || '').trim();
    return /\.(md|markdown|rmd|qmd)$/i.test(file.name) || !/\.[a-z0-9]+$/i.test(file.name) ? text.trim() : '```\n' + text.replace(/```/g, '``​`').trimEnd() + '\n```';
  }

  // Adds the files to the open notebook; resolves to { ok, text }.
  async function add(files) {
    if (!getDoc()) throw Error('No notebook is open in this tab.');
    const groups = { picture: [], pdf: [], notes: [], skipped: [] };
    for (const file of files) {
      const kind = sentKind(file, new Uint8Array(await file.slice(0, 64).arrayBuffer()));
      if (kind === 'picture') groups.picture.push(file);
      else if (kind === 'pdf') groups.pdf.push(file);
      else if (kind) groups.notes.push([file, kind]);
      else groups.skipped.push(file.name);
    }
    const done = [];
    if (groups.picture.length) {
      await importImages(groups.picture);
      done.push(`${groups.picture.length} ${groups.picture.length === 1 ? 'picture' : 'pictures'} on the page`);
    }
    for (const file of groups.pdf) {
      const pages = await appendPdf(new Uint8Array(await file.arrayBuffer()), file.name);
      done.push(`${pages} ${pages === 1 ? 'page' : 'pages'} from ${file.name}`);
    }
    if (groups.notes.length) {
      const api = await notes();
      for (const [file, kind] of groups.notes) {
        const md = await toMarkdown(file, kind);
        await api.append(`## ${file.name.replace(/\.[^.]+$/, '')}\n\n${md}`);
      }
      done.push(`${groups.notes.length} ${groups.notes.length === 1 ? 'file' : 'files'} in the Markdown notes`);
    }
    if (!done.length) throw Error(`NoteComplete cannot add ${groups.skipped.join(', ')} to a notebook.`);
    const text = `Added ${done.join(', ')}${groups.skipped.length ? `; not added: ${groups.skipped.join(', ')}` : ''}.`;
    status(text);
    return { ok: true, text };
  }

  // The picker: open notebooks first (this one checked), then Recent. Resolves to a target id, or
  // null (cancelled).
  async function pick(files, hereId) {
    const list = await bridge.targets().catch(() => ({ open: [], recent: [] }));
    const dialog = document.createElement('dialog');
    dialog.className = 'ocr-dialog migrate-dialog send-pick';
    const h = Object.assign(document.createElement('h2'), { textContent: 'Send to which notebook?' });
    const what = Object.assign(document.createElement('p'), { className: 'muted', textContent: files.map((f) => f.name).join(', ') });
    const box = Object.assign(document.createElement('div'), { className: 'migrate-list' });
    box.setAttribute('role', 'radiogroup');
    const row = (target, section, checked) => {
      const label = Object.assign(document.createElement('label'), { className: 'migrate-row' });
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'sendTarget', value: target.id, checked });
      const name = Object.assign(document.createElement('span'), { textContent: target.title });
      const meta = Object.assign(document.createElement('span'), { className: 'muted', textContent: section });
      label.append(radio, name, meta);
      return label;
    };
    const here = list.open.find((t) => t.id === hereId);
    const first = here?.id || list.default || list.open[0]?.id || list.recent[0]?.id;
    for (const t of list.open) box.append(row(t, t.id === here?.id ? 'Open here' : 'Open', t.id === first));
    for (const t of list.recent) box.append(row({ ...t, id: `path:${t.path}` }, 'Recent', `path:${t.path}` === first));
    if (!box.children.length) box.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No notebook is open or in Recent. Open one, then send the files again.' }));
    const actions = Object.assign(document.createElement('div'), { className: 'ocr-actions' });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    const go = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Send', disabled: !first });
    actions.append(cancel, go);
    dialog.append(h, what, box, actions);
    document.body.append(dialog);
    return new Promise((resolve) => {
      const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
      cancel.onclick = () => close(null);
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
      go.onclick = () => close(box.querySelector('input:checked')?.value || null);
      dialog.showModal();
      go.focus();
    });
  }

  async function receive({ token, files, pick: choose, here }) {
    const list = (files || []).map((f) => new File([f.bytes], f.name, { type: f.type || '' }));
    try {
      if (choose) {
        const target = await pick(list, here);
        if (!target) return bridge.done(token, { ok: false, error: 'Cancelled in NoteComplete.' });
        if (target !== here) {
          const routed = await bridge.route(token, target);
          if (!routed?.ok) throw Error(routed?.error || 'Could not send them there.');
          return; // the chosen tab answers
        }
      }
      if (ready) await ready();
      bridge.done(token, await add(list));
    } catch (e) {
      status('Could not add the sent files: ' + e.message, true);
      bridge.done(token, { ok: false, error: e.message });
    }
  }
  bridge.onFiles((delivery) => { receive(delivery); });

  return {
    publish,
    publishRecent,
    // Files queued for this tab (sent to the notebook it opened for): called once it is open.
    async take() {
      for (const delivery of await bridge.take().catch(() => [])) await receive(delivery);
    },
  };
}
