// "Open with" in the interface: the chooser shown when a kind's default is "Ask each time", the
// "Open with ▸" submenu on office files in the lists (Home, Drive, Dropbox, Internet Archive),
// and the way the open path asks which opener to use (chooseOpener). The decisions themselves
// are in open-with.js; the Euro-Office module behind them in office-module.js.
import { icon } from './icons.js';
import { openContextMenu } from './context-menu.js';
import { OFFICE_FORMATS } from './office-formats.js';
import { decideOpener, hasOpenWith, takeOpenOnce, openOnceWith, OPENER_LABELS, KIND_NAMES } from './open-with.js';
import { OFFICE_KINDS, setOpenWith } from './open-with-pref.js';
import { officeModule } from './office-module.js';

const INSTALL_HINT = 'Install from Setup ▸ Modules…';

// Opening the setup wizard at its Modules step: app.js gives the wizard's own open(); without
// it (a page without the wizard) the address that opens it is used.
let setupModules = () => { location.search = '?setup=modules'; };
export function setOpenSetupModules(fn) { if (typeof fn === 'function') setupModules = fn; }
export const openSetupModules = () => setupModules();

// The module's state, read each time (cheap: Sprint 6 asks the desktop bridge).
async function moduleState(module = officeModule) {
  try {
    const s = (await module.status()) || {};
    return { installed: s.installed === true, formats: s.installed && Array.isArray(s.formats) ? s.formats : OFFICE_FORMATS };
  } catch { return { installed: false, formats: OFFICE_FORMATS }; }
}

// What one opener does to this file, said in a line under its name.
function describe(o, installed) {
  if (o.id === 'text') return 'Read it here as text and tables. Save keeps a Markdown copy; the file is not changed.';
  if (!installed) return 'Edit it in the office suite. Not installed yet.';
  return { edit: 'Edit it in the office suite; saves to the same file.', 'lossy-edit': 'Edit it in the office suite; saves to the same file (some formatting may be lost).', convert: 'Edit it in the office suite as a new file beside it; this one is kept.', view: 'View it in the office suite.' }[o.mode] || '';
}

