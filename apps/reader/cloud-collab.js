// Unified Cloud section controller, GitHub (Auto-Chunked) & Nextcloud/WebDAV browsers,
// multi-provider checkbox dropdown, and fixed-layout User/Creator guided setup dialog.
import {
  GitHubCloudClient,
  WebDavCloudClient,
  parseGitHubRepo,
  parseWebDavTarget,
  encryptInvite,
  decryptInvite,
} from './chunked-note.js';
import { addExportMenu, exportable } from './download-queue.js';

// Where each cloud keeps its connection (what the Home screen checks to show a connected cloud).
// Dropbox and archive keys are dropbox-browser.js's and archive-browser.js's own.
export const CLOUD_CONFIG_KEYS = {
  dropbox: ['notecomplete-dropbox-session-v1', 'notecomplete-dropbox-config-v1'],
  github: ['notecomplete-github-config-v1'],
  webdav: ['notecomplete-webdav-config-v1'],
  archive: ['notecomplete-archive-sources-v1'],
};

export const CLOUD_PROVIDERS = [
  {
    id: 'drive',
    label: 'Google Drive',
    sectionId: 'driveSection',
    searchId: 'driveSearch',
    findId: 'driveFind',
    svg: '<svg class="provider-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M21.35 11.1H12v2.96h5.36c-.46 2.3-2.43 3.94-5.36 3.94a5.99 5.99 0 0 1-6-6 5.99 5.99 0 0 1 6-6c1.47 0 2.8.56 3.82 1.48l2.2-2.2A9.97 9.97 0 0 0 12 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9c5.21 0 8.66-3.66 8.66-8.83 0-.71-.07-1.4-.2-2.07h-.11z"/></svg>',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    sectionId: 'dropboxSection',
    searchId: 'dropboxSearch',
    findId: 'dropboxFind',
    svg: '<svg class="provider-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7 3 2 6.2l5 3.2 5-3.2zm10 0-5 3.2 5 3.2 5-3.2zM2 12.6l5 3.2 5-3.2-5-3.2zm15-3.2-5 3.2 5 3.2 5-3.2zM7 17l5 3.2 5-3.2-5-3.2z"/></svg>',
  },
  {
    id: 'github',
    label: 'GitHub (Auto-Chunked)',
    sectionId: 'githubSection',
    searchId: 'githubSearch',
    findId: 'githubFind',
    svg: '<svg class="provider-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
  },
  {
    id: 'webdav',
    label: 'Nextcloud / WebDAV',
    sectionId: 'webdavSection',
    searchId: 'webdavSearch',
    findId: 'webdavFind',
    svg: '<svg class="provider-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.5"/><circle cx="5.5" cy="12" r="2.5"/><circle cx="18.5" cy="12" r="2.5"/></svg>',
  },
  {
    id: 'archive',
    label: 'Internet Archive',
    sectionId: 'archiveSection',
    searchId: 'archiveSearch',
    findId: null,
    svg: '<svg class="provider-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 10h18M4 10v9M8 10v9M12 10v9M16 10v9M20 10v9M2 20h20M12 3 3 6h18z"/></svg>',
  },
];

