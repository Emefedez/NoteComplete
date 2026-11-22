// The hanzi module's editor, in the kit's movable window: a look-up of the characters with their
// stroke order. In the middle the player (play/pause Space, ← →, Home/End, speed, timeline, repeat
// L, and with several characters a loop button over each one picking which repeat), an optional
// still copy beside it and the sheet as it goes on the page, then the header: characters, pinyin
// whose syllables play their tone, 🔊, ☆ favourite, HSK level. On the right the characters (with
// the built-in Chinese input), then collapsible Meanings (each one put on the page or taken off
// with a click), Forms, Structure, Words with it and On the page. Practise traces each character
// with the pen or a finger.
import { editorShell, make, button, field, textInput, selectInput, checkInput } from '../kit/index.js';
import { normalize, dictionaryFor, pageGloss, PAGE_GLOSSES, render as renderHanziSheet, name, MAX_CHARS } from './render.js';
import { meaningsOf, formsOf, lowestLevel } from '../../chinese/lookup-panel.js';
import { sayer, listenButton, syllables, favouriteButton, formRows, structureRows } from '../../chinese/char-info.js';
import { levelLabel } from '../../chinese/vocab.js';
import { strokePlayer, isHan } from '../../chinese/stroke-player.js';
import { practise } from '../../chinese/practice.js';
import { attachIme, zhButton } from '../../chinese/ime.js';
import { langToggle } from '../../chinese/zh-window.js';

