// Markdown from AI answers and notes: HTML from the Rust core (raw HTML shown
// as text), formulas typeset by KaTeX, which loads only when there is math.
let katex = null;
const aiFiles = new Map();

export function rememberAiFile(name, info) {
  if (name && info) aiFiles.set(String(name).toLowerCase(), info);
}
export function getAiFile(name) {
  return aiFiles.get(String(name || '').toLowerCase()) || null;
}

// Links to pages, attached images or external web pages in AI answers.
export function resolveAiLink(label = '', url = '') {
  const raw = String(url || '').trim(), text = String(label || '').trim();
  if (/^(https?:|mailto:)/i.test(raw)) return { href: raw, external: true };
  if (/^data:image\//i.test(raw)) return { href: '#ai-image', image: raw };
  const combined = `${raw} ${text}`;
  const fileMatch = combined.match(/(?:^|[/\\:#]|\b)(?:\d+-)?(notes-region|region-\d+|selection|source)(?:\.(?:jpe?g|png|webp|pdf))?(?:$|[\s)#?])/i);
  if (fileMatch) return { href: `#ai-file:${fileMatch[1].toLowerCase()}`, aiFile: fileMatch[1].toLowerCase() };
  const pageFromUrl = raw.match(/(?:^|[/\\:#?=&]|\b)(?:\d+-)?(?:page|p[aá]gina|p[aá]g|p)[-_=\s:/]*(\d+)\b/i)
    || raw.match(/#L(\d+)$/i);
  if (pageFromUrl && Number(pageFromUrl[1]) > 0) return { href: `#page-${Number(pageFromUrl[1])}`, page: Number(pageFromUrl[1]) };
  const pageFromText = text.match(/(?:^|[/\\]|\b)(?:\d+-)?(?:page|p[aá]gina|p[aá]g\.?|p\.)[-_\s]*(\d+)\b/i)
    || (/^(?:#|file:|page:|$)/i.test(raw) && text.match(/^(?:p\s*)?(\d+)$/i));
  if (pageFromText && Number(pageFromText[1]) > 0) return { href: `#page-${Number(pageFromText[1])}`, page: Number(pageFromText[1]) };
  return null;
}

// Normalises LaTeX delimiters (\[…\], \(…\), multi-line $$…$$, spaced $ … $)
// and local/page/image links outside code blocks before CommonMark parsing.
export function normalizeMarkdown(markdown) {
  const rewriteSegment = segment => segment
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (whole, bang, label, url) => {
      const resolved = resolveAiLink(label, url);
      if (!resolved) return whole;
      if (bang === '!') {
        const key = resolved.aiFile || (resolved.page ? `page-${resolved.page}` : '');
        const found = key && getAiFile(key);
        return found?.url ? `![${label}](${found.url})` : whole;
      }
      return !resolved.external && !resolved.image ? `[${label}](${resolved.href})` : whole;
    })
    .replace(/\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|\$\$([\s\S]+?)\$\$|\$(?!\$)\s*([^$\n]+?)\s*\$(?![$\d])/g, (whole, displayBracket, inlineParen, displayDollar, inlineDollar) => {
      if (displayBracket != null) return `$$\n${displayBracket.trim().replace(/\n\s*\n/g, '\n')}\n$$`;
      if (inlineParen != null) return `$${inlineParen.trim()}$`;
      if (displayDollar != null) return `$$${displayDollar.replace(/\n\s*\n/g, '\n')}$$`;
      if (inlineDollar != null && !/^\d+\s+[A-Za-z]{2,}/.test(inlineDollar.trim())) return `$${inlineDollar.trim()}$`;
      return whole;
    });
  return String(markdown ?? '')
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part, i) => (i % 2 === 1 ? part : rewriteSegment(part)))
    .join('');
}

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
  const html = await toHtml(normalizeMarkdown(text));
  element.innerHTML = html;
  for (const a of element.querySelectorAll('a')) {
    const resolved = resolveAiLink(a.textContent, a.getAttribute('href') || '');
    if (resolved?.external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (resolved?.page) {
      a.setAttribute('href', resolved.href);
      a.dataset.page = String(resolved.page);
      a.title ||= `Go to page ${resolved.page}`;
    } else if (resolved?.aiFile) {
      a.setAttribute('href', resolved.href);
      a.dataset.aiFile = resolved.aiFile;
      a.title ||= 'Show attached image';
    } else if (resolved?.image) {
      a.setAttribute('href', '#ai-image');
      a.dataset.aiImage = resolved.image;
      a.title ||= 'Show image';
    }
  }
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
  return normalizeMarkdown(markdown)
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
