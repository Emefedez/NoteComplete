// The hanzi module's editor, in the kit's movable window: the stroke-order player in the middle
// (play/pause Space, ← →, Home/End, speed, timeline), the characters, pinyin and look on the
// right; Practise traces each character with the pen or a finger. "Show this step on the page"
// puts the strokes so far on the page; Insert/Apply keeps the figure's step (all strokes when new).
import { editorShell, make, button, field, textInput, selectInput, checkInput } from '../kit/index.js';
import { normalize, prepare, name, MAX_CHARS } from './render.js';
import { strokePlayer, isHan } from '../../chinese/stroke-player.js';
import { practise } from '../../chinese/practice.js';

function loadStyles() {
  if (document.querySelector('link[data-hanzi-css]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./hanzi.css', import.meta.url).href });
  link.dataset.hanziCss = '';
  document.head.append(link);
}
// Pinyin for the characters from the dictionary, when Chinese mode's engine is there.
async function autoPinyin(text) {
  try {
    const { chinese } = await import('../../chinese/client.js');
    const runs = await chinese().annotate(text, {});
    return runs.flatMap((r) => r.pinyin || []).join(' ');
  } catch { return ''; }
}

export function open(root, { spec, editing, host }) {
  loadStyles();
  let model = normalize(spec);
  let pinyinAuto = !model.pinyin;
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
      { keys: 'Space', does: 'Play · pause' },
      { keys: '← →', does: 'Stroke back · forward' },
      { keys: 'Home / End', does: 'No strokes · all strokes' },
      { does: 'Practise: write each stroke over the grey character; after 2 misses the stroke is shown' },
      { keys: 'Ctrl Enter', does: `${host.applyLabel} on the page` },
      { keys: 'Esc', does: 'Close without changes' },
    ] }],
  });
  root.classList.add('hz-editor');
  shell.canvas.classList.add('hz-canvas');
  shell.canvas.removeAttribute('tabindex');

  // ── Middle: the player, or practice ──
  const stage = make('div', { className: 'hz-stage-host' });
  const pageBtn = button('check', 'Show this step on the page');
  pageBtn.onclick = () => finish(player.index >= player.steps ? null : player.index);
  const practiseBtn = button('draw', 'Practise');
  const actions = make('div', { className: 'hz-actions' }, practiseBtn, make('span', { className: 'pk-spacer' }), pageBtn);
  shell.canvas.append(stage, actions);
  let player = null, drill = null;
  const size = () => Math.max(120, Math.min(260, Math.floor((shell.canvas.clientWidth || 520) / Math.max(1, [...model.text].length) - 24)));
  function showPlayer(autoplay = false) {
    drill?.destroy(); drill = null;
    player?.destroy();
    practiseBtn.replaceChildren(...button('draw', 'Practise').childNodes);
    pageBtn.hidden = false;
    player = strokePlayer(stage, { text: model.text, data: model.data, size: size(), grid: model.grid, outline: model.outline, colour: model.colour, start: model.step === null ? 'all' : model.step, autoplay });
    player.ready.then(() => { say(); requestAnimationFrame(() => player.focus()); });
  }
  // Each character in turn; the result of each in the status line.
  function showPractice(k = 0) {
    const han = [...model.text].filter((c) => isHan(c) && model.data[c]);
    if (!han.length) { shell.say('Nothing to practise: no stroke data for these characters', true); return; }
    player?.destroy(); player = null;
    drill?.destroy();
    practiseBtn.replaceChildren(...button('play', 'Back to the player').childNodes);
    pageBtn.hidden = true;
    const c = han[k % han.length];
    drill = practise(stage, { char: c, data: model.data[c], size: Math.min(300, size() + 40), grid: model.grid, outline: model.outline, onDone: (r) => {
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

  // ── Right: characters, pinyin, look ──
  const pinyinInput = textInput(model.pinyin, (pinyin) => { pinyinAuto = !pinyin; change({ pinyin }, false); }, { placeholder: 'nǐ hǎo (or ni3 hao3)' });
  function panel() {
    pinyinInput.value = model.pinyin;
    shell.panel.replaceChildren(
      field('Characters', textInput(model.text, (text) => change({ text }, true), { placeholder: '你好' }), `Up to ${MAX_CHARS}`),
      field('Pinyin', pinyinInput, 'Above the characters; tone numbers become marks'),
      make('h4', { textContent: 'On the page' }),
      field('Show', selectInput([['strokes', 'The characters'], ['numbers', 'With stroke numbers'], ['steps', 'With the stroke sequence']], model.show, (show) => change({ show }, false))),
      field('Grid', selectInput([['mi', '米字格 (cross and diagonals)'], ['tian', '田字格 (cross)'], ['none', 'None']], model.grid, (grid) => change({ grid }, false))),
      checkInput('Grey outline of the strokes still to come', model.outline, (outline) => change({ outline }, false)),
      field('Colour', selectInput([['#1f2328', 'Black'], ['#245dc4', 'Blue'], ['#7a3db8', 'Purple'], ['#1c7c54', 'Green']], model.colour, (colour) => change({ colour }, false))),
    );
  }
  let loading = 0;
  // A new text: its stroke data before the player shows it; its pinyin when not typed (the
  // player does not show pinyin, so it is not redrawn for it).
  async function load(show = true) {
    const ticket = ++loading;
    const next = await prepare(model);
    if (ticket !== loading) return;
    model = { ...model, data: next.data };
    if (show) showPlayer();
    if (pinyinAuto && model.text) autoPinyin(model.text).then((p) => { if (ticket === loading && p && pinyinAuto) { model = normalize({ ...model, pinyin: p }); pinyinInput.value = model.pinyin; } });
  }
  let timer = 0;
  function change(next, text) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next, ...(text ? { step: null } : {}) });
    shell.history(true, false);
    root.querySelector('.pk-title').textContent = name(model);
    if (text) { clearTimeout(timer); timer = setTimeout(load, 250); }
    else if (player && ('grid' in next || 'outline' in next || 'colour' in next)) player.set({ grid: model.grid, outline: model.outline, colour: model.colour });
  }
  function back(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    shell.history(past.length > 0, future.length > 0);
    panel();
    showPlayer();
  }
  function finish(step) { host.done({ ...model, step: step ?? null }); }

  panel();
  shell.history(false, false);
  const mode = host.mode || 'author';
  load(false).then(() => (mode === 'practice' ? showPractice() : showPlayer(mode === 'play')));
  return {
    destroy() { clearTimeout(timer); loading++; player?.destroy(); drill?.destroy(); shell.destroy(); root.classList.remove('hz-editor'); },
  };
}