function cardCoverSvg(name, badgeLabel = 'NOTE') {
  const isPdf = /\.pdf$/i.test(name);
  const color = isPdf ? '#d9534f' : '#245dc4';
  const label = isPdf ? 'PDF' : badgeLabel;
  const baseName = String(name || 'Note').replace(/\.[^.]+$/, '').trim().slice(0, 34);
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240"><rect x="48" y="24" width="224" height="192" rx="8" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/><rect x="68" y="44" width="56" height="20" rx="4" fill="${color}" fill-opacity="0.12"/><text x="96" y="58" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${color}" text-anchor="middle">${esc(label)}</text><text x="68" y="98" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#1e2433">${esc(baseName)}</text><rect x="68" y="122" width="160" height="6" rx="3" fill="#eef2f6"/><rect x="68" y="138" width="130" height="6" rx="3" fill="#eef2f6"/><rect x="68" y="154" width="145" height="6" rx="3" fill="#eef2f6"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const formatMb = (size) => (size > 0 ? `${(Number(size) / 1048576).toFixed(1)} MB` : 'Chunked');

// --- GitHub Auto-Chunked Browser ---
export function githubBrowser({
  open,
  library,
  exportRequest = null,
  exportOpenNote = null,
  onCards = null,
  client = new GitHubCloudClient(),
  storage = globalThis.localStorage,
} = {}) {
  const $ = (id) => document.getElementById(id);
  const [CONFIG_KEY] = CLOUD_CONFIG_KEYS.github;
  let config = { repo: '', branch: 'main', path: '', token: '', connected: false };
  try { Object.assign(config, JSON.parse(storage?.getItem(CONFIG_KEY) || '{}')); } catch { /* Optional */ }
  const saveConfig = () => { try { storage?.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* Optional */ } };

  let currentPath = config.path || '';
  const history = [];
  let itemsCache = [];
  let loading = false;

  const message = (text, isErr = false) => {
    const el = $('githubStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', isErr);
  };

  function syncUi() {
    if ($('githubRepoInput') && !$('githubRepoInput').matches?.(':focus')) $('githubRepoInput').value = config.repo || '';
    if ($('githubTokenInput') && !$('githubTokenInput').matches?.(':focus')) $('githubTokenInput').value = config.token || '';
    if ($('githubSignin')) $('githubSignin').hidden = config.connected;
    if ($('githubBrowse')) $('githubBrowse').hidden = !config.connected;
    if ($('githubDisconnect')) {
      $('githubDisconnect').hidden = !config.connected;
      $('githubDisconnect').disabled = !config.connected || loading;
    }
    if ($('githubRefresh')) $('githubRefresh').disabled = !config.connected || loading;
    if ($('githubBack')) $('githubBack').disabled = !config.connected || loading || !history.length;
    if ($('githubPublishBtn')) { $('githubPublishBtn').hidden = !config.connected || !config.token; $('githubPublishBtn').disabled = loading; }
    if ($('githubPath')) $('githubPath').textContent = config.connected ? `${client.slug}${currentPath ? '/' + currentPath : ''}` : 'GitHub';
  }

  function renderItems() {
    const listEl = $('githubList');
    if (!listEl) return;
    const q = ($('githubSearch')?.value || '').trim().toLowerCase();
    const visible = q ? itemsCache.filter((it) => it.name.toLowerCase().includes(q)) : itemsCache;
    const nodes = visible.map((it) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (it.isFolder) {
        btn.className = 'folder-chip';
        const meta = document.createElement('div');
        meta.className = 'note-meta';
        const title = document.createElement('strong');
        title.textContent = it.name;
        const sub = document.createElement('span');
        sub.textContent = 'Folder';
        meta.append(title, sub);
        btn.append(meta);
        btn.onclick = () => {
          history.push(currentPath);
          currentPath = it.path;
          void refresh();
        };
      } else {
        btn.className = 'note-card';
        btn.note = { title: it.name.replace(/\.[^.]+$/, ''), name: it.name, source: 'github', size: it.size || 0 };
        const img = document.createElement('img');
        img.className = 'note-cover';
        img.alt = '';
        img.src = cardCoverSvg(it.name, it.chunked ? 'CHUNK' : 'GH');
        if (library) {
          library.cover(library.coverKey(it)).then((url) => { if (url) img.src = url; }).catch(() => {});
        }
        const meta = document.createElement('div');
        meta.className = 'note-meta';
        const title = document.createElement('strong');
        title.textContent = it.name.replace(/\.(noteful|nfedit|notecomp|notecomplete)$/i, '');
        const sub = document.createElement('span');
        sub.textContent = `${it.chunked ? 'Auto-chunked · ' : ''}${formatMb(it.size)}`;
        const badge = document.createElement('span');
        badge.className = 'note-badge';
        badge.textContent = it.chunked ? 'Chunked' : 'GitHub';
        meta.append(title, sub, badge);
        btn.append(img, meta);
        btn.onclick = () => void openItem(it);
        if (exportRequest && exportable(it.name)) {
          addExportMenu(li, it.name, () => {
            exportRequest(`github:${it.id}`);
            void openItem(it);
          });
        }
      }
      li.append(btn);
      return li;
    });
    listEl.replaceChildren(...nodes);
    onCards?.();
  }

  async function openItem(it) {
    if (loading) return;
    loading = true;
    syncUi();
    const prog = $('githubProgress');
    if (prog) { prog.value = 0; prog.hidden = false; }
    try {
      let file = library ? await library.cached(it) : null;
      if (!file) {
        message(`Downloading ${it.name}${it.chunked ? ' (reassembling chunks)' : ''}…`);
        file = await client.download(it, { onProgress: (p) => { if (prog) prog.value = p; } });
        if (library) await library.keep(it, file);
      }
      message(`Opened ${it.name}.`);
      await open?.(file, it);
    } catch (err) {
      message(err.message, true);
    } finally {
      loading = false;
      if (prog) prog.hidden = true;
      syncUi();
    }
  }

  async function refresh() {
    if (!config.repo) { config.connected = false; syncUi(); return; }
    try {
      client.configure(config);
    } catch (err) {
      config.connected = false;
      syncUi();
      message(err.message, true);
      return;
    }
    loading = true;
    syncUi();
    message(`Loading ${client.slug}…`);
    try {
      itemsCache = await client.list(currentPath);
      config.connected = true;
      saveConfig();
      renderItems();
      message(itemsCache.length ? `${itemsCache.length} item${itemsCache.length === 1 ? '' : 's'} in ${client.slug}${currentPath ? '/' + currentPath : ''}.` : 'This folder is empty. Use Creator → Publish open note to upload an auto-chunked note.');
    } catch (err) {
      message(err.message, true);
    } finally {
      loading = false;
      syncUi();
    }
  }

  async function connect({ repo, branch = 'main', path = '', token = '' } = {}) {
    const parsed = parseGitHubRepo(repo);
    if (!parsed) throw Error('Enter a valid GitHub repository (owner/repo or github.com/owner/repo).');
    config = {
      repo: parsed.slug,
      branch: branch || parsed.branch || 'main',
      path: path || parsed.path || '',
      token: String(token ?? config.token ?? '').trim(),
      connected: true,
    };
    currentPath = config.path;
    history.length = 0;
    saveConfig();
    await refresh();
  }

  async function publishCurrentNote() {
    if (!exportOpenNote) throw Error('Open a note first to publish it.');
    const file = await exportOpenNote();
    if (!file) throw Error('Open a note or Markdown document first to publish it.');
    loading = true;
    syncUi();
    const prog = $('githubProgress');
    if (prog) { prog.value = 0; prog.hidden = false; }
    try {
      client.configure(config);
      message(`Splitting ${file.name} into <= 4 MiB chunks and syncing to ${client.slug}…`);
      const res = await client.publishNote(file, {
        folder: currentPath,
        onProgress: (p) => { if (prog) prog.value = p; },
      });
      await refresh();
      message(`Published ${file.name} (${res.uploadedChunks} new chunk${res.uploadedChunks === 1 ? '' : 's'}, ${res.reusedChunks} reused).`);
      return res;
    } catch (err) {
      message(err.message, true);
      throw err;
    } finally {
      loading = false;
      if (prog) prog.hidden = true;
      syncUi();
    }
  }

  function disconnect() {
    config = { repo: '', branch: 'main', path: '', token: '', connected: false };
    currentPath = '';
    history.length = 0;
    itemsCache = [];
    saveConfig();
    if ($('githubList')) $('githubList').replaceChildren();
    message('Disconnected GitHub repository on this device.');
    syncUi();
  }

  if ($('githubConnect')) {
    $('githubConnect').onclick = () => {
      const repo = $('githubRepoInput')?.value?.trim() || config.repo;
      const token = $('githubTokenInput')?.value?.trim() || config.token;
      connect({ repo, token }).catch((e) => message(e.message, true));
    };
  }
  if ($('githubRefresh')) $('githubRefresh').onclick = () => void refresh();
  if ($('githubBack')) $('githubBack').onclick = () => { if (history.length) { currentPath = history.pop(); void refresh(); } };
  if ($('githubDisconnect')) $('githubDisconnect').onclick = () => disconnect();
  if ($('githubPublishBtn')) $('githubPublishBtn').onclick = () => { publishCurrentNote().catch(() => {}); };
  if ($('githubSearch')) $('githubSearch').oninput = () => renderItems();
  if ($('githubFind')) $('githubFind').onclick = () => renderItems();

  syncUi();

  return {
    show: () => { syncUi(); if (config.connected && !itemsCache.length && !loading) void refresh(); },
    hide: () => {},
    setQuick: () => {},
    connect,
    disconnect,
    refresh,
    publishCurrentNote,
    get config() { return { ...config }; },
    back: () => { if (!history.length) return false; currentPath = history.pop(); void refresh(); return true; },
    forward: () => false,
  };
}

