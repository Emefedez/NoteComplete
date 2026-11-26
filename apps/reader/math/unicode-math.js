// Typed or pasted Unicode math (x³, x₁, 2×3, 6÷2, −4, √x, π…) rewritten into the plain/LaTeX
// spelling the Math Mode engine (cas.js) and the graph (math-eval.js) parse.

const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i', 'ˣ': 'x' };
const SUBSCRIPT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₓ': 'x', 'ᵢ': 'i', 'ⱼ': 'j', 'ₙ': 'n' };
const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅙': '1/6', '⅛': '1/8' };
const SYMBOLS = [
  [/[−–‐‑]/g, '-'],
  [/[×·⋅∙∗]/g, '*'],
  [/[÷∕⁄]/g, '/'],
  [/∛/g, '\\sqrt[3] '],
  [/∜/g, '\\sqrt[4] '],
  [/√/g, '\\sqrt '],
  [/π/g, '\\pi '],
];

const runOf = (map) => new RegExp(`[${Object.keys(map).join('')}]+`, 'g');
const SUPER_RUN = runOf(SUPERSCRIPT);
const SUB_RUN = runOf(SUBSCRIPT);
const VULGAR_ANY = runOf(VULGAR);

export function normalizeUnicodeMath(input) {
  let s = String(input ?? '');
  // x³ → x^{3}, x⁻¹ → x^{-1}; x₁ → x_{1}. A run of marks is one exponent or index.
  s = s.replace(SUPER_RUN, (run) => `^{${[...run].map((c) => SUPERSCRIPT[c]).join('')}}`);
  s = s.replace(SUB_RUN, (run) => `_{${[...run].map((c) => SUBSCRIPT[c]).join('')}}`);
  s = s.replace(VULGAR_ANY, (run) => [...run].map((c) => `(${VULGAR[c]})`).join(''));
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  return s;
}
