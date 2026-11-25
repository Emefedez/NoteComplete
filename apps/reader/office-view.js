// Euro-Office editor tab (docs/TABLES-AND-OFFICE.md phase 3c):
// Hosts DocsAPI.DocEditor inside a NoteComplete view, loads api.js from the local desktop
// DocumentServer on 127.0.0.1, forwards save callbacks (status 6 / 2) to NoteComplete's save
// paths, and offers "Open as text" to switch back to the Markdown view.
import { extensionOf, textViewOpens } from './open-with.js';

const OOXML_BY_TYPE = { word: 'docx', cell: 'xlsx', slide: 'pptx' };
const OOXML_BY_EXT = {
  doc: 'docx', dot: 'docx', odt: 'docx', ott: 'docx', fodt: 'docx', rtf: 'docx', epub: 'docx', fb2: 'docx', pages: 'docx', wps: 'docx', hwp: 'docx', hwpx: 'docx',
  xls: 'xlsx', xlt: 'xlsx', ods: 'xlsx', ots: 'xlsx', fods: 'xlsx', csv: 'xlsx', tsv: 'xlsx', numbers: 'xlsx', et: 'xlsx',
  ppt: 'pptx', pot: 'pptx', pps: 'pptx', odp: 'pptx', otp: 'pptx', fodp: 'pptx', odg: 'pptx', key: 'pptx', dps: 'pptx',
};

export function ooxmlTargetExt(ext, documentType = '') {
  const clean = String(ext || '').replace(/^\./, '').toLowerCase();
  return OOXML_BY_EXT[clean] || OOXML_BY_TYPE[documentType] || 'docx';
}

export function convertedCopyName(name, targetExt) {
  const base = String(name || 'Document').replace(/\.[^.]+$/, '');
  const ext = String(targetExt || 'docx').replace(/^\./, '').toLowerCase();
  return `${base}.${ext}`;
}

// How saves are routed for each Euro-Office open mode:
// - edit: overwrite the original file in place
// - lossy-edit: ask once whether to save in place (may lose formatting) or as an OOXML copy
// - convert: always save as a new OOXML file beside the original (never overwrite legacy/ODF)
// - view: read-only
export function savePlanFor({ mode = 'view', name = '', documentType = '', lossyChoice = '' } = {}) {
  if (mode === 'view') return { kind: 'none', name };
  const ext = extensionOf(name);
  const copyName = convertedCopyName(name, ooxmlTargetExt(ext, documentType));
  if (mode === 'edit') return { kind: 'in-place', name };
  if (mode === 'lossy-edit') {
    if (lossyChoice === 'in-place') return { kind: 'in-place', name };
    if (lossyChoice === 'copy') return { kind: 'copy', name: copyName };
    return { kind: 'ask-lossy', inPlaceName: name, copyName };
  }
  return { kind: 'copy', name: copyName };
}

let loadedApiUrl = '';
export async function loadDocsApi(apiUrl, doc = globalThis.document) {
  if (globalThis.DocsAPI?.DocEditor && loadedApiUrl === apiUrl) return globalThis.DocsAPI;
  const old = doc.querySelector('script[data-euro-office-api]');
  if (old) old.remove();
  await new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = apiUrl;
    s.async = true;
    s.dataset.euroOfficeApi = apiUrl;
    s.onload = () => resolve();
    s.onerror = () => reject(Error('Could not load Euro-Office editor script (api.js).'));
    doc.head.append(s);
  });
  if (!globalThis.DocsAPI?.DocEditor) throw Error('Euro-Office DocsAPI did not initialize.');
  loadedApiUrl = apiUrl;
  return globalThis.DocsAPI;
}

