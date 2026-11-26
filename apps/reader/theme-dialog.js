// View ▸ More themes…: every theme as a card (Light, Dark, Follows the system and the colour
// themes of themes.js), the same cards as the Setup wizard's Look step. A pick shows at once;
// Done closes. The dialog is made the first time it opens, so it costs nothing until then.
import { choiceGrid, themeOptions } from './setup-wizard.js';

export function themeDialog({ get, set, doc = globalThis.document }) {
  let dialog = null;
  function build() {
    dialog = doc.createElement('dialog');
    dialog.id = 'themeDialog';
    dialog.className = 'ocr-dialog theme-dialog';
    dialog.setAttribute('aria-labelledby', 'themeDialogTitle');
    dialog.innerHTML = '<h2 id="themeDialogTitle">Theme</h2><p class="muted">Changes show at once. The Setup wizard offers the same themes.</p><div class="theme-dialog-grid"></div><div class="ocr-actions"><button type="button" class="primary">Done</button></div>';
    dialog.querySelector('.primary').onclick = () => dialog.close();
    doc.body.append(dialog);
  }
  return {
    open() {
      if (!dialog) build();
      const grid = choiceGrid(themeOptions(), get(), (v) => set(v), 4);
      grid.classList.add('wizard-theme-grid');
      dialog.querySelector('.theme-dialog-grid').replaceChildren(grid);
      dialog.showModal();
      grid.querySelector('[aria-checked="true"]')?.focus();
    },
  };
}
