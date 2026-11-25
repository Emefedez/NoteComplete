// The Euro-Office module as the rest of the reader sees it: is it installed, which formats does
// it open, and open a file in it. A separate install (AGPL-3.0, run by the desktop app on
// localhost), not released yet: Sprint 6 (docs/TABLES-AND-OFFICE.md phase 3c) fills in status()
// from the desktop bridge and open() with the editor tab. Until then it reports "not installed",
// so every office file opens in the text view as before.
export const officeModule = {
  // { state, installed, formats? }: `formats`, when the installed module gives its manifest
  // (entries { name, type, actions, mime }); without it the built-in list is used.
  async status() { return { state: 'soon', installed: false }; },
  // Opens `file` in a Euro-Office editor tab. `mode` (open-with.js euroOfficeMode) says whether it
  // is edited in place, converted to OOXML first (saved as a new file) or only viewed.
  async open(file, { mode = 'view' } = {}) {
    void file; void mode;
    throw Error('Euro-Office is not installed. Install it from Help ▸ Setup wizard ▸ Modules.');
  },
};

// Whether it is installed now (false when the check fails: files then open as text).
export async function officeInstalled(module = officeModule) {
  try { return (await module.status())?.installed === true; } catch { return false; }
}
