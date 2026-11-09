// The math keypad (docs/SHAPES-TABLES-MATH.md, M3): shown under the page while a math text
// box is typed. Its keys put LaTeX into the box (a fraction, a power, a root…) with the
// cursor where the next thing goes; Tab (or →|) moves to the next empty {}. On touch screens
// it replaces the system keyboard (ABC brings that back), as Photomath's does; with a
// keyboard it is a palette. "Graph" draws the box's function (graph.js), or empty axes.
// No library: KaTeX (already used for the boxes) only draws the key labels.
import { loadKatex } from './rich-text.js';
import { icon } from './icons.js';
// Small: MathLive itself loads only when a formula is edited (math-field.js loadMathLive).
import { mathliveTemplate, MOVES } from './math-field.js';

// ‸ marks where the cursor goes; a selection is put there (selecting x and pressing √ gives √x).
const C = '‸';
export const KEY_TABS = [
  ['1 2 3', [
    ['7'], ['8'], ['9'], ['\\div', '\\div '], ['(', `(${C})`], [')'],
    ['4'], ['5'], ['6'], ['\\times', '\\cdot '], ['x'], ['y'],
    ['1'], ['2'], ['3'], ['-'], ['\\frac{a}{b}', `\\frac{${C}}{}`], ['x^2', `^{2}${C}`],
    ['0'], ['.'], ['='], ['+'], ['\\sqrt{x}', `\\sqrt{${C}}`], ['x^n', `^{${C}}`],
    ['<'], ['>'], ['\\le', '\\le '], ['\\ge', '\\ge '], ['\\ne', '\\ne '], ['\\pi', '\\pi '],
  ], 'Numbers and operations'],
  ['f(x)', [
    ['\\sin', `\\sin(${C})`], ['\\cos', `\\cos(${C})`], ['\\tan', `\\tan(${C})`], ['\\ln', `\\ln(${C})`], ['\\log', `\\log(${C})`], ['\\log_b', `\\log_{${C}}()`],
    ['\\sin^{-1}', `\\sin^{-1}(${C})`], ['\\cos^{-1}', `\\cos^{-1}(${C})`], ['\\tan^{-1}', `\\tan^{-1}(${C})`], ['e^x', `e^{${C}}`], ['|x|', `\\left|${C}\\right|`], ['\\sqrt[n]{x}', `\\sqrt[${C}]{}`],
    ['x_n', `_{${C}}`], ['f(x)', `f(${C})`], ['y=', 'y = '], ['\\pm', '\\pm '], ['\\infty', '\\infty '], ['\\%', '\\% '],
    ['\\{\\}', `\\{${C}\\}`], ['[\\,]', `[${C}]`], ['n!', '!'], ['\\binom{n}{k}', `\\binom{${C}}{}`], ['\\overline{x}', `\\overline{${C}}`], ['\\vec{v}', `\\vec{${C}}`],
  ], 'Functions'],
  ['\\alpha\\beta\\gamma', [
    ['\\alpha'], ['\\beta'], ['\\gamma'], ['\\delta'], ['\\varepsilon'], ['\\theta'],
    ['\\lambda'], ['\\mu'], ['\\rho'], ['\\sigma'], ['\\tau'], ['\\varphi'],
    ['\\omega'], ['\\Delta'], ['\\Sigma'], ['\\Omega'], ['\\Phi'], ['\\Pi'],
  ].map(([k]) => [k, `${k} `]), 'Greek letters'],
  ['\\int\\!\\sum', [
    ['\\int', `\\int ${C}\\,dx`], ['\\int_a^b', `\\int_{${C}}^{} \\,dx`], ['\\frac{d}{dx}', `\\frac{d}{dx}\\left(${C}\\right)`], ['\\partial', '\\partial '], ['\\lim', `\\lim_{x \\to ${C}}`], ['\\to', '\\to '],
    ['\\sum', `\\sum_{n=${C}}^{}`], ['\\prod', `\\prod_{n=${C}}^{}`], ['\\Rightarrow', '\\Rightarrow '], ['\\Leftrightarrow', '\\Leftrightarrow '], ['\\in', '\\in '], ['\\approx', '\\approx '],
    ['\\begin{smallmatrix}a&b\\\\c&d\\end{smallmatrix}', `\\begin{pmatrix} ${C} & \\\\  & \\end{pmatrix}`], ['\\begin{cases}\\end{cases}', `\\begin{cases} ${C} & \\text{if } \\\\  & \\text{otherwise} \\end{cases}`], ['\\text{abc}', `\\text{${C}}`], ['\\forall', '\\forall '], ['\\exists', '\\exists '], ['\\cdots', '\\cdots '],
  ], 'Calculus and logic'],
];

