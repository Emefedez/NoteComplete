// Convert to traditional / simplified (docs/CHINESE-INPUT.md §4.5): a selection or a text box
// in a dialog with a preview; a character that still has several targets after the phrase
// tables is underlined, and a click on it offers the alternatives.
//   convertDialog(text, { direction?, near? }) → Promise of the converted text, or null
// Pure parts: guessDirection, partsText, ambiguousAt, choose, changes.
import { openContextMenu } from '../context-menu.js';
import { zhWindow } from './zh-window.js';

export const DIRECTIONS = { s2t: 'To traditional', t2s: 'To simplified' };
// Simplified text goes to traditional; text that only changes the other way, to simplified.
export function guessDirection(text, toTraditional, toSimplified) {
  if (toTraditional !== text) return 's2t';
  if (toSimplified !== text) return 't2s';
  return 's2t';
}
export const partsText = (parts) => (parts || []).map((p) => p.text).join('');
export const ambiguousAt = (parts) => (parts || []).flatMap((p, i) => (p.alternatives?.length > 1 ? [i] : []));
// `parts` with alternative `alt` chosen for part `i`.
export function choose(parts, i, alt) {
  return parts.map((p, k) => (k === i && p.alternatives?.includes(alt) ? { ...p, text: alt } : p));
}
// How many characters the conversion changes.
export function changes(parts) {
  let n = 0;
  for (const p of parts || []) { const a = [...p.text], b = [...p.source]; a.forEach((c, i) => { if (c !== b[i]) n++; }); n += Math.abs(a.length - b.length); }
  return n;
}

export function convertDialog(text, { direction = null, near = null } = {}) {
  return new Promise((resolve) => {
    let done = false, parts = [], dir = direction;
    const finish = (value) => { if (done) return; done = true; win.destroy(); resolve(value); };
    const win = zhWindow({ key: 'zh-convert', title: 'Convert Chinese', width: 460, near, onClose: () => finish(null) });
    const tabs = document.createElement('div');
    tabs.className = 'zh-cv-tabs';
    tabs.setAttribute('role', 'radiogroup');
    const preview = document.createElement('div');
    preview.className = 'zh-cv-preview zh-cjk';
    preview.setAttribute('aria-live', 'polite');
    const note = document.createElement('p');
    note.className = 'muted zh-cv-note';
    win.body.append(tabs, preview, note);
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel', onclick: () => finish(null) });
    const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Replace', onclick: () => finish(partsText(parts)) });
    win.foot.append(cancel, ok);
    win.el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); ok.click(); } });

    function drawTabs() {
      tabs.replaceChildren(...Object.entries(DIRECTIONS).map(([d, label]) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', textContent: label });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(d === dir));
        b.setAttribute('aria-pressed', String(d === dir));
        b.onclick = () => { if (dir !== d) { dir = d; load(); } };
        return b;
      }));
    }
    function draw() {
      preview.replaceChildren(...parts.map((p, i) => {
        if (!(p.alternatives?.length > 1)) return document.createTextNode(p.text);
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'zh-cv-alt', textContent: p.text, title: `${p.source} → ${p.alternatives.join(' / ')}: choose` });
        b.onclick = () => {
          const r = b.getBoundingClientRect();
          openContextMenu(r.left, r.bottom + 2, p.alternatives.map((alt) => ({ label: alt, checked: alt === p.text, icon: 'text', run: () => { parts = choose(parts, i, alt); draw(); } })), { title: `${p.source} could be`, host: win.el.closest('dialog') });
        };
        return b;
      }));
      const n = changes(parts), amb = ambiguousAt(parts).length;
      note.textContent = `${n ? `${n} character${n === 1 ? '' : 's'} change${n === 1 ? 's' : ''}.` : 'Nothing changes.'}${amb ? ` Underlined: ${amb === 1 ? 'a character' : `${amb} characters`} with more than one form; click to choose.` : ''}`;
      ok.disabled = !n;
    }
    async function load() {
      drawTabs();
      win.setTitle(`${DIRECTIONS[dir]} Chinese`);
      preview.textContent = '…';
      try {
        const { chinese } = await import('./client.js');
        parts = await chinese().convertParts(text, dir);
        draw();
      } catch (e) { preview.textContent = text; note.textContent = `The conversion tables could not be loaded: ${e.message}`; ok.disabled = true; }
    }
    (async () => {
      if (!dir) {
        try {
          const { chinese } = await import('./client.js');
          const [t, s] = await Promise.all([chinese().convert(text, 's2t'), chinese().convert(text, 't2s')]);
          dir = guessDirection(text, t, s);
        } catch { dir = 's2t'; }
      }
      load();
      ok.focus();
    })();
  });
}
