// The Chinese input controller (docs/CHINESE-INPUT.md §5.1–5.2, §15.4–5).
// imeReduce is pure (tested in Node): keys in, the new state and what to do out.
// attachIme wires it to a textarea, input or contenteditable; chineseField does that for the
// app's other fields, with the remembered mode and a small 中 button.
import { numbersToMarks, readingOf, hasMarkedPinyin } from './pinyin.js';
import { zhSettings, fieldMode, setFieldMode, zhEverUsed } from './settings.js';

export const IME_MODES = ['off', 'hanzi', 'pinyin'];
// Ctrl+Shift+Space and the 中 button: Off → Hanzi → Pinyin → Off.
export const nextMode = (mode) => IME_MODES[(IME_MODES.indexOf(mode) + 1) % IME_MODES.length];

const FULL = { ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；', '\\': '、', '(': '（', ')': '）', '<': '《', '>': '》', '[': '【', ']': '】' };
const MODS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'Fn'];
const PAGE_KEYS = { PageUp: -1, PageDown: 1, '-': -1, '=': 1 };

export const imeInitial = (mode = 'off', opts = {}) => ({
  mode, latin: false, composing: false, buffer: '', chosen: [], cands: null, page: 0, sel: 0, justChose: false,
  // Space held in Hanzi mode (it chooses on release); chord: a digit was pressed while it was held.
  spaceHeld: false, chord: false,
  opts: { perPage: 9, fullWidth: true, enter: 'auto', digits: 'tone', ...opts },
});

const clear = (s) => ({ ...s, buffer: '', chosen: [], cands: null, page: 0, sel: s.mode === 'hanzi' ? 0 : -1, justChose: false });
const typed = (s) => s.chosen.map((c) => c.text).join('');
const fresh = (s) => !!s.cands && s.cands.input === s.buffer && !s.cands.loading;
const items = (s) => (fresh(s) ? s.cands.items || [] : []);
// What Enter writes: the pinyin with marks (the top candidate's reading when it covers the
// whole input, else the digits turned into marks), or the letters as typed.
function marked(s) {
  const top = items(s)[0];
  if (s.mode === 'hanzi' && top && top.consumed >= s.buffer.length && top.pinyin && !/\d/.test(s.buffer)) return top.pinyin.replace(/\s+/g, '');
  return numbersToMarks(s.buffer);
}
function enterText(s, k) {
  if (k.shift) return typed(s) + s.buffer;
  const how = s.mode === 'pinyin' ? 'marks' : s.opts.enter === 'auto' ? (hasMarkedPinyin(k.lineBefore || '') ? 'marks' : 'letters') : s.opts.enter;
  return typed(s) + (how === 'marks' ? marked(s) : s.buffer);
}

// Choosing candidate `i` (index in the whole list): all of the input → commit; part of it →
// kept with the rest still to choose (Backspace undoes it).
function choose(s, i) {
  const item = items(s)[i];
  if (!item) return { state: s, handled: true };
  const learn = { input: s.buffer.slice(0, item.consumed ?? s.buffer.length), item };
  const used = Math.max(1, item.consumed ?? s.buffer.length);
  // Several choices for one input (小 + 明): learnt as one word too (learnSeq).
  if (used >= s.buffer.length) return { state: clear(s), handled: true, commit: typed(s) + item.text, learn, ...(s.chosen.length ? { learnSeq: [...s.chosen.map((c) => c.item), item] } : {}) };
  const buffer = s.buffer.slice(used);
  return { state: { ...s, buffer, chosen: [...s.chosen, { text: item.text, input: s.buffer.slice(0, used), item }], cands: null, page: 0, sel: s.mode === 'hanzi' ? 0 : -1, justChose: true }, handled: true, query: buffer, learn };
}
function move(s, delta) {
  const n = items(s).length;
  if (!n) return { state: s, handled: true };
  const sel = Math.max(0, Math.min(n - 1, (s.sel < 0 ? (delta > 0 ? -1 : 0) : s.sel) + delta));
  return { state: { ...s, sel, page: Math.floor(sel / s.opts.perPage) }, handled: true };
}
function page(s, delta) {
  const n = items(s).length, per = s.opts.perPage;
  const last = Math.max(0, Math.ceil(n / per) - 1);
  const p = Math.max(0, Math.min(last, s.page + delta));
  return { state: { ...s, page: p, sel: s.sel < 0 && s.mode === 'pinyin' ? -1 : p * per }, handled: true };
}