// The text after a key: `value` with the template put over the selection [start, end].
export function applyTemplate(value, start, end, template) {
  const selected = value.slice(start, end), at = template.indexOf(C);
  const body = at < 0 ? template + selected : template.slice(0, at) + selected + template.slice(at + 1);
  const cursor = start + (at < 0 ? body.length : at + selected.length);
  return { value: value.slice(0, start) + body + value.slice(end), cursor };
}
// The next empty {} (or [] of a root) after the cursor, or the end; `back` looks before it.
export function nextSlot(value, from, back = false) {
  const slots = [...value.matchAll(/\{\}|\[\]|\(\)/g)].map((m) => m.index + 1);
  const found = back ? slots.filter((i) => i < from).at(-1) : slots.find((i) => i > from);
  return found ?? (back ? 0 : value.length);
}

// `onLayout`: the keypad's height changed (keys drawn, a tab chosen), so what it covers did.
// The caret moved one step in LaTeX text: a command (\frac, \alpha) is one step.
export function caretStep(value, at, dir) {
  if (dir > 0) {
    if (at >= value.length) return value.length;
    const command = /^\\[a-zA-Z]+/.exec(value.slice(at));
    return at + (command ? command[0].length : 1);
  }
  if (at <= 0) return 0;
  const command = /\\[a-zA-Z]+$/.exec(value.slice(0, at));
  return at - (command ? command[0].length : 1);
}

