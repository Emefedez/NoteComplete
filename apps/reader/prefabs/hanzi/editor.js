// The hanzi module's editor, in the kit's movable window: the stroke-order player in the middle
// (play/pause Space, ← →, Home/End, speed, timeline), live English equivalents & Simplified/
// Traditional variants card (every meaning, grouped by reading, each one put on the page or
// taken off with a click), the characters (with built-in Chinese IME mode remembered via icon),
// pinyin and look on the right; Practise traces each character with the pen or a finger.
import { editorShell, make, button, field, textInput, selectInput, checkInput } from '../kit/index.js';
import { normalize, dictionaryFor, pageGloss, render as renderHanziSheet, name, MAX_CHARS } from './render.js';
import { meaningsOf } from '../../chinese/lookup-panel.js';
import { strokePlayer, isHan } from '../../chinese/stroke-player.js';
import { practise } from '../../chinese/practice.js';
import { attachIme, zhButton } from '../../chinese/ime.js';
import { langToggle } from '../../chinese/zh-window.js';
import { zhLang, setZhLang } from '../../chinese/translate.js';

const HANZI_IME_KEY = 'notecomplete-hanzi-prefab-ime';
const hasLatin = (s) => /[a-zA-Z]/.test(String(s || ''));
const yellowBridgeUrl = (c) => `https://www.yellowbridge.com/chinese/character-stroke-order.php?word=${encodeURIComponent(c)}`;
function getHanziImeMode() {
  try {
    const v = localStorage.getItem(HANZI_IME_KEY);
    if (v === 'hanzi' || v === 'off') return v;
  } catch { /* Optional */ }
  return 'hanzi';
}
function setHanziImeMode(mode) {
  try { localStorage.setItem(HANZI_IME_KEY, mode); } catch { /* Optional */ }
}

function loadStyles() {
  if (document.querySelector('link[data-hanzi-css]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./hanzi.css', import.meta.url).href });
  link.dataset.hanziCss = '';
  document.head.append(link);
}

