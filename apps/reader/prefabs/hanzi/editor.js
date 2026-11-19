// The hanzi module's editor, in the kit's movable window: the stroke-order player in the middle
// (play/pause Space, ← →, Home/End, speed, timeline), live English equivalents & Simplified/
// Traditional variants card, the characters (with built-in Chinese IME mode remembered via icon),
// pinyin and look on the right; Practise traces each character with the pen or a finger.
import { editorShell, make, button, field, textInput, selectInput, checkInput } from '../kit/index.js';
import { normalize, prepareWithDict, name, MAX_CHARS } from './render.js';
import { strokePlayer, isHan } from '../../chinese/stroke-player.js';
import { practise } from '../../chinese/practice.js';
import { attachIme, zhButton } from '../../chinese/ime.js';

const HANZI_IME_KEY = 'notecomplete-hanzi-prefab-ime';
function getHanziImeMode() {
  try {
    const v = localStorage.getItem(HANZI_IME_KEY);
    if (v === 'hanzi' || v === 'pinyin' || v === 'off') return v;
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
    help: [{ title: 'Stroke order & Trace Prefab', icon: 'draw', rows: [
      { keys: 'Space', does: 'Play · pause main trace animation' },
      { keys: '← →', does: 'Stroke back · forward' },
      { keys: 'Home / End', does: 'No strokes · all strokes' },
      { does: '中 / ā / A icon next to Characters: switch Chinese Hanzi, Pinyin or Latin typing (remembered)' },
      { does: 'Practise: write each stroke over the grey character; after 2 misses the stroke is shown' },
      { keys: 'Ctrl Enter', does: `${host.applyLabel} on the page` },
      { keys: 'Esc', does: 'Close without changes' },
    ] }],
  });
  root.classList.add('hz-editor');
  shell.canvas.classList.add('hz-canvas');
  shell.canvas.removeAttribute('tabindex');

  // ── Middle: the main trace animation player, English & variants summary bar, or practice ──
  const stage = make('div', { className: 'hz-stage-host' });
  const dictBar = make('div', {
    className: 'hz-dict-bar',
    style: 'display:grid;gap:4px;padding:8px 12px;border-top:1px solid var(--pk-line, #d0d7de);background:var(--pk-surface, rgba(127,127,127,0.06));font-size:12.5px',
  });
  const pageBtn = button('check', 'Show this step on the page');
  pageBtn.onclick = () => finish(player.index >= player.steps ? null : player.index);
  const practiseBtn = button('draw', 'Practise');
  const actions = make('div', { className: 'hz-actions' }, practiseBtn, make('span', { className: 'pk-spacer' }), pageBtn);
  shell.canvas.append(stage, dictBar, actions);
  let player = null, drill = null, charIme = null;
  const size = () => Math.max(120, Math.min(240, Math.floor((shell.canvas.clientWidth || 520) / Math.max(1, [...model.text].length) - 24)));

  function renderDictBar(variantChars = []) {
    dictBar.replaceChildren();
    const headRow = make('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:baseline' },
      make('strong', { style: 'font-size:16px', textContent: model.text || '—' }),
      model.pinyin ? make('span', { style: 'color:var(--accent, #2563eb);font-weight:600', textContent: model.pinyin }) : null,
      model.gloss ? make('span', { style: 'color:var(--pk-ink, inherit)', textContent: `— ${model.gloss}` }) : make('span', { className: 'muted', textContent: 'Looking up English meaning…' }),
    );
    dictBar.append(headRow);
    if (model.variants || variantChars.length) {
      const varRow = make('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px' },
        make('span', { className: 'muted', textContent: model.variants || 'Variants:' }),
      );
      for (const vc of variantChars) {
        if (!vc || vc === model.text) continue;
        const chip = make('button', {
          type: 'button',
          className: 'pk-button',
          textContent: vc,
          title: `Switch trace prefab to variant ${vc}`,
          style: 'height:22px;min-width:26px;padding:0 6px;font-size:13px',
          onclick: () => {
            pinyinAuto = true; glossAuto = true; variantsAuto = true;
            change({ text: vc, pinyin: '', gloss: '', variants: '' }, true);
            panel();
          },
        });
        varRow.append(chip);
      }
      dictBar.append(varRow);
    }
  }

  function showPlayer(autoplay = false) {
    drill?.destroy(); drill = null;
    player?.destroy();
    practiseBtn.replaceChildren(...button('draw', 'Practise').childNodes);
    pageBtn.hidden = false;
    player = strokePlayer(stage, { text: model.text, data: model.data, size: size(), grid: model.grid, outline: model.outline, colour: model.colour, start: model.step === null ? 'all' : model.step, autoplay });
    player.ready.then(() => { say(); requestAnimationFrame(() => player?.focus()); });
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

  // ── Right: characters (with remembered Chinese IME icon), pinyin, English meaning, variants, look ──
  const pinyinInput = textInput(model.pinyin, (pinyin) => { pinyinAuto = !pinyin; change({ pinyin }, false); renderDictBar(); }, { placeholder: 'nǐ hǎo (or ni3 hao3)' });
  const glossInput = textInput(model.gloss, (gloss) => { glossAuto = !gloss; change({ gloss }, false); renderDictBar(); }, { placeholder: 'English equivalent (e.g. hello; hi)' });
  const variantsInput = textInput(model.variants, (variants) => { variantsAuto = !variants; change({ variants }, false); renderDictBar(); }, { placeholder: 'Simplified / Traditional variants' });

  function panel() {
    charIme?.detach?.();
    const charInput = textInput(model.text, (text) => {
      pinyinAuto = true; glossAuto = true; variantsAuto = true;
      change({ text, pinyin: '', gloss: '', variants: '' }, true);
    }, { placeholder: 'Type pinyin (e.g. nihao) or characters…' });
    const imeBtn = zhButton(() => charInput);
    imeBtn.style.cssText = 'height:28px;min-width:30px;padding:0 6px;border:1px solid var(--pk-line, #d0d7de);border-radius:6px;cursor:pointer;flex:none';
    charIme = attachIme(charInput, {
      kind: 'input',
      getMode: () => getHanziImeMode(),
      setMode: (m) => setHanziImeMode(m),
    });
    charIme.addButton(imeBtn);
    const charRow = make('div', { style: 'display:flex;gap:6px;align-items:center' }, charInput, imeBtn);
    charInput.style.flex = '1';

    pinyinInput.value = model.pinyin;
    glossInput.value = model.gloss;
    variantsInput.value = model.variants;
    shell.panel.replaceChildren(
      field('Characters (Chinese input)', charRow, `Up to ${MAX_CHARS} · click 中/ā/A icon to switch input mode (remembered)`),
      field('Pinyin', pinyinInput, 'Above the characters; tone numbers become marks'),
      field('English equivalent', glossInput, 'Shown below the characters on the prefab'),
      field('Variants (繁/简)', variantsInput, 'Simplified, traditional or variant forms'),
      make('h4', { textContent: 'On the page' }),
      field('Show', selectInput([['strokes', 'The characters'], ['numbers', 'With stroke numbers'], ['steps', 'With the stroke sequence (traces)']], model.show, (show) => change({ show }, false))),
      field('Grid', selectInput([['mi', '米字格 (cross and diagonals)'], ['tian', '田字格 (cross)'], ['none', 'None']], model.grid, (grid) => change({ grid }, false))),
      checkInput('Grey outline of the strokes still to come', model.outline, (outline) => change({ outline }, false)),
      field('Colour', selectInput([['#1f2328', 'Black'], ['#245dc4', 'Blue'], ['#7a3db8', 'Purple'], ['#1c7c54', 'Green']], model.colour, (colour) => change({ colour }, false))),
    );
  }

  let loading = 0;
  async function load(show = true, autoplay = false) {
    const ticket = ++loading;
    renderDictBar();
    const next = await prepareWithDict({
      ...model,
      pinyin: pinyinAuto ? '' : model.pinyin,
      gloss: glossAuto ? '' : model.gloss,
      variants: variantsAuto ? '' : model.variants,
    });
    if (ticket !== loading) return;
    model = normalize({
      ...model,
      data: next.data,
      pinyin: pinyinAuto && next.pinyin ? next.pinyin : model.pinyin,
      gloss: glossAuto && next.gloss ? next.gloss : model.gloss,
      variants: variantsAuto && next.variants ? next.variants : model.variants,
    });
    pinyinInput.value = model.pinyin;
    glossInput.value = model.gloss;
    variantsInput.value = model.variants;
    const varChars = [...new Set((model.variants.match(/\p{Script=Han}/gu) || []))];
    renderDictBar(varChars);
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
    else if (player && ('grid' in next || 'outline' in next || 'colour' in next)) player.set({ grid: model.grid, outline: model.outline, colour: model.colour });
  }
  function back(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    shell.history(past.length > 0, future.length > 0);
    panel();
    renderDictBar();
    showPlayer();
  }
  function finish(step) { host.done({ ...model, step: step ?? null }); }

  panel();
  shell.history(false, false);
  const mode = host.mode || 'author';
  load(false).then(() => (mode === 'practice' ? showPractice() : showPlayer(mode === 'play' || true)));
  return {
    destroy() { clearTimeout(timer); loading++; charIme?.detach?.(); player?.destroy(); drill?.destroy(); shell.destroy(); root.classList.remove('hz-editor'); },
  };
}
