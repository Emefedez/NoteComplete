// Opens a prefab module's own editor (its editor.js) over the note: a full window of its own
// (a "window" module: a movable window over the page), and gives back the figure when Insert or Apply is pressed (null when cancelled). The
// module gets the spec, whether it is editing a figure already on a page, and the host: the
// kit, a way to finish, and its render (docs/PREFAB-MODULES-GUIDE.md).
import * as kit from './prefabs/kit/index.js';
import { moduleBase } from './prefab-registry.js';

// `mode`: how it opens, "author" (the usual) or one of the entries its manifest's "menu"
// adds to the figure's menu (host.mode). `insert(spec)`: where figures the editor asks to
// add besides its own go (host.insert; none, and the editor has no host.insert).
export async function openModuleEditor(module, spec, { editing = false, mode = 'author', insert = null, project = null } = {}) {
  const base = moduleBase(module);
  const editor = await import(new URL(module.manifest.editor, base).href);
  if (typeof editor.open !== 'function') throw Error(`Prefab module ${module.manifest.id}: its editor has no open()`);
  return new Promise((resolve) => {
    const root = kit.make('div', { className: 'pk-host' });
    let done = false, instance = null, win = null, dialog = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { instance?.destroy?.(); } catch (e) { console.warn(e); }
      if (win) win.destroy();
      else { dialog.close(); dialog.remove(); }
      resolve(value ? { module: module.manifest.id, ...value } : null);
    };
    if (module.manifest.kind === 'window') {
      // A "window" module edits in a movable window over the page, which stays usable and
      // scrolls behind it (the kit's movableWindow); its place is remembered per module.
      win = kit.movableWindow({ key: `module-${module.manifest.id}`, title: module.manifest.label || module.manifest.id, width: module.manifest.window?.width || 720, height: module.manifest.window?.height || 520, className: 'pk-module-window', onClose: () => finish(null) });
      win.body.append(root);
    } else {
      dialog = kit.make('dialog', { className: 'pk-dialog nc-modal' });
      dialog.append(root);
      document.body.append(dialog);
      kit.loadKitStyles();
      // Esc is the editor's (it may close a menu first); the dialog's own cancel is not.
      dialog.addEventListener('cancel', (e) => e.preventDefault());
      dialog.addEventListener('keydown', (e) => e.stopPropagation());
      dialog.showModal();
    }
    const host = {
      kit,
      editing,
      mode,
      applyLabel: editing ? 'Apply' : 'Insert',
      // The finished figure's spec, or null to leave without changing anything.
      done: (next) => finish(next),
      cancel: () => finish(null),
      render: (s) => module.code.render?.(s) ?? null,
      // Another figure (any module's spec) to add after this editor closes with done(): it
      // opens in its own editor, then goes on the same page (the Textual Analysis's UML).
      ...(insert ? { insert: (s) => insert(structuredClone(s)) } : {}),
      ...(project ? { project } : {}),
    };
    try {
      instance = editor.open(root, { spec: structuredClone(spec), editing, host });
    } catch (e) {
      console.warn(e);
      finish(null);
      throw e;
    }
  });
}
