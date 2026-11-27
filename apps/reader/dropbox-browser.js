import { DropboxClient, DROPBOX_ROOT, dropboxPath, supportedDropboxFile } from './dropbox-client.js';
import { FOLDER_MIME } from './drive-client.js';
import { dropboxIdentity, redirectUri, validAppKey, webSignIn, refreshAccess } from './dropbox-auth.js';
import { driveThumbnails } from './drive-thumbs.js';
import { addExportMenu, exportable } from './download-queue.js';
import { attachOpenWithMenu } from './open-with-ui.js';
import { hideDuplicates, copyKey, copyGroups, copyCount, chooseCopy } from './duplicate-copies.js';
import { onlyEuroOffice } from './open-with.js';
import { queueButton, markQueueDone, selectionCheck, updateQueueControls as queueControls } from './queue-controls.js';

// The Dropbox tab of the home screen's Cloud section (docs/DROPBOX.md): sign in, browse or
// search, and open a file, which is downloaded and kept on this device like a Drive note.
// show()/hide() follow the home screen: hiding cancels listings, downloads, covers and sign-in.
export function dropboxBrowser({ open, client = new DropboxClient(), identity = dropboxIdentity(), signIn = webSignIn, refresh = refreshAccess, thumbs = null, library = null, onCards = () => {}, queue = null, exportRequest = null }) {
  const $ = id => document.getElementById(id);
  const copies = copyGroups();
  const previews = thumbs || driveThumbnails(client, { library });
  const configKey = 'notecomplete-dropbox-config-v1', folderKey = 'notecomplete-dropbox-folder-v1', sessionKey = 'notecomplete-dropbox-session-v1';
  const stored = key => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } };
  const config = stored(configKey) || {};
  const siteKey = document.querySelector('meta[name="dropbox-app-key"]')?.content?.trim() || '';
  let controller, generation = 0, loading = false, importing = false, visible = false, refreshToken = '';
  let everywhere = config.everywhere === true, folder = null, trail = [], nextPage = '', search = '', filter = '';
  let history = [], forwardHistory = [], box = '';
  const view = () => ({ trail: [...trail], folder, search, filter, box });
  const push = () => { history.push(view()); if (history.length > 50) history.shift(); forwardHistory = []; };
  $('dropboxAppKey').value = typeof config.appKey === 'string' ? config.appKey : '';
  if (siteKey) $('dropboxAppKey').placeholder = "Using this site's app key. Paste your own to override.";
  const appKey = () => $('dropboxAppKey').value.trim() || siteKey;
  $('dropboxRedirect').textContent = identity.native
    ? 'Register this redirect URI in the Dropbox App Console: http://127.0.0.1:53691/dropbox-callback'
    : `Register this redirect URI in the Dropbox App Console: ${redirectUri()}`;
  function saveConfig() {
    store(configKey, { appKey: $('dropboxAppKey').value.trim(), connected: !!config.connected, email: config.email || '', everywhere });
  }
  // Web: the short-lived access token survives a reload; the refresh token stays in memory.
  function persistSession(token) {
    if (identity.native) return;
    const seconds = Number(token?.expires_in);
    if (!token?.access_token || !Number.isFinite(seconds) || seconds <= 60) return;
    store(sessionKey, { access_token: token.access_token, scope: token.scope || '', expires: Date.now() + seconds * 1000 });
  }
  const clearStoredSession = () => store(sessionKey, null);
  function restoreSession() {
    const saved = stored(sessionKey);
    if (!saved?.access_token || !saved?.expires) return false;
    const remaining = Math.floor((saved.expires - Date.now()) / 1000);
    if (remaining <= 60) { clearStoredSession(); return false; }
    try { client.authorize({ access_token: saved.access_token, scope: saved.scope, expires_in: remaining }); config.connected = true; return true; }
    catch { clearStoredSession(); return false; }
  }
  function accept(token) {
    client.authorize(token);
    if (token.refresh_token) refreshToken = token.refresh_token;
    persistSession(token);
    config.connected = true; saveConfig();
    if (!config.email) client.userEmail().then(email => { if (email) { config.email = email; saveConfig(); } }, () => {});
  }
  // Silent refresh: the desktop app's main process holds the refresh token; the web keeps it
  // in memory for the session.
  let refreshTask = null;
  function silentRefresh({ force = false } = {}) {
    refreshTask ||= (async () => {
      try {
        const token = identity.native ? await identity.refresh?.({ force })
          : refreshToken && validAppKey(appKey()) ? await refresh({ appKey: appKey(), refreshToken }) : null;
        if (!token?.access_token) return false;
        accept(token); controls();
        return true;
      } catch { return false; }
      finally { refreshTask = null; }
    })();
    return refreshTask;
  }
  client.onRefresh = silentRefresh;
  client.onClear = clearStoredSession;
  const message = text => { $('dropboxStatus').textContent = text; };
  const label = () => folder?.path ? `Dropbox / ${folder.name}` : 'Dropbox';
  function controls() {
    $('dropboxConnect').disabled = loading;
    $('dropboxConnect').textContent = config.connected ? 'Reconnect Dropbox' : 'Connect Dropbox';
    $('dropboxSignin').hidden = client.connected;
    $('dropboxBrowse').hidden = !client.ready;
    $('dropboxScope').hidden = !folder?.path;
    $('dropboxScope').setAttribute('aria-pressed', String(everywhere));
    $('dropboxScope').classList?.toggle('active', everywhere);
    $('dropboxSearch').placeholder = folder?.path ? (everywhere ? 'Search all of Dropbox (folders and notes)' : 'Search this folder') : 'Search names; clear to list the top level';
    $('dropboxDisconnect').hidden = !client.connected && !loading;
    $('dropboxDisconnect').disabled = importing || (!client.token && !loading);
    $('dropboxFind').disabled = loading || !client.ready;
    $('dropboxUseFolder').disabled = loading || !client.ready;
    $('dropboxRefresh').disabled = !client.ready || loading;
    const backable = Boolean(client.ready && canGoBack());
    $('dropboxBack').hidden = !backable;
    $('dropboxBack').disabled = !backable;
    $('dropboxRefresh').hidden = !client.ready;
    $('dropboxMore').hidden = !nextPage;
    $('dropboxMore').disabled = loading || !client.ready;
    $('dropboxList').setAttribute('aria-busy', String(loading));
    for (const button of $('dropboxList').querySelectorAll('button')) button.disabled = loading || !client.ready || button.dataset.unavailable === 'true';
    $('dropboxPath').textContent = folder ? trail.map(item => item.name).join(' / ') : search ? `Names matching “${search}”` : 'Dropbox';
  }
  function stop() { generation++; identity.cancel?.(); controller?.abort(); loading = false; controls(); }
  async function run(task) {
    if (loading) return;
    const version = ++generation;
    controller = new AbortController();
    loading = true; controls();
    try { await task(controller.signal, () => version === generation && visible); }
    catch (error) { if (version === generation && error.name !== 'AbortError') message(error.message); }
    finally { if (version === generation) { loading = false; controls(); } }
  }
  let currentFiles = [], selectingQueue = false;
  const selectedFiles = new Set();
  const downloadable = () => currentFiles.filter(f => supportedDropboxFile(f) && f.capabilities?.canDownload !== false);
  const queueItem = f => ({ source: 'dropbox', id: `dropbox:${f.id}`, name: f.name, size: Number(f.size) || 0, doc: f, client });
  function resetList() {
    nextPage = ''; copies.clear(); cards.clear(); pending.clear(); currentFiles = []; selectedFiles.clear(); selectingQueue = false;
    updateQueueControls();
    $('dropboxList').replaceChildren();
  }
  function updateQueueControls() {
    queueControls(
      { mode: $('dropboxQueueMode'), download: $('dropboxQueueDownload'), cancel: $('dropboxQueueCancel'), all: $('dropboxQueueAll'), list: $('dropboxList') },
      { available: !!queue, count: downloadable().length, selecting: selectingQueue, selected: selectedFiles.size },
    );
  }
  const endSelection = () => {
    selectingQueue = false; selectedFiles.clear(); updateQueueControls();
    for (const card of $('dropboxList').querySelectorAll('button')) card.classList?.remove?.('is-selected');
  };
  $('dropboxQueueMode').onclick = () => { endSelection(); selectingQueue = true; updateQueueControls(); };
  $('dropboxQueueDownload').onclick = () => {
    const chosen = downloadable().filter(f => selectedFiles.has(f.id));
    if (chosen.length) queue?.enqueue(chosen.map(queueItem));
    endSelection();
  };
  $('dropboxQueueCancel').onclick = endSelection;
  $('dropboxQueueAll').onclick = () => queue?.enqueue(downloadable().map(queueItem));

  const megabytes = size => `${(Number(size) / 1048576).toFixed(1)} MB`;
  // Cards whose file has a current copy on this device say so.
  const cards = new Map();
  function badge(entry, file) {
    library?.cached(file).then(hit => {
      if (!hit || entry.querySelector?.('.note-badge')) return;
      const tag = document.createElement('span');
      tag.className = 'note-badge';
      tag.textContent = 'On this device';
      entry.append(tag);
    }, () => {});
  }
  // Covers and facts still to load; cancelled ones are asked for again when Home shows.
  const pending = new Map();
  let quick = false;
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
  // Same-named items share one card when "One of each" is on (duplicate-copies.js).
  const copyWhere = (f) => (f.pathDisplay || '').replace(/\/[^/]*$/, '') || '/';
  globalThis.addEventListener?.('notecomplete:duplicates', () => {
    if (!currentFiles.length) return;
    const files = [...currentFiles], more = nextPage;
    resetList(); nextPage = more;
    addFiles(files); controls();
  });
  function addFiles(files) {
    currentFiles.push(...files);
    const fragment = document.createDocumentFragment();
    const oneOfEach = hideDuplicates();
    for (const file of files) {
      const isFolder = file.mimeType === FOLDER_MIME;
      const group = oneOfEach ? copies.add(copyKey(file.name, isFolder), file) : { copies: [file] };
      if (!group) continue;
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = isFolder ? 'folder-chip' : 'note-card';
      const name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = file.name.replace(/\.noteful$/i, '');
      name.title = file.pathDisplay || file.name;
      const supported = isFolder || supportedDropboxFile(file);
      const allowed = supported && (isFolder || file.capabilities?.canDownload !== false);
      button.dataset.unavailable = String(!allowed);
      detail.textContent = isFolder ? `${label()} · Folder` : !supported ? (onlyEuroOffice(file.name) ? 'Needs the Office suite module' : 'Unsupported format') : !allowed ? 'Download restricted'
        : [label(), file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '', file.size ? megabytes(file.size) : ''].filter(Boolean).join(' · ');
      const entry = document.createElement('div');
      entry.className = 'note-meta';
      entry.append(name, detail);
      if (isFolder || !allowed) button.append(entry);
      else {
        const preview = document.createElement('img');
        preview.className = 'note-cover'; preview.alt = ''; preview.loading = 'lazy';
        button.append(preview, entry);
        button.note = { name: file.name, modified: Date.parse(file.modifiedTime) || 0, size: Number(file.size) || 0, facts: null };
        pending.set(preview, { file, button, cover: false, facts: false, busy: 0 });
        if (!quick) load(preview);
        cards.set(entry, file);
        badge(entry, file);
        button.append(selectionCheck());
        if (selectedFiles.has(file.id)) button.classList?.add?.('is-selected');
      }
      button.onclick = () => {
        if (!isFolder && selectingQueue) {
          if (selectedFiles.delete(file.id)) button.classList?.remove?.('is-selected');
          else { selectedFiles.add(file.id); button.classList?.add?.('is-selected'); }
          return updateQueueControls();
        }
        return chooseCopy(group, button, (picked) => (isFolder ? enter(picked) : choose(picked)), { name: file.name, where: copyWhere });
      };
      if (oneOfEach) copyCount(group, entry);
      item.append(button);
      if (!isFolder && allowed) attachOpenWithMenu(button, file.name, () => choose(file));
      if (!isFolder && allowed && exportRequest && exportable(file.name)) addExportMenu(item, { label: file.name, pick: kind => { Object.assign(exportRequest, { kind, key: `dropbox:${file.id}` }); choose(file); } });
      if (!isFolder && allowed && queue) item.append(queueButton({ queue, id: `dropbox:${file.id}`, item: () => queueItem(file), kept: library?.cached(file) }));
      fragment.append(item);
    }
    $('dropboxList').append(fragment);
    updateQueueControls();
    onCards();
  }
  async function fetchList(signal, valid, append = false) {
    const token = append ? nextPage : '';
    const page = folder ? await client.children(folder, token, signal, filter)
      : search ? await client.search(search, token, signal)
        : await client.roots(token, signal);
    if (!valid()) return;
    if (!append) resetList();
    addFiles(page.files || []);
    nextPage = page.nextPageToken || '';
    const count = $('dropboxList').children.length;
    message(count ? `${count} ${folder ? filter ? 'matching items' : 'items' : 'folders and notes'}. ${nextPage ? 'More results available.' : ''}`.trim()
      : nextPage ? 'No items on this page. Load more results.'
        : folder ? filter ? `Nothing matches “${filter}” in this folder.` : 'This folder is empty.'
          : search ? 'No folders or notes match. Try another name, or clear the box to list the top level.'
            : 'Your Dropbox is empty.');
  }
  // The folder trail is remembered so the next visit opens straight into it.
  const remember = () => store(folderKey, trail.map(({ id, name, path }) => ({ id, name, path })));
  function enter(file) {
    if (loading) return;
    push(); trail.push(file); folder = file; filter = ''; box = ''; $('dropboxSearch').value = ''; resetList(); remember();
    run((signal, valid) => { message('Loading folder…'); return fetchList(signal, valid); });
  }
  async function resume(signal, valid) {
    const saved = stored(folderKey);
    if (Array.isArray(saved) && saved.length) {
      try {
        const last = await client.folder(saved.at(-1), signal);
        if (!valid()) return;
        trail = [...saved.slice(0, -1), last]; folder = last; filter = ''; box = ''; $('dropboxSearch').value = '';
        return await fetchList(signal, valid);
      } catch (error) { if (error.name === 'AbortError') throw error; /* Moved or deleted: list the top level. */ }
    }
    folder = null; trail = []; search = '';
    return fetchList(signal, valid);
  }
  async function fetchFile(file, signal, onProgress = () => {}) {
    let local = await library?.cached(file).catch(() => null);
    if (local) { await library.touch(library.key(file)); return local; }
    local = await client.download(file, signal, onProgress);
    try { await library?.keep(file, local); } catch (error) { message(`Opening without keeping a copy: ${error.message}`); }
    return local;
  }
  function choose(file) {
    run(async (signal, valid) => {
      let local = await library?.cached(file).catch(() => null);
      if (!local) {
        message(`Downloading ${file.name}${file.size ? ` (${megabytes(file.size)})` : ''}…`);
        const bar = $('dropboxProgress');
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
        try { await library?.keep({ ...file, folderName: folder?.path ? folder.name : '' }, local); }
        catch (error) { message(`Opening without keeping a copy: ${error.message}`); }
      } else await library.touch(library.key(file));
      if (!valid()) return;
      importing = true; controls();
      try { message(await open(local, file) ? 'Document opened.' : 'Open cancelled. Your current document is unchanged.'); }
      finally { importing = false; controls(); }
    });
  }
  async function show() {
    visible = true; controls();
    if (!identity.native && !window.isSecureContext) { message('Open NoteComplete over HTTPS or localhost to connect Dropbox.'); return; }
    if (window.ReactNativeWebView && !identity.native) { $('dropboxConnect').disabled = true; message('Dropbox works in the web and desktop apps for now.'); return; }
    $('dropboxAppKey').closest('details').hidden = !!identity.native && !!siteKey;
    for (const [entry, file] of cards) badge(entry, file);
    if (!quick) for (const preview of [...pending.keys()]) load(preview);
    if (!client.connected && !identity.native) restoreSession();
    if (!client.connected && config.connected) await silentRefresh();
    if (client.connected && visible && !$('dropboxList').children.length) run(resume);
  }
  function hide() { visible = false; stop(); previews.cancel(); }
  $('dropboxConnect').onclick = () => {
    saveConfig();
    if (!validAppKey(appKey())) {
      message('Enter the Dropbox app key in Connection setup.');
      const details = $('dropboxAppKey').closest('details'); details.hidden = false; details.open = true; $('dropboxAppKey').focus?.();
      return;
    }
    // The popup has to open in the click itself, or the browser blocks it.
    const popup = identity.native ? null : window.open('about:blank', 'notecomplete-dropbox', 'popup,width=560,height=720');
    stop(); client.clear(); clearStoredSession(); resetList(); trail = []; folder = null; history = []; forwardHistory = [];
    const version = ++generation;
    controller = new AbortController();
    loading = true; controls(); message('Complete sign-in in the Dropbox window…');
    const request = identity.native ? identity.signIn({ appKey: appKey() }) : signIn({ appKey: appKey(), popup, signal: controller.signal });
    request.then(token => {
      if (version !== generation) return;
      loading = false;
      accept(token);
      search = ''; filter = '';
      if (visible) run(resume); else controls();
    }, error => {
      if (version !== generation) return;
      loading = false; message(error.name === 'AbortError' ? '' : error.message); controls();
    });
  };
  $('dropboxDisconnect').onclick = () => {
    stop(); void client.revoke(); identity.disconnect?.(); client.clear(); clearStoredSession(); previews.cancel(); resetList();
    refreshToken = ''; trail = []; folder = null; filter = ''; search = ''; history = []; forwardHistory = []; box = '';
    config.connected = false; config.email = ''; saveConfig();
    message('Disconnected on this device. No files were changed in Dropbox. Notes kept on this device stay available under Recent.'); controls();
  };
  $('dropboxSearch').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); if (!$('dropboxFind').disabled) $('dropboxFind').click(); }
  };
  $('dropboxScope').onclick = () => { everywhere = !everywhere; saveConfig(); controls(); };
  $('dropboxFind').onclick = () => {
    const value = $('dropboxSearch').value.trim();
    if (folder?.path && everywhere && value) {
      push(); box = value; search = value; filter = ''; trail = []; folder = null; resetList();
      return run((signal, valid) => fetchList(signal, valid));
    }
    if (value === (folder ? filter : search)) return run((signal, valid) => fetchList(signal, valid));
    push(); box = value;
    if (folder) { filter = value; return run((signal, valid) => fetchList(signal, valid)); }
    search = value; filter = ''; trail = []; folder = null; resetList();
    run((signal, valid) => fetchList(signal, valid));
  };
  // A folder by its path ("/Noteful" or a dropbox.com/home/… address).
  $('dropboxUseFolder').onclick = () => run(async (signal, valid) => {
    const path = dropboxPath($('dropboxFolderPath').value);
    const selected = path ? await client.folder({ path }, signal) : { ...DROPBOX_ROOT };
    if (!valid()) return;
    push(); folder = selected.path ? selected : null; trail = selected.path ? [selected] : []; search = ''; filter = ''; box = ''; $('dropboxSearch').value = '';
    resetList(); remember(); await fetchList(signal, valid);
  });
  $('dropboxFolderPath').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); if (!$('dropboxUseFolder').disabled) $('dropboxUseFolder').click(); }
  };
  function canGoBack() { return !loading && Boolean(history.length || folder); }
  const canGoForward = () => !loading && forwardHistory.length > 0;
  function restore(state) {
    ({ trail, folder, search, filter, box } = { ...state, trail: [...state.trail] });
    $('dropboxSearch').value = box;
    resetList(); remember(); run((signal, valid) => fetchList(signal, valid));
  }
  // Back returns to the previous view (before a search, filter or folder); without one it goes up a folder.
  function back() {
    if (!canGoBack()) return false;
    forwardHistory.push(view());
    const previous = history.pop();
    if (previous) restore(previous);
    else { const up = trail.slice(0, -1); restore({ trail: up, folder: up.at(-1) || null, search: '', filter: '', box: '' }); }
    return true;
  }
  function forward() {
    if (!canGoForward()) return false;
    history.push(view());
    restore(forwardHistory.pop());
    return true;
  }
  $('dropboxBack').onclick = back;
  $('dropboxRefresh').onclick = () => run((signal, valid) => fetchList(signal, valid));
  $('dropboxMore').onclick = () => run((signal, valid) => fetchList(signal, valid, true));
  function setQuick(on) {
    quick = on;
    if (on) previews.cancel();
    else if (visible) for (const preview of [...pending.keys()]) load(preview);
  }
  // For Recent: Dropbox files with this entry's name in its folder, and fetching one.
  async function newest(entry) {
    const parent = entry.parent ?? (client.connected ? await client.parentOf(entry.dropboxId || entry.path).catch(() => null) : null);
    if (parent === null && !client.connected) return [];
    if (parent !== null && entry.parent == null) {
      entry.parent = parent;
      await library?.store.set('entries', entry.key, entry).catch(() => { /* Optional. */ });
    }
    return (await client.sameName(entry.name, parent)).filter(f => supportedDropboxFile(f));
  }
  function onQueueItemDone(item) {
    if (item.source !== 'dropbox') return;
    for (const [entry, file] of cards) {
      if (`dropbox:${file.id}` === item.id) { badge(entry, file); markQueueDone(entry.closest('li')?.querySelector('.card-queue-btn')); }
    }
  }
  // Desktop: one Dropbox session for every tab (the main process keeps it, encrypted).
  function adopt(session) {
    try {
      if (session?.access_token) {
        if (client.token !== session.access_token) {
          client.authorize(session); config.connected = true; saveConfig(); controls();
          if (visible && !$('dropboxList').children.length) run(resume);
        }
      } else if (client.token) { client.clear(); config.connected = false; saveConfig(); resetList(); controls(); }
    } catch { /* A stale session just means signing in again. */ }
  }
  if (!identity.native) restoreSession();
  else if (identity.session) { identity.onSession?.(adopt); identity.session().then(adopt, () => {}); }
  controls();
  return { show, hide, setQuick, newest, onQueueItemDone, back, forward, canGoBack, canGoForward, fetch: (file, onProgress) => fetchFile(file, undefined, onProgress), get ready() { return client.ready; }, get busy() { return importing; } };
}