const HANZI_IME_KEY = 'notecomplete-hanzi-prefab-ime';
const STILL_KEY = 'notecomplete-hanzi-still', SECTION_KEY = 'notecomplete-hanzi-section-';
const remembered = (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Optional. */ } };
const hasLatin = (s) => /[a-zA-Z]/.test(String(s || ''));
const yellowBridgeUrl = (c) => `https://www.yellowbridge.com/chinese/character-stroke-order.php?word=${encodeURIComponent(c)}`;
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
    help: [{ title: 'Stroke order', icon: 'draw', rows: [
      { keys: 'Space', does: 'Play · pause main trace animation' },
      { keys: '← →', does: 'Stroke back · forward' },
      { keys: 'Home / End', does: 'No strokes · all strokes' },
      { keys: 'L', does: 'Repeat on or off; with several characters, the loop button over each one picks which repeat' },
      { does: 'Still copy: the finished characters beside the animated ones' },
      { does: 'Click a syllable of the pinyin to hear its tone; ☆ makes it a favourite (Chinese input offers it first)' },
      { does: '中 / ā / A icon next to Characters: switch Chinese Hanzi, Pinyin or Latin typing (remembered)' },
      { does: 'Practise: write each stroke over the grey character; after 2 misses the stroke is shown' },
      { keys: 'Ctrl Enter', does: `${host.applyLabel} on the page` },
      { keys: 'Esc', does: 'Close without changes' },
    ] }],
  });
  root.classList.add('hz-editor');
  shell.canvas.classList.add('hz-canvas');
  shell.canvas.removeAttribute('tabindex');

  // What goes on the page is chosen once, in the side panel (On the page → Show); Insert just inserts it.

  // ── Middle: the player (or practice), the look-up's header, the actions ──
  const stage = make('div', { className: 'hz-stage-host' });
  const sheetPreview = make('div', { className: 'hz-sheet-preview' });
  let showSheet = model.show !== 'strokes';
  let still = remembered(STILL_KEY) === '1';
  const sheetToggleBtn = button('graph', 'Sheet', { title: 'The picture as it goes on the page (the stroke sequence when shown)' });
  sheetToggleBtn.onclick = () => { showSheet = !showSheet; renderSheetPreview(); };
  const stillBtn = button('pin', 'Still copy', { title: 'A finished copy of the characters beside the animated ones' });
  stillBtn.onclick = () => {
    still = !still;
    keep(STILL_KEY, still ? '1' : '0');
    stillBtn.setAttribute('aria-pressed', String(still));
    player?.set({ still, size: size() });
  };
  stillBtn.setAttribute('aria-pressed', String(still));
  const dictBar = make('div', { className: 'hz-dict-bar' });
  const pageBtn = button('check', 'Show this step on the page');
  pageBtn.onclick = () => finish(player.index >= player.steps ? null : player.index);
  const practiseBtn = button('draw', 'Practise');
  const ybWrap = make('span', { className: 'hz-yb-wrap' });
  const views = make('span', { className: 'hz-views', role: 'group', ariaLabel: 'View' }, sheetToggleBtn, stillBtn);
  const actions = make('div', { className: 'hz-actions' }, practiseBtn, views, ybWrap, make('span', { className: 'pk-spacer' }), pageBtn);
  shell.canvas.append(stage, sheetPreview, dictBar, actions);
  let player = null, drill = null, charIme = null, charInputEl = null, compareBase = '', compareForms = null;
  const charCount = () => Math.max(1, [...model.text].length);
  const size = () => Math.max(72, Math.min(240, Math.floor((shell.canvas.clientWidth || 520) / (charCount() * (still ? 2 : 1)) - 24)));

  // The dictionary's look-up of the text (load()) and of each of its characters (Structure).
  let lookup = null, charLookups = [];
  const script = () => model.script;
  const say = sayer({ script, status: (msg, bad) => shell.say(msg, bad) });
  // es | en: the meanings again in the other language (the page's caption too while it is automatic).
  const langSwitch = langToggle({ onChange: () => load(false) });
  const splitGloss = (g) => String(g || '').split(/\s*;\s*/).filter(Boolean);
  const pageMeanings = () => splitGloss(model.gloss);
  function setPageMeanings(list) {
    glossAuto = false;
    change({ gloss: list.join('; ') }, false);
    renderLookup();
  }
  // Other characters in the window, with their own look-up (pinyin, meaning and forms anew).
  function trace(text) {
    compareBase = '';
    if (charInputEl) charInputEl.value = text;
    pinyinAuto = true; glossAuto = true; variantsAuto = true;
    change({ text, pinyin: '', gloss: '', variants: '' }, true);
  }
  const link = (t, cls = 'zh-lk-link zh-cjk') => make('button', { type: 'button', className: cls, textContent: t, title: `Trace ${t}`, onclick: () => trace(t) });

  // A collapsible section of the side panel, its open state remembered.
  const sectionBox = (key, title, { open = true, note = '' } = {}) => {
    const d = make('details', { className: 'hz-section' });
    d.open = remembered(`${SECTION_KEY}${key}`, open ? '1' : '0') === '1';
    d.addEventListener('toggle', () => keep(`${SECTION_KEY}${key}`, d.open ? '1' : '0'));
    d.append(make('summary', {}, make('span', { textContent: title }), note ? make('small', { className: 'muted', textContent: note }) : null));
    return d;
  };
  const lookupBox = make('div', { className: 'hz-lookup' });

  function renderDictBar() {
    const han = [...model.text].filter(isHan).join('');
    const reading = model.pinyin;
    const level = lowestLevel(lookup);
    const strokes = Object.values(model.data).reduce((n, d) => n + d.strokes.length, 0);
    const head = make('div', { className: 'hz-dict-head' },
      make('strong', { className: 'hz-dict-chars zh-cjk', textContent: model.text || '—' }),
      reading ? syllables(reading, model.text, say) : null,
      han ? listenButton(han, say, { reading: [...han].length === 1 ? reading : '', script: model.script }) : null,
      han ? favouriteButton(han, { reading, status: (msg, bad) => shell.say(msg, bad) }) : null,
      make('span', { className: 'pk-spacer' }),
      level ? make('span', { className: 'zh-lk-level', textContent: levelLabel(level) }) : null,
      strokes ? make('span', { className: 'muted', textContent: `${strokes} strokes` }) : null,
    );
    const gloss = model.gloss
      ? make('div', { className: 'hz-dict-gloss', textContent: model.gloss, title: `On the page: ${model.gloss}` })
      : make('div', { className: 'hz-dict-gloss muted', textContent: lookup || !model.text ? 'No meaning on the page' : 'Looking up the meaning…' });
    dictBar.replaceChildren(head, gloss);
  }

  // The side panel's look-up: Meanings (each one put on the page or taken off with a click),
  // Forms, Structure and Words with it, each collapsible.
  function renderLookup() {
    renderDictBar();
    const parts = [];
    // One toggle per meaning (a dictionary gloss can hold several: "hello; hi").
    const meanings = meaningsOf(lookup, model.text).map((m) => ({ ...m, gloss: [...new Set(m.gloss.flatMap(splitGloss))] }));
    const all = [...new Set(meanings.flatMap((m) => m.gloss))];
    const onPage = pageMeanings();
    // ── Meanings: a scrolling box of toggles, the quick choices as icons ──
    const tool = (name, label, run, disabled = false) => {
      const b = button(name, label, { iconOnly: true });
      b.classList.add('hz-tool');
      b.disabled = disabled;
      b.onclick = run;
      return b;
    };
    const tools = make('div', { className: 'hz-tools' },
      all.length ? tool('restart', `The first ${Math.min(PAGE_GLOSSES, all.length)} on the page, as when it was inserted`, () => setPageMeanings(pageGloss(all).split('; '))) : null,
      all.length ? tool('doubleCheck', 'Every meaning on the page (long ones wrap to three lines)', () => setPageMeanings(all), onPage.length === all.length) : null,
      all.length ? tool('close', 'No meaning on the page', () => setPageMeanings([]), !onPage.length) : null,
      make('span', { className: 'pk-spacer' }),
      langSwitch,
    );
    const meaningsSec = sectionBox('meanings', 'Meanings', { note: all.length ? `${onPage.length} of ${all.length} on the page` : '' });
    meaningsSec.append(tools);
    if (all.length) {
      const list = make('ol', { className: 'zh-lk-meanings hz-defs-list' });
      for (const m of meanings) {
        const li = make('li', {}, make('span', { className: 'hz-defs-reading', textContent: m.pinyin }));
        for (const g of m.gloss) {
          const on = onPage.includes(g);
          const chip = make('button', { type: 'button', className: 'hz-def', textContent: g, title: on ? 'On the page: click to take it off' : 'Click to put it on the page' });
          chip.setAttribute('aria-pressed', String(on));
          chip.onclick = () => setPageMeanings(on ? pageMeanings().filter((x) => x !== g) : [...pageMeanings(), g]);
          li.append(chip);
        }
        list.append(li);
      }
      meaningsSec.append(make('div', { className: 'hz-defs-box', tabIndex: 0, ariaLabel: 'Meanings: click one to put it on the page or take it off' }, list));
    } else {
      meaningsSec.append(make('small', { className: 'muted', textContent: lookup || !model.text ? 'Nothing in the dictionary.' : 'Looking up…' }));
    }
    parts.push(meaningsSec);
    // ── Forms: trace the other forms, or compare one beside it ──
    // While two forms are compared, the forms of the first one (the pair has none of its own).
    const forms = compareBase && compareForms ? compareForms : lookup ? formsOf(lookup, model.text) : [];
    if (forms.length) {
      const sec = sectionBox('forms', 'Forms');
      sec.append(...formRows(forms, link));
      const baseFirst = compareBase || ([...model.text].find(isHan) || '');
      const altFirst = forms.flatMap((f) => f.chars).find((c) => [...c].length === 1 && c !== baseFirst);
      if (baseFirst && altFirst) {
        const both = `${baseFirst}${altFirst}`, comparing = model.text === both;
        const compareBtn = button('split', comparing ? `Stop comparing ${baseFirst}/${altFirst}` : `Compare ${baseFirst}/${altFirst}`, { title: comparing ? `Back to ${baseFirst}` : `Trace ${baseFirst} and ${altFirst} side by side` });
        compareBtn.setAttribute('aria-pressed', String(comparing));
        compareBtn.onclick = () => {
          if (comparing) { const back = compareBase || baseFirst; trace(back); return; }
          compareBase = baseFirst;
          compareForms = forms;
          if (charInputEl) charInputEl.value = both;
          change({ text: both }, true);
        };
        sec.append(make('div', { className: 'zh-lk-row hz-compare' }, compareBtn));
      }
      parts.push(sec);
    }
    // ── Structure: each character's radical, parts and how it was made ──
    const structure = charLookups.map(({ char, info }) => ({ char, rows: structureRows(info, link) })).filter((x) => x.rows.length);
    if (structure.length) {
      const sec = sectionBox('structure', 'Structure');
      for (const { char, rows } of structure) {
        if (structure.length > 1) sec.append(make('div', { className: 'hz-struct-char zh-cjk', textContent: char }));
        sec.append(...rows);
      }
      parts.push(sec);
    }
    // ── Words with it (one character) ──
    if (lookup?.words?.length && [...model.text].length === 1) {
      const sec = sectionBox('words', `Words with ${model.text} (${lookup.words.length})`, { open: false });
      const ul = make('ul', { className: 'zh-lk-words hz-words' });
      for (const w of lookup.words) {
        const li = make('li', {}, link(w.text), listenButton(w.text, say, { script: model.script, small: true }), syllables(w.pinyin, w.text, say), make('span', { className: 'zh-lk-gloss', textContent: w.gloss || '' }));
        if (w.level) li.append(make('span', { className: 'zh-lk-level', textContent: levelLabel(w.level) }));
        ul.append(li);
      }
      sec.append(ul);
      parts.push(sec);
    }
    lookupBox.replaceChildren(...parts);
    renderMissing();
  }
  // No local stroke order: a link to look each one up elsewhere.
  function renderMissing() {
    const missing = [...new Set(model.text)].filter((c) => isHan(c) && !model.data[c]);
    ybWrap.replaceChildren(...missing.map((ch) => make('button', {
      type: 'button',
      className: 'pk-button hz-yb-btn',
      textContent: `Look up ${ch} on YellowBridge ↗`,
      title: `No local stroke order for ${ch}: look it up on YellowBridge`,
      onclick: () => window.open(yellowBridgeUrl(ch), '_blank', 'noopener,noreferrer'),
    })));
    // Nothing animates without stroke data: no still copy beside it then.
    stillBtn.hidden = !!drill || !Object.keys(model.data).length;
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
    renderMissing();
    player = strokePlayer(stage, { text: model.text, data: model.data, size: size(), grid: model.grid, outline: model.outline, still, colour: model.colour, start: model.step === null ? (autoplay ? 0 : 'all') : model.step, autoplay });
    player.ready.then(() => {
      sayMissing();
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
    stillBtn.hidden = true;
    const c = han[k % han.length];
    drill = practise(stage, { char: c, data: model.data[c], size: Math.min(280, size() + 40), grid: model.grid, outline: model.outline, onDone: (r) => {
      shell.say(`${c}: ${r.mistakes ? `${r.mistakes} mistake${r.mistakes === 1 ? '' : 's'}` : 'no mistakes'}${han.length > 1 ? ' · next character…' : ''}`);
      if (han.length > 1) setTimeout(() => drill && showPractice(k + 1), 1100);
    } });
    shell.say(`Write ${c} (${k % han.length + 1} of ${han.length})`);
  }
  practiseBtn.onclick = () => (drill ? showPlayer() : showPractice());
  const sayMissing = () => {
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
      const latinMatches = raw.match(/[a-zA-ZüÜvV]+[1-5]?/g);
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
          const list = await chinese().candidates(key, { script: model.script, limit: 5 });
          const top = list?.[0]?.text || '';
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
      field('Characters (Chinese input)', charRow, `Up to ${MAX_CHARS} · click 中/ā/A icon to switch input mode (remembered)`),
      lookupBox,
      pageSection(),
    );
  }
  // How it looks on the page.
  function pageSection() {
    const sec = sectionBox('page', 'On the page');
    sec.append(
      field('Show', selectInput([['strokes', 'The characters'], ['numbers', 'With stroke numbers'], ['steps', 'With the stroke sequence (traces)']], model.show, (show) => { if (show !== 'strokes') showSheet = true; change({ show }, false); renderSheetPreview(); })),
      field('Grid', selectInput([['mi', '米字格 (cross and diagonals)'], ['tian', '田字格 (cross)'], ['none', 'None']], model.grid, (grid) => change({ grid }, false))),
      checkInput('Grey outline of the strokes still to come', model.outline, (outline) => change({ outline }, false)),
      field('Colour', selectInput([['#1f2328', 'Black'], ['#245dc4', 'Blue'], ['#7a3db8', 'Purple'], ['#1c7c54', 'Green']], model.colour, (colour) => change({ colour }, false))),
    );
    return sec;
  }

  let loading = 0;
  async function load(show = true, autoplay = false) {
    const ticket = ++loading;
    lookup = null;
    charLookups = [];
    renderLookup();
    const { spec: next, lookup: found } = await dictionaryFor({
      ...model,
      pinyin: pinyinAuto ? '' : model.pinyin,
      gloss: glossAuto ? '' : model.gloss,
      variants: variantsAuto ? '' : model.variants,
    });
    if (ticket !== loading) return;
    lookup = found;
    charLookups = await charsLookedUp(found);
    if (ticket !== loading) return;
    model = normalize({
      ...model,
      data: next.data,
      pinyin: pinyinAuto && next.pinyin ? next.pinyin : model.pinyin,
      gloss: glossAuto && next.gloss ? next.gloss : model.gloss,
      variants: variantsAuto && next.variants ? next.variants : model.variants,
    });
    renderLookup();
    if (show) showPlayer(autoplay);
  }
  // Each character's own look-up, for Structure (one character: the text's).
  async function charsLookedUp(found) {
    const han = [...new Set([...model.text].filter(isHan))];
    if (han.length === 1) return found?.char ? [{ char: han[0], info: found.char }] : [];
    try {
      const { chinese } = await import('../../chinese/client.js');
      const list = await Promise.all(han.map((c) => chinese().lookup(c, { script: model.script }).catch(() => null)));
      return han.map((char, i) => ({ char, info: list[i]?.char })).filter((x) => x.info);
    } catch { return []; }
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
      renderDictBar();
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
    renderLookup();
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