export function open(root, { spec, editing, host }) {
  loadStyles();
  let model = normalize(spec);
  let pinyinAuto = !model.pinyin;
  let glossAuto = !model.gloss;
  let variantsAuto = !model.variants;
  const past = [], future = [];
  const shell = editorShell(root, {
    id: 'hanzi',
    title: name(model),
    applyLabel: host.applyLabel,
    onApply: () => finish(model.step),
    onCancel: () => host.cancel(),
    undo: () => back(past, future),
    redo: () => back(future, past),
    help: [{ title: 'Stroke order', icon: 'draw', rows: [
      { keys: 'Space', does: 'Play · pause main trace animation' },
      { keys: '← →', does: 'Stroke back · forward' },
      { keys: 'Home / End', does: 'No strokes · all strokes' },
      { does: '中 / A icon next to Characters: toggle Chinese Hanzi or Latin typing (remembered)' },
      { does: 'Practise: write each stroke over the grey character; after 2 misses the stroke is shown' },
      { keys: 'Ctrl Enter', does: `${host.applyLabel} on the page` },
      { keys: 'Esc', does: 'Close without changes' },
    ] }],
  });
  root.classList.add('hz-editor');
  shell.canvas.classList.add('hz-canvas');
  shell.canvas.removeAttribute('tabindex');

  // What goes on the page is chosen once, in the side panel (On the page → Show); Insert just inserts it.

  // ── Middle: the main trace animation player, English & variants summary bar, or practice ──
  const stage = make('div', { className: 'hz-stage-host' });
  const sheetPreview = make('div', { className: 'hz-sheet-preview' });
  let showSheet = model.show !== 'strokes';
  const sheetToggleBtn = button('graph', 'Show sheet', { title: 'Visualize the pre-drawn black character alongside the colored-in stroke sequence' });
  sheetToggleBtn.setAttribute('aria-pressed', String(showSheet));
  sheetToggleBtn.onclick = () => {
    showSheet = !showSheet;
    sheetToggleBtn.setAttribute('aria-pressed', String(showSheet));
    renderSheetPreview();
  };
  const dictBar = make('div', { className: 'hz-dict-bar' });
  const pageBtn = button('check', 'Show this step on the page');
  pageBtn.onclick = () => finish(player.index >= player.steps ? null : player.index);
  const practiseBtn = button('draw', 'Practise');
  const dictsBtn = button('import', 'Dictionaries', { title: 'Download more HSK dictionaries or import a local dictionary (CC-CEDICT, JSON, TSV/CSV)' });
  dictsBtn.onclick = async () => {
    try {
      const [{ openZhSettings }, { chinese }] = await Promise.all([import('../../chinese/settings.js'), import('../../chinese/client.js')]);
      openZhSettings({ client: () => Promise.resolve(chinese()), tab: 'packs', onClose: () => load(false) });
    } catch (e) { shell.say(e.message, true); }
  };
  const ybWrap = make('span', { className: 'hz-yb-wrap' });
  const actions = make('div', { className: 'hz-actions' }, practiseBtn, sheetToggleBtn, dictsBtn, ybWrap, make('span', { className: 'pk-spacer' }), pageBtn);
  shell.canvas.append(stage, sheetPreview, dictBar, actions);
  let player = null, drill = null, charIme = null, charInputEl = null, compareBase = '';
  const size = () => {
    const cw = shell.canvas.clientWidth || 520;
    const narrow = cw < 500;
    const cap = narrow ? 136 : 240;
    const floor = narrow ? 88 : 120;
    return Math.max(floor, Math.min(cap, Math.floor(cw / Math.max(1, [...model.text].length) - 24)));
  };

  // The dictionary's look-up of the characters (load()), for the list of every meaning.
  let lookup = null;
  const defsBox = make('div', { className: 'hz-defs' });
  if (editing && (model.lang === 'es' || model.lang === 'en') && model.lang !== zhLang()) setZhLang(model.lang);
  // es | en: the meanings again in the other language (updating the caption & trace SVG preview too).
  const langSwitch = langToggle({ onChange: (lang) => { glossAuto = true; model = normalize({ ...model, lang }); load(false); } });
  const pageMeanings = () => (model.gloss || '').split(/\s*;\s*/).filter(Boolean);
  function setPageMeanings(list) {
    glossAuto = false;
    change({ gloss: list.join('; ') }, false);
    renderDictBar();
  }
  function renderDictBar() {
    const variantChars = [...new Set((model.variants.match(/\p{Script=Han}/gu) || []))];
    dictBar.replaceChildren();
    const meanings = meaningsOf(lookup, model.text);
    const all = [...new Set(meanings.flatMap((m) => m.gloss))];
    const onPage = pageMeanings();
    const headRow = make('div', { className: 'hz-dict-head' },
      make('strong', { className: 'hz-dict-chars', textContent: model.text || '—' }),
      model.pinyin ? make('span', { className: 'hz-dict-pinyin', textContent: model.pinyin }) : null,
      model.gloss
        ? make('span', { className: 'hz-dict-gloss', textContent: model.gloss, title: `On the page: ${model.gloss}` })
        : make('span', { className: 'muted', textContent: lookup || !model.text ? 'No meaning on the page' : 'Looking up the meaning…' }),
    );
    dictBar.append(headRow);
    // In the side panel: non-editable, scrollable definitions box grouped by reading;
    // clicking a meaning toggles whether it appears on the page.
    const list = make('ol', { className: 'zh-lk-meanings hz-defs-list' });
    for (const m of meanings) {
      const li = make('li', {}, m.pinyin ? make('span', { className: 'hz-defs-reading', textContent: m.pinyin }) : null);
      for (const g of m.gloss) {
        const on = onPage.includes(g);
        const chip = make('button', { type: 'button', className: 'hz-def', textContent: g, title: on ? 'On the page: click to take it off' : 'Click to put it on the page' });
        chip.setAttribute('aria-pressed', String(on));
        chip.onclick = () => setPageMeanings(on ? pageMeanings().filter((x) => x !== g) : [...pageMeanings(), g]);
        li.append(chip);
      }
      list.append(li);
    }
    const defsScroll = make('div', { className: 'hz-defs-box', role: 'region', ariaLabel: 'Dictionary definitions' },
      all.length ? list : make('small', { className: 'muted', textContent: lookup || !model.text ? 'No dictionary definitions found.' : 'Looking up…' }),
    );
    const quick = make('div', { className: 'pk-row hz-defs-tools' });
    if (all.length) {
      const few = button(null, `First ${Math.min(3, all.length)}`, { title: 'Put the first meanings on the page, as when it was inserted' });
      few.onclick = () => setPageMeanings(pageGloss(all).split('; '));
      const every = button(null, 'All', { title: 'Put every meaning on the page (long ones wrap to three lines)' });
      every.onclick = () => setPageMeanings(all);
      const none = button(null, 'None', { title: 'No meaning under the characters' });
      none.onclick = () => setPageMeanings([]);
      quick.append(few, every, none);
    }
    // replaceChildren() would write a null child as the text "null": leave it out instead.
    defsBox.replaceChildren(...[
      make('div', { className: 'hz-defs-head' }, make('h4', { textContent: all.length ? `Meanings (${onPage.length} of ${all.length} on the page)` : 'Meanings' }), langSwitch),
      defsScroll,
      all.length ? make('small', { className: 'muted', textContent: 'Click a meaning above to show or hide it on the page' }) : null,
      all.length ? quick : null,
    ].filter(Boolean));
    const cleanVariants = variantChars.filter((c) => isHan(c) && !['简', '体', '繁', '體', '異'].includes(c));
    if (model.variants || cleanVariants.length) {
      const varRow = make('div', { className: 'hz-variants' },
        make('span', { className: 'muted', textContent: model.variants || 'Variants (click to trace):' }),
      );
      for (const vc of cleanVariants) {
        if (!vc) continue;
        const active = model.text === vc;
        const chip = make('button', {
          type: 'button',
          className: `pk-button${active ? ' is-active' : ''}`,
          textContent: `Trace ${vc}`,
          title: `Show stroke trace for variant ${vc}`,
          onclick: () => {
            compareBase = '';
            pinyinAuto = true; glossAuto = true; variantsAuto = true;
            if (charInputEl) charInputEl.value = vc;
            change({ text: vc, pinyin: '', gloss: '', variants: '' }, true);
          },
        });
        chip.setAttribute('aria-pressed', String(active));
        varRow.append(chip);
      }
      const baseFirst = compareBase || ([...model.text].find(isHan) || '');
      const altFirst = cleanVariants.find((c) => c !== baseFirst);
      if (baseFirst && altFirst && baseFirst !== altFirst) {
        const both = `${baseFirst}${altFirst}`;
        const comparing = model.text === both;
        const compareBtn = make('button', {
          type: 'button',
          className: `pk-button${comparing ? ' is-active' : ''}`,
          textContent: `Compare ${baseFirst}/${altFirst}`,
          title: comparing ? `Stop comparing and return to ${baseFirst}` : `Compare stroke traces for ${baseFirst} and ${altFirst} side-by-side`,
          onclick: () => {
            if (comparing) {
              const restore = compareBase || baseFirst;
              compareBase = '';
              pinyinAuto = true; glossAuto = true; variantsAuto = true;
              if (charInputEl) charInputEl.value = restore;
              change({ text: restore, pinyin: '', gloss: '', variants: '' }, true);
            } else {
              compareBase = baseFirst;
              if (charInputEl) charInputEl.value = both;
              change({ text: both }, true);
            }
          },
        });
        compareBtn.setAttribute('aria-pressed', String(comparing));
        varRow.append(compareBtn);
      }
      dictBar.append(varRow);
    }
    const missing = [...new Set(model.text)].filter((c) => isHan(c) && !model.data[c]);
    ybWrap.replaceChildren();
    if (missing.length) {
      for (const ch of missing) {
        const ybBtn = make('button', {
          type: 'button',
          className: 'pk-button hz-yb-btn',
          textContent: `Look up ${ch} on YellowBridge ↗`,
          title: `No local stroke order for ${ch} — look up stroke order on YellowBridge`,
          onclick: () => window.open(yellowBridgeUrl(ch), '_blank', 'noopener,noreferrer'),
        });
        ybWrap.append(ybBtn);
      }
    }
  }

  function renderSheetPreview() {
    sheetPreview.hidden = !showSheet;
    sheetToggleBtn.setAttribute('aria-pressed', String(showSheet));
    if (!showSheet) { sheetPreview.replaceChildren(); return; }
    const out = renderHanziSheet({ ...model, show: model.show === 'strokes' ? 'steps' : model.show }, { size: 96 });
    sheetPreview.innerHTML = out?.svg || '';
  }

  function showPlayer(autoplay = false) {
    drill?.destroy(); drill = null;
    player?.destroy();
    practiseBtn.replaceChildren(...button('draw', 'Practise').childNodes);
    pageBtn.hidden = false;
    renderSheetPreview();
    player = strokePlayer(stage, { text: model.text, data: model.data, size: size(), grid: model.grid, outline: model.outline, colour: model.colour, start: model.step === null ? (autoplay ? 0 : 'all') : model.step, autoplay });
    player.ready.then(() => {
      say();
      const active = document.activeElement;
      const typingInField = active && root.contains(active) && active.matches('input, textarea, select');
      if (!typingInField) requestAnimationFrame(() => player?.focus());
    });
  }
  function showPractice(k = 0) {
    const han = [...model.text].filter((c) => isHan(c) && model.data[c]);
    if (!han.length) { shell.say('Nothing to practise: no stroke data for these characters', true); return; }
    player?.destroy(); player = null;
    drill?.destroy();
    practiseBtn.replaceChildren(...button('play', 'Back to the player').childNodes);
    pageBtn.hidden = true;
    const c = han[k % han.length];
    drill = practise(stage, { char: c, data: model.data[c], size: Math.min(280, size() + 40), grid: model.grid, outline: model.outline, onDone: (r) => {
      shell.say(`${c}: ${r.mistakes ? `${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'}` : 'no mistakes'}${han.length > 1 ? ' · next character…' : ''}`);
      if (han.length > 1) setTimeout(() => drill && showPractice(k + 1), 1100);
    } });
    shell.say(`Write ${c} (${k % han.length + 1} of ${han.length})`);
  }
  practiseBtn.onclick = () => (drill ? showPlayer() : showPractice());
  const say = () => {
    const missing = [...new Set(model.text)].filter((c) => isHan(c) && !model.data[c]);
    shell.say(missing.length ? `No stroke order for ${missing.join(' ')}` : '', !!missing.length);
  };

  // ── Right: characters (with remembered Chinese IME icon) & page appearance ──
  function panel() {
    charIme?.detach?.();
    const charInput = textInput(model.text, (text) => {
      const raw = String(text ?? '');
      const hanOnly = [...raw].filter(isHan).join('');
      // If a Chinese character appears (and no trailing Latin Pinyin letters are being composed), update immediately without needing Enter!
      if (hanOnly && !hasLatin(raw)) {
        if (hanOnly !== model.text) {
          pinyinAuto = true; glossAuto = true; variantsAuto = true;
          change({ text: hanOnly, pinyin: '', gloss: '', variants: '' }, true);
        }
      }
      // If Latin letters are present, wait for Enter (or IME candidate selection) so Latin letters are never rendered on the trace canvas.
    }, { placeholder: 'Type Chinese, or Pinyin + Enter…' });
    charInputEl = charInput;
    charInput.addEventListener('keydown', async (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const raw = charInput.value.trim();
      if (!raw) return;
      const hanOnly = [...raw].filter(isHan).join('');
      const latinMatches = raw.match(/[a-zA-ZüÜvVāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ0-5']+/gu);
      if (hanOnly && !latinMatches) {
        charInput.value = hanOnly;
        pinyinAuto = true; glossAuto = true; variantsAuto = true;
        change({ text: hanOnly, pinyin: '', gloss: '', variants: '' }, true);
        return;
      }
      if (latinMatches) {
        const key = latinMatches.join('').toLowerCase().replace(/v/g, 'ü');
        try {
          const { chinese } = await import('../../chinese/client.js');
          const res = await chinese().candidates(key, { script: model.script, limit: 5 });
          const top = res?.items?.[0]?.text || '';
          const combined = (hanOnly + top).slice(0, MAX_CHARS);
          if (combined) {
            charInput.value = combined;
            pinyinAuto = true; glossAuto = true; variantsAuto = true;
            change({ text: combined, pinyin: '', gloss: '', variants: '' }, true);
            return;
          }
        } catch {}
      }
      if (hanOnly) {
        charInput.value = hanOnly;
        pinyinAuto = true; glossAuto = true; variantsAuto = true;
        change({ text: hanOnly, pinyin: '', gloss: '', variants: '' }, true);
      }
    });
    const imeBtn = zhButton(() => charInput);
    imeBtn.classList.add('pk-button', 'hz-ime-btn');
    charIme = attachIme(charInput, {
      kind: 'input',
      getMode: () => getHanziImeMode(),
      setMode: (m) => setHanziImeMode(m),
    });
    charIme.addButton(imeBtn);
    const charRow = make('div', { className: 'hz-char-row' }, charInput, imeBtn);
    charInput.style.flex = '1';

    shell.panel.replaceChildren(
      field('Characters (Chinese input)', charRow, `Up to ${MAX_CHARS} · click 中/A icon to toggle Chinese input (remembered)`),
      defsBox,
      make('h4', { textContent: 'On the page' }),
      field('Show', selectInput([['strokes', 'The characters'], ['numbers', 'With stroke numbers'], ['steps', 'With the stroke sequence (traces)']], model.show, (show) => { if (show !== 'strokes') showSheet = true; change({ show }, false); renderSheetPreview(); })),
      field('Grid', selectInput([['mi', '米字格 (cross and diagonals)'], ['tian', '田字格 (cross)'], ['none', 'None']], model.grid, (grid) => change({ grid }, false))),
      checkInput('Grey outline of the strokes still to come', model.outline, (outline) => change({ outline }, false)),
      field('Colour', selectInput([['#1f2328', 'Black'], ['#245dc4', 'Blue'], ['#7a3db8', 'Purple'], ['#1c7c54', 'Green']], model.colour, (colour) => change({ colour }, false))),
    );
  }

  let loading = 0;
  async function load(show = true, autoplay = false) {
    const ticket = ++loading;
    const activeLang = zhLang();
    lookup = null;
    renderDictBar();
    const { spec: next, lookup: found } = await dictionaryFor({
      ...model,
      lang: activeLang,
      pinyin: pinyinAuto ? '' : model.pinyin,
      gloss: glossAuto ? '' : model.gloss,
      variants: variantsAuto ? '' : model.variants,
    });
    if (ticket !== loading) return;
    lookup = found;
    model = normalize({
      ...model,
      lang: activeLang,
      data: next.data,
      pinyin: pinyinAuto && next.pinyin ? next.pinyin : model.pinyin,
      gloss: glossAuto && next.gloss ? next.gloss : model.gloss,
      variants: variantsAuto && next.variants ? next.variants : model.variants,
    });
    renderDictBar();
    renderSheetPreview();
    if (show) showPlayer(autoplay);
  }

  let timer = 0;
  function change(next, text) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next, ...(text ? { step: null } : {}) });
    shell.history(true, false);
    root.querySelector('.pk-title').textContent = name(model);
    if (text) { clearTimeout(timer); timer = setTimeout(() => load(true, true), 250); }
    else {
      renderSheetPreview();
      if (player && ('grid' in next || 'outline' in next || 'colour' in next)) player.set({ grid: model.grid, outline: model.outline, colour: model.colour });
    }
  }
  function back(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    const before = model.text;
    model = JSON.parse(from.pop());
    shell.history(past.length > 0, future.length > 0);
    panel();
    // Other characters: their own look-up (the list of meanings) and strokes.
    if (model.text !== before) { pinyinAuto = glossAuto = variantsAuto = false; load(true); return; }
    renderDictBar();
    showPlayer();
  }
  function finish(step) {
    const validHan = [...model.text].filter(isHan).join('');
    if (!validHan) {
      shell.say('Enter at least one Chinese character (or press Enter after Pinyin) before inserting.', true);
      charInputEl?.focus();
      return;
    }
    host.done({ ...model, text: validHan, step: step ?? null });
  }

  panel();
  shell.history(false, false);
  const mode = host.mode || 'author';
  load(false).then(() => (mode === 'practice' ? showPractice() : showPlayer(mode === 'play' || true)));
  return {
    destroy() { clearTimeout(timer); loading++; charIme?.detach?.(); player?.destroy(); drill?.destroy(); shell.destroy(); root.classList.remove('hz-editor'); },
  };
}
