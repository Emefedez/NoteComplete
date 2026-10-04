import { DriveClient, FOLDER_MIME, folderReference, supportedDriveFile } from './drive-client.js';
import { loadGoogleIdentity, requestDriveAccess } from './drive-auth.js';
import { driveThumbnails } from './drive-thumbs.js';

export function driveBrowser({ open, client = new DriveClient(), identityLoader = loadGoogleIdentity, authorize = requestDriveAccess, thumbs = null }) {
  const $ = id => document.getElementById(id);
  const dialog = $('driveDialog');
  const previews = thumbs || driveThumbnails(client);
  let identity, controller, generation = 0, loading = false, importing = false;
  let folder = null, trail = [], nextPage = '', search = 'Noteful', filter = '';
  const configKey = 'notecomplete-drive-config-v1';
  let config = {};
  try { config = JSON.parse(localStorage.getItem(configKey)) || {}; } catch { /* Storage is optional. */ }
  $('driveClientId').value = (typeof config.clientId === 'string' ? config.clientId : '') || document.querySelector('meta[name="google-drive-client-id"]')?.content || '';
  // The site's shared key is the default; a personal key typed here overrides it on this device.
  const siteApiKey = document.querySelector('meta[name="google-drive-api-key"]')?.content?.trim() || '';
  const applyApiKey = () => { client.apiKey = $('driveApiKey').value.trim() || siteApiKey; };
  $('driveApiKey').value = typeof config.apiKey === 'string' ? config.apiKey : '';
  if (siteApiKey) $('driveApiKey').placeholder = "Using this site's key. Paste your own to override.";
  applyApiKey();
  $('driveClientId').closest('details').open = !$('driveClientId').value && !client.apiKey;
  $('driveOrigin').textContent = `Register this Authorized JavaScript origin: ${location.origin}`;
  $('driveApiKey').oninput = () => { applyApiKey(); if (client.publicAccess) $('driveLinkSetup').open = true; controls(); };
  $('driveFolderLink').value = typeof config.folderLink === 'string' ? config.folderLink : '';
  function saveConfig() {
    applyApiKey();
    try { localStorage.setItem(configKey, JSON.stringify({ clientId: $('driveClientId').value.trim(), apiKey: $('driveApiKey').value.trim(), folderLink: $('driveFolderLink').value.trim() })); } catch { /* Session-only configuration. */ }
  }
  const message = text => { $('driveStatus').textContent = text; };
  function controls() {
    $('driveConnect').disabled = !identity || loading;
    $('driveDisconnect').disabled = importing || (!client.token && !loading);
    $('driveFind').disabled = loading || !(folder ? client.ready : client.connected);
    $('driveUseFolder').disabled = !client.ready || loading;
    // Public access can only browse from a folder link, not search the Drive.
    $('driveRefresh').disabled = !client.ready || loading || (client.publicAccess && !folder);
    $('driveBack').disabled = !folder || loading || (client.publicAccess && trail.length <= 1);
    $('driveMore').hidden = !nextPage;
    $('driveMore').disabled = loading || !client.ready;
    $('driveClose').disabled = importing;
    $('driveList').setAttribute('aria-busy', String(loading));
    for (const button of $('driveList').querySelectorAll('button')) button.disabled = loading || !client.ready || button.dataset.unavailable === 'true';
    $('drivePath').textContent = folder ? trail.map(item => item.name).join(' / ') : 'Choose your Noteful folder';
  }
  function stop() { generation++; identity?.cancel?.(); controller?.abort(); loading = false; controls(); }
  async function run(task) {
    if (loading) return;
    const version = ++generation;
    controller = new AbortController();
    loading = true; controls();
    try { await task(controller.signal, () => version === generation && dialog.open); }
    catch (error) { if (version === generation && error.name !== 'AbortError') message(error.message); }
    finally { if (version === generation) { loading = false; controls(); } }
  }
  function resetList() { nextPage = ''; $('driveList').replaceChildren(); }
  function addFiles(files) {
    const fragment = document.createDocumentFragment();
    for (const file of files) {
      const isFolder = file.mimeType === FOLDER_MIME;
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = file.name;
      const supported = isFolder || supportedDriveFile(file);
      const allowed = supported && (isFolder || file.capabilities?.canDownload !== false);
      button.dataset.unavailable = String(!allowed);
      detail.textContent = isFolder ? 'Folder · browse' : !supported ? 'Unsupported format' : !allowed ? 'Download restricted' : [file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : '', file.size ? `${(Number(file.size) / 1048576).toFixed(1)} MB` : '', 'Download & open'].filter(Boolean).join(' · ');
      const entry = document.createElement('div');
      entry.className = 'drive-entry';
      entry.append(name, detail);
      if (isFolder || !allowed) button.append(entry);
      else {
        const preview = document.createElement('img');
        preview.className = 'drive-thumb';
        preview.alt = '';
        button.append(preview, entry);
        previews.get(file).then(url => { if (url) preview.src = url; else preview.remove?.(); });
      }
      button.onclick = () => isFolder ? enter(file) : choose(file);
      item.append(button); fragment.append(item);
    }
    $('driveList').append(fragment);
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
      : count ? `${count} ${context} listed. ${nextPage ? 'More results available.' : ''}`
      : nextPage ? 'No items on this page. Load more results.'
      : folder ? filter ? `Nothing matches “${filter}” in this folder.` : 'This folder is empty.'
      : search ? 'No folders or notes match. Try another name, or clear the box to list the top level of Drive.'
      : 'This level of Drive is empty.');
  }
  function enter(file) {
    if (loading) return;
    trail.push(file); folder = file; filter = ''; resetList();
    run((signal, valid) => { message('Loading folder…'); return fetchList(signal, valid); });
  }
  function choose(file) {
    run(async (signal, valid) => {
      message(`Downloading ${file.name}…`);
      const downloaded = await client.download(file, signal);
      if (!valid()) return;
      importing = true; controls();
      try {
        if (await open(downloaded)) { message('Downloaded document opened.'); dialog.close(); }
        else message('Open cancelled. Your current document is unchanged.');
      } finally { importing = false; controls(); }
    });
  }
  $('driveOpen').onclick = async () => {
    dialog.showModal(); controls();
    if (!window.isSecureContext && !window.ReactNativeWebView && !window.notecompleteDrive) { message('Open NoteComplete over HTTPS or localhost to connect Google Drive.'); return; }
    if (client.publicAccess) { $('driveLinkSetup').open = true; message('Paste a folder shared as "Anyone with the link" to browse it without signing in, or connect Google Drive.'); }
    else if (!client.connected) message('Connect Google Drive, then find your Noteful folder.');
    try { identity = await identityLoader(); $('driveClientId').closest('details').hidden = !!identity.native; controls(); }
    catch (error) { message(error.message); }
  };
  $('driveConnect').onclick = () => {
    saveConfig(); stop(); client.clear(); resetList(); trail = []; folder = null;
    try {
      const version = generation;
      loading = true; controls(); message('Complete sign-in in the Google window…');
      authorize(identity, $('driveClientId').value.trim(), response => {
        if (version !== generation || !dialog.open) return;
        loading = false;
        try { client.authorize(response); search = $('driveSearch').value.trim() || 'Noteful'; filter = ''; run((signal, valid) => fetchList(signal, valid)); }
        catch (error) { message(error.message); controls(); }
      }, error => { if (version === generation) { loading = false; message(error.message); controls(); } });
    } catch (error) { loading = false; message(error.message); controls(); }
  };
  $('driveDisconnect').onclick = () => {
    stop(); identity?.disconnect?.(); client.clear(); previews.cancel(); resetList(); trail = []; folder = null; filter = '';
    message('Disconnected on this device. No files were changed in Drive.'); controls();
  };
  $('driveFind').onclick = () => {
    const value = $('driveSearch').value.trim();
    // Inside a folder the same box filters its children; at the top it searches names, or lists the top level when cleared.
    if (folder) { filter = value; run((signal, valid) => fetchList(signal, valid)); return; }
    search = value; filter = ''; trail = []; folder = null; resetList();
    run((signal, valid) => fetchList(signal, valid));
  };
  $('driveUseFolder').onclick = () => run(async (signal, valid) => {
    saveConfig(); const selected = await client.folder(folderReference($('driveFolderLink').value), signal);
    if (!valid()) return;
    folder = selected; trail = [selected]; filter = ''; resetList(); await fetchList(signal, valid);
  });
  $('driveBack').onclick = () => {
    trail.pop(); folder = trail.at(-1) || null; filter = ''; resetList(); run((signal, valid) => fetchList(signal, valid));
  };
  $('driveRefresh').onclick = () => run((signal, valid) => fetchList(signal, valid));
  $('driveMore').onclick = () => run((signal, valid) => fetchList(signal, valid, true));
  $('driveClose').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); });
  dialog.addEventListener('close', () => { stop(); previews.cancel(); });
  controls();
}
