// Structured editing of a formula (MathLive's <math-field>, loaded only when a formula is
// edited): click any part of the typeset formula to change it, arrows move through its
// structure (into a numerator, out of a power), Backspace deletes whole pieces. The text box's
// LaTeX stays the stored form. MathLive's own menu and keyboard are hidden: the app's keypad
// (math-keypad.js) is the keyboard, sending it commands.
let loading = null;

export function loadMathLive() {
  return loading ||= import('./vendor/mathlive/mathlive.min.mjs').then((module) => {
    const { MathfieldElement } = module;
    // Its fonts are KaTeX's, which the reader already has; no sounds.
    MathfieldElement.fontsDirectory = new URL('./vendor/katex/fonts/', import.meta.url).href;
    MathfieldElement.soundsDirectory = null;
    MathfieldElement.keypressSound = null;
    MathfieldElement.plonkSound = null;
    return module;
  }).catch((error) => { loading = null; throw error; });
}

// A keypad template (‸ where the cursor goes, empty {} [] () to fill) in MathLive's insert
// syntax: #0 takes the selection or becomes the first place to type, #? are the others.
export function mathliveTemplate(template) {
  // A cursor at the end (x², a symbol) leaves nothing to fill after it.
  const mark = template.indexOf('‸'), atEnd = mark === template.length - 1;
  let out = mark < 0 ? template : template.slice(0, mark) + (atEnd ? '' : '#0') + template.slice(mark + 1);
  out = out.replace(/\{\}/g, '{#?}').replace(/\[\]/g, '[#?]').replace(/\(\)/g, '(#?)');
  return out.replace(/\\left\|#0\\right\|/, '\\left|#0\\right|');
}

// Commands for the keypad's keys.
export const MOVES = { left: 'moveToPreviousChar', right: 'moveToNextChar', up: 'moveUp', down: 'moveDown', back: 'deleteBackward', next: 'moveToNextPlaceholder', previous: 'moveToPreviousPlaceholder' };

// A math field over a text box being typed: `value` LaTeX, `style` the box's (size in screen
// px, rgba). `onInput(latex)` on each change.
export async function mathField(value, style, { onInput } = {}) {
  await loadMathLive();
  const mf = document.createElement('math-field');
  mf.className = 'text-math-field';
  mf.setAttribute('aria-label', 'Formula');
  mf.mathVirtualKeyboardPolicy = 'manual';
  mf.smartFence = true;
  mf.value = value;
  styleField(mf, style);
  mf.addEventListener('input', () => onInput?.(mf.value));
  return mf;
}
// Once it is on the page (MathLive refuses before): no menu of its own.
export function mounted(mf) {
  try { mf.menuItems = []; } catch { /* An older MathLive: its menu stays. */ }
}
// Focus that holds: tried when it is mounted, then a few times more until it has it.
export function focusField(mf, tries = 6) {
  const attempt = (left) => {
    if (!mf.isConnected || mf.readOnly) return;
    mf.focus();
    if (left > 0) setTimeout(() => { if (!mf.hasFocus?.() && document.activeElement !== mf) attempt(left - 1); }, 80);
  };
  mf.addEventListener('mount', () => attempt(tries), { once: true });
  requestAnimationFrame(() => attempt(tries));
}
export function styleField(mf, { size = 16, rgba = [0, 0, 0, 1] } = {}) {
  mf.style.fontSize = `${size}px`;
  mf.style.color = `rgba(${rgba.slice(0, 3).map((c) => Math.round(c * 255)).join(',')},${rgba[3] ?? 1})`;
}
