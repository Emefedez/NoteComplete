// Markdown from AI answers and notes: HTML from the Rust core (raw HTML shown
// as text), formulas typeset by KaTeX, which loads only when there is math.
let katex = null;
function loadKatex() {
  return katex ||= import('./vendor/katex/katex.mjs').then(module => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('./vendor/katex/katex.min.css', import.meta.url).href;
    document.head.append(css);
    return module.default;
  }).catch(error => { katex = null; throw error; });
}

export async function renderMarkdown(element, text, toHtml) {
  const html = await toHtml(text);
  element.innerHTML = html;
  const maths = element.querySelectorAll('.math');
  if (!maths.length) return;
  const tex = await loadKatex().catch(() => null);
  if (!tex) return;
  for (const span of maths) {
    const source = span.textContent;
    span.dataset.tex = source;
    tex.render(source, span, { displayMode: span.classList.contains('math-display'), throwOnError: false, output: 'html' });
  }
}

// Common LaTeX commands as characters, for plain text (text boxes, copying).
const SYMBOLS = {
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', mapsto: '↦',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝',
  infty: '∞', sum: 'Σ', prod: 'Π', int: '∫', sqrt: '√', partial: '∂', nabla: '∇', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', emptyset: '∅',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', oplus: '⊕', otimes: '⊗', ldots: '…', cdots: '⋯', dots: '…', degree: '°', circ: '∘',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
};
export function texToText(tex) {
  return tex
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^}]*)\}/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\([A-Za-z]+)/g, (whole, name) => SYMBOLS[name] ?? whole.slice(1))
    .replace(/\^\{([^}]*)\}/g, '^$1').replace(/_\{([^}]*)\}/g, '_$1')
    .replace(/\\[,;:! ]/g, ' ').replace(/[{}]/g, '')
    .trim();
}

// Markdown as plain text for a text box: list bullets kept, emphasis marks,
// headings and code fences dropped, math turned into characters.
export function plainText(markdown) {
  return markdown
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => texToText(tex))
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => texToText(tex))
    .split('\n')
    .filter(line => !/^\s*```/.test(line))
    .map(line => line
      .replace(/^(\s*)[*+-]\s+/, '$1• ')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
