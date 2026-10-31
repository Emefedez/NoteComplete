// Newer versions in Google Drive. Opening a Drive note from Recent asks Drive for the
// newest file with its name in its folder (Noteful backups upload new files instead
// of updating old ones). When it differs from the kept copy, the user picks: open
// the Drive version, keep their copy, keep both, or compare them page by page side by
// side first. Taking a new version offers to bring the old one's flashcards, quizzes
// and Markdown notes along (they are stored per version of the file).
import { prepareDocument } from './media-import.js';
import { PdfBackgrounds, backgroundPlacement } from './pdf-background.js';

const $ = id => document.getElementById(id);

// Pages aligned by their longest common run (like a text diff): unchanged pages pair up,
// a removed run next to an added run counts as changed pages.
export function pageDiff(left, right) {
  const n = left.length, m = right.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  // Walk the table: same pages, or a page only on one side.
  const walk = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && left[i] === right[j]) walk.push({ type: 'same', left: i++, right: j++ });
    else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) walk.push({ type: 'removed', left: i++ });
    else walk.push({ type: 'added', right: j++ });
  }
  // Between two same pages, removed and added pages pair up as changed pages.
  const steps = [];
  for (let k = 0; k < walk.length;) {
    if (walk[k].type === 'same') { steps.push(walk[k++]); continue; }
    const removed = [], added = [];
    while (k < walk.length && walk[k].type !== 'same') (walk[k].type === 'removed' ? removed : added).push(walk[k++]);
    const paired = Math.min(removed.length, added.length);
    for (let p = 0; p < paired; p++) steps.push({ type: 'changed', left: removed[p].left, right: added[p].right });
    steps.push(...removed.slice(paired), ...added.slice(paired));
  }
  return steps;
}

// A page's identity for the diff: its drawing plus which PDF page sits behind it.
export function pageHash(view) {
  const text = `${view.svg}|${view.pdf_background ? `${view.pdf_background.page_index}:${JSON.stringify(view.pdf_background.rect || null)}` : ''}`;
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

// Study material stored per version (fingerprint): what there is, and copying it over.
export const STUDY = [['decks', 'Flashcard decks'], ['quizzes', 'Quizzes'], ['notes', 'Markdown notes'], ['recordings', 'Recordings added here']];
export async function studyCounts(store, fingerprint) {
  const out = {};
  for (const [kind] of STUDY) {
    const value = await store.get('settings', `${kind}:${fingerprint}`).catch(() => null);
    out[kind] = kind === 'notes' ? (String(value || '').trim() ? 1 : 0) : (Array.isArray(value) ? value.length : 0);
  }
  return out;
}
export function mergeStudy(kind, existing, previous) {
  if (kind === 'notes') {
    const now = String(existing || '').trim(), before = String(previous || '').trim();
    if (!before || now.includes(before)) return now;
    return now ? `${now}\n\n---\n\n${before}` : before;
  }
  const have = Array.isArray(existing) ? existing : [];
  const ids = new Set(have.map(x => x?.id));
  return [...have, ...(Array.isArray(previous) ? previous : []).filter(x => !ids.has(x?.id))];
}
export async function carryStudy(store, from, to, kinds) {
  for (const kind of kinds) {
    const previous = await store.get('settings', `${kind}:${from}`).catch(() => null);
    if (previous == null) continue;
    const existing = await store.get('settings', `${kind}:${to}`).catch(() => null);
    await store.set('settings', `${kind}:${to}`, mergeStudy(kind, existing, previous));
  }
}

// A second document opened in its own worker, so comparing never touches the open note.
function sideDocument() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.ready) return resolve();
      if (data.fatal) return reject(Error(data.fatal));
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
  });
  const call = async (op, args = {}) => { await ready; const id = ++next; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...args }, args.bytes instanceof ArrayBuffer ? [args.bytes] : []); }); };
  const backgrounds = new PdfBackgrounds(resource => call('pdf', { resource }));
  return {
    call, backgrounds,
    async open(file) {
      const prepared = await prepareDocument(file);
      return call('open', { ...prepared, project: prepared.kind === 'project', notecomplete: prepared.kind === 'notecomplete', page: 0 });
    },
    view: page => call('view', { page }),
    close() { backgrounds.closed = true; worker.terminate(); },
  };
}
// A page as an image URL (SVG with its PDF page behind it), for the side-by-side view.
async function pageImage(side, view, width) {
  const holder = document.createElement('div');
  holder.innerHTML = view.svg;
  const svg = holder.querySelector('svg'), [w, h] = view.size;
  if (view.pdf_background) {
    const place = backgroundPlacement(view.pdf_background, view.size);
    const href = await side.backgrounds.image(view.pdf_background, view.size, (width * place.share) / 2).catch(() => null);
    const target = svg.querySelector('[data-background]');
    if (href && target) {
      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      for (const [k, v] of Object.entries({ href, x: place.x, y: place.y, width: place.width, height: place.height, preserveAspectRatio: 'none' })) image.setAttribute(k, v);
      target.append(image);
    }
  }
  svg.setAttribute('width', width); svg.setAttribute('height', Math.round((h / w) * width));
  return URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
}

