// The math keypad (docs/SHAPES-TABLES-MATH.md, M3): shown under the page while a math text
// box is typed. Its keys put LaTeX into the box (a fraction, a power, a root…) with the
// cursor where the next thing goes; Tab (or →|) moves to the next empty {}. On touch screens
// it replaces the system keyboard (ABC brings that back), as Photomath's does; with a
// keyboard it is a palette. "Graph" draws the box's function (graph.js), or empty axes.
// No library: KaTeX (already used for the boxes) only draws the key labels.
import { loadKatex } from './rich-text.js';
import { icon } from './icons.js';

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
export function mathKeypad({ onGraph, onLayout = () => {}, status = () => {} } = {}) {
  let area = null, el = null, tab = 0, typing = false, listener = null;
  const touch = () => matchMedia('(pointer: coarse)').matches;
  function insert(template) {
    if (!area) return;
    const { value, cursor } = applyTemplate(area.value, area.selectionStart, area.selectionEnd, template);
    area.value = value;
    area.setSelectionRange(cursor, cursor);
    area.dispatchEvent(new Event('input'));
  }
  function jump(back = false) {
    const at = nextSlot(area.value, area.selectionStart, back);
    area.setSelectionRange(at, at);
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
      button('slotPrev', 'Previous empty place (Shift Tab)', () => jump(true), 'math-nav'),
      button('slotNext', 'Next empty place (Tab)', () => jump(), 'math-nav'),
      button('backspace', 'Delete', () => {
        const s = area.selectionStart, e = area.selectionEnd;
        if (s === e && s === 0) return;
        area.setRangeText('', s === e ? s - 1 : s, e, 'end');
        area.dispatchEvent(new Event('input'));
      }, 'math-nav'),
      keyboard,
      button('graph', 'Graph: draw this function of x on axes below the box (empty axes when the box is empty)', () => onGraph?.(area.value), 'math-graph'),
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
    el.querySelector('.math-abc').hidden = !touch();
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
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    jump(e.shiftKey);
  }
  return {
    get open() { return !!area; },
    // Where the keypad starts on screen (what it covers below), for keeping the box in view.
    get top() { return el && !el.hidden ? el.getBoundingClientRect().top : innerHeight; },
    attach(textarea) {
      if (area === textarea) return;
      this.detach();
      area = textarea;
      if (!el) build();
      // Touch: the keypad is the keyboard until ABC is pressed.
      typing = !touch();
      if (!typing) area.inputMode = 'none';
      area.addEventListener('keydown', keydown);
      listener = place;
      window.visualViewport?.addEventListener('resize', listener);
      el.hidden = false;
      draw();
      status('Math: type LaTeX or use the keys; Tab goes to the next empty place.');
    },
    detach() {
      if (!area) return;
      area.removeEventListener('keydown', keydown);
      area.inputMode = '';
      window.visualViewport?.removeEventListener('resize', listener);
      area = null;
      if (el) el.hidden = true;
    },
    // Whether a press went to the keypad (so the box it types into stays open).
    contains: (node) => !!el?.contains(node),
  };
}