export function officeViewer({
  root,
  host,
  title,
  stateEl,
  saveBtn,
  textBtn,
  getBridge = () => globalThis.notecompleteOffice,
  getTheme = () => (globalThis.document?.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light'),
  getLang = () => globalThis.navigator?.language || 'en',
  confirmLossy = (name, copyName) => (globalThis.confirm?.(`Editing "${name}" in place may lose some formatting.\n\nOK: save in place\nCancel: save as a new ${copyName} copy beside it`) ? 'in-place' : 'copy'),
  onSaveBytes = async () => ({ savedName: '' }),
  onOpenAsText = () => {},
  onDirtyChange = () => {},
  onStatus = () => {},
} = {}) {
  let active = null; // { file, sessionId, mode, documentType, lossyChoice, copyTarget, editor, dirty, unsub }

  function setState(text) {
    if (stateEl) stateEl.textContent = text;
  }

  async function open(file, { mode = 'edit' } = {}) {
    const bridge = getBridge();
    if (!bridge?.open) throw Error('Euro-Office needs the desktop app.');
    if (active) await close({ save: true });

    let lossyChoice = '';
    const plan = savePlanFor({ mode, name: file.name });
    if (plan.kind === 'ask-lossy') {
      lossyChoice = await Promise.resolve(confirmLossy(plan.inPlaceName, plan.copyName));
      if (!lossyChoice) return false;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const state = {
      file,
      sessionId: '',
      mode,
      documentType: '',
      lossyChoice,
      copyTarget: null,
      editor: null,
      dirty: false,
      unsub: null,
    };
    active = state;

    if (title) title.textContent = file.name;
    setState('Starting Euro-Office…');
    if (textBtn) {
      textBtn.hidden = !textViewOpens(file.name);
      textBtn.onclick = async () => {
        const currentFile = active?.file || file;
        await close({ save: true });
        onOpenAsText(currentFile);
      };
    }
    if (saveBtn) {
      saveBtn.hidden = mode === 'view';
      saveBtn.onclick = () => void forcesave();
    }
    if (root) root.hidden = false;

    const slowHint = setTimeout(() => {
      if (active === state && stateEl?.textContent === 'Starting Euro-Office…') {
        setState('Starting Euro-Office… (first launch builds fonts, ~45 s)');
      }
    }, 4000);
    let session;
    try {
      session = await bridge.open({
        bytes,
        name: file.name,
        mode,
        theme: getTheme(),
        lang: getLang(),
      });
    } catch (err) {
      if (active === state) { active = null; if (root) root.hidden = true; }
      throw err;
    } finally {
      clearTimeout(slowHint);
    }
    if (active !== state) return false;

    state.sessionId = session.sessionId;
    state.documentType = session.config?.documentType || '';

    const mountId = `eoMount_${Date.now()}`;
    if (host) {
      host.replaceChildren();
      const div = host.ownerDocument.createElement('div');
      div.id = mountId;
      div.className = 'office-editor-mount';
      host.append(div);
    }

    if (typeof bridge.onSaved === 'function') {
      state.unsub = bridge.onSaved(async (ev) => {
        if (!active || ev?.sessionId !== state.sessionId) return;
        setState('Saving…');
        try {
          const finalPlan = savePlanFor({ mode: state.mode, name: state.file.name, documentType: state.documentType, lossyChoice: state.lossyChoice });
          const res = await onSaveBytes({
            file: state.file,
            bytes: ev.bytes instanceof Uint8Array ? ev.bytes : new Uint8Array(ev.bytes),
            ext: ev.ext,
            plan: finalPlan,
            copyTarget: state.copyTarget,
            status: ev.status,
          });
          if (res?.copyTarget) state.copyTarget = res.copyTarget;
          // Keep an updated File in memory so "Open as text" reflects saved edits.
          state.file = new File([ev.bytes], res?.savedName || state.file.name, { type: state.file.type });
          state.dirty = false;
          onDirtyChange(false, state.file.name);
          setState(res?.savedName ? `Saved (${res.savedName})` : 'Saved');
          onStatus(res?.message || `Saved ${res?.savedName || state.file.name}.`);
        } catch (err) {
          setState('Save failed');
          onStatus(`Could not save ${state.file.name}: ${err.message}`, true);
        }
      });
    }

    const DocsAPI = await loadDocsApi(session.apiUrl, host?.ownerDocument || globalThis.document);
    if (active !== state) return false;

    const cfg = {
      ...session.config,
      width: '100%',
      height: '100%',
      events: {
        onAppReady: () => setState('Loading document…'),
        onDocumentReady: () => {
          const badge = mode === 'view' ? 'Read-only' : savePlanFor({ mode, name: file.name, documentType: state.documentType, lossyChoice }).kind === 'copy' ? `Saves as ${convertedCopyName(file.name, ooxmlTargetExt(extensionOf(file.name), state.documentType))}` : 'Ready';
          setState(badge);
        },
        onDocumentStateChange: (e) => {
          state.dirty = Boolean(e?.data);
          onDirtyChange(state.dirty, state.file.name);
          setState(state.dirty ? 'Unsaved changes' : 'Saved');
        },
        onError: (e) => {
          const msg = e?.data?.errorDescription || JSON.stringify(e?.data || 'Editor error');
          setState(`Error: ${msg}`);
          onStatus(`Euro-Office: ${msg}`, true);
        },
      },
    };
    state.editor = new DocsAPI.DocEditor(mountId, cfg);
    return true;
  }

  async function forcesave() {
    if (!active) return { ok: false };
    const bridge = getBridge();
    if (!bridge?.forcesave) return { ok: false };
    setState('Saving…');
    const res = await bridge.forcesave(active.sessionId);
    if (!res?.ok && res?.error === 4) setState('No changes to save');
    return res;
  }

  async function close({ save = true } = {}) {
    if (!active) return;
    const state = active;
    active = null;
    try { state.editor?.destroyEditor?.(); } catch {}
    const bridge = getBridge();
    if (bridge?.close) {
      await bridge.close(state.sessionId, { save: save && state.dirty && state.mode !== 'view' }).catch(() => {});
    }
    state.unsub?.();
    if (host) host.replaceChildren();
    if (root) root.hidden = true;
    onDirtyChange(false, '');
  }

  return {
    open,
    forcesave,
    close,
    show() { if (root) root.hidden = false; },
    hide() { if (root) root.hidden = true; },
    get hasDocument() { return Boolean(active); },
    get visible() { return Boolean(root && !root.hidden && active); },
    get name() { return active?.file?.name || ''; },
    get file() { return active?.file || null; },
    get dirty() { return Boolean(active?.dirty); },
    get sessionId() { return active?.sessionId || ''; },
  };
}
