// The folder of prefab modules, on the reader's side (docs/PREFAB-MODULES.md): at start, the
// modules in the folder in use (desktop: Prefab modules… in Insert prefab) join the registry;
// the window lists them and lets the folder be copied, chosen, reset, opened and reloaded.
// Added modules are trusted like the app's own (they run with its rights).
import { addModule, listModules, manifestProblem, packById, API } from './prefab-registry.js';
import { packList, installPack, removePack, packSizes, formatSize } from './prefab-packs.js';
import { icon } from './icons.js';
import { loadKitStyles } from './prefabs/kit/shell.js';

const bridge = () => (typeof window !== 'undefined' ? window.notecompletePrefabs : null);
const make = (tag, props = {}, ...children) => { const el = Object.assign(document.createElement(tag), props); el.append(...children.filter((c) => c != null && c !== false)); return el; };
let problems = [];

// The folder's modules, imported and added (a reload asks for fresh files). Returns what was
// refused, with why.
export async function loadFolderModules({ reload = false } = {}) {
  const b = bridge();
  if (!b?.list) return [];
  let listed;
  try { listed = await b.list(); } catch (e) { console.warn(e); return []; }
  problems = [];
  const stamp = reload ? `?v=${Date.now()}` : '';
  for (const { folder, manifest, render } of listed.modules || []) {
    const problem = manifestProblem(manifest);
    if (problem) { problems.push({ folder, problem }); continue; }
    const base = new URL(`./prefabs-user/${folder}/`, document.baseURI).href;
    try {
      const code = render ? { ...(await import(new URL(`render.js${stamp}`, base).href)) } : {};
      addModule(manifest, code, { folder, source: 'folder', base });
    } catch (e) {
      problems.push({ folder, problem: e.message });
      console.warn(`Prefab module ${folder}:`, e);
    }
  }
  return problems;
}

// Prefab packs and modules…: install/remove packs, see what is in use, and manage a custom folder.
export async function openModulesDialog({ status = () => {} } = {}) {
  const b = bridge();
  loadKitStyles();
  const dialog = make('dialog', { className: 'ocr-dialog prefab-modules-dialog' });
  dialog.setAttribute('aria-label', 'Prefab packs and modules');
  const close = make('button', { type: 'button', className: 'dlg-close', title: 'Close' }, icon('close'));
  close.setAttribute('aria-label', 'Close');
  const packsBox = make('div', { className: 'prefab-modules-list prefab-packs-list' });
  const where = make('p', { className: 'muted' });
  const table = make('div', { className: 'prefab-modules-list' });
  const actions = make('div', { className: 'ocr-actions' });
  dialog.append(
    make('div', { className: 'exam-dlg-head' }, make('h2', {}, icon('graph'), ' Prefab packs & modules'), close),
    make('h3', { className: 'exam-sub', textContent: 'Packs' }),
    packsBox,
    make('h3', { className: 'exam-sub', textContent: 'Modules' }),
    where, table, actions,
  );
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dialog);
  const sizes = await packSizes().catch(() => ({}));
  const button = (name, label, title, run) => {
    const el = make('button', { type: 'button', title }, icon(name), ` ${label}`);
    el.onclick = async () => { el.disabled = true; try { await run(); } catch (e) { status(e.message, true); } finally { el.disabled = false; } };
    return el;
  };
  async function draw() {
    packsBox.replaceChildren(...packList().map((p) => {
      const sz = formatSize(sizes[p.id] || 0);
      const meta = make('small', { className: 'muted', textContent: `${p.summary}${sz ? ` · ${sz}` : ''}` });
      let action;
      if (p.core) {
        action = make('span', { className: 'prefab-pack-badge', textContent: 'Always installed' });
      } else if (p.installed) {
        const blocked = p.neededBy.length > 0;
        const rm = make('button', {
          type: 'button',
          className: 'prefab-pack-rm',
          disabled: blocked,
          title: blocked ? `Needed by ${p.neededBy.map((id) => packById(id)?.label || id).join(', ')}` : `Remove ${p.label}`,
        }, icon('trash'), ' Remove');
        rm.onclick = async () => {
          rm.disabled = true;
          try { await removePack(p.id); status(`${p.label} pack removed.`); await draw(); }
          catch (e) { status(e.message, true); rm.disabled = false; }
        };
        action = rm;
      } else {
        const add = make('button', { type: 'button', className: 'primary', title: `Install ${p.label}` }, icon('cloud'), ' Install');
        add.onclick = async () => {
          add.disabled = true;
          try {
            await installPack(p.id, (pr) => { meta.textContent = pr?.text || `Installing ${p.label}…`; });
            status(`${p.label} pack installed.`);
            await draw();
          } catch (e) { status(e.message, true); add.disabled = false; await draw(); }
        };
        action = add;
      }
      return make('div', { className: 'prefab-module-row prefab-pack-row' },
        make('span', { className: 'prefab-pack-title' }, icon(p.icon), make('span', {}, make('b', { textContent: p.label }), meta)),
        action);
    }));
    const listed = b?.list ? await b.list().catch(() => null) : null;
    const shipped = new Map((listed?.shipped || []).map((m) => [m.manifest.id, m.manifest.version]));
    where.replaceChildren(listed?.folder
      ? make('span', {}, 'Modules from ', make('code', { textContent: listed.folder }), '. They run with the app’s rights: add only modules you trust.')
      : (b ? 'The app’s own modules. Copy them to a folder to change them or add your own (docs/PREFAB-MODULES-GUIDE.md).' : 'The app’s own modules. A folder of your own is chosen in the desktop app.'));
    table.replaceChildren(...listModules().map((m) => {
      const newer = m.source === 'folder' && shipped.get(m.manifest.id) && shipped.get(m.manifest.id) !== m.manifest.version;
      return make('div', { className: 'prefab-module-row' },
        make('b', { textContent: m.manifest.label || m.manifest.id }),
        make('small', { className: 'muted', textContent: `${m.manifest.kind} · ${m.source === 'folder' ? 'folder' : 'app'}${m.manifest.version ? ` · ${m.manifest.version}` : ''}${newer ? ` · the app has ${shipped.get(m.manifest.id)}` : ''}` }));
    }), ...problems.map(({ folder, problem }) => make('div', { className: 'prefab-module-row error' }, make('b', { textContent: folder }), make('small', { textContent: problem }))));
    actions.replaceChildren(
      ...(b ? [
        button('export', 'Copy to…', 'Copy the app’s modules to a folder and use that folder', async () => { const dir = await b.copyTo(); if (dir) { status(`Prefab modules copied to ${dir}.`); await loadFolderModules({ reload: true }); draw(); } }),
        button('folder', 'Use a folder…', 'Use the modules in a folder', async () => { const dir = await b.use(); if (dir) { await loadFolderModules({ reload: true }); status('Modules loaded. Restart to stop using modules no longer there.'); draw(); } }),
        listed?.folder && button('open', 'Open folder', 'Show the folder in the file manager', () => b.open()),
        listed?.folder && button('undo', 'Use the app’s own', 'Stop using the folder (after a restart)', async () => { await b.reset(); status('Back to the app’s own modules after a restart.'); draw(); }),
        listed?.folder && button('restart', 'Reload modules', 'Read the folder’s modules again', async () => { await loadFolderModules({ reload: true }); status('Prefab modules reloaded.'); draw(); }),
      ] : []),
      make('span', { className: 'prefab-step-spacer' }),
      (() => { const done = make('button', { type: 'button', className: 'primary', textContent: 'Done' }); done.onclick = () => dialog.close(); return done; })());
  }
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  await draw();
  dialog.showModal();
}
export { API };