// `onGraph(latex)`: the Graph key. `onLayout`: the keypad's height changed (keys drawn, a tab
// chosen), so what it covers did. It types into a text field (LaTeX as text) or into a
// MathLive field (math-field.js), whichever it is attached to.
export function mathKeypad({ onGraph, onLayout = () => {}, status = () => {} } = {}) {
  let area = null, el = null, tab = 0, typing = false, listener = null;
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const isField = () => area?.localName === 'math-field';
  // Synchronous, so a key typed right after a template lands inside it.
  const command = (name) => area?.executeCommand(MOVES[name]);
  function insert(template) {
    if (!area) return;
    if (isField()) {
      area.insert(mathliveTemplate(template), { selectionMode: 'placeholder', focus: true });
      return;
    }
    const { value, cursor } = applyTemplate(area.value, area.selectionStart, area.selectionEnd, template);
    area.value = value;
    area.setSelectionRange(cursor, cursor);
    area.dispatchEvent(new Event('input'));
  }
  // Arrows: through the structure in a math field; in text, by LaTeX steps (← →) and between
  // empty places (↑ ↓).
  function move(dir) {
    if (!area) return;
    if (isField()) return command(dir);
    const at = area.selectionStart;
    const to = dir === 'left' ? caretStep(area.value, at, -1) : dir === 'right' ? caretStep(area.value, at, 1) : nextSlot(area.value, at, dir === 'up');
    area.setSelectionRange(to, to);
  }
  function erase() {
    if (!area) return;
    if (isField()) return command('back');
    const s = area.selectionStart, e = area.selectionEnd;
    if (s === e && s === 0) return;
    area.setRangeText('', s === e ? caretStep(area.value, s, -1) : s, e, 'end');
    area.dispatchEvent(new Event('input'));
  }
  // A key press keeps the typing focus (and the box open) instead of taking it.
  const keep = (b) => { b.addEventListener('pointerdown', (e) => e.preventDefault()); return b; };
  // Icon buttons like the app's other bars: the name is the tooltip and the accessible label.
  const button = (glyph, title, action, className = '') => {
    const b = keep(Object.assign(document.createElement('button'), { type: 'button', className, title }));
    b.setAttribute('aria-label', title);
    if (glyph) b.append(icon(glyph));
    b.onclick = action;
    return b;
  };
  function build() {
    el = document.createElement('div');
    el.className = 'math-keypad';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Math keys');
    const head = document.createElement('div');
    head.className = 'math-keypad-head';
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    tabs.className = 'math-tabs';
    tabs.append(...KEY_TABS.map(([name, , title], i) => {
      const b = button('', title, () => { tab = i; draw(); }, 'math-tab');
      b.dataset.label = name;
      b.setAttribute('role', 'tab');
      return b;
    }));
    const keyboard = button('keyboard', 'Keyboard: type letters and words', () => {
      typing = !typing;
      area.inputMode = typing ? 'text' : 'none';
      // The system keyboard shows again only on a fresh focus.
      area.blur(); area.focus();
      draw();
    }, 'math-abc');
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.append(tabs, spacer,
      button('arrowLeft', 'Left', () => move('left'), 'math-nav'),
      button('arrowRight', 'Right', () => move('right'), 'math-nav'),
      button('arrowUp', 'Up: the place before, or up in the formula (Shift Tab)', () => move('up'), 'math-nav'),
      button('arrowDown', 'Down: the next place, or down in the formula (Tab)', () => move('down'), 'math-nav'),
      button('backspace', 'Delete', erase, 'math-nav'),
      keyboard,
      button('graph', 'Graph: draw this function of x on axes below the box (empty axes when the box is empty)', () => onGraph?.(area?.value ?? ''), 'math-graph'),
    );
    const keys = document.createElement('div');
    keys.className = 'math-keys';
    el.append(head, keys);
    document.body.append(el);
  }
  async function draw() {
    const [, keys] = KEY_TABS[tab];
    el.querySelectorAll('[role=tab]').forEach((b, i) => b.setAttribute('aria-selected', String(i === tab)));
    el.querySelector('.math-abc').setAttribute('aria-pressed', String(typing));
    el.querySelector('.math-abc').hidden = !touch() || isField();
    el.querySelector('.math-graph').hidden = !onGraph || !!area?.closest?.('dialog');
    const grid = el.querySelector('.math-keys');
    const katex = await loadKatex().catch(() => null);
    // Key faces and tab names are typeset, so each shows the symbol it writes.
    const face = (b, label) => { if (katex) katex.render(label, b, { throwOnError: false }); else b.textContent = label; };
    for (const b of el.querySelectorAll('.math-tab')) if (!b.firstChild) face(b, b.dataset.label);
    grid.replaceChildren(...keys.map(([label, template = label]) => {
      const b = button('', template.replace(C, '…'), () => insert(template), 'math-key');
      face(b, label);
      return b;
    }));
    place();
  }
  // Above the on-screen keyboard (the visual viewport shrinks when it opens).
  function place() {
    const vv = window.visualViewport;
    if (!el || !vv) return;
    el.style.bottom = `${Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height))}px`;
    if (area) onLayout();
  }
  function keydown(e) {
    // A math field moves between its places with Tab by itself.
    if (isField() || e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    move(e.shiftKey ? 'up' : 'down');
  }
  return {
    get open() { return !!area; },
    // Where the keypad starts on screen (what it covers below), for keeping the box in view.
    get top() { return el && !el.hidden ? el.getBoundingClientRect().top : innerHeight; },
    // A text field or a math field to type into.
    attach(target) {
      if (area === target) return;
      this.detach();
      area = target;
      if (!el) build();
      // Touch: the keypad is the keyboard of a text field until the keyboard key is pressed.
      typing = !touch();
      if (!typing && !isField()) area.inputMode = 'none';
      area.addEventListener('keydown', keydown);
      listener = place;
      window.visualViewport?.addEventListener('resize', listener);
      el.hidden = false;
      draw();
      status(isField() ? 'Math: tap any part to change it; arrows move through the formula.' : 'Math: type LaTeX or use the keys; Tab goes to the next empty place.');
    },
    detach() {
      if (!area) return;
      area.removeEventListener('keydown', keydown);
      if (!isField()) area.inputMode = '';
      window.visualViewport?.removeEventListener('resize', listener);
      area = null;
      if (el) el.hidden = true;
    },
    // Shown inside `parent` (a modal dialog is above everything else on the page).
    mount(parent) { if (!el) build(); if (el.parentElement !== parent) parent.append(el); },
    // Whether a press went to the keypad (so the box it types into stays open).
    contains: (node) => !!el?.contains(node),
  };
}
