const { contextBridge, ipcRenderer, webFrame } = require('electron');
// Euro-Office's editors (Word, Slides, Visio in sdkjs) repaint from a paint loop that runs at
// most every 40 ms on desktop, 25 frames a second, whatever the screen's refresh rate:
// scrolling and the caret move in visible steps while the toolbar (plain DOM) feels quick.
// Their mobile version already paints on every animation frame. Before the editor's scripts
// run, this lifts the 40 ms gate in the frames of the local DocumentServer while the user
// scrolls, types, clicks or drags (and for a second after), so the editor follows the screen's
// refresh rate then; idle, it keeps its 25 frames a second, so an open document costs no more
// CPU than before. requestAnimationFrame still pauses in hidden tabs.
// Runs in the page's own world; it must stay self-contained (it is passed as a function).
function officePaintHook(activeMs = 1000) {
  try {
    if (window.__ncOfficePaint) return;
    window.__ncOfficePaint = true;
    let lastInput = -Infinity;
    const now = () => (typeof performance === 'object' ? performance.now() : Date.now());
    const mark = (e) => { if (e?.type !== 'pointermove' || e.buttons) lastInput = now(); };
    for (const type of ['wheel', 'keydown', 'pointerdown', 'pointermove', 'touchmove']) {
      window.addEventListener?.(type, mark, { capture: true, passive: true });
    }
    const patch = (loop) => {
      if (typeof loop !== 'function' || !loop.prototype || loop.__ncPatched) return;
      loop.__ncPatched = true;
      // The constructor assigns this.isUseInterval (true on desktop); an accessor on the
      // prototype takes it, and _animation reads it on every frame.
      Object.defineProperty(loop.prototype, 'isUseInterval', {
        configurable: true,
        get() { return this.__ncInterval !== false && now() - lastInput > activeMs; },
        set(value) { this.__ncInterval = Boolean(value); },
      });
    };
    const hook = (common) => {
      if (!common || (typeof common !== 'object' && typeof common !== 'function')) return;
      if (common.PaintMessageLoop) { patch(common.PaintMessageLoop); return; }
      let loop;
      Object.defineProperty(common, 'PaintMessageLoop', { configurable: true, enumerable: true, get() { return loop; }, set(value) { loop = value; patch(value); } });
    };
    let common = window.AscCommon;
    if (common) hook(common);
    else Object.defineProperty(window, 'AscCommon', { configurable: true, enumerable: true, get() { return common; }, set(value) { common = value; hook(value); } });
  } catch { /* The editor keeps its own timing. */ }
}
// NoteComplete's own Ctrl shortcuts inside Euro-Office: its editor frame takes every key, so
// Ctrl S (save), Ctrl O (open), Ctrl N / Ctrl Shift N (new) and Ctrl 1–9 (tabs) never reached
// the app. They go up to the reader instead (office-view.js passes them on as key presses).
// The editor's own shortcuts (Ctrl Z, C, V, B, I, K, F, P…) stay with it.
const OFFICE_APP_KEYS = /^(KeyS|KeyO|KeyN|Digit[1-9])$/;
function officeKeyTarget(e) {
  if (!e || e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey || !OFFICE_APP_KEYS.test(e.code || '')) return null;
  if (/^Digit/.test(e.code) && e.shiftKey) return null;
  return { type: 'nc-office-key', key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey };
}
function officeKeyHook(win = globalThis) {
  win.addEventListener?.('keydown', (e) => {
    const data = officeKeyTarget(e);
    if (!data) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { win.top.postMessage(data, '*'); } catch { /* No reader above. */ }
  }, true);
}
// Parses a NoteComplete prefab spec embedded in an Office image's alt/description text
// ("notecomplete-prefab:<json>") or in an SVG data URI.
function parseOfficePrefabMeta(descr = '', title = '') {
  for (const candidate of [descr, title]) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const idx = raw.indexOf('notecomplete-prefab:');
    if (idx >= 0) {
      const jsonText = raw.slice(idx + 'notecomplete-prefab:'.length).trim();
      try {
        const spec = JSON.parse(jsonText);
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
          return { spec, descr: raw, title: String(title || spec.title || spec.type || 'Prefab') };
        }
      } catch { /* Try next candidate. */ }
    }
  }
  return null;
}
// Patches Euro-Office's right-click context menu on NoteComplete prefab images to add
// "Edit prefab…", which opens NoteComplete's native prefab editor and applies the updated
// PNG + spec back onto the selected image in place via Asc.asc_CImgProperty / api.ImgApply.
// Self-contained: injected into the DocumentServer frame's main world.
function officePrefabHook() {
  try {
    if (window.__ncOfficePrefab) return;
    window.__ncOfficePrefab = true;
    const parseMeta = (descr, title) => {
      for (const candidate of [descr, title]) {
        const raw = String(candidate || '').trim();
        if (!raw) continue;
        const idx = raw.indexOf('notecomplete-prefab:');
        if (idx >= 0) {
          try {
            const spec = JSON.parse(raw.slice(idx + 'notecomplete-prefab:'.length).trim());
            if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
              return { spec, descr: raw, title: String(title || spec.title || spec.type || 'Prefab') };
            }
          } catch {}
        }
      }
      return null;
    };
    const activeController = () => {
      for (const ns of [window.DE, window.PE, window.SSE]) {
        try {
          const ctrl = ns?.getController?.('Main');
          if (ctrl?.api) return ctrl;
        } catch {}
      }
      return null;
    };
    const readSelectedPrefab = () => {
      const ctrl = activeController();
      const candidates = [];
      try {
        const rm = ctrl?.rightMenu || window.DE?.getController?.('RightMenu') || window.PE?.getController?.('RightMenu');
        if (rm?.imageSettings?._originalProps) candidates.push(rm.imageSettings._originalProps);
        if (rm?.shapeSettings?._originalProps) candidates.push(rm.shapeSettings._originalProps);
      } catch {}
      try {
        const sel = ctrl?.api?.getSelectedElements?.();
        if (Array.isArray(sel)) candidates.push(...sel);
        else if (sel) candidates.push(sel);
      } catch {}
      for (const obj of candidates) {
        if (!obj || typeof obj !== 'object') continue;
        const descr = obj.get_Description?.() ?? obj.asc_getDescription?.() ?? obj.description ?? '';
        const title = obj.get_Title?.() ?? obj.asc_getTitle?.() ?? obj.get_Name?.() ?? obj.title ?? obj.name ?? '';
        const hit = parseMeta(descr, title);
        if (hit) return hit;
      }
      return null;
    };
    const isImageContextMenu = (ul) => {
      const text = (ul.textContent || '').toLowerCase();
      return /replace image|image advanced|save as picture|reemplazar imagen|guardar como imagen|actual size|tama[ñn]o real/.test(text);
    };
    const injectIntoMenu = (ul) => {
      if (!ul || ul.querySelector('.nc-edit-prefab-item')) return;
      const meta = readSelectedPrefab();
      if (!meta && !isImageContextMenu(ul)) return;
      if (!meta) return;
      const li = document.createElement('li');
      li.className = 'nc-edit-prefab-item';
      const a = document.createElement('a');
      a.href = '#';
      a.tabIndex = -1;
      a.textContent = 'Edit prefab…';
      a.style.fontWeight = '600';
      a.addEventListener('mousedown', (ev) => ev.stopPropagation());
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try { window.Common?.UI?.Menu?.Manager?.hideAll?.(); } catch {}
        try { window.top.postMessage({ type: 'nc-office-edit-prefab', spec: meta.spec, descr: meta.descr, title: meta.title }, '*'); } catch {}
      });
      li.appendChild(a);
      const sep = document.createElement('li');
      sep.className = 'divider nc-edit-prefab-sep';
      ul.insertBefore(sep, ul.firstChild);
      ul.insertBefore(li, ul.firstChild);
    };
    const scanMenus = () => {
      for (const ul of document.querySelectorAll('ul.dropdown-menu')) {
        const style = getComputedStyle(ul);
        if (style.display !== 'none' && style.visibility !== 'hidden') injectIntoMenu(ul);
      }
    };
    const obs = new MutationObserver(() => scanMenus());
    const startObserver = () => {
      if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    };
    if (document.body) startObserver();
    else window.addEventListener('DOMContentLoaded', startObserver, { once: true });
    window.addEventListener('contextmenu', () => setTimeout(scanMenus, 60), true);
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d?.type !== 'nc-office-apply-prefab' || !d.dataUrl) return;
      const ctrl = activeController();
      const api = ctrl?.api;
      if (!api || !window.Asc?.asc_CImgProperty) return;
      try {
        const props = new window.Asc.asc_CImgProperty();
        props.put_ImageUrl(String(d.dataUrl));
        if (d.descr && typeof props.put_Description === 'function') props.put_Description(String(d.descr));
        if (d.title && typeof props.put_Title === 'function') props.put_Title(String(d.title));
        api.ImgApply(props);
      } catch (err) {
        console.warn('NoteComplete prefab apply in Euro-Office:', err);
      }
    });
  } catch { /* Euro-Office keeps its own context menu. */ }
}
// The DocumentServer runs on 127.0.0.1 at a random port (office-bridge.js).
const isOfficeFrame = (origin) => /^http:\/\/127\.0\.0\.1:\d+$/.test(String(origin || ''));
const isMainFrame = typeof process?.isMainFrame === 'boolean' ? process.isMainFrame : globalThis.top === globalThis;
if (!isMainFrame) {
  // Sub-frames get this script only for the hook above (nodeIntegrationInSubFrames in
  // main.js): no bridge is exposed to them, whatever their origin.
  if (isOfficeFrame(globalThis.location?.origin)) {
    try { officeKeyHook(); } catch { /* Keys stay with the editor. */ }
    try {
      if (typeof contextBridge.executeInMainWorld === 'function') {
        contextBridge.executeInMainWorld({ func: officePaintHook });
        contextBridge.executeInMainWorld({ func: officePrefabHook });
      } else {
        webFrame.executeJavaScript(`(${officePaintHook})()`);
        webFrame.executeJavaScript(`(${officePrefabHook})()`);
      }
    } catch { /* The editor keeps its own timing. */ }
  }
} else exposeReaderBridges();
if (typeof module === 'object' && module) module.exports = { officePaintHook, officePrefabHook, parseOfficePrefabMeta, isOfficeFrame, officeKeyTarget };
function exposeReaderBridges() {
contextBridge.exposeInMainWorld('notecompleteFiles', {
  folder: () => ipcRenderer.invoke('files:folder'),
  choose: () => ipcRenderer.invoke('files:choose'),
  read: name => ipcRenderer.invoke('files:read', name),
  write: (name, bytes) => ipcRenderer.invoke('files:write', name, bytes),
  remove: name => ipcRenderer.invoke('files:remove', name),
  openFile: () => ipcRenderer.invoke('files:open'),
  pickAiFiles: () => ipcRenderer.invoke('files:pick-ai'),
  // The file the system asked this tab to open (Open with…), or null.
  launched: () => ipcRenderer.invoke('files:launched'),
  readRecent: file => ipcRenderer.invoke('files:read-recent', file),
  openExternalPath: file => ipcRenderer.invoke('files:open-external-path', file),
  openWithSystem: file => ipcRenderer.invoke('files:open-with-system', file),
  showInFolder: file => ipcRenderer.invoke('files:show-in-folder', file),
  readLocalNote: file => ipcRenderer.invoke('files:read-local-note', file),
  statLocalNote: file => ipcRenderer.invoke('files:stat-local-note', file),
  openFolder: () => ipcRenderer.invoke('files:open-folder'),
  listFolder: (folder, options) => ipcRenderer.invoke('files:list-folder', folder, options),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  writeOpened: (file, bytes) => ipcRenderer.invoke('files:write-opened', file, bytes),
  saveFile: (defaultName, bytes, filters) => ipcRenderer.invoke('files:save', defaultName, bytes, filters),
  saveEntry: (name, bytes) => ipcRenderer.invoke('files:save-entry', name, bytes),
  readSibling: (file, relative) => ipcRenderer.invoke('files:read-sibling', file, relative),
  saveCopy: (file, options) => ipcRenderer.invoke('files:save-copy', file, options),
  renderHtmlPdf: html => ipcRenderer.invoke('files:render-html-pdf', html),
  renameOpened: (file, name) => ipcRenderer.invoke('files:rename-opened', file, name),
  trashOpened: (file) => ipcRenderer.invoke('files:trash-opened', file),
  // onCancel(cancel) hands the caller a function that stops the download. A function, not an
  // AbortSignal: only functions and plain values cross from the page to this script.
  downloadUrl: (url, onProgress, onCancel) => {
    const streamId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const listener = (_event, data) => onProgress?.(data.received, data.total);
    ipcRenderer.on(`download:progress:${streamId}`, listener);
    const result = ipcRenderer.invoke('files:download-url', url, streamId).finally(() => {
      ipcRenderer.removeListener(`download:progress:${streamId}`, listener);
    });
    if (typeof onCancel === 'function') onCancel(() => ipcRenderer.send('files:download-cancel', streamId));
    return result;
  },
});
// PlantUML diagrams (.puml…) drawn by the PlantUML installed on this computer (diagrams.js).
contextBridge.exposeInMainWorld('notecompleteDiagrams', {
  plantuml: (text, file) => ipcRenderer.invoke('diagrams:plantuml', text, file),
});
// Copied items as a picture that keeps them (reader png-clip.js): the PNG as it is, chunk and
// all, with the reader's marker text (desktop png-clipboard.js).
contextBridge.exposeInMainWorld('notecompleteClipboard', {
  writePng: (bytes, text) => ipcRenderer.invoke('clipboard:write-png', bytes, text),
});
// Connecting the user's AI tools to the bundled note server (agent-setup.js).
contextBridge.exposeInMainWorld('notecompleteAgents', {
  status: () => ipcRenderer.invoke('agents:status'),
  connect: id => ipcRenderer.invoke('agents:connect', id),
  installSkills: id => ipcRenderer.invoke('agents:install-skills', id),
  settings: () => ipcRenderer.invoke('agents:settings'),
  setSettings: patch => ipcRenderer.invoke('agents:set-settings', patch),
});
contextBridge.exposeInMainWorld('notecompleteMoodle', {
  presets: () => ipcRenderer.invoke('moodle:presets'),
  session: () => ipcRenderer.invoke('moodle:session'),
  signIn: options => ipcRenderer.invoke('moodle:sign-in', options),
  disconnect: () => ipcRenderer.invoke('moodle:disconnect'),
  courses: () => ipcRenderer.invoke('moodle:courses'),
  courseContents: courseId => ipcRenderer.invoke('moodle:course-contents', courseId),
  folderFiles: url => ipcRenderer.invoke('moodle:folder-files', url),
  download: (url, name) => ipcRenderer.invoke('moodle:download', url, name),
  image: url => ipcRenderer.invoke('moodle:image', url),
  deadlines: options => ipcRenderer.invoke('moodle:deadlines', options),
  grades: courseId => ipcRenderer.invoke('moodle:grades', courseId),
  announcements: courseId => ipcRenderer.invoke('moodle:announcements', courseId),
  mcpConfig: () => ipcRenderer.invoke('moodle:mcp-config'),
  openExternal: url => ipcRenderer.invoke('moodle:open-external', url),
});
contextBridge.exposeInMainWorld('notecompleteAppleNotes', {
  detectMac: () => ipcRenderer.invoke('apple-notes:detect-mac'),
  importMac: () => ipcRenderer.invoke('apple-notes:import-mac'),
  pickSqlite: () => ipcRenderer.invoke('apple-notes:pick-sqlite'),
});
contextBridge.exposeInMainWorld('notecompleteWindows', {
  zoom: step => ipcRenderer.invoke('ui:zoom', step),
  open: () => ipcRenderer.invoke('windows:new'),
  list: () => ipcRenderer.invoke('windows:list'),
  focus: id => ipcRenderer.invoke('windows:focus', id),
  // Help ▸ Setup wizard… in the native menu (app-menu.js): the tab in front opens it.
  onSetupWizard: callback => ipcRenderer.on('app:setup-wizard', () => callback()),
  onEuroOfficeLaunch: callback => ipcRenderer.on('app:euro-office-launch', () => callback()),
});
// Tabs in this window: the reader draws the strip and reports its title and
// unsaved state; closing asks the reader first (onCloseRequest).
contextBridge.exposeInMainWorld('notecompleteTabs', {
  list: () => ipcRenderer.invoke('tabs:list'),
  open: filePath => ipcRenderer.invoke('tabs:new', typeof filePath === 'string' ? filePath : ''),
  activate: id => ipcRenderer.invoke('tabs:activate', id),
  close: id => ipcRenderer.invoke('tabs:close', id),
  closeSelf: () => ipcRenderer.invoke('tabs:close-self'),
  move: (id, index) => ipcRenderer.invoke('tabs:move', id, index),
  detach: id => ipcRenderer.invoke('tabs:detach', id),
  update: state => ipcRenderer.invoke('tabs:update', { title: String(state?.title ?? ''), dirty: state?.dirty === true }),
  onList: callback => ipcRenderer.on('tabs:list', (_event, list) => callback(list)),
  onCloseRequest: callback => ipcRenderer.on('tabs:close-request', () => callback()),
  // Downloads running in this tab: it keeps full speed while another tab is shown.
  busy: busy => ipcRenderer.invoke('tabs:busy', busy === true),
});
contextBridge.exposeInMainWorld('notecompleteTranscribe', {
  backends: () => ipcRenderer.invoke('asr:backends'),
  run: (request, onProgress) => {
    const listener = (_event, value) => onProgress?.(value);
    ipcRenderer.on('asr:progress', listener);
    return ipcRenderer.invoke('asr:run', request).finally(() => ipcRenderer.removeListener('asr:progress', listener));
  },
  cancel: () => ipcRenderer.send('asr:cancel'),
});
contextBridge.exposeInMainWorld('notecompleteAI', {
  providers: () => ipcRenderer.invoke('ai:providers'),
  models: (provider, options) => ipcRenderer.invoke('ai:models', provider, { fresh: options?.fresh === true }),
  // onDelta(text) receives the answer while it is written, when the tool streams.
  // onActivity(note) gets what the tool is doing before its answer starts ("Thinking…").
  run: (request, onDelta, onActivity) => {
    if (typeof onDelta !== 'function') return ipcRenderer.invoke('ai:run', request);
    const stream = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const listener = (_event, id, text) => { if (id === stream) onDelta(text); };
    const activity = (_event, id, text) => { if (id === stream && typeof onActivity === 'function') onActivity(text); };
    ipcRenderer.on('ai:delta', listener);
    ipcRenderer.on('ai:activity', activity);
    return ipcRenderer.invoke('ai:run', { ...request, stream }).finally(() => { ipcRenderer.removeListener('ai:delta', listener); ipcRenderer.removeListener('ai:activity', activity); });
  },
  cancel: tag => ipcRenderer.send('ai:cancel', typeof tag === 'string' ? tag : ''),
  t3Status: () => ipcRenderer.invoke('t3:status'),
  t3Start: () => ipcRenderer.invoke('t3:start'),
  t3Stop: () => ipcRenderer.invoke('t3:stop'),
  t3Install: (opts = {}, onProgress = null) => {
    if (typeof onProgress !== 'function') return ipcRenderer.invoke('t3:install', opts);
    const listener = (_event, p) => onProgress(p);
    ipcRenderer.on('t3:install-progress', listener);
    return ipcRenderer.invoke('t3:install', opts).finally(() => ipcRenderer.removeListener('t3:install-progress', listener));
  },
});
// Help → Keep a diagnostic log, Open the log.
contextBridge.exposeInMainWorld('notecompleteLog', {
  get: () => ipcRenderer.invoke('log:get'),
  set: on => ipcRenderer.invoke('log:set', on === true),
  open: () => ipcRenderer.invoke('log:open'),
});
// After a restart for an update: what this tab showed before it (desktop session.js).
// Settings → Prefab modules: the folder of modules in use (desktop prefab-folder.js).
contextBridge.exposeInMainWorld('notecompletePrefabs', {
  list: () => ipcRenderer.invoke('prefabs:list'),
  copyTo: () => ipcRenderer.invoke('prefabs:copy-to'),
  use: () => ipcRenderer.invoke('prefabs:use'),
  reset: () => ipcRenderer.invoke('prefabs:reset'),
  open: () => ipcRenderer.invoke('prefabs:open'),
});
contextBridge.exposeInMainWorld('notecompleteRestore', {
  take: () => ipcRenderer.invoke('session:take'),
});
contextBridge.exposeInMainWorld('notecompleteUpdates', {
  check: (manual = false) => ipcRenderer.invoke('update:check', manual === true),
  install: onProgress => {
    const listener = (_event, value) => onProgress?.(value);
    ipcRenderer.on('update:progress', listener);
    return ipcRenderer.invoke('update:install').finally(() => ipcRenderer.removeListener('update:progress', listener));
  },
  skip: version => ipcRenderer.invoke('update:skip', version),
  settings: () => ipcRenderer.invoke('update:settings'),
  setCheckOnOpen: on => ipcRenderer.invoke('update:check-on-open', on === true),
  openPage: url => ipcRenderer.invoke('update:page', url),
  restart: () => ipcRenderer.invoke('update:restart'),
  // Back to the newest release from a beta branch build (then install() as usual).
  stable: () => ipcRenderer.invoke('update:stable'),
  // Help → Update from a branch… (desktop branch-build.js).
  branch: {
    info: () => ipcRenderer.invoke('branch:info'),
    list: () => ipcRenderer.invoke('branch:list'),
    status: name => ipcRenderer.invoke('branch:status', String(name ?? '')),
    missing: () => ipcRenderer.invoke('branch:missing'),
    build: name => ipcRenderer.invoke('branch:build', String(name ?? '')),
    cancel: () => ipcRenderer.invoke('branch:cancel'),
    openLog: () => ipcRenderer.invoke('branch:log'),
    onLine: callback => { const l = (_e, lines) => callback(lines); ipcRenderer.on('branch:line', l); return () => ipcRenderer.removeListener('branch:line', l); },
    onStep: callback => { const l = (_e, step) => callback(step); ipcRenderer.on('branch:step', l); return () => ipcRenderer.removeListener('branch:step', l); },
  },
});
contextBridge.exposeInMainWorld('notecompleteDrive', {
  signIn: (options = {}) => ipcRenderer.invoke('drive:sign-in', { write: options.write === true, silent: options.silent === true }),
  refresh: (options = {}) => ipcRenderer.invoke('drive:refresh', { write: options.write === true, force: options.force === true }),
  cancel: () => ipcRenderer.send('drive:cancel'),
  // The session shared by every tab: what is signed in now, and changes made in other tabs.
  session: () => ipcRenderer.invoke('drive:session'),
  onSession: callback => { ipcRenderer.on('drive:session', (_event, session) => callback(session)); },
  disconnect: () => ipcRenderer.send('drive:forget'),
});
contextBridge.exposeInMainWorld('notecompleteDropbox', {
  signIn: (options = {}) => ipcRenderer.invoke('dropbox:sign-in', { appKey: typeof options.appKey === 'string' ? options.appKey : '' }),
  refresh: (options = {}) => ipcRenderer.invoke('dropbox:refresh', { force: options.force === true }),
  cancel: () => ipcRenderer.send('dropbox:cancel'),
  // The session shared by every tab: what is signed in now, and changes made in other tabs.
  session: () => ipcRenderer.invoke('dropbox:session'),
  onSession: callback => { ipcRenderer.on('dropbox:session', (_event, session) => callback(session)); },
  disconnect: () => ipcRenderer.send('dropbox:forget'),
});
// Sharing notes and pairing drawing tablets (docs/COLLABORATION.md): the server runs in the
// main process; the reader connects to it as the host.
contextBridge.exposeInMainWorld('notecompleteCollab', {
  start: (options = {}) => ipcRenderer.invoke('collab:start', { notes: ['edit', 'view'].includes(options.notes) ? options.notes : null }),
  stop: () => ipcRenderer.invoke('collab:stop'),
  info: () => ipcRenderer.invoke('collab:info'),
  shareFile: (options = {}) => ipcRenderer.invoke('collab:share-file', { name: String(options.name || 'note.nfedit'), mime: String(options.mime || 'application/octet-stream'), bytes: options.bytes }),
  shareLinks: id => ipcRenderer.invoke('collab:share-links', String(id || '')),
  unshareFile: id => ipcRenderer.invoke('collab:unshare-file', String(id || '')),
  useAddress: address => ipcRenderer.invoke('collab:address', String(address)),
  online: on => ipcRenderer.invoke('collab:online', on === true),
  onOnlineProgress: callback => ipcRenderer.on('collab:online-progress', (_event, p) => callback(Number(p) || 0)),
  onOnlineEnded: callback => ipcRenderer.on('collab:online-ended', () => callback()),
  minimize: () => ipcRenderer.invoke('collab:minimize'),
  onEnded: callback => ipcRenderer.on('collab:ended', (_event, detail) => callback(detail)),
});
// R Math & Statistics Bridge (r-bridge.js): connects to R Commander Studio or local Rscript fallback.
contextBridge.exposeInMainWorld('notecompleteRBridge', {
  status: () => ipcRenderer.invoke('rbridge:status'),
  evalFigure: request => ipcRenderer.invoke('rbridge:eval-figure', request || {}),
  evalCode: request => ipcRenderer.invoke('rbridge:eval-code', request || {}),
  openInStudio: request => ipcRenderer.invoke('rbridge:open-studio', request || {}),
  installStudio: onProgress => {
    const listener = (_event, p) => { if (typeof onProgress === 'function') onProgress(p); };
    ipcRenderer.on('rbridge:install-progress', listener);
    return ipcRenderer.invoke('rbridge:install-studio').finally(() => ipcRenderer.removeListener('rbridge:install-progress', listener));
  },
  pickFolder: defaultPath => ipcRenderer.invoke('rbridge:pick-folder', typeof defaultPath === 'string' ? defaultPath : ''),
  createItem: request => ipcRenderer.invoke('rbridge:create-item', request || {}),
});
// Euro-Office module (office-bridge.js): local DocumentServer for Word, Excel and PowerPoint files.
contextBridge.exposeInMainWorld('notecompleteOffice', {
  status: () => ipcRenderer.invoke('office:status'),
  setupPrereqs: onProgress => {
    const listener = (_e, p) => { if (typeof onProgress === 'function') onProgress(p); };
    ipcRenderer.on('office:progress', listener);
    return ipcRenderer.invoke('office:setup-prereqs').finally(() => ipcRenderer.removeListener('office:progress', listener));
  },
  install: onProgress => {
    const listener = (_event, p) => { if (typeof onProgress === 'function') onProgress(p); };
    ipcRenderer.on('office:progress', listener);
    return ipcRenderer.invoke('office:install').finally(() => ipcRenderer.removeListener('office:progress', listener));
  },
  uninstall: options => ipcRenderer.invoke('office:uninstall', options || {}),
  open: request => ipcRenderer.invoke('office:open', request || {}),
  blankTemplate: (ext, lang) => ipcRenderer.invoke('office:template', ext, lang),
  forcesave: sessionId => ipcRenderer.invoke('office:forcesave', String(sessionId || '')),
  close: (sessionId, options) => ipcRenderer.invoke('office:close', String(sessionId || ''), options || {}),
  onSaved: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('office:saved', listener);
    return () => ipcRenderer.removeListener('office:saved', listener);
  },
});
}