// state: from imeInitial; k: {key, shift, ctrl, alt, meta, composing, lineBefore} for a key, or
// {type: 'cands', input, items, loading}, {type: 'composition', active}, {type: 'latin'}, {type: 'mode', mode}.
// → {state, handled (the key is ours: preventDefault), commit (text to insert), pass (insert, then let the key through),
//    query (ask for candidates of this input), learn ({input, item}), wait (run this key again when candidates arrive)}.
export function imeReduce(state, k) {
  const s = { ...imeInitial(), ...state };
  if (k.type === 'cands') {
    if (k.input !== s.buffer) return { state: s };
    return { state: { ...s, cands: { input: k.input, items: k.items || [], loading: !!k.loading, reading: k.reading || '' }, page: 0, sel: s.mode === 'hanzi' ? 0 : -1 } };
  }
  if (k.type === 'composition') return { state: { ...clear(s), composing: !!k.active, spaceHeld: false, chord: false } };
  // Hanzi mode, pinyin typed: Space chooses when released, and a digit pressed while it is held
  // chooses candidate n of the page (Space+2, then Space+1… within one hold).
  if (k.type === 'spaceDown') {
    if (s.mode !== 'hanzi' || s.latin || s.composing || (!s.buffer && !s.chosen.length)) return { state: s.spaceHeld ? { ...s, spaceHeld: false, chord: false } : s };
    if (s.spaceHeld) return { state: s, handled: true }; // key repeat: nothing twice
    return { state: { ...s, spaceHeld: true, chord: false }, handled: true };
  }
  if (k.type === 'spaceUp') {
    if (!s.spaceHeld) return { state: s };
    if (s.chord || (!s.buffer && !s.chosen.length)) return { state: { ...s, spaceHeld: false, chord: false }, handled: true };
    if (!fresh(s) && s.buffer) return { state: { ...s, spaceHeld: false, chord: false }, handled: true, wait: true };
    const out = imeReduce({ ...s, spaceHeld: false }, { key: ' ' });
    return { ...out, state: { ...out.state, spaceHeld: false, chord: false }, handled: true };
  }
  if (k.type === 'spaceCancel') return { state: { ...s, spaceHeld: false, chord: false } };
  if (k.type === 'digit') return imeReduce(s, { key: String(k.d) });
  if (k.type === 'mode') {
    const pending = typed(s) + s.buffer;
    return { state: { ...clear({ ...s, mode: k.mode }), latin: false }, commit: pending || undefined };
  }
  if (k.type === 'latin') {
    if (s.mode === 'off') return { state: s };
    const pending = typed(s) + s.buffer;
    return { state: { ...clear(s), latin: !s.latin }, commit: pending || undefined };
  }
  const key = k.key;
  if (s.mode === 'off' || s.latin || s.composing || k.composing || !key) return { state: s };
  // Rolled keys (the next letter pressed before Space is released): Space's choice first.
  if (s.spaceHeld && !s.chord && !/^[0-9]$/.test(key) && !MODS.includes(key)) {
    if (!fresh(s) && s.buffer) return { state: s, handled: true, wait: true };
    const first = imeReduce({ ...s, spaceHeld: false }, { key: ' ' });
    const next = imeReduce({ ...first.state, spaceHeld: true, chord: true }, k);
    return { ...next, commit: (first.commit || '') + (next.commit || '') || undefined, learn: first.learn || next.learn, learnSeq: first.learnSeq || next.learnSeq, query: next.query ?? first.query };
  }
  const empty = !s.buffer && !s.chosen.length;
  // Shortcuts keep working; what was being typed is written first (Ctrl+Enter finishes a text box with it).
  if (k.ctrl || k.alt || k.meta) return empty ? { state: s } : { state: clear(s), commit: enterText(s, { lineBefore: k.lineBefore }) };
  if (/^[a-zA-Z]$/.test(key)) {
    // Hanzi mode: a capital starting a word is Latin (names, acronyms), as phone IMEs do.
    if (empty && s.mode === 'hanzi' && /[A-Z]/.test(key)) return { state: s };
    const buffer = s.buffer + key;
    return { state: { ...s, buffer, justChose: false }, handled: true, query: buffer };
  }
  if (empty) {
    if (s.spaceHeld && /^[0-9]$/.test(key)) return { state: s, handled: true };
    if (s.mode === 'hanzi' && s.opts.fullWidth && FULL[key] && !k.shiftDigit) return { state: s, handled: true, commit: FULL[key] };
    return { state: s };
  }
  if (key === "'") {
    if (!s.buffer || s.buffer.endsWith("'")) return { state: s, handled: true };
    const buffer = s.buffer + key;
    return { state: { ...s, buffer, justChose: false }, handled: true, query: buffer };
  }
  if (/^[0-9]$/.test(key)) {
    const d = +key, afterLetter = /[a-zü]$/i.test(s.buffer);
    if (!s.buffer) return { state: clear(s), handled: true, commit: typed(s) + key };
    if (s.spaceHeld && d >= 1) {
      if (!fresh(s)) return { state: s, handled: true, wait: true };
      const out = choose(s, s.page * s.opts.perPage + d - 1);
      return { ...out, state: { ...out.state, spaceHeld: true, chord: true } };
    }
    if (s.mode === 'pinyin') {
      if (afterLetter && d <= 5) return { state: clear(s), handled: true, commit: typed(s) + numbersToMarks(s.buffer + key) };
      if (d >= 1 && s.cands) return fresh(s) ? choose(s, s.page * s.opts.perPage + d - 1) : { state: s, handled: true, wait: true };
      return { state: clear(s), handled: true, commit: typed(s) + s.buffer + key };
    }
    // Once the list was paged or a candidate highlighted, digits choose.
    if (afterLetter && d <= 5 && s.opts.digits === 'tone' && s.page === 0 && s.sel <= 0) {
      const buffer = s.buffer + key;
      return { state: { ...s, buffer, justChose: false }, handled: true, query: buffer };
    }
    if (d === 0) return { state: s, handled: true };
    if (!fresh(s)) return { state: s, handled: true, wait: true };
    return choose(s, s.page * s.opts.perPage + d - 1);
  }
  if (key === ' ') {
    if (s.mode === 'pinyin') {
      if (s.sel >= 0 && fresh(s) && items(s).length) return choose(s, s.sel);
      return { state: clear(s), pass: true, commit: typed(s) + numbersToMarks(s.buffer) };
    }
    if (!fresh(s) && s.buffer) return { state: s, handled: true, wait: true };
    if (!items(s).length) return { state: clear(s), handled: true, commit: typed(s) + s.buffer };
    return choose(s, Math.max(0, s.sel));
  }
  if (key === 'Enter') return { state: clear(s), handled: true, commit: enterText(s, k) };
  if (key === 'Escape') return { state: clear(s), handled: true };
  if (key === 'Backspace') {
    if ((s.justChose || !s.buffer) && s.chosen.length) {
      const last = s.chosen.at(-1), buffer = last.input + s.buffer;
      return { state: { ...s, chosen: s.chosen.slice(0, -1), buffer, cands: null, justChose: false }, handled: true, query: buffer };
    }
    const buffer = s.buffer.slice(0, -1);
    if (!buffer && !s.chosen.length) return { state: clear(s), handled: true };
    return { state: { ...s, buffer, justChose: false, cands: buffer ? s.cands : null }, handled: true, query: buffer || undefined };
  }
  if (key === 'ArrowRight' || key === 'ArrowDown' || (key === 'Tab' && !k.shift)) return move(s, 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp' || (key === 'Tab' && k.shift)) return move(s, -1);
  if (key in PAGE_KEYS) return page(s, PAGE_KEYS[key]);
  if (key.length === 1) {
    // Other punctuation: Hanzi mode writes the highlighted candidate then the mark; Pinyin mode the pinyin.
    if (s.mode === 'hanzi') {
      if (!fresh(s) && s.buffer) return { state: s, handled: true, wait: true };
      const c = items(s)[Math.max(0, s.sel)];
      const mark = s.opts.fullWidth && FULL[key] ? FULL[key] : key;
      if (!c || c.consumed < s.buffer.length) return { state: clear(s), handled: true, commit: typed(s) + (c ? '' : s.buffer) + (c ? c.text + numbersToMarks(s.buffer.slice(c.consumed)) : '') + mark };
      return { state: clear(s), handled: true, commit: typed(s) + c.text + mark, learn: { input: s.buffer, item: c } };
    }
    return { state: clear(s), pass: true, commit: typed(s) + numbersToMarks(s.buffer) };
  }
  if (MODS.includes(key)) return { state: s };
  // Home, End, Delete…: the caret must not move under a composition.
  return { state: s, handled: true };
}

// ---- The controller (DOM) ----

let menuModule = null;
const menu = () => (menuModule ||= import('./ime-menu.js'));
let clientPromise = null;
// The dictionary (client.js, docs §15): null while it is not there; Pinyin mode needs none.
export function zhClient() {
  return (clientPromise ||= import('./client.js').then((m) => m.chinese()).catch(() => null));
}

// opts: {kind, getMode, setMode, insert(text) (contenteditable editors with their own API), button}.
export function attachIme(el, { kind = 'textarea', getMode = () => 'off', setMode = () => {}, insert = null, onMode = null } = {}) {
  if (el.__zhIme) return el.__zhIme;
  let st = imeInitial(getMode(), zhSettings());
  let pending = null, shiftAlone = false, identified = false, rafId = 0, seq = 0;
  const doc = el.ownerDocument;

  const sync = () => { st = { ...st, opts: { ...st.opts, ...zhSettings() } }; };
  const busy = () => !!(st.buffer || st.chosen.length);

  // quiet: the field has lost the focus (blur, detach): written without taking it back.
  function write(text, quiet = false) {
    if (!text) return;
    if (insert) return insert(text);
    if (!quiet) el.focus({ preventScroll: true });
    if (quiet || !doc.execCommand?.('insertText', false, text)) {
      if ('selectionStart' in el) {
        el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    }
  }

  async function query(input, retry = 0) {
    const id = ++seq;
    if (st.mode === 'pinyin' && /\d/.test(input)) return;
    const zh = await zhClient();
    if (id !== seq || input !== st.buffer) return;
    if (!zh) { apply({ type: 'cands', input, items: [] }); return; }
    // Still loading: the reading now, the candidates when the dictionary answers.
    const loadingTimer = setTimeout(() => { if (id === seq && input === st.buffer && !st.cands) { st = { ...st, cands: { input, items: [], loading: true } }; paint(); } }, 60);
    let res;
    try { res = await zh.candidates(input, { script: st.opts.script, limit: 60 }); } catch { res = { items: [] }; }
    clearTimeout(loadingTimer);
    if (id !== seq || input !== st.buffer) return;
    // null: another caller superseded the worker query; retry once if this buffer is still active.
    if (res === null) {
      if (retry < 1) { Promise.resolve().then(() => { if (id === seq && input === st.buffer) query(input, retry + 1); }); return; }
      res = { items: [] };
    }
    let list = res?.items || [];
    if (st.mode === 'pinyin') {
      // Pinyin mode: the readings of words for these letters (nǐhǎo, níhǎo…).
      const seen = new Set();
      list = list.filter((it) => it.consumed >= input.length && it.pinyin).map((it) => ({ ...it, text: it.pinyin.replace(/\s+/g, ''), hanzi: it.text }))
        .filter((it) => !seen.has(it.text) && seen.add(it.text));
    }
    apply({ type: 'cands', input, items: list, reading: res?.reading || '' });
  }

  function apply(k) {
    sync();
    const out = k.type === 'pick' ? choose(st, k.index) : imeReduce(st, k);
    st = out.state;
    if (out.commit) write(out.commit);
    if (out.learn && !out.learn.item.hanzi) {
      const { script } = st.opts;
      zhClient().then((zh) => { zh?.choose?.(out.learn.input, out.learn.item, script); if (out.learnSeq) zh?.chooseSequence?.(out.learnSeq, script); }).catch(() => {});
    }
    if (out.query) query(out.query);
    if (out.wait) pending = k.type === 'spaceUp' ? { key: ' ' } : k;
    else if (k.type !== 'cands') pending = null;
    else if (pending && fresh(st)) { const again = pending; pending = null; apply(again); return out; }
    paint();
    return out;
  }

  function paint() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(async () => {
      const m = await menu();
      if (!busy() || st.mode === 'off') { m.hideImeMenu(el); return; }
      const all = fresh(st) ? st.cands.items : [];
      const per = st.opts.perPage;
      m.showImeMenu(el, {
        reading: st.chosen.map((c) => c.text).join('') + ' ' + (st.mode === 'hanzi' && fresh(st) && st.cands.reading && !/\d/.test(st.buffer) ? st.cands.reading : readingOf(st.buffer)),
        chosen: st.chosen.map((c) => c.text).join(''),
        buffer: st.buffer,
        items: all.slice(st.page * per, st.page * per + per),
        offset: st.page * per,
        sel: st.sel,
        page: st.page, pages: Math.max(1, Math.ceil(all.length / per)),
        loading: !!st.cands?.loading || (st.mode === 'hanzi' && !fresh(st) && !!st.buffer),
        mode: st.mode, script: st.opts.script, toneColours: st.opts.toneColours, bothScripts: st.opts.bothScripts,
        onChoose: (i) => apply({ type: 'pick', index: i }),
        onPage: (d) => { st = page(st, d).state; paint(); },
        onScript: () => { zhSettings({ script: st.opts.script === 'simplified' ? 'traditional' : 'simplified' }); sync(); if (st.buffer) query(st.buffer); },
      });
    });
  }

  function setModeTo(mode) {
    apply({ type: 'mode', mode });
    setMode(mode);
    if (mode !== 'off') zhUsedNow();
    onMode?.(mode);
    syncButtons();
  }
  const keyOf = (e) => ({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, composing: e.isComposing || e.keyCode === 229, lineBefore: lineBeforeOf() });
  let lineBeforeOf = () => '';
  import('./caret.js').then((c) => { lineBeforeOf = () => c.lineBefore(el); });

  function onKeyDown(e) {
    // A key the keyboard named: its beforeinput (if any) is not ours to read again.
    identified = e.key !== 'Unidentified' && e.keyCode !== 229;
    if (identified) setTimeout(() => { identified = false; }, 0);
    if (e.key !== 'Shift') shiftAlone = false;
    else if (!e.repeat) shiftAlone = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (e.isComposing || e.keyCode === 229) return;
    // Ctrl+Shift+Space: Off → Hanzi → Pinyin → Off.
    if (e.code === 'Space' && e.ctrlKey && e.shiftKey && !e.altKey && zhSettings().shortcut) {
      e.preventDefault(); e.stopImmediatePropagation();
      setModeTo(nextMode(st.mode));
      return;
    }
    // Space in Hanzi mode with pinyin typed: held (it chooses when released; Space+digit picks).
    if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && (st.spaceHeld || (st.mode === 'hanzi' && busy()))) {
      const out = apply({ type: 'spaceDown', repeat: e.repeat });
      if (out.handled) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
    const k = keyOf(e);
    const out = apply(k);
    if (out.handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  function onKeyUp(e) {
    if ((e.key === ' ' || e.code === 'Space') && st.spaceHeld) { const out = apply({ type: 'spaceUp' }); if (out.handled) { e.preventDefault(); e.stopImmediatePropagation(); } return; }
    if (e.key === 'Shift' && shiftAlone && st.mode !== 'off' && zhSettings().shiftLatin) { shiftAlone = false; apply({ type: 'latin' }); syncButtons(); }
    shiftAlone = false;
  }
  // Android and other on-screen keyboards without key codes: letters come as beforeinput.
  function onBeforeInput(e) {
    if (st.mode === 'off' || st.latin || st.composing || e.isComposing) return;
    if (identified) return;
    let key = null;
    if (e.inputType === 'insertText' && e.data && [...e.data].length === 1) key = e.data;
    else if (e.inputType === 'deleteContentBackward' && busy()) key = 'Backspace';
    else if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && busy()) key = 'Enter';
    if (!key) return;
    const out = apply({ key, lineBefore: lineBeforeOf() });
    // pass: the committed text is in, the key's own character follows.
    if (out.handled) e.preventDefault();
  }
  let hinted = false;
  function onCompositionStart() {
    apply({ type: 'composition', active: true });
    if (st.mode !== 'off' && !hinted && matchMedia?.('(pointer: coarse)').matches) {
      hinted = true;
      import('./ime-menu.js').then((m) => m.imeHint(el, 'Your keyboard is typing Chinese itself; NoteComplete’s Chinese mode works with its own keys only.'));
    }
  }
  const onCompositionEnd = () => apply({ type: 'composition', active: false });
  const onBlur = () => setTimeout(() => {
    if (st.spaceHeld) st = imeReduce(st, { type: 'spaceCancel' }).state;
    if (doc.activeElement === el) return;
    // Leaving the field: what was being typed stays, as letters (as system IMEs do).
    if (busy()) { const text = typed(st) + st.buffer; st = clear(st); write(text, true); }
    paint();
  }, 0);
  // A press in the field moves the caret: what was being typed is written first, as letters.
  const onPointerDown = () => { if (busy()) { const text = typed(st) + st.buffer; st = clear(st); write(text); paint(); } };
  const onSettings = () => { sync(); paint(); };
  const onWindowBlur = () => { if (st.spaceHeld) st = imeReduce(st, { type: 'spaceCancel' }).state; shiftAlone = false; };

  el.addEventListener?.('keydown', onKeyDown, true);
  el.addEventListener?.('keyup', onKeyUp, true);
  el.addEventListener?.('beforeinput', onBeforeInput, true);
  el.addEventListener?.('compositionstart', onCompositionStart);
  el.addEventListener?.('compositionend', onCompositionEnd);
  el.addEventListener?.('blur', onBlur);
  el.addEventListener?.('pointerdown', onPointerDown);
  globalThis.addEventListener?.('zh-settings', onSettings);
  globalThis.addEventListener?.('blur', onWindowBlur);
  const buttons = new Set();
  function syncButtons() {
    for (const b of buttons) paintButton(b, st.mode, st.latin);
  }
  const api = {
    el, kind,
    get mode() { return st.mode; },
    get busy() { return busy(); },
    get latin() { return st.latin; },
    setMode: setModeTo,
    cycle: () => setModeTo(nextMode(st.mode)),
    refresh() { const m = getMode(); if (m !== st.mode) { st = { ...clear(st), mode: m }; } syncButtons(); },
    addButton(b) { buttons.add(b); paintButton(b, st.mode, st.latin); },
    detach() {
      if (busy()) { const text = typed(st) + st.buffer; st = clear(st); write(text, true); }
      el.removeEventListener?.('keydown', onKeyDown, true);
      el.removeEventListener?.('keyup', onKeyUp, true);
      el.removeEventListener?.('beforeinput', onBeforeInput, true);
      el.removeEventListener?.('compositionstart', onCompositionStart);
      el.removeEventListener?.('compositionend', onCompositionEnd);
      el.removeEventListener?.('blur', onBlur);
      el.removeEventListener?.('pointerdown', onPointerDown);
      globalThis.removeEventListener?.('zh-settings', onSettings);
      globalThis.removeEventListener?.('blur', onWindowBlur);
      menu().then((m) => m.hideImeMenu(el));
      delete el.__zhIme;
    },
  };
  el.__zhIme = api;
  return api;
}

const LABEL = { off: '中', hanzi: '中', pinyin: 'ā' };
function paintButton(b, mode, latin) {
  b.textContent = latin ? 'A' : LABEL[mode] || '中';
  b.setAttribute('aria-pressed', String(mode !== 'off'));
  b.dataset.zhMode = latin ? 'latin' : mode;
  const name = mode === 'off' ? 'off' : mode === 'hanzi' ? (latin ? 'Hanzi, Latin letters for now (Shift)' : 'Hanzi') : latin ? 'Pinyin, Latin letters for now (Shift)' : 'Pinyin with tone marks';
  b.title = `Chinese input: ${name}. Click: ${nextModeName(mode)} (Ctrl+Shift+Space). Right-click or long press: more`;
  b.setAttribute('aria-label', `Chinese input: ${name}`);
}
const nextModeName = (m) => ({ off: 'Hanzi', hanzi: 'Pinyin', pinyin: 'off' })[m];

// The 中 button: click cycles; right-click / long press opens the mode menu.
// `field()`: the element whose IME it drives (the text box changes; the bar stays).
export function zhButton(field, { small = false, doc = document } = {}) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = small ? 'zh-toggle zh-toggle-small' : 'zh-toggle';
  b.addEventListener('pointerdown', (e) => e.preventDefault()); // the field keeps the focus
  let pressTimer = 0, long = false;
  b.addEventListener('pointerdown', (e) => {
    long = false;
    if (e.pointerType === 'mouse') return;
    pressTimer = setTimeout(() => { long = true; modeMenu(b, field()); }, 500);
  });
  b.addEventListener('pointerup', () => clearTimeout(pressTimer));
  b.addEventListener('pointerleave', () => clearTimeout(pressTimer));
  b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (long) { long = false; return; }
    field()?.__zhIme?.cycle();
    field()?.focus({ preventScroll: true });
  });
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); modeMenu(b, field()); });
  return b;
}