// --- Nextcloud / WebDAV Shared Folder Browser ---
export function webdavBrowser({
  open,
  library,
  exportRequest = null,
  exportOpenNote = null,
  onCards = null,
  client = new WebDavCloudClient(),
  storage = globalThis.localStorage,
} = {}) {
  const $ = (id) => document.getElementById(id);
  const [CONFIG_KEY] = CLOUD_CONFIG_KEYS.webdav;
  let config = { url: '', password: '', connected: false };
  try { Object.assign(config, JSON.parse(storage?.getItem(CONFIG_KEY) || '{}')); } catch { /* Optional */ }
  const saveConfig = () => { try { storage?.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* Optional */ } };

  let currentPath = '';
  const history = [];
  let itemsCache = [];
  let loading = false;

  const message = (text, isErr = false) => {
    const el = $('webdavStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', isErr);
  };

  function syncUi() {
    if ($('webdavUrlInput') && !$('webdavUrlInput').matches?.(':focus')) $('webdavUrlInput').value = config.url || '';
    if ($('webdavPassInput') && !$('webdavPassInput').matches?.(':focus')) $('webdavPassInput').value = config.password || '';
    if ($('webdavSignin')) $('webdavSignin').hidden = config.connected;
    if ($('webdavBrowse')) $('webdavBrowse').hidden = !config.connected;
    if ($('webdavDisconnect')) {
      $('webdavDisconnect').hidden = !config.connected;
      $('webdavDisconnect').disabled = !config.connected || loading;
    }
    if ($('webdavRefresh')) $('webdavRefresh').disabled = !config.connected || loading;
    if ($('webdavBack')) $('webdavBack').disabled = !config.connected || loading || !history.length;
    if ($('webdavPublishBtn')) { $('webdavPublishBtn').hidden = !config.connected; $('webdavPublishBtn').disabled = loading; }
    if ($('webdavPath')) {
      const host = client.target?.host || 'Nextcloud / WebDAV';
      $('webdavPath').textContent = `${host}${currentPath ? '/' + currentPath : ''}`;
    }
  }

  function renderItems() {
    const listEl = $('webdavList');
    if (!listEl) return;
    const q = ($('webdavSearch')?.value || '').trim().toLowerCase();
    const visible = q ? itemsCache.filter((it) => it.name.toLowerCase().includes(q)) : itemsCache;
    const nodes = visible.map((it) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (it.isFolder) {
        btn.className = 'folder-chip';
        const meta = document.createElement('div');
        meta.className = 'note-meta';
        const title = document.createElement('strong');
        title.textContent = it.name;
        const sub = document.createElement('span');
        sub.textContent = 'Folder';
        meta.append(title, sub);
        btn.append(meta);
        btn.onclick = () => {
          history.push(currentPath);
          currentPath = it.path;
          void refresh();
        };
      } else {
        btn.className = 'note-card';
        btn.note = { title: it.name.replace(/\.[^.]+$/, ''), name: it.name, source: 'webdav', size: it.size || 0, modifiedTime: it.modifiedTime };
        const img = document.createElement('img');
        img.className = 'note-cover';
        img.alt = '';
        img.src = cardCoverSvg(it.name, 'DAV');
        if (library) {
          library.cover(library.coverKey(it)).then((url) => { if (url) img.src = url; }).catch(() => {});
        }
        const meta = document.createElement('div');
        meta.className = 'note-meta';
        const title = document.createElement('strong');
        title.textContent = it.name.replace(/\.(noteful|nfedit|notecomp|notecomplete)$/i, '');
        const sub = document.createElement('span');
        sub.textContent = formatMb(it.size);
        const badge = document.createElement('span');
        badge.className = 'note-badge';
        badge.textContent = 'WebDAV';
        meta.append(title, sub, badge);
        btn.append(img, meta);
        btn.onclick = () => void openItem(it);
        if (exportRequest && exportable(it.name)) {
          addExportMenu(li, it.name, () => {
            exportRequest(`webdav:${it.id}`);
            void openItem(it);
          });
        }
      }
      li.append(btn);
      return li;
    });
    listEl.replaceChildren(...nodes);
    onCards?.();
  }

  async function openItem(it) {
    if (loading) return;
    loading = true;
    syncUi();
    try {
      let file = library ? await library.cached(it) : null;
      if (!file) {
        message(`Downloading ${it.name}…`);
        file = await client.download(it);
        if (library) await library.keep(it, file);
      }
      message(`Opened ${it.name}.`);
      await open?.(file, it);
    } catch (err) {
      message(err.message, true);
    } finally {
      loading = false;
      syncUi();
    }
  }

  async function refresh() {
    if (!config.url) { config.connected = false; syncUi(); return; }
    try {
      client.configure(config);
    } catch (err) {
      config.connected = false;
      syncUi();
      message(err.message, true);
      return;
    }
    loading = true;
    syncUi();
    message('Listing shared folder…');
    try {
      itemsCache = await client.list(currentPath);
      config.connected = true;
      saveConfig();
      renderItems();
      message(itemsCache.length ? `${itemsCache.length} item${itemsCache.length === 1 ? '' : 's'} in shared folder.` : 'Shared folder is empty.');
    } catch (err) {
      message(err.message, true);
    } finally {
      loading = false;
      syncUi();
    }
  }

  async function connect({ url, password = '' } = {}) {
    if (!parseWebDavTarget(url, password)) {
      throw Error('Enter a valid Nextcloud share link (https://…/s/token) or WebDAV URL.');
    }
    config = { url: String(url).trim(), password: String(password || ''), connected: true };
    currentPath = '';
    history.length = 0;
    saveConfig();
    await refresh();
  }

  async function publishCurrentNote() {
    if (!exportOpenNote) throw Error('Open a note first to upload it.');
    const file = await exportOpenNote();
    if (!file) throw Error('Open a note or Markdown document first to upload it.');
    loading = true;
    syncUi();
    try {
      client.configure(config);
      message(`Uploading ${file.name} to shared folder…`);
      const res = await client.upload(file.name, new Uint8Array(await file.arrayBuffer()), currentPath);
      await refresh();
      message(`Uploaded ${file.name} to shared folder.`);
      return res;
    } catch (err) {
      message(err.message, true);
      throw err;
    } finally {
      loading = false;
      syncUi();
    }
  }

  function disconnect() {
    config = { url: '', password: '', connected: false };
    currentPath = '';
    history.length = 0;
    itemsCache = [];
    saveConfig();
    if ($('webdavList')) $('webdavList').replaceChildren();
    message('Disconnected Nextcloud / WebDAV folder.');
    syncUi();
  }

  if ($('webdavConnect')) {
    $('webdavConnect').onclick = () => {
      const url = $('webdavUrlInput')?.value?.trim() || config.url;
      const password = $('webdavPassInput')?.value?.trim() || config.password;
      connect({ url, password }).catch((e) => message(e.message, true));
    };
  }
  if ($('webdavRefresh')) $('webdavRefresh').onclick = () => void refresh();
  if ($('webdavBack')) $('webdavBack').onclick = () => { if (history.length) { currentPath = history.pop(); void refresh(); } };
  if ($('webdavDisconnect')) $('webdavDisconnect').onclick = () => disconnect();
  if ($('webdavPublishBtn')) $('webdavPublishBtn').onclick = () => { publishCurrentNote().catch(() => {}); };
  if ($('webdavSearch')) $('webdavSearch').oninput = () => renderItems();
  if ($('webdavFind')) $('webdavFind').onclick = () => renderItems();

  syncUi();

  return {
    show: () => { syncUi(); if (config.connected && !itemsCache.length && !loading) void refresh(); },
    hide: () => {},
    setQuick: () => {},
    connect,
    disconnect,
    refresh,
    publishCurrentNote,
    get config() { return { ...config }; },
    back: () => { if (!history.length) return false; currentPath = history.pop(); void refresh(); return true; },
    forward: () => false,
  };
}

