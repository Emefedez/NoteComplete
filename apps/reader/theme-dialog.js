// View ▸ More themes…: every theme as a card (Light, Dark, Follows the system and the colour
// themes of themes.js), the same cards as the Setup wizard's Look step, and under them the
// theme editor of R Commander Studio: each colour with a picker and its hex code, Reset
// colours, and the theme as JSON to copy or paste (R Commander Studio's JSON is read too).
// A pick shows at once; Done closes. The dialog is made the first time it opens, so it costs
// nothing until then.
import { choiceGrid, themeOptions } from './setup-wizard.js';
import { EDITABLE, toHex, parseThemeJson, themeJson } from './themes.js';

const HEX = /^#[0-9a-f]{6}$/i;

export function themeDialog({ theme, status = () => {}, doc = globalThis.document }) {
  let dialog = null, rows = [];
  const $ = (sel) => dialog.querySelector(sel);
  const current = (name) => toHex(doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue(name));

  // Each row shows the colour in use now, edited or the theme's own.
  function refresh() {
    const edited = theme.colors;
    for (const { name, row, picker, hex } of rows) {
      const value = current(name);
      if (doc.activeElement !== hex) hex.value = value;
      if (doc.activeElement !== picker) picker.value = value || '#000000';
      row.classList.toggle('edited', name in edited);
    }
    $('.theme-colors-reset').disabled = !Object.keys(edited).length;
  }
  function renderGrid() {
    const grid = choiceGrid(themeOptions(), theme.choice, (v) => { theme.set(v); refresh(); }, 5);
    grid.classList.add('wizard-theme-grid');
    $('.theme-dialog-grid').replaceChildren(grid);
    return grid;
  }

  function build() {
    dialog = doc.createElement('dialog');
    dialog.id = 'themeDialog';
    dialog.className = 'ocr-dialog theme-dialog';
    dialog.setAttribute('aria-labelledby', 'themeDialogTitle');
    dialog.innerHTML = `<h2 id="themeDialogTitle">Theme</h2>
      <p class="muted">Changes show at once. The Setup wizard offers the same themes.</p>
      <div class="theme-dialog-grid"></div>
      <details class="theme-editor">
        <summary>Edit colours</summary>
        <p class="muted">Changes lie over the chosen theme and are kept with it; picking another theme starts from its own colours.</p>
        <div class="theme-token-grid"></div>
        <div class="theme-editor-actions">
          <button type="button" class="theme-colors-reset" title="Back to the theme's own colours">Reset colours</button>
          <button type="button" class="theme-json-copy" title="The theme and your colours as JSON, to keep or to share">Copy JSON</button>
          <button type="button" class="theme-json-paste" title="A theme copied from NoteComplete or from R Commander Studio">Paste JSON…</button>
        </div>
        <div class="theme-json-box" hidden>
          <textarea rows="5" spellcheck="false" aria-label="Theme JSON" placeholder='{ "theme": "nord", "colors": { "--accent": "#88c0d0" } }'></textarea>
          <p class="muted theme-json-error" hidden>That is not a theme. Paste JSON copied with Copy JSON here or in R Commander Studio.</p>
          <div class="theme-editor-actions"><button type="button" class="theme-json-cancel">Cancel</button><button type="button" class="theme-json-apply primary">Use this theme</button></div>
        </div>
      </details>
      <div class="ocr-actions"><button type="button" class="theme-done primary">Done</button></div>`;
    const grid = $('.theme-token-grid');
    rows = EDITABLE.map(({ name, label }) => {
      const id = `themeColor${name.replace(/\W/g, '')}`;
      const row = doc.createElement('div');
      row.className = 'theme-token-row';
      row.innerHTML = `<label for="${id}"></label><span class="theme-token-controls"><input id="${id}" type="color" /><input type="text" class="theme-hex-input" maxlength="7" spellcheck="false" autocomplete="off" /></span>`;
      row.querySelector('label').textContent = label;
      const picker = row.querySelector('input[type="color"]'), hex = row.querySelector('.theme-hex-input');
      hex.setAttribute('aria-label', `${label}, hex code`);
      picker.oninput = () => { theme.setColor(name, picker.value, false); hex.value = picker.value; row.classList.add('edited'); };
      picker.onchange = () => { theme.setColor(name, picker.value); refresh(); };
      hex.onchange = () => {
        let v = hex.value.trim();
        if (!v.startsWith('#')) v = `#${v}`;
        if (HEX.test(v)) { theme.setColor(name, v.toLowerCase()); refresh(); } else hex.value = current(name);
      };
      grid.append(row);
      return { name, row, picker, hex };
    });
    $('.theme-colors-reset').onclick = () => { theme.resetColors(); refresh(); status('Colours back to the theme’s own.'); };
    $('.theme-json-copy').onclick = async () => {
      const json = themeJson(theme.choice, theme.colors);
      try { await navigator.clipboard.writeText(json); status('Theme JSON copied.'); }
      catch { openBox(json); status('Select the JSON and copy it.'); }
    };
    const box = $('.theme-json-box'), area = box.querySelector('textarea'), error = box.querySelector('.theme-json-error');
    function openBox(text = '') { box.hidden = false; error.hidden = true; area.value = text; area.focus(); area.select(); }
    $('.theme-json-paste').onclick = () => openBox();
    $('.theme-json-cancel').onclick = () => { box.hidden = true; };
    $('.theme-json-apply').onclick = () => {
      const parsed = parseThemeJson(area.value);
      if (!parsed) { error.hidden = false; return; }
      theme.load(parsed.theme, parsed.colors);
      box.hidden = true;
      renderGrid();
      refresh();
      status('Theme pasted.');
    };
    $('.theme-done').onclick = () => dialog.close();
    doc.body.append(dialog);
  }

  return {
    open() {
      if (!dialog) build();
      const grid = renderGrid();
      $('.theme-json-box').hidden = true;
      refresh();
      dialog.showModal();
      grid.querySelector('[aria-checked="true"]')?.focus();
    },
  };
}
