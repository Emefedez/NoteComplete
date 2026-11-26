// New R Script / R Markdown / R Workspace dialog (File → New note… → R Script or Workspace).
// Creates single .R / .Rmd files or full workspace folders and opens them in R Commander Studio
// (in its own window or zero-bloat embedded view), with 1-click platform auto-installer if needed.
import { icon } from '../icons.js';
import { mathSettings } from './settings.js';

let dlg = null;

export async function openNewRDialog({
  status = () => {},
  onOpenStudio = null,
  onOpenFile = null,
  onCreatedWorkspace = null,
  onCreatedFile = null,
} = {}) {
  if (!window.notecompleteRBridge) {
    status('Creating R files and launching R Commander Studio requires NoteComplete Desktop.', true);
    return;
  }
  if (!dlg) dlg = buildDialog();
  dlg._handlers = { status, onOpenStudio, onOpenFile, onCreatedWorkspace, onCreatedFile };
  await refreshDialogState(dlg);
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('[data-nr-name]')?.focus();
}

function buildDialog() {
  const d = document.createElement('dialog');
  d.className = 'ocr-dialog zh-settings new-r-dialog';
  d.setAttribute('aria-labelledby', 'newRDialogTitle');
  d.innerHTML = `
    <div class="zh-settings-head">
      <h2 id="newRDialogTitle">New R Script or Workspace</h2>
      <div class="expand-mode-pills" role="tablist" aria-label="Creation mode">
        <button type="button" role="tab" data-nr-mode="file" aria-selected="true">Single file</button>
        <button type="button" role="tab" data-nr-mode="workspace" aria-selected="false">Folder / Workspace</button>
      </div>
    </div>
    <div class="zh-settings-panel">
      <label class="zh-set-row">
        <span data-nr-name-label>File name</span>
        <input type="text" data-nr-name value="analysis" placeholder="analysis" autocomplete="off" spellcheck="false" />
      </label>
      <label class="zh-set-row" data-nr-kind-row>
        <span>Format</span>
        <select data-nr-kind>
          <option value="r">R Script (.R)</option>
          <option value="rmd">R Markdown Report (.Rmd)</option>
        </select>
      </label>
      <div class="zh-set-row">
        <span>Location</span>
        <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;">
          <input type="text" data-nr-dir readonly style="flex:1;min-width:0;" />
          <button type="button" class="math-mini-btn" data-nr-browse>Folder…</button>
        </div>
      </div>
      <p class="muted" data-nr-hint style="margin:6px 0 0;font-size:12px;">
        Single file creates a starter .R or .Rmd file. Workspace creates a project folder with analysis.R, report.Rmd, data/, and .Rproj and adds it to NoteComplete's Folders.
      </p>
      <div class="math-bridge-card" data-nr-install-box hidden style="margin-top:10px;">
        <div class="math-bridge-status-row">
          <span class="math-bridge-dot" data-state="offline"></span>
          <strong data-nr-install-title>R Commander Studio is not installed yet</strong>
        </div>
        <p class="muted" data-nr-install-detail style="margin:4px 0 8px;font-size:12px;"></p>
        <div class="math-bridge-actions">
          <button type="button" class="primary" data-nr-install-btn>Install R Commander Studio</button>
        </div>
        <progress data-nr-progress max="1" value="0" hidden style="width:100%;margin-top:8px;"></progress>
      </div>
    </div>
    <div class="ocr-actions">
      <button type="button" data-nr-cancel>Cancel</button>
      <button type="button" class="primary" data-nr-create>Create &amp; Open</button>
    </div>
  `;

  d.querySelector('h2')?.prepend(icon('graph'), ' ');
  d.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.matches?.('[data-nr-name]')) {
      e.preventDefault();
      d.querySelector('[data-nr-create]')?.click();
    }
  });

  let mode = 'file';
  const setMode = (next) => {
    mode = next === 'workspace' ? 'workspace' : 'file';
    for (const b of d.querySelectorAll('[data-nr-mode]')) {
      b.setAttribute('aria-selected', String(b.dataset.nrMode === mode));
    }
    d.querySelector('[data-nr-kind-row]').hidden = mode === 'workspace';
    d.querySelector('[data-nr-name-label]').textContent = mode === 'workspace' ? 'Workspace folder name' : 'File name';
    const nameInput = d.querySelector('[data-nr-name]');
    if (mode === 'workspace' && nameInput.value === 'analysis') nameInput.value = 'r-project';
    else if (mode === 'file' && nameInput.value === 'r-project') nameInput.value = 'analysis';
  };
  for (const b of d.querySelectorAll('[data-nr-mode]')) {
    b.onclick = () => setMode(b.dataset.nrMode);
  }

  d.querySelector('[data-nr-cancel]').onclick = () => d.close();
  d.querySelector('[data-nr-browse]').onclick = async () => {
    const picked = await window.notecompleteRBridge.pickFolder(d.querySelector('[data-nr-dir]').value);
    if (picked) d.querySelector('[data-nr-dir]').value = picked;
  };

  d.querySelector('[data-nr-install-btn]').onclick = async () => {
    const btn = d.querySelector('[data-nr-install-btn]');
    const prog = d.querySelector('[data-nr-progress]');
    const detail = d.querySelector('[data-nr-install-detail]');
    btn.disabled = true;
    prog.hidden = false;
    prog.removeAttribute('value');
    try {
      const res = await window.notecompleteRBridge.installStudio((p) => {
        if (p?.total > 0) prog.value = Math.min(1, p.received / p.total);
        detail.textContent = p?.phase === 'downloading'
          ? `Downloading ${p.name || 'R Commander Studio'}… ${p.total ? `${Math.round((p.received / p.total) * 100)}%` : ''}`
          : p?.phase === 'verifying' ? 'Verifying SHA-256 checksum…'
          : p?.phase === 'installing' ? 'Installing R Commander Studio…'
          : 'Checking latest release…';
      });
      if (res?.ok) {
        d._handlers?.status?.(`Installed R Commander Studio (${res.platform}).`);
        await refreshDialogState(d);
      } else {
        detail.textContent = res?.error || 'Could not install R Commander Studio.';
      }
    } catch (e) {
      detail.textContent = e.message;
    } finally {
      btn.disabled = false;
      prog.hidden = true;
    }
  };

  d.querySelector('[data-nr-create]').onclick = async () => {
    const name = d.querySelector('[data-nr-name]').value.trim();
    const kind = d.querySelector('[data-nr-kind]').value;
    const parentDir = d.querySelector('[data-nr-dir]').value.trim();
    if (!parentDir) return d._handlers?.status?.('Choose a target folder first.', true);
    const btn = d.querySelector('[data-nr-create]');
    btn.disabled = true;
    try {
      const created = await window.notecompleteRBridge.createItem({ mode, name, parentDir, kind });
      if (!created?.ok) throw new Error(created?.error || 'Could not create R item.');
      d.close();
      if (created.mode === 'workspace') {
        await d._handlers?.onCreatedWorkspace?.(created);
        await d._handlers?.onOpenStudio?.({
          filePath: created.filePath,
          folderPath: created.folderPath,
          embed: false,
        });
      } else {
        await d._handlers?.onCreatedFile?.(created);
        if (d._handlers?.onOpenFile) {
          await d._handlers.onOpenFile(created);
        } else {
          await d._handlers?.onOpenStudio?.({ filePath: created.filePath, folderPath: '', embed: false });
        }
      }
    } catch (e) {
      d._handlers?.status?.(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  document.body.append(d);
  return d;
}

async function refreshDialogState(d) {
  const dirInput = d.querySelector('[data-nr-dir]');
  if (!dirInput.value && window.notecompleteFiles?.folder) {
    try { dirInput.value = await window.notecompleteFiles.folder(); } catch {}
  }

  const installBox = d.querySelector('[data-nr-install-box]');
  const installBtn = d.querySelector('[data-nr-install-btn]');
  const installDetail = d.querySelector('[data-nr-install-detail]');
  try {
    const st = await window.notecompleteRBridge.status();
    if (st.studioInstalled || st.studioConnected) {
      installBox.hidden = true;
    } else {
      installBox.hidden = false;
      const ps = st.platformSupport;
      if (ps?.supported) {
        installBtn.hidden = false;
        installBtn.textContent = `Install R Commander Studio (${ps.label})`;
        installDetail.textContent = 'NoteComplete can download and install R Commander Studio automatically for your platform.';
      } else {
        installBtn.hidden = true;
        installDetail.textContent = `Files will still be created in your folder; automatic Studio installation is available on Linux (x64/ARM64), Windows x64, and macOS ARM64.`;
      }
    }
  } catch {
    installBox.hidden = true;
  }
}