// --- Guided User / Creator Setup Modal (Fixed-size, zero-scroll, stable footer buttons) ---
export function setupCloudGuideDialog({
  drive,
  dropbox,
  github,
  webdav,
  archive,
  status = () => {},
  onSelectProvider = () => {},
} = {}) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('cloudGuideDialog');
  if (!dialog) return { open: () => {} };

  let currentProvider = 'github';
  let currentRole = 'user'; // 'user' | 'creator'
  let currentStep = 0;
  const draft = {
    inviteCode: '',
    invitePin: '',
    ghRepo: '',
    ghBranch: 'main',
    ghToken: '',
    ghPin: '',
    ghGeneratedLink: '',
    davUrl: '',
    davPass: '',
    davPin: '',
    davGeneratedLink: '',
    driveLink: '',
    driveApiKey: '',
    driveClientId: '',
    dbxAppKey: '',
    dbxPath: '/Noteful',
    archiveItem: '',
  };

  function providerInfo(id) {
    return CLOUD_PROVIDERS.find((p) => p.id === id) || CLOUD_PROVIDERS[0];
  }

  function buildSteps(provider, role) {
    if (provider === 'github') {
      if (role === 'user') {
        return [
          {
            title: '1. Join with invite link or public repo',
            desc: 'Paste a classmate’s invite code/link (with PIN) or any public GitHub repository (owner/repo).',
            render(host) {
              host.innerHTML = `
                <label class="cg-field"><span>Invite link or repository</span><input id="cgGhUserTarget" type="text" spellcheck="false" autocomplete="off" placeholder="nc1.… or owner/apuntes-curso" /></label>
                <label class="cg-field"><span>Group PIN (if encrypted invite)</span><input id="cgGhUserPin" type="password" spellcheck="false" autocomplete="off" placeholder="PIN from your classmate (leave empty for public repo)" /></label>
                <p class="cg-hint muted">Public repositories open without a PIN. Encrypted invites unlock read/write chunked sync automatically.</p>
              `;
              const t = host.querySelector('#cgGhUserTarget'), p = host.querySelector('#cgGhUserPin');
              t.value = draft.inviteCode || draft.ghRepo || github?.config?.repo || '';
              p.value = draft.invitePin;
              t.oninput = () => { draft.inviteCode = t.value.trim(); };
              p.oninput = () => { draft.invitePin = p.value; };
            },
            actionLabel: 'Connect GitHub',
            async run() {
              const target = draft.inviteCode || github?.config?.repo || '';
              if (!target) throw Error('Enter an invite link or owner/repo.');
              if (target.includes('nc1.') || target.includes('nc-cloud=')) {
                const payload = await decryptInvite(target, draft.invitePin);
                await github.connect({ repo: payload.repo, branch: payload.branch || 'main', path: payload.path || '', token: payload.token || '' });
              } else {
                await github.connect({ repo: target });
              }
              onSelectProvider('github');
              status('GitHub repository connected.');
              dialog.close();
            },
          },
          {
            title: '2. Read & save auto-chunked notes',
            desc: 'Open any note from the grid. Large PDFs and recordings stream in 4 MiB chunks.',
            render(host) {
              host.innerHTML = `
                <div class="cg-cards">
                  <div class="cg-card"><strong>Fast open & cache</strong><span>Only changed 4 MiB chunks download; copies stay cached offline on this device.</span></div>
                  <div class="cg-card"><strong>Save changes back</strong><span>Use <b>Publish note</b> in the GitHub bar to push your updated pages without re-uploading the base PDF.</span></div>
                </div>
              `;
            },
            actionLabel: 'Done',
            async run() { dialog.close(); },
          },
        ];
      }
      // Creator for GitHub
      return [
        {
          title: '1. Repository & Fine-Grained Token',
          desc: 'Create a free GitHub repo and a Fine-Grained Personal Access Token scoped only to that repository (Contents: Read & Write).',
          render(host) {
            host.innerHTML = `
              <label class="cg-field"><span>GitHub repository</span><input id="cgGhRepo" type="text" spellcheck="false" autocomplete="off" placeholder="owner/apuntes-fisica" /></label>
              <label class="cg-field"><span>Fine-grained token</span><input id="cgGhToken" type="password" spellcheck="false" autocomplete="off" placeholder="github_pat_…" /></label>
              <p class="cg-hint muted">Fine-grained tokens limit access strictly to one repository so your other GitHub projects stay private.</p>
            `;
            const r = host.querySelector('#cgGhRepo'), tok = host.querySelector('#cgGhToken');
            r.value = draft.ghRepo || github?.config?.repo || '';
            tok.value = draft.ghToken || github?.config?.token || '';
            r.oninput = () => { draft.ghRepo = r.value.trim(); };
            tok.oninput = () => { draft.ghToken = tok.value.trim(); };
          },
          actionLabel: 'Connect & Continue',
          async run() {
            await github.connect({ repo: draft.ghRepo || github?.config?.repo, token: draft.ghToken || github?.config?.token });
            onSelectProvider('github');
            currentStep = 1;
            renderDialog();
          },
        },
        {
          title: '2. Generate PIN-encrypted invite for classmates',
          desc: 'Encrypt the repository access with a class PIN. Classmates paste the invite code and PIN—no GitHub account needed.',
          render(host) {
            host.innerHTML = `
              <label class="cg-field"><span>Choose a group PIN</span><input id="cgGhPin" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. calculo2026" /></label>
              <label class="cg-field"><span>Encrypted invite code</span><input id="cgGhOut" type="text" readonly spellcheck="false" placeholder="Click Generate invite to create code…" /></label>
              <p class="cg-hint muted">Encrypted locally with AES-GCM (PBKDF2 50k iterations). Share the code in WhatsApp/Discord and tell your group the PIN.</p>
            `;
            const p = host.querySelector('#cgGhPin'), out = host.querySelector('#cgGhOut');
            p.value = draft.ghPin;
            out.value = draft.ghGeneratedLink;
            p.oninput = () => { draft.ghPin = p.value.trim(); };
            out.onclick = () => out.select();
          },
          actionLabel: 'Generate & Copy Invite',
          async run() {
            const repo = draft.ghRepo || github?.config?.repo;
            const token = draft.ghToken || github?.config?.token;
            if (!repo) throw Error('Connect your GitHub repository in Step 1 first.');
            const code = await encryptInvite({ provider: 'github', repo, branch: 'main', token }, draft.ghPin);
            draft.ghGeneratedLink = code;
            try { await navigator.clipboard.writeText(code); status('Encrypted invite code copied to clipboard.'); }
            catch { status('Encrypted invite code generated. Copy it from the box.'); }
            renderDialog();
          },
        },
        {
          title: '3. Auto-chunk & publish open note',
          desc: 'Split the currently open note into deduplicated <= 4 MiB chunks and upload it to the repository.',
          render(host) {
            host.innerHTML = `
              <div class="cg-cards">
                <div class="cg-card"><strong>Automatic <= 4 MiB splitting</strong><span>Base PDFs and recordings are hashed by SHA-256 into <code>chunks/</code> so GitHub size limits are never hit.</span></div>
                <div class="cg-card"><strong>Delta saves</strong><span>Future saves only upload new or changed chunks plus <code>manifest.json</code>.</span></div>
              </div>
            `;
          },
          actionLabel: 'Publish Open Note',
          async run() {
            await github.publishCurrentNote();
            dialog.close();
          },
        },
      ];
    }

    if (provider === 'webdav') {
      if (role === 'user') {
        return [
          {
            title: '1. Open a Nextcloud / WebDAV shared link',
            desc: 'Paste a public Nextcloud folder link (https://…/s/token), an encrypted group invite, or a WebDAV URL.',
            render(host) {
              host.innerHTML = `
                <label class="cg-field"><span>Shared link or invite</span><input id="cgDavUrl" type="text" spellcheck="false" autocomplete="off" placeholder="https://cloud.university.edu/s/AbCdEf123" /></label>
                <label class="cg-field"><span>Password or Group PIN (optional)</span><input id="cgDavPass" type="password" spellcheck="false" autocomplete="off" placeholder="Leave empty if the link has no password" /></label>
                <p class="cg-hint muted">Nextcloud public share links work with zero account setup—NoteComplete connects directly over WebDAV.</p>
              `;
              const u = host.querySelector('#cgDavUrl'), pw = host.querySelector('#cgDavPass');
              u.value = draft.davUrl || webdav?.config?.url || '';
              pw.value = draft.davPass || webdav?.config?.password || '';
              u.oninput = () => { draft.davUrl = u.value.trim(); };
              pw.oninput = () => { draft.davPass = pw.value; };
            },
            actionLabel: 'Open Shared Folder',
            async run() {
              const target = draft.davUrl || webdav?.config?.url || '';
              if (!target) throw Error('Paste a Nextcloud shared link or WebDAV address.');
              if (target.includes('nc1.')) {
                const payload = await decryptInvite(target, draft.davPass);
                await webdav.connect({ url: payload.url, password: payload.password || '' });
              } else {
                await webdav.connect({ url: target, password: draft.davPass });
              }
              onSelectProvider('webdav');
              status('Nextcloud / WebDAV folder connected.');
              dialog.close();
            },
          },
        ];
      }
      // Creator for WebDAV
      return [
        {
          title: '1. Create a Nextcloud shared folder link',
          desc: 'In Nextcloud / OwnCloud, right-click your course folder → Share → Create public link (enable Allow upload and editing for collaboration).',
          render(host) {
            host.innerHTML = `
              <label class="cg-field"><span>Public share URL</span><input id="cgDavCreatorUrl" type="text" spellcheck="false" autocomplete="off" placeholder="https://cloud.example.edu/s/Token123" /></label>
              <label class="cg-field"><span>Share password (optional)</span><input id="cgDavCreatorPass" type="password" spellcheck="false" autocomplete="off" placeholder="Optional share password" /></label>
              <p class="cg-hint muted">Anyone with this link can browse and (if enabled) save notes back without creating an account or OAuth app.</p>
            `;
            const u = host.querySelector('#cgDavCreatorUrl'), pw = host.querySelector('#cgDavCreatorPass');
            u.value = draft.davUrl || webdav?.config?.url || '';
            pw.value = draft.davPass || webdav?.config?.password || '';
            u.oninput = () => { draft.davUrl = u.value.trim(); };
            pw.oninput = () => { draft.davPass = pw.value; };
          },
          actionLabel: 'Connect & Continue',
          async run() {
            await webdav.connect({ url: draft.davUrl || webdav?.config?.url, password: draft.davPass });
            onSelectProvider('webdav');
            currentStep = 1;
            renderDialog();
          },
        },
        {
          title: '2. Upload open note or copy invite',
          desc: 'Upload your current note directly to the shared Nextcloud folder so classmates can open it.',
          render(host) {
            host.innerHTML = `
              <div class="cg-cards">
                <div class="cg-card"><strong>Zero OAuth friction</strong><span>Share the Nextcloud link directly, or upload the currently open note right now.</span></div>
                <div class="cg-card"><strong>Version comparison</strong><span>When classmates update a file, NoteComplete compares pages side by side.</span></div>
              </div>
            `;
          },
          actionLabel: 'Upload Open Note',
          async run() {
            await webdav.publishCurrentNote();
            dialog.close();
          },
        },
      ];
    }

    if (provider === 'drive') {
      if (role === 'user') {
        return [
          {
            title: '1. Sign in or open a shared Drive folder',
            desc: 'Connect your Google Drive read-only, or paste a public shared Drive folder link directly.',
            render(host) {
              host.innerHTML = `
                <label class="cg-field"><span>Public Drive folder link (optional)</span><input id="cgDriveLink" type="text" spellcheck="false" autocomplete="off" placeholder="https://drive.google.com/drive/folders/…" /></label>
                <label class="cg-field"><span>Google API key (for public links)</span><input id="cgDriveKey" type="text" spellcheck="false" autocomplete="off" placeholder="Optional if site key is configured" /></label>
                <p class="cg-hint muted">Leave the link empty and click Connect Google Drive to browse your own Drive folders.</p>
              `;
              const l = host.querySelector('#cgDriveLink'), k = host.querySelector('#cgDriveKey');
              l.value = $('driveFolderLink')?.value || '';
              k.value = $('driveApiKey')?.value || '';
              l.oninput = () => { if ($('driveFolderLink')) { $('driveFolderLink').value = l.value; $('driveFolderLink').oninput?.(); } };
              k.oninput = () => { if ($('driveApiKey')) { $('driveApiKey').value = k.value; $('driveApiKey').oninput?.(); } };
            },
            actionLabel: 'Connect / Open Drive',
            async run() {
              onSelectProvider('drive');
              if ($('driveFolderLink')?.value?.trim() && !$('driveUseFolder')?.disabled) {
                $('driveUseFolder').click();
              } else {
                $('driveConnect')?.click();
              }
              dialog.close();
            },
          },
        ];
      }
      return [
        {
          title: '1. Configure OAuth Client ID (Creator / Self-Host)',
          desc: 'To host your own Drive connection or share a public Drive folder with a group, set the public Web Client ID or API key.',
          render(host) {
            const origin = $('driveOrigin')?.textContent || location.origin;
            host.innerHTML = `
              <label class="cg-field"><span>Google OAuth Client ID</span><input id="cgDriveCid" type="text" spellcheck="false" autocomplete="off" placeholder="…apps.googleusercontent.com" /></label>
              <label class="cg-field"><span>Public API Key (optional)</span><input id="cgDriveCreatorKey" type="text" spellcheck="false" autocomplete="off" placeholder="AIza…" /></label>
              <p class="cg-hint muted">${origin} — Enable Drive API in Google Cloud Console (public client ID only, never a secret).</p>
            `;
            const c = host.querySelector('#cgDriveCid'), k = host.querySelector('#cgDriveCreatorKey');
            c.value = $('driveClientId')?.value || '';
            k.value = $('driveApiKey')?.value || '';
            c.oninput = () => { if ($('driveClientId')) { $('driveClientId').value = c.value; $('driveClientId').oninput?.(); } };
            k.oninput = () => { if ($('driveApiKey')) { $('driveApiKey').value = k.value; $('driveApiKey').oninput?.(); } };
          },
          actionLabel: 'Save & Connect Drive',
          async run() {
            onSelectProvider('drive');
            $('driveConnect')?.click();
            dialog.close();
          },
        },
      ];
    }

    if (provider === 'dropbox') {
      const detectOs = () => {
        const ua = navigator.userAgent || '';
        const plat = navigator.userAgentData?.platform || navigator.platform || '';
        if (/android/i.test(ua)) return 'android';
        if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(plat) && navigator.maxTouchPoints > 1)) return 'ios';
        if (/win/i.test(plat) || /windows/i.test(ua)) return 'windows';
        if (/mac/i.test(plat) || /macintosh/i.test(ua)) return 'macos';
        return 'linux';
      };
      const webRedirect = (() => {
        try { const u = new URL('dropbox-callback.html', location.href); u.search = ''; u.hash = ''; return u.href; }
        catch { return 'https://<your-site>/dropbox-callback.html'; }
      })();
      const desktopRedirect = 'http://127.0.0.1:53691/dropbox-callback';
      const copyText = async (txt, label = 'Copied') => {
        try { await navigator.clipboard.writeText(txt); status(`${label} copied to clipboard.`); }
        catch { status('Copy manually from the box.', true); }
      };
      const downloadScript = (filename, content) => {
        const a = Object.assign(document.createElement('a'), {
          download: filename,
          href: URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })),
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        status(`Downloaded ${filename}`);
      };
      const PLATFORMS = {
        windows: {
          label: 'Windows',
          cmd: 'winget install --id Dropbox.Dropbox -e',
          scriptName: 'setup-dropbox-windows.ps1',
          scriptBody: `# NoteComplete — Dropbox Setup Helper (Windows PowerShell)\r\nWrite-Host "Installing Dropbox via winget..."\r\nwinget install --id Dropbox.Dropbox -e --accept-source-agreements --accept-package-agreements\r\n$dbx = Join-Path $env:USERPROFILE "Dropbox"\r\nWrite-Host "After signing in to Dropbox, right-click '$dbx\\Noteful' -> Make available offline."\r\nWrite-Host "Then open notes in NoteComplete via File -> Open or Home -> Cloud -> Dropbox."\r\n`,
          steps: [
            'Install Dropbox with the command above (PowerShell / Terminal) or download the installer from <a href="https://www.dropbox.com/install" target="_blank" rel="noopener">dropbox.com/install</a>.',
            'Sign in and let Dropbox create <code>%USERPROFILE%\\Dropbox</code>.',
            'Right-click your <code>Noteful</code> (or course) folder in Explorer → <b>Make available offline</b>.',
            'Open notes directly in NoteComplete via <b>Open…</b> / <b>Open folder…</b>, or use in-app OAuth (Step 1).',
          ],
        },
        macos: {
          label: 'macOS',
          cmd: 'brew install --cask dropbox',
          scriptName: 'setup-dropbox-macos.command',
          scriptBody: `#!/usr/bin/env bash\nset -e\necho "NoteComplete — Dropbox Setup Helper (macOS)"\nif command -v brew >/dev/null 2>&1; then\n  brew install --cask dropbox\nelse\n  echo "Homebrew not found; opening dropbox.com/install..."\n  open "https://www.dropbox.com/install"\nfi\nopen -a Dropbox || true\necho "Sign in, then right-click ~/Library/CloudStorage/Dropbox/Noteful -> Make available offline."\n`,
          steps: [
            'Install Dropbox with Homebrew (command above) or download the macOS installer from <a href="https://www.dropbox.com/install" target="_blank" rel="noopener">dropbox.com/install</a>.',
            'Open <b>Dropbox</b>, sign in, and allow Finder / File Provider integration when prompted.',
            'In Finder, open <code>~/Library/CloudStorage/Dropbox</code>, right-click your <code>Noteful</code> folder → <b>Make available offline</b>.',
            'Open notes in NoteComplete via <b>Open…</b> / <b>Open folder…</b>, or connect via in-app OAuth (Step 1).',
          ],
        },
        linux: {
          label: 'Linux',
          cmd: '# Ubuntu/Debian: sudo apt install -y nautilus-dropbox   |   Arch/Omarchy: yay -S dropbox   |   Fedora: sudo dnf install -y nautilus-dropbox',
          scriptName: 'setup-dropbox-linux.sh',
          scriptBody: `#!/usr/bin/env bash\nset -e\necho "NoteComplete — Dropbox Setup Helper (Linux)"\nif command -v apt-get >/dev/null 2>&1; then\n  sudo apt-get update && sudo apt-get install -y nautilus-dropbox || sudo apt-get install -y rclone\nelif command -v yay >/dev/null 2>&1; then\n  yay -S --needed dropbox\nelif command -v paru >/dev/null 2>&1; then\n  paru -S --needed dropbox\nelif command -v pacman >/dev/null 2>&1; then\n  sudo pacman -S --needed rclone\nelif command -v dnf >/dev/null 2>&1; then\n  sudo dnf install -y nautilus-dropbox || sudo dnf install -y rclone\nelse\n  echo "Downloading official Dropbox daemon..."\n  cd ~ && wget -O - "https://www.dropbox.com/download?plat=lnx.x86_64" | tar xzf -\n  ~/.dropbox-dist/dropboxd &\nfi\necho "Done! Sync folder: ~/Dropbox (or configure rclone with: rclone config)"\n`,
          steps: [
            '<b>Ubuntu / Debian</b>: <code>sudo apt install -y nautilus-dropbox</code> (or run the auto-setup script below).',
            '<b>Arch / Omarchy / Manjaro</b>: <code>yay -S dropbox</code> (or headless/Wayland: <code>sudo pacman -S rclone &amp;&amp; rclone config</code>).',
            '<b>Fedora</b>: <code>sudo dnf install -y nautilus-dropbox</code> (or <code>sudo dnf install -y rclone</code>).',
            'Run <code>dropbox start -i</code> and sign in via browser. Your synced notes appear in <code>~/Dropbox/Noteful</code> — open them in NoteComplete via <b>Open…</b> or in-app OAuth.',
          ],
        },
        android: {
          label: 'Android',
          cmd: '',
          scriptName: '',
          scriptBody: '',
          steps: [
            '<b>Direct in-app OAuth (Web)</b>: Open NoteComplete in Chrome/Brave → <b>Home → Cloud → Dropbox → Connect Dropbox</b> (PKCE sign-in works natively in mobile browsers).',
            '<b>Dropbox app + NoteComplete APK</b>: Install <b>Dropbox</b> from Google Play and sign in, then use NoteComplete’s <b>Open…</b> picker → choose <b>Dropbox</b> from the left sidebar to open any <code>.noteful</code> / PDF file.',
            '<b>Two-way offline folder (optional)</b>: Install <b>Dropsync</b> or <b>FolderSync</b> from Google Play to mirror <code>/Noteful</code> to <code>Internal Storage/Documents/Noteful</code> for full offline access in the APK.',
          ],
        },
        ios: {
          label: 'iOS / iPadOS',
          cmd: '',
          scriptName: '',
          scriptBody: '',
          steps: [
            'Install the <b>Dropbox</b> app from the App Store and sign in.',
            'Open the Apple <b>Files</b> app → tap <b>⋯</b> → <b>Edit</b> → switch <b>Dropbox</b> ON under Locations.',
            '<b>Noteful auto-backup</b>: In Noteful → <b>Settings → Auto-Backup → Dropbox</b> (saves to <code>/Noteful</code>).',
            'In NoteComplete (Safari / Home Screen PWA): tap <b>Open… → Browse → Dropbox → Noteful</b>, or use in-app OAuth in Step 1.',
          ],
        },
      };
      let selectedOs = detectOs();
      const renderDeviceStep = (host) => {
        const paint = () => {
          const p = PLATFORMS[selectedOs] || PLATFORMS.windows;
          host.innerHTML = `
            <div class="cg-os-tabs" role="tablist" aria-label="Operating system">
              ${Object.entries(PLATFORMS).map(([id, info]) => `<button type="button" class="cg-os-tab" data-dbx-os="${id}" aria-pressed="${id === selectedOs}">${info.label}</button>`).join('')}
            </div>
            ${p.cmd ? `<div class="cg-code-row"><code id="cgDbxCmd"></code><button type="button" id="cgDbxCopyCmd">Copy</button></div>` : ''}
            <ol class="cg-checklist">${p.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
            <div class="cg-actions-inline">
              ${p.scriptName ? `<button type="button" class="primary" id="cgDbxDlScript">Download ${p.label} auto-setup script</button>` : ''}
              <a class="cg-link" href="https://www.dropbox.com/install" target="_blank" rel="noopener">Official Dropbox download ↗</a>
            </div>
          `;
          if (p.cmd) {
            host.querySelector('#cgDbxCmd').textContent = p.cmd;
            host.querySelector('#cgDbxCopyCmd').onclick = () => copyText(p.cmd, `${p.label} install command`);
          }
          if (p.scriptName) {
            host.querySelector('#cgDbxDlScript').onclick = () => downloadScript(p.scriptName, p.scriptBody);
          }
          for (const tab of host.querySelectorAll('[data-dbx-os]')) {
            tab.onclick = () => { selectedOs = tab.dataset.dbxOs; paint(); };
          }
        };
        paint();
      };
      const applySetupCode = (raw) => {
        const s = String(raw || '').trim();
        if (!s.startsWith('nc-dbx:')) return false;
        try {
          const obj = JSON.parse(atob(s.slice(7)));
          if (obj.appKey && $('dropboxAppKey')) { $('dropboxAppKey').value = obj.appKey; $('dropboxAppKey').oninput?.(); }
          if (obj.path && $('dropboxFolderPath')) { $('dropboxFolderPath').value = obj.path; $('dropboxFolderPath').oninput?.(); }
          return true;
        } catch { return false; }
      };

      if (role === 'user') {
        return [
          {
            title: '1. Connect Dropbox (In-App OAuth)',
            desc: 'Sign in with OAuth 2 PKCE to browse your Noteful backups and shared folders read-only, or paste a Device Setup Code from another device.',
            render(host) {
              host.innerHTML = `
                <label class="cg-field"><span>Dropbox App Key or Device Setup Code (optional if site key is set)</span><input id="cgDbxUserKey" type="text" spellcheck="false" autocomplete="off" placeholder="App key or nc-dbx:… setup code" /></label>
                <label class="cg-field"><span>Folder path (optional)</span><input id="cgDbxPath" type="text" spellcheck="false" autocomplete="off" placeholder="/Noteful" /></label>
                <p class="cg-hint muted">NoteComplete only reads your Dropbox files; it never modifies or deletes them. Need an App Key? Switch to <b>Share / Setup</b> above.</p>
              `;
              const k = host.querySelector('#cgDbxUserKey'), p = host.querySelector('#cgDbxPath');
              k.value = $('dropboxAppKey')?.value || '';
              p.value = $('dropboxFolderPath')?.value || '';
              k.oninput = () => {
                if (applySetupCode(k.value)) {
                  k.value = $('dropboxAppKey')?.value || '';
                  p.value = $('dropboxFolderPath')?.value || '';
                  status('Dropbox setup code applied!');
                } else if ($('dropboxAppKey')) {
                  $('dropboxAppKey').value = k.value.trim();
                  $('dropboxAppKey').oninput?.();
                }
              };
              p.oninput = () => { if ($('dropboxFolderPath')) { $('dropboxFolderPath').value = p.value; $('dropboxFolderPath').oninput?.(); } };
            },
            actionLabel: 'Connect Dropbox',
            async run() {
              onSelectProvider('dropbox');
              if ($('dropboxFolderPath')?.value?.trim() && !$('dropboxUseFolder')?.disabled) {
                $('dropboxUseFolder').click();
              } else {
                $('dropboxConnect')?.click();
              }
              dialog.close();
            },
          },
          {
            title: '2. Install & Sync on Device (All OS)',
            desc: 'Want offline local folder sync on Windows, macOS, Linux, Android, or iOS/iPadOS? Follow the step-by-step instructions or download the auto-setup script for your OS.',
            render: renderDeviceStep,
            actionLabel: 'Done',
            async run() { dialog.close(); },
          },
        ];
      }
      return [
        {
          title: '1. Create Dropbox App (App Console)',
          desc: 'One-time setup (takes ~1 minute): create a free public PKCE App Key in the Dropbox App Console (never paste an App Secret).',
          render(host) {
            host.innerHTML = `
              <div class="cg-actions-inline">
                <a class="cg-link" href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noopener">Open Dropbox App Console ↗</a>
              </div>
              <ol class="cg-checklist">
                <li>Choose <b>Scoped access</b> → <b>Full Dropbox</b> (to browse your <code>/Noteful</code> folder) and give the app any name.</li>
                <li>Open the <b>Permissions</b> tab, tick <code>account_info.read</code>, <code>files.metadata.read</code>, and <code>files.content.read</code>, then click <b>Submit</b>.</li>
                <li>Open <b>Settings → OAuth 2 → Redirect URIs</b> and add both URIs below:</li>
              </ol>
              <div class="cg-code-row"><code id="cgDbxWebUri"></code><button type="button" id="cgDbxCopyWeb">Copy Web URI</button></div>
              <div class="cg-code-row"><code id="cgDbxDeskUri"></code><button type="button" id="cgDbxCopyDesk">Copy Desktop URI</button></div>
            `;
            host.querySelector('#cgDbxWebUri').textContent = webRedirect;
            host.querySelector('#cgDbxDeskUri').textContent = desktopRedirect;
            host.querySelector('#cgDbxCopyWeb').onclick = () => copyText(webRedirect, 'Web redirect URI');
            host.querySelector('#cgDbxCopyDesk').onclick = () => copyText(desktopRedirect, 'Desktop redirect URI');
          },
          actionLabel: 'Next: Enter App Key',
          async run() { currentStep = 1; renderDialog(); },
        },
        {
          title: '2. Save App Key & Sync to Other Devices',
          desc: 'Paste your public App Key from Settings → App key, then optionally copy a 1-click Device Setup Code for your other devices.',
          render(host) {
            host.innerHTML = `
              <label class="cg-field"><span>Dropbox App Key (public, 15 characters)</span><input id="cgDbxKey" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. a1b2c3d4e5f6g7h" /></label>
              <label class="cg-field"><span>Default folder path (optional)</span><input id="cgDbxCreatorPath" type="text" spellcheck="false" autocomplete="off" placeholder="/Noteful" /></label>
              <div class="cg-actions-inline">
                <button type="button" id="cgDbxCopyCode">Copy Device Setup Code</button>
                <span class="muted" id="cgDbxKeyCheck"></span>
              </div>
              <p class="cg-hint muted">Paste the Device Setup Code into Step 1 on any other computer, tablet, or phone to configure it automatically.</p>
            `;
            const k = host.querySelector('#cgDbxKey');
            const p = host.querySelector('#cgDbxCreatorPath');
            const chk = host.querySelector('#cgDbxKeyCheck');
            k.value = $('dropboxAppKey')?.value || '';
            p.value = $('dropboxFolderPath')?.value || '/Noteful';
            const validate = () => {
              const v = k.value.trim();
              chk.textContent = !v ? '' : /^[a-z0-9]{8,32}$/i.test(v) ? '✓ Valid key format' : 'Check key (8–32 letters/digits)';
            };
            validate();
            k.oninput = () => {
              if ($('dropboxAppKey')) { $('dropboxAppKey').value = k.value.trim(); $('dropboxAppKey').oninput?.(); }
              validate();
            };
            p.oninput = () => { if ($('dropboxFolderPath')) { $('dropboxFolderPath').value = p.value.trim(); $('dropboxFolderPath').oninput?.(); } };
            host.querySelector('#cgDbxCopyCode').onclick = () => {
              const appKey = k.value.trim();
              if (!appKey) { status('Enter your Dropbox App Key first.', true); return; }
              const code = 'nc-dbx:' + btoa(JSON.stringify({ appKey, path: p.value.trim() || '/Noteful' }));
              copyText(code, 'Device setup code');
            };
          },
          actionLabel: 'Save & Connect Dropbox',
          async run() {
            onSelectProvider('dropbox');
            $('dropboxConnect')?.click();
            dialog.close();
          },
        },
        {
          title: '3. Install Dropbox on Device (All OS)',
          desc: 'Step-by-step installation and local folder sync for Windows, macOS, Linux, Android, and iOS/iPadOS, with downloadable setup scripts.',
          render: renderDeviceStep,
          actionLabel: 'Done',
          async run() { dialog.close(); },
        },
      ];
    }

    // Internet Archive
    if (role === 'user') {
      return [
        {
          title: '1. Browse or add an Internet Archive item',
          desc: 'Open public study repositories on archive.org or paste an item identifier / URL to add it to your list.',
          render(host) {
            host.innerHTML = `
              <div class="cg-cards">
                <div class="cg-card"><strong>Preloaded collections</strong><span>Select any repository card in the Internet Archive panel to browse and queue downloads.</span></div>
                <div class="cg-card"><strong>Add custom item</strong><span>Click <b>Add repository (+)</b> below to add any archive.org identifier.</span></div>
              </div>
            `;
          },
          actionLabel: 'Add Repository…',
          async run() {
            onSelectProvider('archive');
            dialog.close();
            $('archiveAddBtn')?.click();
          },
        },
      ];
    }
    return [
      {
        title: '1. Publish an Internet Archive collection (Creator)',
        desc: 'Upload your course PDFs or .noteful packages to archive.org and share the item identifier with your class.',
        render(host) {
          host.innerHTML = `
            <div class="cg-cards">
              <div class="cg-card"><strong>1. Upload at archive.org/upload</strong><span>Create a public item on Internet Archive with your folder of notes and PDFs.</span></div>
              <div class="cg-card"><strong>2. Add identifier here</strong><span>Copy the item ID (from <code>archive.org/details/your-id</code>) and add it with <b>+</b>.</span></div>
            </div>
          `;
        },
        actionLabel: 'Add Item ID…',
        async run() {
          onSelectProvider('archive');
          dialog.close();
          $('archiveAddBtn')?.click();
        },
      },
    ];
  }

  function renderDialog() {
    const info = providerInfo(currentProvider);
    const steps = buildSteps(currentProvider, currentRole);
    if (currentStep >= steps.length) currentStep = steps.length - 1;
    if (currentStep < 0) currentStep = 0;
    const step = steps[currentStep];

    const titleEl = $('cloudGuideTitle');
    if (titleEl) {
      titleEl.innerHTML = `${info.svg} <span>${info.label}</span>`;
    }
    for (const btn of dialog.querySelectorAll('[data-cg-role]')) {
      const active = btn.dataset.cgRole === currentRole;
      btn.setAttribute('aria-pressed', String(active));
    }
    const stepsBar = $('cloudGuideSteps');
    if (stepsBar) {
      stepsBar.replaceChildren(...steps.map((s, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cg-step-pill${idx === currentStep ? ' active' : ''}`;
        b.textContent = s.title;
        b.onclick = () => { currentStep = idx; renderDialog(); };
        return b;
      }));
    }
    if ($('cloudGuideDesc')) $('cloudGuideDesc').textContent = step.desc;
    const body = $('cloudGuideBody');
    if (body) {
      body.replaceChildren();
      step.render(body);
    }
    if ($('cloudGuideError')) {
      $('cloudGuideError').textContent = '';
      $('cloudGuideError').hidden = true;
    }
    const backBtn = $('cloudGuideBack');
    if (backBtn) backBtn.disabled = currentStep === 0;
    const nextBtn = $('cloudGuideAction');
    if (nextBtn) nextBtn.textContent = step.actionLabel || 'Continue';
  }

  for (const btn of dialog.querySelectorAll('[data-cg-role]')) {
    btn.onclick = () => {
      currentRole = btn.dataset.cgRole;
      currentStep = 0;
      renderDialog();
    };
  }
  if ($('cloudGuideCancel')) $('cloudGuideCancel').onclick = () => dialog.close();
  if ($('cloudGuideBack')) {
    $('cloudGuideBack').onclick = () => {
      if (currentStep > 0) { currentStep--; renderDialog(); }
    };
  }
  if ($('cloudGuideAction')) {
    $('cloudGuideAction').onclick = async () => {
      const steps = buildSteps(currentProvider, currentRole);
      const step = steps[currentStep];
      if (!step) return;
      try {
        await step.run();
      } catch (err) {
        const errEl = $('cloudGuideError');
        if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
        else status(err.message, true);
      }
    };
  }

  function open(provider = 'github', role = 'user') {
    currentProvider = providerInfo(provider).id;
    currentRole = role === 'creator' ? 'creator' : 'user';
    currentStep = 0;
    renderDialog();
    if (!dialog.open) dialog.showModal();
  }

  // Wire all `[data-cloud-guide="provider:role"]` buttons across the page
  for (const btn of document.querySelectorAll('[data-cloud-guide]')) {
    btn.onclick = (e) => {
      e.stopPropagation();
      const [prov, role] = String(btn.dataset.cloudGuide || '').split(':');
      open(prov || 'github', role || 'user');
    };
  }

  return { open };
}
