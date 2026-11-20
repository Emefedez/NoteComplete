// The candidate menu (docs/CHINESE-INPUT.md §5.3): one per document, at the caret, or docked
// above the on-screen keyboard on phones. Focus never moves into it.
import { caretRect, placeMenu, viewportBox, dockOffset } from './caret.js';
import { marksToNumbers } from './pinyin.js';

let el = null, owner = null, view = null, pressedAt = 0, raf = 0, expanded = false;
// When the menu was last pressed (the text box's blur → commit ignores that press).
export const imeMenuPressedAt = () => pressedAt;

function build(doc) {
  const m = doc.createElement('div');
  m.className = 'zh-ime';
  m.id = 'zhIme';
  m.hidden = true;
  m.setAttribute('role', 'listbox');
  m.setAttribute('aria-label', 'Chinese candidates');
  m.innerHTML = '<div class="zh-ime-reading" aria-live="polite"></div><ol class="zh-ime-list"></ol>'
    + '<div class="zh-ime-foot"><span class="zh-ime-keys" title="Hold Space and press a number to choose that candidate; Space alone writes the highlighted one">Space+1–9 picks</span><button type="button" class="zh-ime-page" data-page="-1" aria-label="Previous candidates">‹</button><span class="zh-ime-pages"></span>'
    + '<button type="button" class="zh-ime-page" data-page="1" aria-label="More candidates">›</button>'
    + '<button type="button" class="zh-ime-expand" aria-label="Show more candidates" title="More candidates">▾</button>'
    + '<button type="button" class="zh-ime-script" title="Simplified / traditional"></button></div>';
  // Presses keep the focus in the field (and the text box open); a release on a candidate chooses it.
  m.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pressedAt = Date.now(); m.__down = { x: e.clientX, y: e.clientY }; });
  m.addEventListener('pointerup', (e) => {
    pressedAt = Date.now();
    const d = m.__down; m.__down = null;
    if (!view) return;
    // A horizontal swipe on the list pages it.
    if (d && Math.abs(e.clientX - d.x) > 40 && Math.abs(e.clientX - d.x) > Math.abs(e.clientY - d.y) * 1.5 && !m.classList.contains('zh-ime-docked')) { view.onPage(e.clientX < d.x ? 1 : -1); return; }
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    const li = e.target.closest('li[data-i]');
    if (li) return view.onChoose(Number(li.dataset.i));
    const page = e.target.closest('[data-page]');
    if (page && !page.disabled) return view.onPage(Number(page.dataset.page));
    if (e.target.closest('.zh-ime-script')) return view.onScript();
    if (e.target.closest('.zh-ime-expand')) { expanded = !expanded; render(); }
  });
  m.addEventListener('click', (e) => e.preventDefault());
  m.addEventListener('contextmenu', (e) => e.preventDefault());
  // Pen and mouse hover highlight (the keyboard highlight stays the chosen one).
  return m;
}

export function showImeMenu(field, v) {
  const doc = field.ownerDocument;
  if (!el || el.ownerDocument !== doc) el = build(doc);
  // Inside an open modal dialog when the field is in one (the rest is under the top layer).
  const host = field.closest('dialog[open]') || doc.body;
  if (el.parentElement !== host) host.append(el);
  if (owner !== field) { owner?.removeAttribute('aria-activedescendant'); owner = field; expanded = false; }
  view = v;
  field.setAttribute('aria-controls', 'zhIme');
  render();
  el.hidden = false;
  position();
  listen(true);
}

export function hideImeMenu(field) {
  if (!el || (field && owner !== field)) return;
  el.hidden = true;
  owner?.removeAttribute('aria-activedescendant');
  owner = view = null;
  listen(false);
}

const TONE = (syl) => { const m = /([1-4])$/.exec(marksToNumbers(syl)); return m ? m[1] : '5'; };

function rubyText(pinyin, colours) {
  const rt = document.createElement('rt');
  for (const [i, syl] of pinyin.split(/\s+/).entries()) {
    if (i) rt.append(' ');
    const s = document.createElement('span');
    s.textContent = syl;
    if (colours) s.className = `zh-t${TONE(syl)}`;
    rt.append(s);
  }
  return rt;
}

