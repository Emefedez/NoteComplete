// The Euro-Office module as the rest of the reader sees it: is it installed, which formats does
// it open, install/uninstall through the desktop bridge, and open a file in the editor tab.
// On the web reader (no `window.notecompleteOffice`), reports `{ state: 'desktop', installed: false }`.
const DESKTOP_ONLY = { state: 'desktop', installed: false, detail: 'Needs the desktop app' };

let opener = null;
export function setOfficeOpener(fn) { opener = typeof fn === 'function' ? fn : null; }

export const officeModule = {
  // { state, installed, version?, formats?, licence?, notice?, sourceUrl?, detail?, ... }
  async status(bridge = globalThis.notecompleteOffice) {
    if (!bridge?.status) return { ...DESKTOP_ONLY };
    const st = await bridge.status();
    return st && typeof st === 'object' ? st : { state: 'error', installed: false, detail: 'Could not check Euro-Office.' };
  },
  async install(onProgress = () => {}, bridge = globalThis.notecompleteOffice) {
    if (!bridge?.install) throw Error('Installing Euro-Office needs the desktop app.');
    return bridge.install(onProgress);
  },
  async uninstall(options = {}, bridge = globalThis.notecompleteOffice) {
    if (!bridge?.uninstall) throw Error('Removing Euro-Office needs the desktop app.');
    return bridge.uninstall(options);
  },
  // Opens `file` in a Euro-Office editor tab. `mode` (open-with.js euroOfficeMode) says whether it
  // is edited in place, converted to OOXML first (saved as a new file) or only viewed.
  async open(file, { mode = 'view' } = {}) {
    if (!globalThis.notecompleteOffice?.open) {
      throw Error('Euro-Office needs the desktop app.');
    }
    const st = await this.status();
    if (!st?.installed) {
      throw Error('Euro-Office is not installed. Install it from Help ▸ Setup wizard ▸ Modules.');
    }
    if (!opener) throw Error('Euro-Office editor view is not ready.');
    return opener(file, { mode, status: st });
  },
};

// Whether it is installed now (false when the check fails: files then open as text).
export async function officeInstalled(module = officeModule) {
  try { return (await module.status())?.installed === true; } catch { return false; }
}