// The chooser: resolves to { opener, remember } or null (cancelled).
export function askOpener(name, decision, { installed = false, doc = globalThis.document } = {}) {
  return new Promise((resolve) => {
    const make = (tag, props = {}, ...kids) => { const el = Object.assign(doc.createElement(tag), props); el.append(...kids); return el; };
    const dialog = make('dialog', { className: 'ocr-dialog open-with-dialog' });
    dialog.setAttribute('aria-labelledby', 'openWithTitle');
    const remember = make('input', { type: 'checkbox' });
    const kindName = KIND_NAMES[decision.kind] || 'these files';
    let result = null;
    // Side by side like the UML editor's tools, each with its number key (1, 2, …).
    const choices = make('div', { className: 'open-with-choices' }, ...decision.openers.map((o, i) => {
      const b = make('button', { type: 'button', className: 'open-with-choice', disabled: !o.available },
        make('span', { className: 'open-with-choice-head' }, icon(o.id === 'text' ? 'text' : 'office'), make('kbd', { textContent: String(i + 1) })),
        make('strong', { textContent: o.label }),
        make('span', { className: 'open-with-choice-about', textContent: describe(o, installed) }));
      b.dataset.opener = o.id;
      b.title = `${o.label} (${i + 1})`;
      b.onclick = () => { result = { opener: o.id, remember: remember.checked }; dialog.close(); };
      return b;
    }));
    const missing = decision.openers.some((o) => !o.available);
    const install = make('button', { type: 'button', className: 'link', textContent: `Euro-Office: ${INSTALL_HINT} (I)` });
    install.onclick = () => { dialog.close(); setTimeout(openSetupModules, 0); };
    const cancel = make('button', { type: 'button', textContent: 'Cancel' });
    cancel.onclick = () => dialog.close();
    const rememberRow = make('label', { className: 'open-with-remember' }, remember, ` Remember for ${kindName} `, make('kbd', { textContent: 'R' }));
    rememberRow.hidden = !OFFICE_KINDS.includes(decision.kind);
    dialog.append(
      make('h2', { id: 'openWithTitle', textContent: 'Open with' }),
      make('p', { className: 'muted open-with-name', textContent: name }),
      choices,
      ...(missing ? [make('p', { className: 'open-with-install' }, install)] : []),
      make('div', { className: 'ocr-actions' }, rememberRow, make('span', { className: 'spacer' }), cancel));
    // Keys: 1–9 open with that choice, R remembers, I installs Euro-Office, ← → move between
    // choices (Enter opens the focused one; Esc cancels, as in every dialog).
    dialog.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const buttons = [...choices.querySelectorAll('button')];
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
      if (n >= 0) { e.preventDefault(); if (buttons[n] && !buttons[n].disabled) buttons[n].click(); return; }
      const key = e.key.toLowerCase();
      if (key === 'r' && !rememberRow.hidden) { e.preventDefault(); remember.checked = !remember.checked; return; }
      if (key === 'i' && missing) { e.preventDefault(); install.click(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const enabled = buttons.filter((b) => !b.disabled);
        const at = enabled.indexOf(doc.activeElement);
        const next = enabled[(at + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
        if (next) { e.preventDefault(); next.focus(); }
      }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
    doc.body.append(dialog);
    dialog.showModal();
    (choices.querySelector(`[data-opener="${decision.opener}"]:not(:disabled)`) || choices.querySelector('button:not(:disabled)'))?.focus();
  });
}

// For the open path (app.js load): { opener: 'native' } when "Open with" does not concern the
// file (or nothing installed opens it: the usual unsupported message follows), { opener,
// mode } for 'text' or 'euro-office', or { cancelled: true } when the chooser was dismissed.
// A choice made in an "Open with" menu for this file wins over the default.
export async function chooseOpener(name, { module = officeModule, storage, ask = askOpener } = {}) {
  const { installed, formats } = await moduleState(module);
  const forced = takeOpenOnce(name);
  if (!hasOpenWith(name, formats)) return { opener: 'native' };
  const decision = decideOpener(name, { installed, formats, storage });
  const mode = (id) => decision.openers.find((o) => o.id === id)?.mode;
  const usable = (id) => decision.openers.some((o) => o.id === id && o.available);
  if (forced && usable(forced)) return { opener: forced, mode: mode(forced) };
  if (!decision.opener) return { opener: 'native' };
  if (!decision.ask) return { opener: decision.opener, mode: mode(decision.opener) };
  const picked = await ask(name, decision, { installed });
  if (!picked || !usable(picked.opener)) return { cancelled: true };
  if (picked.remember && OFFICE_KINDS.includes(decision.kind)) setOpenWith(decision.kind, picked.opener, storage);
  return { opener: picked.opener, mode: mode(picked.opener) };
}

// The "Open with ▸" entries for a file (context-menu.js entries), or [] when it has no choice.
// `open(opener)` opens the file that way. Euro-Office is shown, disabled, while not installed,
// with the way to install it below.
export function openWithEntries(name, { open, installed = false, formats = OFFICE_FORMATS, storage } = {}) {
  if (!hasOpenWith(name, formats)) return [];
  const decision = decideOpener(name, { installed, formats, storage });
  const items = decision.openers.map((o) => ({
    label: o.available ? o.label : `${o.label} (not installed)`,
    icon: o.id === 'text' ? 'text' : 'office',
    disabled: !o.available,
    checked: !decision.ask && decision.opener === o.id,
    run: () => open(o.id),
  }));
  if (decision.openers.some((o) => !o.available)) items.push('-', { label: INSTALL_HINT, icon: 'settings', run: () => openSetupModules() });
  return [{ label: 'Open with', icon: 'open', submenu: items }];
}

// Right-click (or a long press) on a list card of an office file: Open with ▸ …, then `extra`
// entries (Home's "More…"). `choose()` opens it the usual way (the card's click); the menu sets
// the opener for that one opening first. Other files keep `fallback` (their own menu), if any.
export function attachOpenWithMenu(button, name, choose, { extra = [], fallback = null, module = officeModule } = {}) {
  if (!hasOpenWith(name)) { if (fallback) button.oncontextmenu = (e) => { e.preventDefault(); fallback(e); }; return; }
  button.oncontextmenu = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const { installed, formats } = await moduleState(module);
    const entries = openWithEntries(name, { installed, formats, open: (opener) => { openOnceWith(name, opener); choose(); } });
    openContextMenu(event.clientX, event.clientY, [{ label: 'Open', icon: 'open', run: () => choose() }, ...entries, ...(extra.length ? ['-', ...extra] : [])], { title: name });
  };
}

// The text view's "Open in Euro-Office" (and, in Sprint 6, the editor tab's "Open as text"):
// app.js registers how a file is opened again with a given opener.
let reopen = null;
export function setReopenWith(fn) { reopen = fn; }
export const reopenWith = (file, opener) => reopen?.(file, opener);

// The bar button's click while Euro-Office is not installed: a small menu that says so.
export function notInstalledMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  openContextMenu(r.left, r.bottom + 4, [
    { label: 'Euro-Office is not installed', icon: 'office', disabled: true, run: () => {} },
    { label: INSTALL_HINT, icon: 'settings', run: () => openSetupModules() },
  ]);
}
export { moduleState, OPENER_LABELS };