const when = value => { const t = Date.parse(value || ''); return t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown date'; };
const mb = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

export function versionChooser({ library, drive, open, status, fingerprint }) {
  let warned = false;
  // Choices resolve one promise; the dialogs are plain <dialog>s in index.html.
  const choose = (dialog, buttons) => new Promise(resolve => {
    for (const [id, value] of Object.entries(buttons)) $(id).onclick = () => { dialog.close(); resolve(value); };
    dialog.oncancel = () => resolve('cancel');
    dialog.showModal();
  });

  // Offer to bring flashcards, quizzes and notes from the old version; returns when done.
  async function offerStudy(oldFile, newFile) {
    const [from, to] = await Promise.all([fingerprint(oldFile), fingerprint(newFile)]);
    if (!from || !to || from === to) return;
    const counts = await studyCounts(library.store, from);
    const kinds = STUDY.filter(([kind]) => counts[kind]);
    if (!kinds.length) return;
    $('carryList').replaceChildren(...kinds.map(([kind, label]) => {
      const row = document.createElement('label'), box = document.createElement('input');
      row.className = 'check'; box.type = 'checkbox'; box.checked = true; box.value = kind;
      row.append(box, ` ${label}${kind === 'notes' ? '' : ` (${counts[kind]})`}`);
      return row;
    }));
    if ((await choose($('carryDialog'), { carrySkip: 'skip', carryBring: 'bring' })) !== 'bring') return;
    const picked = [...$('carryList').querySelectorAll('input:checked')].map(b => b.value);
    await carryStudy(library.store, from, to, picked);
    if (picked.length) status(`Brought ${picked.length === kinds.length ? 'everything' : picked.length + ' of ' + kinds.length} to the new version.`);
  }

  async function fetchDrive(file) {
    let shown = 0, downloaded = false;
    const result = await drive.fetch(file, (received, total) => {
      downloaded = true;
      if (Date.now() - shown < 300) return;
      shown = Date.now();
      status(`Downloading ${file.name}: ${total ? Math.round((received / total) * 100) + ' %' : mb(received)}`);
    });
    if (downloaded) status(`Downloaded ${file.name}.`);
    return result;
  }

  // Side by side, page by page: unchanged pages are counted, the rest shown in pairs.
  async function compare(entry, local, newest) {
    const dialog = $('compareDialog'), rows = $('compareRows'), urls = [];
    $('compareTitle').textContent = `Compare “${entry.name.replace(/\.noteful$/i, '')}”`;
    $('compareLeftLabel').textContent = `Your copy · ${when(entry.modifiedTime)}`;
    $('compareRightLabel').textContent = `Google Drive · ${when(newest.modifiedTime)}`;
    $('compareSummary').textContent = 'Downloading and reading both versions…';
    rows.replaceChildren();
    const left = sideDocument(), right = sideDocument();
    let stopped = false;
    const done = choose(dialog, { compareMine: 'mine', compareBoth: 'both', compareDrive: 'drive' });
    try {
      const driveFile = await fetchDrive(newest);
      const [a, b] = await Promise.all([left.open(local), right.open(driveFile)]);
      const hashes = async (side, count) => { const out = []; for (let i = 0; i < count && !stopped; i++) out.push(pageHash(await side.view(i))); return out; };
      const [ha, hb] = await Promise.all([hashes(left, a.pages), hashes(right, b.pages)]);
      const steps = pageDiff(ha, hb), diff = steps.filter(s => s.type !== 'same');
      const count = type => diff.filter(s => s.type === type).length;
      $('compareSummary').textContent = diff.length
        ? [count('changed') && `${count('changed')} changed`, count('added') && `${count('added')} only in Drive`, count('removed') && `${count('removed')} only in your copy`].filter(Boolean).join(' · ') + ` · ${steps.length - diff.length} the same`
        : 'Every page is the same; only the file differs.';
      for (const step of diff.slice(0, 60)) {
        if (stopped || !dialog.open) break;
        const row = document.createElement('li'), label = document.createElement('p');
        row.className = `compare-row ${step.type}`;
        label.textContent = step.type === 'changed' ? `Page ${step.left + 1} → ${step.right + 1} changed` : step.type === 'added' ? `Page ${step.right + 1} only in Drive` : `Page ${step.left + 1} only in your copy`;
        const pair = document.createElement('div');
        pair.className = 'compare-pair';
        for (const [side, index] of [[left, step.left], [right, step.right]]) {
          const figure = document.createElement('figure');
          if (index === undefined) figure.className = 'empty';
          else {
            const img = document.createElement('img'), url = await pageImage(side, await side.view(index), 360);
            urls.push(url); img.src = url; img.alt = `Page ${index + 1}`;
            figure.append(img);
          }
          pair.append(figure);
        }
        row.append(label, pair);
        rows.append(row);
      }
      if (diff.length > 60) rows.append(Object.assign(document.createElement('li'), { className: 'muted', textContent: `${diff.length - 60} more differences not shown.` }));
      const choice = await done;
      return { choice, driveFile };
    } catch (error) {
      $('compareSummary').textContent = error.message;
      return { choice: await done, driveFile: null };
    } finally {
      stopped = true;
      left.close(); right.close();
      setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 1000);
    }
  }

  // Opening a Drive note from Recent: true when handled here (opened or cancelled).
  async function openRecent(entry, local) {
    if (entry.source !== 'drive') return false;
    if (!drive.ready) {
      if (!warned) status('Opened the copy on this device. Connect Google Drive to check for newer versions.');
      warned = true;
      return false;
    }
    let newest;
    try { newest = (await drive.newest(entry))?.[0]; }
    catch (error) { status(`Could not check Drive for a newer version: ${error.message}`, true); return false; }
    if (!newest) return false;
    if (!entry.md5 && library.md5) {
      entry.md5 = await library.md5(new Uint8Array(await local.arrayBuffer()));
      await library.store.set('entries', entry.key, entry);
    }
    // Same content under a new Drive file: adopt it quietly.
    if (newest.md5Checksum && newest.md5Checksum === entry.md5) {
      if (newest.id !== entry.driveId) await library.cached(newest).catch(() => null);
      return false;
    }
    if (Date.parse(newest.modifiedTime || 0) <= Date.parse(entry.modifiedTime || 0)) return false;
    $('versionText').textContent = `“${entry.name.replace(/\.noteful$/i, '')}” has a newer version in Google Drive.`;
    $('versionMine').textContent = `${when(entry.modifiedTime)} · ${mb(entry.size)}`;
    $('versionDrive').textContent = `${when(newest.modifiedTime)} · ${mb(newest.size)}`;
    let choice = await choose($('versionDialog'), { versionCompare: 'compare', versionOpenMine: 'mine', versionBoth: 'both', versionOpenDrive: 'drive' });
    let driveFile = null;
    if (choice === 'compare') ({ choice, driveFile } = await compare(entry, local, newest));
    if (choice === 'cancel') return true;
    if (choice === 'mine') { await library.touch(entry.key); await open(local, entry); return true; }
    try {
      driveFile ||= await fetchDrive(newest);
      await offerStudy(local, driveFile);
      // Using the Drive version replaces the kept copy; keeping both leaves it in Recent.
      if (choice === 'drive') await library.forget(entry.key, { deleteFile: true });
      const opened = await library.entry(newest);
      await open(driveFile, opened);
    } catch (error) { status(error.message, true); }
    return true;
  }
  return { openRecent, compare, offerStudy };
}