function render() {
  const v = view;
  if (!v) return;
  const reading = el.querySelector('.zh-ime-reading');
  reading.replaceChildren();
  if (v.chosen) reading.append(Object.assign(document.createElement('span'), { className: 'zh-ime-chosen', textContent: v.chosen }));
  reading.append(Object.assign(document.createElement('span'), { textContent: v.reading.slice(v.chosen.length).trim() }));
  if (v.loading) reading.append(Object.assign(document.createElement('span'), { className: 'zh-ime-loading', textContent: 'Loading dictionary…' }));
  const list = el.querySelector('.zh-ime-list');
  list.replaceChildren();
  v.items.forEach((item, k) => {
    const i = v.offset + k;
    const li = document.createElement('li');
    li.id = `zh-c-${k}`;
    li.dataset.i = String(i);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === v.sel));
    const n = Object.assign(document.createElement('span'), { className: 'n', textContent: String(k + 1) });
    li.append(n);
    if (v.mode === 'pinyin') {
      li.append(Object.assign(document.createElement('span'), { className: 'zh-ime-py', textContent: item.text }));
      if (item.hanzi) li.append(Object.assign(document.createElement('small'), { className: 'zh-ime-alt', textContent: item.hanzi }));
    } else {
      const ruby = document.createElement('ruby');
      ruby.className = 'zh-ime-han';
      ruby.append(item.text);
      if (item.pinyin) ruby.append(rubyText(item.pinyin, v.toneColours));
      li.append(ruby);
      const other = v.script === 'traditional' ? item.simp : item.trad;
      if (v.bothScripts && other && other !== item.text) li.append(Object.assign(document.createElement('small'), { className: 'zh-ime-alt', textContent: other }));
    }
    if (item.level > 0) li.append(Object.assign(document.createElement('small'), { className: 'zh-ime-level', textContent: item.level >= 7 ? 'HSK 7–9' : `HSK ${item.level}`, title: `HSK level ${item.level >= 7 ? '7–9' : item.level}` }));
    if (item.fuzzy) li.append(Object.assign(document.createElement('small'), { className: 'zh-ime-level', textContent: '≈', title: 'Similar word suggestion' }));
    if (item.sentence) li.classList.add('zh-ime-sentence');
    if (item.gloss) li.title = item.gloss;
    list.append(li);
  });
  if (!v.items.length && !v.loading && v.mode === 'hanzi') list.append(Object.assign(document.createElement('li'), { className: 'zh-ime-none', textContent: 'No characters for this; Space or Enter writes the letters' }));
  const prev = el.querySelector('[data-page="-1"]'), next = el.querySelector('[data-page="1"]');
  prev.disabled = v.page <= 0;
  next.disabled = v.page >= v.pages - 1;
  el.querySelector('.zh-ime-pages').textContent = v.pages > 1 ? `${v.page + 1}/${v.pages}` : '';
  el.querySelector('.zh-ime-foot').hidden = v.pages <= 1 && v.mode !== 'hanzi';
  el.querySelector('.zh-ime-keys').hidden = v.mode !== 'hanzi' || !v.items.length;
  const script = el.querySelector('.zh-ime-script');
  script.textContent = v.script === 'traditional' ? '繁' : '简';
  script.hidden = v.mode !== 'hanzi';
  el.classList.toggle('zh-ime-expanded', expanded);
  const k = v.sel - v.offset;
  if (k >= 0 && k < v.items.length) owner?.setAttribute('aria-activedescendant', `zh-c-${k}`);
  else owner?.removeAttribute('aria-activedescendant');
  el.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

// Phones (the 700 px media query app.js uses), or a touch screen with its keyboard up: docked.
function docked(win) {
  const v = viewportBox(win);
  if (win.matchMedia('(max-width: 700px)').matches) return true;
  return win.matchMedia('(pointer: coarse)').matches && win.innerHeight - v.height > 120;
}

function position() {
  if (!el || el.hidden || !owner) return;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const zRaw = parseFloat(doc.documentElement.style.zoom);
  const z = Number.isFinite(zRaw) && zRaw > 0 ? zRaw : 1;
  const dock = docked(win);
  el.classList.toggle('zh-ime-docked', dock);
  const vpRaw = viewportBox(win);
  const vp = { left: vpRaw.left / z, top: vpRaw.top / z, width: vpRaw.width / z, height: vpRaw.height / z };
  if (dock) {
    Object.assign(el.style, { left: '0px', top: '', bottom: `${dockOffset(win.innerHeight / z, vp)}px` });
    return;
  }
  const cRaw = caretRect(owner);
  const caret = { left: cRaw.left / z, right: cRaw.right / z, top: cRaw.top / z, bottom: cRaw.bottom / z };
  const keypad = doc.querySelector('.math-keypad:not([hidden])');
  const kTop = keypad ? keypad.getBoundingClientRect().top / z : null;
  el.style.bottom = '';
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  const r = placeMenu(caret, size, vp, kTop);
  let top = r.top;
  // Avoid overlapping the floating text-format bar (font/size/colour controls) when space permits.
  const fmt = doc.querySelector('.text-format:not([hidden])');
  if (fmt) {
    const fr = fmt.getBoundingClientRect();
    if (fr.width > 0 && fr.height > 0) {
      const fTop = fr.top / z, fBot = fr.bottom / z, fLeft = fr.left / z, fRight = fr.right / z;
      const horizOverlap = r.left < fRight && (r.left + size.width) > fLeft;
      const vertOverlap = top < fBot && (top + size.height) > fTop;
      if (horizOverlap && vertOverlap) {
        const bottomLimit = Math.min(vp.top + vp.height, kTop ?? Infinity) - 8;
        const belowFmt = fBot + 6;
        const aboveFmt = fTop - size.height - 6;
        if (belowFmt + size.height <= bottomLimit && belowFmt >= caret.bottom) top = belowFmt;
        else if (aboveFmt >= vp.top + 8) top = aboveFmt;
        else if (belowFmt + size.height <= bottomLimit) top = belowFmt;
      }
    }
  }
  el.style.left = `${r.left}px`;
  el.style.top = `${top}px`;
  el.classList.toggle('zh-ime-above', top < caret.top);
}
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(position); };
let listening = false;
function listen(on) {
  if (on === listening) return;
  listening = on;
  const win = (el?.ownerDocument || document).defaultView;
  const f = on ? 'addEventListener' : 'removeEventListener';
  win[f]('scroll', schedule, true);
  win[f]('resize', schedule);
  win.visualViewport?.[f]('resize', schedule);
  win.visualViewport?.[f]('scroll', schedule);
  win.document[f]('input', schedule, true);
}

// A one-time note next to the field (the on-screen keyboard is composing Chinese itself).
export function imeHint(field, text) {
  const doc = field.ownerDocument;
  const h = doc.createElement('div');
  h.className = 'zh-ime-hint';
  h.setAttribute('role', 'status');
  h.textContent = text;
  doc.body.append(h);
  const r = field.getBoundingClientRect();
  Object.assign(h.style, { left: `${Math.max(8, r.left)}px`, top: `${Math.max(8, r.top - 44)}px` });
  setTimeout(() => h.remove(), 6000);
}