async function modeMenu(b, el) {
  const ime = el?.__zhIme;
  if (!ime) return;
  const { openContextMenu } = await import('../context-menu.js');
  const s = zhSettings();
  const r = b.getBoundingClientRect();
  const back = () => el.isConnected && el.focus({ preventScroll: true });
  openContextMenu(r.left, r.bottom + 4, [
    { label: 'Off', icon: 'close', checked: ime.mode === 'off', run: () => ime.setMode('off') },
    { label: 'Hanzi (characters)', icon: 'text', checked: ime.mode === 'hanzi', run: () => ime.setMode('hanzi') },
    { label: 'Pinyin with tone marks', icon: 'text', checked: ime.mode === 'pinyin', run: () => ime.setMode('pinyin') },
    '-',
    { label: 'Simplified 简体', checked: s.script === 'simplified', run: () => zhSettings({ script: 'simplified' }) },
    { label: 'Traditional 繁體', checked: s.script === 'traditional', run: () => zhSettings({ script: 'traditional' }) },
    '-',
    { label: 'Chinese settings…', icon: 'settings', run: () => openSettings() },
  ], { title: 'Chinese input', onClose: () => setTimeout(back, 0) });
}

export function openSettings() {
  import('./settings.js').then((m) => m.openZhSettings({ client: zhClient }));
}

