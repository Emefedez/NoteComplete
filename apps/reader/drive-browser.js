import { DriveClient, FOLDER_MIME, folderReference, supportedDriveFile, DRIVE_WRITE_SCOPE } from './drive-client.js';
import { loadGoogleIdentity, requestDriveAccess } from './drive-auth.js';
import { driveThumbnails } from './drive-thumbs.js';

// The Drive section of the home screen. show()/hide() follow the home screen:
// hiding cancels listings, downloads, previews and a pending sign-in.
export function driveBrowser({ open, client = new DriveClient(), identityLoader = loadGoogleIdentity, authorize = requestDriveAccess, thumbs = null, library = null, onCards = () => {} }) {
  const $ = id => document.getElementById(id);
  const previews = thumbs || driveThumbnails(client, { library });
  let identity, controller, generation = 0, loading = false, importing = false, visible = false;
  let folder = null, trail = [], nextPage = '', search = 'Noteful', filter = '';
  // Views to go back to: entering a folder, searching or filtering pushes the view it leaves.
  // `box` is the search text that produced the current view.
  let history = [], box = '';
  const view = () => ({ trail: [...trail], folder, search, filter, box });
  const push = () => { history.push(view()); if (history.length > 50) history.shift(); };
  const configKey = 'notecomplete-drive-config-v1', folderKey = 'notecomplete-drive-folder-v1';
  const stored = key => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } };
  const config = stored(configKey) || {};
  $('driveClientId').value = (typeof config.clientId === 'string' ? config.clientId : '') || document.querySelector('meta[name="google-drive-client-id"]')?.content || '';
  // The site's shared key is the default; a personal key typed here overrides it on this device.
  const siteApiKey = document.querySelector('meta[name="google-drive-api-key"]')?.content?.trim() || '';
  const applyApiKey = () => { client.apiKey = $('driveApiKey').value.trim() || siteApiKey; };
  $('driveApiKey').value = typeof config.apiKey === 'string' ? config.apiKey : '';
  if (siteApiKey) $('driveApiKey').placeholder = "Using this site's key. Paste your own to override.";
  applyApiKey();
  $('driveOrigin').textContent = `Register this Authorized JavaScript origin: ${location.origin}`;
  $('driveApiKey').oninput = () => { applyApiKey(); if (client.publicAccess) $('driveLinkSetup').open = true; controls(); };
  $('driveFolderLink').value = typeof config.folderLink === 'string' ? config.folderLink : '';
  function saveConfig() {
    applyApiKey();
    store(configKey, { ...config, clientId: $('driveClientId').value.trim(), apiKey: $('driveApiKey').value.trim(), folderLink: $('driveFolderLink').value.trim(), connected: config.connected });
  }
  const message = text => { $('driveStatus').textContent = text; };
  function controls() {
    $('driveConnect').disabled = !identity || loading;
    $('driveConnect').textContent = config.connected ? 'Reconnect Google Drive' : 'Connect Google Drive';
    $('driveSignin').hidden = client.connected;
    // While a public folder is open, the instructions shrink to the connect button.
    $('driveSignin').classList?.toggle('compact', !!folder);
    $('driveSearch').placeholder = folder ? 'Filter this folder' : 'Search names; clear to list the top level';
    $('driveBrowse').hidden = !client.ready;
    $('driveDisconnect').hidden = !client.connected && !loading;
    $('driveDisconnect').disabled = importing || (!client.token && !loading);
    $('driveFind').disabled = loading || !(folder ? client.ready : client.connected);
    $('driveUseFolder').disabled = !client.ready || loading;
    // Public access can only browse from a folder link, not search the Drive.
    $('driveRefresh').disabled = !client.ready || loading || (client.publicAccess && !folder);
    $('driveBack').hidden = $('driveRefresh').hidden = !client.ready;
    $('driveBack').disabled = loading || !(history.length || (folder && !(client.publicAccess && trail.length <= 1)));
    $('driveMore').hidden = !nextPage;
    $('driveMore').disabled = loading || !client.ready;
    $('driveList').setAttribute('aria-busy', String(loading));
    for (const button of $('driveList').querySelectorAll('button')) button.disabled = loading || !client.ready || button.dataset.unavailable === 'true';
    $('drivePath').textContent = folder ? trail.map(item => item.name).join(' / ') : 'Find your Noteful folder';
  }
  function stop() { generation++; identity?.cancel?.(); controller?.abort(); loading = false; controls(); }
  async function run(task) {
    if (loading) return;
    const version = ++generation;
    controller = new AbortController();
    loading = true; controls();
    try { await task(controller.signal, () => version === generation && visible); }
    catch (error) { if (version === generation && error.name !== 'AbortError') message(error.message); }
    finally { if (version === generation) { loading = false; controls(); } }
  }
  function resetList() { nextPage = ''; cards.clear(); pending.clear(); $('driveList').replaceChildren(); }
  const megabytes = size => `${(Number(size) / 1048576).toFixed(1)} MB`;
  // Cards whose note has a current copy in the library say so.
  const cards = new Map();
  function badge(entry, file) {
    library?.cached(file).then(hit => {
      if (!hit || entry.querySelector?.('.note-badge')) return;
      const label = document.createElement('span');
      label.className = 'note-badge';
      label.textContent = 'On this device';
      entry.append(label);
    }, () => {});
  }
  // Covers and facts still to load. One that was cancelled (leaving Home) or failed
  // stays here and is asked for again the next time Home is shown.
  const pending = new Map();
  function load(preview) {
    const job = pending.get(preview);
    if (!job || job.busy) return;
    job.busy = 2;
    const settle = () => { if (--job.busy) return; if (job.cover && job.facts) pending.delete(preview); };
    if (job.cover) settle();
    else previews.get(job.file).then(url => {
      job.cover = url !== null;
      if (url) { preview.src = url; preview.classList?.remove('missing'); } else preview.classList?.add('missing');
      settle();
    });
    if (job.facts) settle();
    else (previews.facts?.(job.file) || Promise.resolve(null)).then(facts => {
      job.facts = !!facts || !/\.noteful$/i.test(job.file.name || '');
      if (facts) { job.button.note.facts = facts; onCards(); }
      settle();
    });
  }
  function addFiles(files) {
    const fragment = document.createDocumentFragment();
    for (const file of files) {
      const isFolder = file.mimeType === FOLDER_MIME;
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = isFolder ? 'folder-chip' : 'note-card';
      const name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = file.name.replace(/\.noteful$/i, '');
      name.title = file.name;
      const supported = isFolder || supportedDriveFile(file);
      const allowed = supported && (isFolder || file.capabilities?.canDownload !== false);
      button.dataset.unavailable = String(!allowed);
      detail.textContent = isFolder ? 'Folder' : !supported ? 'Unsupported format' : !allowed ? 'Download restricted' : [file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '', file.size ? megabytes(file.size) : ''].filter(Boolean).join(' · ');
      const entry = document.createElement('div');
      entry.className = 'note-meta';
      entry.append(name, detail);
      if (isFolder || !allowed) button.append(entry);
      else {
        const preview = document.createElement('img');
        preview.className = 'note-cover';
        preview.alt = '';
        preview.loading = 'lazy';
        button.append(preview, entry);
        // What the home filters look at; facts arrive after the cover.
        button.note = { name: file.name, modified: Date.parse(file.modifiedTime) || 0, size: Number(file.size) || 0, facts: null };
        pending.set(preview, { file, button, cover: false, facts: false, busy: 0 });
        load(preview);
        cards.set(entry, file);
        badge(entry, file);
      }
      button.onclick = () => isFolder ? enter(file) : choose(file);
      item.append(button); fragment.append(item);
    }
    $('driveList').append(fragment);
    onCards();
  }
  async function fetchList(signal, valid, append = false) {
    const page = folder
      ? await client.children(folder, append ? nextPage : '', signal, filter)
      : search
        ? await client.search(search, append ? nextPage : '', signal)
        : await client.roots(append ? nextPage : '', signal);
    if (!valid()) return;
    if (!append) resetList();
    addFiles(page.files || []);
    nextPage = page.nextPageToken || '';
    const count = $('driveList').children.length;
    const context = folder ? filter ? 'matching items' : 'items' : 'folders and notes';
    message(page.incompleteSearch ? 'Some results are missing. Paste an exact folder link to open it.'
      : count ? `${count} ${context}. ${nextPage ? 'More results available.' : ''}`
      : nextPage ? 'No items on this page. Load more results.'
      : folder ? filter ? `Nothing matches “${filter}” in this folder.` : 'This folder is empty.'
      : search ? 'No folders or notes match. Try another name, or clear the box to list the top level of Drive.'
      : 'This level of Drive is empty.');
  }
  // The folder trail is remembered so the next visit opens straight into it.
  const remember = () => store(folderKey, trail.map(({ id, name, resourceKey, mimeType }) => ({ id, name, resourceKey, mimeType })));
  function enter(file) {
    if (loading) return;
    push(); trail.push(file); folder = file; filter = ''; box = ''; $('driveSearch').value = ''; resetList(); remember();
    run((signal, valid) => { message('Loading folder…'); return fetchList(signal, valid); });
  }
  async function resume(signal, valid) {
    const saved = stored(folderKey);
    if (Array.isArray(saved) && saved.length) {
      try {
        const last = await client.folder(saved.at(-1), signal);
        if (!valid()) return;
        trail = [...saved.slice(0, -1), last]; folder = last; filter = ''; box = ''; $('driveSearch').value = '';
        return fetchList(signal, valid);
      } catch (error) { if (error.name === 'AbortError') throw error; /* Moved or deleted: search instead. */ }
    }
    folder = null; trail = [];
    return fetchList(signal, valid);
  }
  function choose(file) {
    run(async (signal, valid) => {
      let local = await library?.cached(file).catch(() => null);
      if (!local) {
        message(`Downloading ${file.name}${file.size ? ` (${megabytes(file.size)})` : ''}…`);
        const bar = $('driveProgress');
        if (bar) { bar.hidden = false; bar.value = 0; }
        let shown = 0;
        try {
          local = await client.download(file, signal, (received, total) => {
            if (Date.now() - shown < 150) return;
            shown = Date.now();
            if (bar && total) bar.value = received / total;
            message(`Downloading ${file.name}: ${total ? `${Math.round((received / total) * 100)} % · ` : ''}${megabytes(received)}${total ? ` of ${megabytes(total)}` : ''}`);
          });
        } finally { if (bar) bar.hidden = true; }
        if (!valid()) return;
        try { await library?.keep(file, local); }
        catch (error) { message(`Opening without keeping a copy: ${error.message}`); }
      } else await library.touch(library.key(file));
      if (!valid()) return;
      importing = true; controls();
      try {
        if (await open(local, file)) message('Document opened.');
        else message('Open cancelled. Your current document is unchanged.');
      } finally { importing = false; controls(); }
    });
  }
  async function show() {
    visible = true; controls();
    if (!window.isSecureContext && !window.ReactNativeWebView && !window.notecompleteDrive) { message('Open NoteComplete over HTTPS or localhost to connect Google Drive.'); return; }
    for (const [entry, file] of cards) badge(entry, file);
    for (const preview of [...pending.keys()]) load(preview);
    if (client.connected) { if (!$('driveList').children.length) run(resume); return; }
    if (client.publicAccess) $('driveLinkSetup').open = true;
    message(client.publicAccess ? 'Paste a folder shared as "Anyone with the link" to browse it without signing in, or connect Google Drive.' : '');
    try { identity ||= await identityLoader(); $('driveClientId').closest('details').hidden = !!identity.native; controls(); }
    catch (error) { message(error.message); }
  }
  function hide() { visible = false; stop(); previews.cancel(); }
  $('driveConnect').onclick = () => {
    saveConfig(); stop(); client.clear(); resetList(); trail = []; folder = null;
    try {
      const version = generation;
      loading = true; controls(); message('Complete sign-in in the Google window…');
      authorize(identity, $('driveClientId').value.trim(), response => {
        if (version !== generation || !visible) return;
        loading = false;
        try {
          client.authorize(response);
          config.connected = true; saveConfig();
          search = $('driveSearch').value.trim() || 'Noteful'; filter = '';
          run(resume);
        }
        catch (error) { message(error.message); controls(); }
      }, error => { if (version === generation) { loading = false; message(error.message); controls(); } });
    } catch (error) {
      loading = false; message(error.message); controls();
      // Missing configuration: reveal the setup fields the message points to.
      if (!$('driveClientId').value.trim()) { $('driveClientId').closest('details').open = true; $('driveClientId').focus?.(); }
    }
  };
  $('driveDisconnect').onclick = () => {
    stop(); identity?.disconnect?.(); client.clear(); previews.cancel(); resetList(); trail = []; folder = null; filter = ''; history = []; box = '';
    config.connected = false; saveConfig();
    message('Disconnected on this device. No files were changed in Drive. Notes kept on this device stay available under Recent.'); controls();
  };
  $('driveSearch').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); if (!$('driveFind').disabled) $('driveFind').click(); }
  };
  $('driveFind').onclick = () => {
    const value = $('driveSearch').value.trim();
    // Inside a folder the same box filters its children; at the top it searches names, or lists the top level when cleared.
    if (value === (folder ? filter : search)) return run((signal, valid) => fetchList(signal, valid));
    push(); box = value;
    if (folder) { filter = value; run((signal, valid) => fetchList(signal, valid)); return; }
    search = value; filter = ''; trail = []; folder = null; resetList();
    run((signal, valid) => fetchList(signal, valid));
  };
  $('driveUseFolder').onclick = () => run(async (signal, valid) => {
    saveConfig(); const selected = await client.folder(folderReference($('driveFolderLink').value), signal);
    if (!valid()) return;
    if (folder || client.connected) push(); folder = selected; trail = [selected]; filter = ''; box = ''; $('driveSearch').value = ''; resetList(); remember(); await fetchList(signal, valid);
  });
  // Back returns to the previous view (before a search, filter or folder); without one it goes up a folder.
  $('driveBack').onclick = () => {
    const previous = history.pop();
    if (previous) ({ trail, folder, search, filter, box } = { ...previous, trail: [...previous.trail] });
    else { trail.pop(); folder = trail.at(-1) || null; filter = ''; box = ''; }
    $('driveSearch').value = box;
    resetList(); remember(); run((signal, valid) => fetchList(signal, valid));
  };
  $('driveRefresh').onclick = () => run((signal, valid) => fetchList(signal, valid));
  $('driveMore').onclick = () => run((signal, valid) => fetchList(signal, valid, true));
  controls();
  // Upload an exported note over its Drive file, asking for write access first.
  async function writeAccess() {
    if (client.canWrite) return;
    identity ||= await identityLoader();
    if (window.ReactNativeWebView) throw Error('Changing Drive files is available in the desktop and web apps.');
    await new Promise((resolve, reject) => {
      try {
        authorize(identity, $('driveClientId').value.trim(), response => {
          try { client.authorizeWrite(response); resolve(); } catch (error) { reject(error); }
        }, reject, DRIVE_WRITE_SCOPE);
      } catch (error) { reject(error); }
    });
  }
  async function trash(entry) {
    await writeAccess();
    await client.trash({ id: entry.driveId, resourceKey: entry.resourceKey });
    resetList();
  }
  async function update(entry, blob, report = () => {}) {
    if (!client.canWrite) {
      identity ||= await identityLoader();
      if (window.ReactNativeWebView) throw Error('Updating Drive files is available in the desktop and web apps.');
      await new Promise((resolve, reject) => {
        try {
          authorize(identity, $('driveClientId').value.trim(), response => {
            try { client.authorizeWrite(response); resolve(); } catch (error) { reject(error); }
          }, reject, DRIVE_WRITE_SCOPE);
        } catch (error) { reject(error); }
      });
    }
    report('Uploading to Drive…');
    return client.upload({ id: entry.driveId, resourceKey: entry.resourceKey }, blob);
  }
  return { show, hide, update, trash, get busy() { return importing; } };
}
