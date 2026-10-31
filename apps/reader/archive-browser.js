import { ArchiveClient, PRELOADED_ARCHIVE, archiveId, archiveListing } from './archive-client.js';

// The Internet Archive section of the home screen: the preloaded source, any item the user adds,
// and its folders. Documents open straight from the download; nothing is uploaded anywhere.
export function archiveBrowser({ open, client = new ArchiveClient() }) {
  const $ = id => document.getElementById(id);
  const key = 'notecomplete-archive-sources-v1', lastKey = 'notecomplete-archive-last-v1';
  let added = [];
  try { added = (JSON.parse(localStorage.getItem(key)) || []).filter(s => archiveId(s?.id)); } catch { /* Optional. */ }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(added)); } catch { /* Optional. */ } };
  const sources = () => [...PRELOADED_ARCHIVE, ...added.filter(s => !PRELOADED_ARCHIVE.some(p => p.id === s.id))];
  let current = null, item = null, trail = [], controller = null, busy = false, visible = false;
  const message = (text, error = false) => { $('archiveStatus').textContent = text; $('archiveStatus').classList.toggle('error', error); };
  const mb = size => `${(Number(size) / 1048576).toFixed(1)} MB`;
  function cancel() { controller?.abort(); controller = null; busy = false; $('archiveProgress').hidden = true; }
  function renderSources() {
    const list = sources();
    $('archiveSources').replaceChildren(...list.map(source => {
      const chip = document.createElement('button'), pinned = PRELOADED_ARCHIVE.some(p => p.id === source.id);
      chip.type = 'button'; chip.className = 'chip'; chip.textContent = source.title || source.id; chip.title = `archive.org/details/${source.id}`;
      chip.setAttribute('aria-pressed', String(current === source.id));
      chip.onclick = () => select(source.id);
      if (pinned) return chip;
      const wrap = document.createElement('span'), remove = document.createElement('button');
      wrap.className = 'archive-source'; remove.type = 'button'; remove.className = 'chip'; remove.textContent = '×';
      remove.title = `Remove ${source.title || source.id}`; remove.setAttribute('aria-label', remove.title);
      remove.onclick = () => { added = added.filter(s => s.id !== source.id); save(); if (current === source.id) select(list[0].id); else renderSources(); };
      wrap.append(chip, remove);
      return wrap;
    }));
  }
  function renderListing() {
    const { folders, documents } = archiveListing(item.files, trail);
    $('archivePath').textContent = [item.title, ...trail].join(' / ');
    $('archiveBack').disabled = !trail.length;
    const rows = [];
    for (const name of folders) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'archive-row folder'; b.textContent = name;
      b.onclick = () => { trail = [...trail, name]; renderListing(); };
      li.append(b); rows.push(li);
    }
    for (const document_ of documents) {
      const li = document.createElement('li'), b = document.createElement('button'), size = document.createElement('span');
      b.type = 'button'; b.className = 'archive-row'; b.textContent = document_.name;
      size.textContent = [document_.modifiedTime ? new Date(document_.modifiedTime).toLocaleDateString() : '', document_.size ? mb(document_.size) : ''].filter(Boolean).join(' · ');
      b.append(size); b.onclick = () => choose(document_);
      li.append(b); rows.push(li);
    }
    $('archiveList').replaceChildren(...rows);
    message(rows.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} · ${documents.length} document${documents.length === 1 ? '' : 's'}` : 'Nothing NoteComplete can open at this level.');
  }
  async function select(id) {
    cancel();
    current = id; trail = []; item = null;
    try { localStorage.setItem(lastKey, id); } catch { /* Optional. */ }
    renderSources(); $('archiveList').replaceChildren(); $('archivePath').textContent = '';
    message('Loading the item…');
    const mine = controller = new AbortController();
    try {
      const loaded = await client.item(id, mine.signal);
      if (current !== id || mine.signal.aborted) return;
      item = loaded;
      const known = added.find(s => s.id === id);
      if (known && known.title !== loaded.title) { known.title = loaded.title; save(); renderSources(); }
      renderListing();
    } catch (error) { if (error.name !== 'AbortError') message(`Could not read the item: ${error.message}`, true); }
  }
  async function choose(document_) {
    if (busy) return;
    cancel(); busy = true;
    const mine = controller = new AbortController(), bar = $('archiveProgress');
    bar.hidden = false; bar.value = 0;
    let shown = 0;
    try {
      message(`Downloading ${document_.name}…`);
      const file = await client.download(current, document_, mine.signal, (received, total) => {
        if (Date.now() - shown < 150) return;
        shown = Date.now();
        if (total) bar.value = received / total;
        message(`Downloading ${document_.name}: ${total ? `${Math.round(received / total * 100)} % · ` : ''}${mb(received)}${total ? ` of ${mb(total)}` : ''}`);
      });
      if (mine.signal.aborted) return;
      bar.hidden = true;
      message(await open(file, { source: 'archive', id: current, path: document_.path }) ? 'Document opened.' : 'Open cancelled. Your current document is unchanged.');
    } catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
    finally { busy = false; bar.hidden = true; }
  }
  $('archiveBack').onclick = () => { trail = trail.slice(0, -1); renderListing(); };
  $('archiveAdd').onclick = async () => {
    const id = archiveId($('archiveLink').value);
    if (!id) return message('Paste an archive.org item link, like https://archive.org/details/1GREIUvigo, or its identifier.', true);
    if (!sources().some(s => s.id === id)) { added.push({ id, title: id }); save(); }
    $('archiveLink').value = '';
    select(id);
  };
  $('archiveLink').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('archiveAdd').click(); } };
  renderSources();
  return {
    show() {
      visible = true;
      if (current) return;
      let last = '';
      try { last = localStorage.getItem(lastKey) || ''; } catch { /* Optional. */ }
      select(sources().some(s => s.id === last) ? last : sources()[0].id);
    },
    hide() { visible = false; cancel(); },
    get visible() { return visible; },
  };
}