// Ask AI, card editors, quiz check, Find: the IME with a mode remembered per field
// ("notecomplete-zh-mode-<name>"), and a small 中 at the field's right edge once Chinese mode
// was ever turned on (so nobody else sees anything).
export function chineseField(el, name = el.id || el.getAttribute('aria-label') || 'field') {
  if (!el || el.__zhIme) return el?.__zhIme || null;
  const ime = attachIme(el, {
    kind: el.isContentEditable ? 'contenteditable' : el.nodeName === 'INPUT' ? 'input' : 'textarea',
    getMode: () => fieldMode(name),
    setMode: (m) => { setFieldMode(name, m); showSmallButtons(); },
  });
  fields.add(el);
  showSmallButtons();
  return ime;
}
const fields = new Set();
function showSmallButtons() {
  if (!zhEverUsed()) return;
  for (const el of fields) {
    if (!el.isConnected || el.__zhButton) continue;
    const b = zhButton(() => el, { small: true, doc: el.ownerDocument });
    el.__zhButton = b;
    el.insertAdjacentElement('afterend', b);
    el.parentElement?.classList.add('zh-host');
    el.__zhIme.addButton(b);
    // At the field's own top-right corner (its parent may hold other buttons).
    const place = () => { b.style.left = `${el.offsetLeft + el.offsetWidth - 26}px`; b.style.top = `${el.offsetTop + 4}px`; b.style.right = 'auto'; };
    place();
    el.addEventListener('focus', place);
    el.addEventListener('input', place);
    globalThis.ResizeObserver && new ResizeObserver(place).observe(el);
  }
}
globalThis.addEventListener?.('zh-mode-used', showSmallButtons);
export const zhUsedNow = () => { try { localStorage.setItem('notecomplete-zh-used', '1'); } catch { /* Not kept. */ } showSmallButtons(); };

// Is the candidate menu up (number keys pick candidates, not tools)?
export const imeMenuOpen = (doc = document) => !!doc.querySelector('.zh-ime:not([hidden])');
