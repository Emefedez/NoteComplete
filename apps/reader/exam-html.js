// AI Exam prompt, sanitizer, and A4 HTML builder styled after Examen_Extenso_Temario_1_ACII.html,
// using visible answer/theory blocks tagged with [data-tape-answer] instead of <details> dropdowns
// so generated PDF pages receive exact-fit Noteful Tape overlays.

let katexMod = null;
export async function ensureExamMathRenderer() {
  if (!katexMod) {
    try {
      const m = await import('./vendor/katex/katex.mjs');
      katexMod = m?.default || m;
    } catch {
      katexMod = null;
    }
  }
  return katexMod;
}

export const PROBLEM_TYPES = [
  ['mcq', 'Multiple choice'],
  ['fill', 'Fill-in / conversions'],
  ['calculation', 'Calculations / derivations'],
  ['open', 'Open-ended / essays'],
  ['table', 'Complete tables'],
  ['code', 'Code / trace / debug'],
];

export const FOCUS_MODES = [
  ['important', 'Most important / frequent'],
  ['everything', 'Literally everything (all details)'],
  ['random', 'Random mix'],
];

const FOCUS_RULES = {
  important: 'Focus on the highest-yield, most repeated, and core exam-likely concepts across the sources. Spend more depth and points on foundational mechanisms and recurring themes.',
  everything: 'Comprehensive coverage: systematically cover EVERY distinct topic, subtopic, definition, formula, edge case, diagram/table, and concrete detail present across all provided sources without omitting minor sections.',
  random: 'Random sampling: pick an unpredictable, varied assortment of concepts from anywhere in the sources — mixing headline theorems with subtle details, edge cases, and atypical combinations.',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Splits exam prose into plain text and $...$ / $$...$$ LaTeX segments without misreading prices like "$5 and $10".
export function splitExamMath(text) {
  const source = String(text ?? '');
  const parts = [];
  let plainStart = 0;
  let i = 0;
  const pushText = (end) => {
    if (end > plainStart) parts.push({ text: source.slice(plainStart, end).replaceAll('\\$', '$') });
  };
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$') { i += 2; continue; }
    if (source[i] !== '$') { i += 1; continue; }
    if (source[i + 1] === '$') {
      const close = source.indexOf('$$', i + 2);
      if (close !== -1) {
        pushText(i);
        parts.push({ tex: source.slice(i + 2, close).trim(), display: true });
        i = close + 2;
        plainStart = i;
        continue;
      }
      i += 2;
      continue;
    }
    let close = -1;
    for (let j = i + 1; j < source.length && source[j] !== '\n'; j++) {
      if (source[j] === '\\') { j += 1; continue; }
      if (source[j] === '$') {
        if (source[j + 1] === '$') break;
        close = j;
        break;
      }
    }
    if (close !== -1) {
      const inner = source.slice(i + 1, close);
      const nextCh = source[close + 1] || '';
      if (inner.trim() && !/^\s|\s$/.test(inner) && !/\d/.test(nextCh)) {
        pushText(i);
        parts.push({ tex: inner.trim(), display: false });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i += 1;
  }
  pushText(source.length);
  return parts;
}

function formatInlinePlain(s) {
  return escapeHtml(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

// Text with line breaks as separate lines and blank lines as paragraphs, each its own element
// so a long solution can be split between pages (exam-pdf.js) and reads airy once the tape is off.
// A step starts a line: "1." "2)" "a)" "Paso 3:" "Step 2 —"; its label goes bold.
const STEP_RE = /^((?:\d{1,2}|[a-z])[.)]|(?:Paso|Step|Fase|Phase|Parte|Part|Caso|Case)\s+\w{1,3}\s*[:.)\u2014-])\s+/i;
const BULLET_RE = /^[-*\u2022\u2013]\s+/;
// A heading prefix ("Ejecución secuencial:", "Monolítico —") or a short line ending in ":"
// goes bold, as section titles of a solution; formulas ("t = 0–4:") do not.
const HEAD_RE = /^([\p{L}][\p{L}\p{N} ()'’/.,-]{0,38}?)(\s*(?::|\u2014|\u2013 ))(?=\s|$)/u;
function boldHead(text, katex) {
  if (/\*\*/.test(text.slice(0, 4))) return renderRichExamHtml(text, katex);
  const m = text.match(HEAD_RE);
  if (!m || /[=<>$]/.test(m[1]) || /^\d/.test(m[1])) return renderRichExamHtml(text, katex);
  return `<strong class="sp-head">${renderRichExamHtml(m[1], katex)}${escapeHtml(m[2])}</strong>${renderRichExamHtml(text.slice(m[0].length), katex)}`;
}
export function renderExamParagraphs(value, katex = katexMod) {
  const paras = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/^\s*\n|\n\s*$/g, '').split(/\n\s*\n+/).filter((p) => p.trim());
  return paras.map((para) => {
    let inStep = false;
    const lines = para.split('\n').filter((l) => l.trim()).map((raw) => {
      // Indent: spaces in the text (2 per level), or being a line under a step.
      const lead = Math.min(3, Math.floor((raw.match(/^ */)[0].length) / 2));
      const line = raw.trim();
      const step = line.match(STEP_RE);
      if (step && lead === 0) {
        inStep = true;
        return `<span class="ln step"><strong class="step-n">${escapeHtml(step[1])}</strong> ${boldHead(line.slice(step[0].length), katex)}</span>`;
      }
      const bullet = line.match(BULLET_RE);
      const level = Math.max(lead, inStep ? 1 : 0);
      const body = bullet ? line.slice(bullet[0].length) : line;
      const cls = `ln${level ? ` in${level}` : ''}${bullet ? ' bul' : ''}${step ? ' step' : ''}`;
      const html = step ? `<strong class="step-n">${escapeHtml(step[1])}</strong> ${boldHead(line.slice(step[0].length), katex)}` : boldHead(body, katex);
      return `<span class="${cls}">${html}</span>`;
    });
    return `<p class="sp">${lines.join('')}</p>`;
  }).join('');
}

// Renders LaTeX ($...$, $$...$$) using bundled KaTeX MathML so formulas print natively in offline A4 PDFs.
export function renderRichExamHtml(value, katex = katexMod) {
  const source = String(value ?? '');
  if (!source) return '';
  return splitExamMath(source).map((part) => {
    if (part.tex == null) return formatInlinePlain(part.text);
    if (!katex?.renderToString) {
      return `<code>${escapeHtml(part.tex)}</code>`;
    }
    try {
      const html = katex.renderToString(part.tex, {
        displayMode: part.display,
        output: 'mathml',
        throwOnError: false,
      });
      return part.display ? `<span class="math-block">${html}</span>` : html;
    } catch {
      return `<code>${escapeHtml(part.tex)}</code>`;
    }
  }).join('');
}

// ---- Structured Math / Engineering Visuals & Safe SVG Sanitizers ----

const MATH_FUNCS = Object.assign(Object.create(null), {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: (v, base) => (base == null ? Math.log(v) : Math.log(v) / Math.log(base)),
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
});

const MATH_CONSTS = Object.assign(Object.create(null), {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
});

/**
 * Pure, safe recursive-descent mathematical expression evaluator (no eval/Function).
 * Supports +, -, *, /, %, ^, **, parentheses, implicit multiplication (2x, 2sin(x)), and common math functions.
 */
export function evalMathExpr(expr, vars = { x: 0 }) {
  const src = String(expr ?? '').trim();
  if (!src || src.length > 300) return NaN;
  const normSrc = src
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'pi');

  // Tokenize
  const rawTokens = [];
  let i = 0;
  while (i < normSrc.length) {
    const ch = normSrc[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(normSrc[i + 1] || ''))) {
      let end = i + 1;
      while (end < normSrc.length && /[\d.]/.test(normSrc[end])) end++;
      if ((normSrc[end] === 'e' || normSrc[end] === 'E') && /[+\-\d]/.test(normSrc[end + 1] || '')) {
        end++;
        if (normSrc[end] === '+' || normSrc[end] === '-') end++;
        while (end < normSrc.length && /\d/.test(normSrc[end])) end++;
      }
      const num = Number(normSrc.slice(i, end));
      if (!Number.isFinite(num)) return NaN;
      rawTokens.push({ t: 'num', v: num });
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < normSrc.length && /[A-Za-z0-9_]/.test(normSrc[end])) end++;
      rawTokens.push({ t: 'id', v: normSrc.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '*' && normSrc[i + 1] === '*') {
      rawTokens.push({ t: 'op', v: '^' });
      i += 2;
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      rawTokens.push({ t: ch === '(' || ch === ')' || ch === ',' ? ch : 'op', v: ch });
      i++;
      continue;
    }
    return NaN;
  }

  // Insert implicit multiplication tokens (e.g. 2x, 3(x+1), (x+1)(x-1), 2sin(x))
  const tokens = [];
  for (let k = 0; k < rawTokens.length; k++) {
    const cur = rawTokens[k];
    const prev = tokens[tokens.length - 1];
    if (prev) {
      const prevIsVal = prev.t === 'num' || prev.t === ')' || (prev.t === 'id' && !(prev.v.toLowerCase() in MATH_FUNCS));
      const curStartsVal = cur.t === 'num' || cur.t === '(' || cur.t === 'id';
      if (prevIsVal && curStartsVal) tokens.push({ t: 'op', v: '*' });
    }
    tokens.push(cur);
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let val = parseTerm();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parseUnary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v;
      const rhs = parseUnary();
      val = op === '*' ? val * rhs : op === '/' ? val / rhs : val % rhs;
    }
    return val;
  }

  function parseUnary() {
    if (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const v = parseUnary();
      return op === '-' ? -v : v;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (peek()?.t === 'op' && peek().v === '^') {
      next();
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseAtom() {
    const tok = next();
    if (!tok) return NaN;
    if (tok.t === 'num') return tok.v;
    if (tok.t === '(') {
      const val = parseExpr();
      if (next()?.t !== ')') return NaN;
      return val;
    }
    if (tok.t === 'id') {
      const lower = tok.v.toLowerCase();
      if (peek()?.t === '(' && lower in MATH_FUNCS) {
        next(); // consume '('
        const args = [];
        if (peek()?.t !== ')') {
          args.push(parseExpr());
          while (peek()?.t === ',') {
            next();
            args.push(parseExpr());
          }
        }
        if (next()?.t !== ')') return NaN;
        return MATH_FUNCS[lower](...args);
      }
      if (vars && Object.prototype.hasOwnProperty.call(vars, tok.v)) return Number(vars[tok.v]);
      if (vars && Object.prototype.hasOwnProperty.call(vars, lower)) return Number(vars[lower]);
      if (lower in MATH_CONSTS) return MATH_CONSTS[lower];
      return NaN;
    }
    return NaN;
  }

  const out = parseExpr();
  if (pos !== tokens.length || !Number.isFinite(out)) return NaN;
  return out;
}

const SAFE_SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'line', 'rect', 'circle', 'ellipse',
  'path', 'polygon', 'polyline', 'text', 'tspan', 'marker',
]);
const DROP_WITH_CONTENT_TAGS = new Set([
  'script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video',
]);
const SVG_ATTR_CASE = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  markerunits: 'markerUnits',
};
const SAFE_SVG_ATTRS = new Set([
  'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'dominant-baseline', 'id', 'class', 'style',
  'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits',
  'marker-start', 'marker-mid', 'marker-end',
]);
const SAFE_STYLE_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'opacity',
  'font-size', 'font-weight', 'font-style', 'font-family', 'text-anchor',
  'dominant-baseline', 'display',
]);

function sanitizeSvgStyle(rawStyle) {
  return String(rawStyle || '')
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return '';
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!SAFE_STYLE_PROPS.has(prop) || !val) return '';
      if (/url\(|expression\(|javascript:|vbscript:|data:/i.test(val)) return '';
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(';');
}

/**
 * Strictly sanitizes raw SVG markup into safe pure SVG primitives (`<svg>`, `<g>`, `<defs>`,
 * `<line>`, `<rect>`, `<circle>`, `<ellipse>`, `<path>`, `<polygon>`, `<polyline>`, `<text>`, `<tspan>`, `<marker>`).
 * Strips scripts, foreignObject, images, use, event handlers, and unsafe URLs.
 */
export function sanitizeSvg(rawSvg) {
  const src = String(rawSvg ?? '').trim();
  if (!src) return '';
  const match = src.match(/<svg\b[\s\S]*?<\/svg>|<svg\b[^>]*\/>/i);
  if (!match) return '';
  let body = match[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

  for (const dangerous of DROP_WITH_CONTENT_TAGS) {
    body = body.replace(new RegExp(`<${dangerous}\\b[\\s\\S]*?<\\/${dangerous}>`, 'gi'), '');
    body = body.replace(new RegExp(`<${dangerous}\\b[^>]*\\/?>`, 'gi'), '');
  }

  const out = [];
  const stack = [];
  let cursor = 0;
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    if (m.index > cursor) {
      const txt = body.slice(cursor, m.index)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (txt) out.push(escapeHtml(txt));
    }
    cursor = m.index + m[0].length;
    const isClose = m[1] === '/';
    const rawName = m[2].includes(':') ? m[2].split(':').pop() : m[2];
    const tag = rawName.toLowerCase();
    const attrText = m[3] || '';
    const selfClose = m[4] === '/';

    if (!SAFE_SVG_TAGS.has(tag)) continue;
    if (isClose) {
      while (stack.length) {
        const top = stack.pop();
        out.push(`</${top}>`);
        if (top === tag) break;
      }
      continue;
    }

    const attrs = new Map();
    const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const rawKey = am[1];
      const lowerKey = rawKey.toLowerCase();
      if (lowerKey.startsWith('on') || !SAFE_SVG_ATTRS.has(lowerKey)) continue;
      const val = am[2] ?? am[3] ?? am[4] ?? '';
      if (/javascript:|vbscript:|data:|expression\s*\(/i.test(val)) continue;
      if (/url\(/i.test(val)) {
        if (!/^marker-(start|mid|end)$/.test(lowerKey) || !/^url\(\s*#[A-Za-z_][A-Za-z0-9_-]*\s*\)$/.test(val.trim())) {
          continue;
        }
      }
      const cleanVal = lowerKey === 'style' ? sanitizeSvgStyle(val) : val;
      if (lowerKey === 'style' && !cleanVal) continue;
      const canonKey = SVG_ATTR_CASE[lowerKey] || lowerKey;
      attrs.set(canonKey, cleanVal);
    }

    if (tag === 'svg') {
      attrs.set('xmlns', 'http://www.w3.org/2000/svg');
      if (!attrs.has('viewBox')) attrs.set('viewBox', '0 0 520 260');
    }

    const attrStr = [...attrs.entries()]
      .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
      .join('');
    out.push(`<${tag}${attrStr}${selfClose ? '/>' : '>'}`);
    if (!selfClose) stack.push(tag);
  }
  if (cursor < body.length) {
    out.push(escapeHtml(body.slice(cursor)));
  }
  while (stack.length) {
    out.push(`</${stack.pop()}>`);
  }
  const finalSvg = out.join('');
  return finalSvg.startsWith('<svg') ? finalSvg : '';
}

const VISUAL_PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4f46e5'];
const DATA_IMG_URI_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

function clampBbox01(bbox) {
  if (!bbox) return null;
  const arr = Array.isArray(bbox)
    ? bbox
    : typeof bbox === 'object'
      ? [bbox.x ?? bbox.left, bbox.y ?? bbox.top, bbox.w ?? bbox.width, bbox.h ?? bbox.height]
      : null;
  if (!arr || arr.length < 4) return null;
  const nums = arr.slice(0, 4).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const x = Math.max(0, Math.min(0.99, nums[0]));
  const y = Math.max(0, Math.min(0.99, nums[1]));
  const w = Math.max(0, Math.min(1 - x, nums[2]));
  const h = Math.max(0, Math.min(1 - y, nums[3]));
  if (w < 0.01 || h < 0.01) return null;
  return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(w.toFixed(4)), Number(h.toFixed(4))];
}

function safeColor(c, fallback = '#2563eb') {
  const s = String(c || '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) return s;
  return fallback;
}

/** Normalizes any structured visual / figure spec (`plot`, `histogram`, `timeline`, `tree`, `graph_nodes`, `custom_svg`, `cutout`). */
// Process states in occupancy diagrams: running (solid blue), ready (dashed green),
// blocked / doing I/O (red hatching).
const STATE_WORDS = [
  ['run', /^(cpu|run(ning)?|activo|active|ejec(uci[oó]n|utando)?|exec(uting)?)$/i],
  ['ready', /^(ready|listo|espera|wait(ing)?|preparado)$/i],
  ['blocked', /^(blocked|bloq(ueado|\.)?|block|e\/s|i\/o|io|es|disco|disk|impresora|printer)\d*$/i],
];
function stateOf(label) {
  const t = String(label || '').trim();
  for (const [state, re] of STATE_WORDS) if (re.test(t)) return state;
  return '';
}
function normalizeStatesSpec(raw, { caption = '', blank = false } = {}) {
  const rawRows = Array.isArray(raw.processes) ? raw.processes : Array.isArray(raw.rows) ? raw.rows : [];
  const processes = rawRows.map((r, ri) => {
    if (!r || typeof r !== 'object') return null;
    const segments = (Array.isArray(r.segments) ? r.segments : Array.isArray(r.intervals) ? r.intervals : [])
      .map((sg) => {
        const start = Number(sg?.start ?? sg?.from), end = Number(sg?.end ?? sg?.to);
        const state = stateOf(sg?.state ?? sg?.label);
        return Number.isFinite(start) && Number.isFinite(end) && end > start && state ? { state, start, end } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
    const arrival = Number.isFinite(Number(r.arrival)) ? Number(r.arrival) : (segments[0]?.start ?? null);
    return { label: String(r.label ?? r.name ?? r.process ?? `P${ri + 1}`).trim(), arrival, segments, done: r.done !== false };
  }).filter((p) => p && p.label);
  const all = processes.flatMap((p) => p.segments);
  const tStart = Number.isFinite(Number(raw.tStart)) ? Number(raw.tStart) : 0;
  const maxEnd = all.reduce((m, sg) => Math.max(m, sg.end), tStart);
  const tEnd = Number.isFinite(Number(raw.tEnd)) && Number(raw.tEnd) > tStart ? Number(raw.tEnd) : (maxEnd > tStart ? maxEnd : tStart + 20);
  const legend = raw.legend && typeof raw.legend === 'object' ? raw.legend : {};
  return {
    type: 'states',
    title: String(raw.title || '').trim(),
    caption: caption && caption !== String(raw.title || '').trim() ? caption : '',
    tStart,
    tEnd,
    tStep: Number.isFinite(Number(raw.tStep)) && Number(raw.tStep) > 0 ? Number(raw.tStep) : null,
    unit: String(raw.unit ?? '').trim(),
    blank: blank || all.length === 0,
    processes,
    legend: {
      run: String(legend.run ?? legend.cpu ?? 'Activo').trim(),
      ready: String(legend.ready ?? 'Listo').trim(),
      blocked: String(legend.blocked ?? 'Bloqueado').trim(),
    },
  };
}

export function normalizeVisualSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rawType = String(raw.type || raw.kind || '').trim().toLowerCase();
  const caption = String(raw.caption ?? raw.title ?? '').trim();
  const blank = Boolean(raw.blank ?? raw.fill ?? raw.empty);

  if (['cutout', 'crop', 'image', 'source_image'].includes(rawType)) {
    const rawUrl = String(raw.dataUrl || raw.src || '').replace(/\s+/g, '');
    const dataUrl = DATA_IMG_URI_RE.test(rawUrl) ? rawUrl : '';
    const bbox = raw.bbox != null ? clampBbox01(raw.bbox) : null;
    const sourceIndex = Number.isInteger(Number(raw.sourceIndex)) && Number(raw.sourceIndex) >= 0 ? Number(raw.sourceIndex) : 0;
    const page = Number.isInteger(Number(raw.page)) && Number(raw.page) >= 1 ? Number(raw.page) : null;
    const imageIndex = Number.isInteger(Number(raw.imageIndex)) && Number(raw.imageIndex) >= 0 ? Number(raw.imageIndex) : null;
    if (!dataUrl && page == null && imageIndex == null) return null;
    return {
      type: 'cutout',
      dataUrl,
      sourceIndex,
      page,
      imageIndex,
      bbox,
      caption,
      alt: String(raw.alt || caption || 'Source figure').trim(),
    };
  }

  if (['plot', 'graph', 'function', 'axes', 'curve'].includes(rawType)) {
    let xMin = Number.isFinite(Number(raw.xMin)) ? Number(raw.xMin) : -5;
    let xMax = Number.isFinite(Number(raw.xMax)) ? Number(raw.xMax) : 5;
    if (xMax <= xMin) { xMin = -5; xMax = 5; }
    let yMin = Number.isFinite(Number(raw.yMin)) ? Number(raw.yMin) : -5;
    let yMax = Number.isFinite(Number(raw.yMax)) ? Number(raw.yMax) : 5;
    if (yMax <= yMin) { yMin = -5; yMax = 5; }
    const fnsRaw = Array.isArray(raw.functions) ? raw.functions : Array.isArray(raw.curves) ? raw.curves : Array.isArray(raw.series) ? raw.series : [];
    const functions = fnsRaw
      .map((f, idx) => {
        if (typeof f === 'string') return { expr: f, points: null, label: f, color: VISUAL_PALETTE[idx % VISUAL_PALETTE.length], dashed: false };
        if (!f || typeof f !== 'object') return null;
        const expr = String(f.expr ?? f.fn ?? f.formula ?? '').trim();
        const points = Array.isArray(f.points)
          ? f.points.filter((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1]))).map((pt) => [Number(pt[0]), Number(pt[1])])
          : null;
        if (!expr && (!points || !points.length)) return null;
        return {
          expr,
          points,
          label: String(f.label || expr || '').trim(),
          color: safeColor(f.color, VISUAL_PALETTE[idx % VISUAL_PALETTE.length]),
          dashed: Boolean(f.dashed),
        };
      })
      .filter(Boolean);
    const points = (Array.isArray(raw.points) ? raw.points : [])
      .filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
      .map((p) => ({
        x: Number(p.x),
        y: Number(p.y),
        label: String(p.label || '').trim(),
        color: safeColor(p.color, '#dc2626'),
        open: Boolean(p.open),
      }));
    const areas = (Array.isArray(raw.areas) ? raw.areas : Array.isArray(raw.shaded) ? raw.shaded : [])
      .filter((a) => a && Number.isFinite(Number(a.from)) && Number.isFinite(Number(a.to)) && (a.expr || functions[0]?.expr))
      .map((a) => ({
        expr: String(a.expr || functions[0]?.expr || '').trim(),
        y0: Number.isFinite(Number(a.y0)) ? Number(a.y0) : 0,
        from: Math.min(Number(a.from), Number(a.to)),
        to: Math.max(Number(a.from), Number(a.to)),
        color: safeColor(a.color, '#3b82f6'),
      }));
    return {
      type: 'plot',
      title: String(raw.title || '').trim(),
      caption,
      xMin,
      xMax,
      yMin,
      yMax,
      xStep: Number.isFinite(Number(raw.xStep)) && Number(raw.xStep) > 0 ? Number(raw.xStep) : null,
      yStep: Number.isFinite(Number(raw.yStep)) && Number(raw.yStep) > 0 ? Number(raw.yStep) : null,
      xLabel: String(raw.xLabel || 'x').trim(),
      yLabel: String(raw.yLabel || 'y').trim(),
      grid: raw.grid !== false,
      blank,
      functions,
      points,
      areas,
    };
  }

  if (['histogram', 'bar', 'barchart', 'freq', 'frequency'].includes(rawType)) {
    const rawBins = Array.isArray(raw.bins) ? raw.bins : Array.isArray(raw.bars) ? raw.bars : Array.isArray(raw.data) ? raw.data : [];
    const bins = rawBins
      .map((b, idx) => {
        if (Array.isArray(b)) {
          const v = b[1] == null || b[1] === '' ? null : Number(b[1]);
          return { label: String(b[0] ?? idx + 1).trim(), value: Number.isFinite(v) ? v : null, color: VISUAL_PALETTE[idx % VISUAL_PALETTE.length] };
        }
        if (typeof b === 'string') return { label: b.trim(), value: null, color: VISUAL_PALETTE[idx % VISUAL_PALETTE.length] };
        if (!b || typeof b !== 'object') return null;
        const rawVal = b.value ?? b.count ?? b.freq ?? b.y;
        const v = rawVal == null || rawVal === '' ? null : Number(rawVal);
        return {
          label: String(b.label ?? b.bin ?? b.name ?? idx + 1).trim(),
          value: Number.isFinite(v) ? v : null,
          color: safeColor(b.color, VISUAL_PALETTE[idx % VISUAL_PALETTE.length]),
        };
      })
      .filter((b) => b && b.label);
    if (!bins.length) return null;
    const maxVal = Math.max(0, ...bins.map((b) => (b.value != null ? b.value : 0)));
    const yMin = Number.isFinite(Number(raw.yMin)) ? Number(raw.yMin) : 0;
    const yMax = Number.isFinite(Number(raw.yMax)) && Number(raw.yMax) > yMin
      ? Number(raw.yMax)
      : (maxVal > 0 ? Math.ceil(maxVal * 1.15) : 10);
    return {
      type: 'histogram',
      title: String(raw.title || '').trim(),
      caption,
      xLabel: String(raw.xLabel || '').trim(),
      yLabel: String(raw.yLabel || 'Frequency').trim(),
      yMin,
      yMax,
      yStep: Number.isFinite(Number(raw.yStep)) && Number(raw.yStep) > 0 ? Number(raw.yStep) : null,
      contiguous: typeof raw.contiguous === 'boolean' ? raw.contiguous : rawType === 'histogram' || rawType === 'freq' || rawType === 'frequency',
      showValues: raw.showValues !== false,
      blank: blank || bins.every((b) => b.value == null),
      bins,
    };
  }

  if (['states', 'process_states', 'occupancy', 'ocupacion', 'ocupación', 'estados'].includes(rawType)) {
    return normalizeStatesSpec(raw, { caption, blank });
  }

  if (['timeline', 'gantt', 'cpu', 'schedule', 'timing'].includes(rawType)) {
    const normalizeInterval = (it, idx) => {
      if (Array.isArray(it) && it.length >= 3) {
        const s = Number(it[1]);
        const e = Number(it[2]);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
        return { label: String(it[0] ?? '').trim(), start: s, end: e, color: safeColor(it[3], ''), row: '' };
      }
      if (!it || typeof it !== 'object') return null;
      const s = Number(it.start ?? it.from ?? it.t0);
      const e = Number(it.end ?? it.to ?? it.t1);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
      return {
        label: String(it.label ?? it.proc ?? it.process ?? it.name ?? `T${idx + 1}`).trim(),
        start: s,
        end: e,
        color: safeColor(it.color, ''),
        row: String(it.row || '').trim(),
      };
    };

    const rawRows = Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.lanes) ? raw.lanes : Array.isArray(raw.processes) ? raw.processes : [];
    const topIntervals = (Array.isArray(raw.intervals) ? raw.intervals : []).map(normalizeInterval).filter(Boolean);
    let rows = rawRows
      .map((r, ri) => {
        if (typeof r === 'string') return { label: r.trim(), intervals: [] };
        if (!r || typeof r !== 'object') return null;
        const lbl = String(r.label ?? r.name ?? r.process ?? `Row ${ri + 1}`).trim();
        const ivs = (Array.isArray(r.intervals) ? r.intervals : []).map(normalizeInterval).filter(Boolean);
        return { label: lbl, intervals: ivs };
      })
      .filter((r) => r && r.label);

    if (!rows.length) {
      const grouped = new Map();
      for (const iv of topIntervals) {
        const key = iv.row || 'CPU';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(iv);
      }
      rows = grouped.size
        ? [...grouped.entries()].map(([label, intervals]) => ({ label, intervals }))
        : [{ label: 'CPU', intervals: [] }];
    } else if (topIntervals.length) {
      for (const iv of topIntervals) {
        const target = (iv.row && rows.find((r) => r.label === iv.row)) || rows[0];
        target.intervals.push(iv);
      }
    }

    const allIntervals = rows.flatMap((r) => r.intervals);
    // One row per process with intervals named by state (CPU, E/S, Listo…): the
    // process-state style (lines, dashes, hatching), as these diagrams are drawn by hand.
    if (allIntervals.length && rows.length >= 1 && allIntervals.every((iv) => stateOf(iv.label))
      && !rows.some((r) => /^(CPU|E\/S|I\/O|IO)$/i.test(r.label))) {
      return normalizeStatesSpec({ ...raw, processes: rows.map((r) => ({ label: r.label, segments: r.intervals.map((iv) => ({ state: iv.label, start: iv.start, end: iv.end })) })) }, { caption, blank });
    }
    const tStart = Number.isFinite(Number(raw.tStart)) ? Number(raw.tStart) : 0;
    const maxEnd = allIntervals.reduce((mx, iv) => Math.max(mx, iv.end), tStart);
    const tEnd = Number.isFinite(Number(raw.tEnd)) && Number(raw.tEnd) > tStart
      ? Number(raw.tEnd)
      : (maxEnd > tStart ? maxEnd : tStart + 12);
    const unit = String(raw.unit ?? 'ms').trim();
    const markers = (Array.isArray(raw.markers) ? raw.markers : Array.isArray(raw.arrivals) ? raw.arrivals : [])
      .filter((m) => m && Number.isFinite(Number(m.t ?? m.time)))
      .map((m) => ({ t: Number(m.t ?? m.time), label: String(m.label || '').trim() }));

    return {
      type: 'timeline',
      title: String(raw.title || '').trim(),
      caption,
      tStart,
      tEnd,
      tStep: Number.isFinite(Number(raw.tStep)) && Number(raw.tStep) > 0 ? Number(raw.tStep) : null,
      unit,
      xLabel: String(raw.xLabel || (unit ? `Time (${unit})` : 'Time')).trim(),
      blank: blank || allIntervals.length === 0,
      rows,
      markers,
    };
  }

  if (['tree', 'graph_nodes', 'fsm', 'automaton', 'network', 'dag'].includes(rawType)
    || (!raw.svg && Array.isArray(raw.nodes) && raw.nodes.length)) {
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
      .map((n, idx) => {
        if (typeof n === 'string' || typeof n === 'number') {
          return { id: String(n), label: String(n), x: null, y: null, shape: 'circle', color: '' };
        }
        if (!n || typeof n !== 'object') return null;
        const id = String(n.id ?? n.name ?? n.label ?? idx).trim();
        if (!id) return null;
        return {
          id,
          label: String(n.label ?? n.name ?? id).trim(),
          x: Number.isFinite(Number(n.x)) ? Number(n.x) : null,
          y: Number.isFinite(Number(n.y)) ? Number(n.y) : null,
          shape: ['circle', 'rect', 'doublecircle'].includes(String(n.shape || '').toLowerCase())
            ? String(n.shape).toLowerCase()
            : 'circle',
          color: safeColor(n.color, ''),
        };
      })
      .filter(Boolean);
    if (!nodes.length) return null;
    const nodeIds = new Set(nodes.map((n) => n.id));
    const defaultDirected = ['tree', 'fsm', 'automaton', 'dag'].includes(rawType) || raw.directed === true;
    const edges = (Array.isArray(raw.edges) ? raw.edges : [])
      .map((e) => {
        if (Array.isArray(e) && e.length >= 2) {
          return { from: String(e[0]), to: String(e[1]), label: String(e[2] ?? '').trim(), directed: defaultDirected, dashed: false };
        }
        if (!e || typeof e !== 'object') return null;
        const from = String(e.from ?? e.source ?? e.u ?? '').trim();
        const to = String(e.to ?? e.target ?? e.v ?? '').trim();
        if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) return null;
        return {
          from,
          to,
          label: String(e.label ?? e.weight ?? '').trim(),
          directed: typeof e.directed === 'boolean' ? e.directed : defaultDirected,
          dashed: Boolean(e.dashed),
        };
      })
      .filter(Boolean);
    return {
      type: rawType === 'tree' ? 'tree' : 'graph_nodes',
      title: String(raw.title || '').trim(),
      caption,
      directed: defaultDirected,
      nodes,
      edges,
    };
  }

  if (['diagram', 'circuit', 'custom_svg', 'svg'].includes(rawType) || typeof raw.svg === 'string') {
    const clean = sanitizeSvg(raw.svg || '');
    if (!clean) return null;
    return {
      type: 'custom_svg',
      svg: clean,
      caption,
    };
  }

  return null;
}

function niceTickStep(span, targetTicks = 6) {
  if (!(span > 0)) return 1;
  const rough = span / Math.max(2, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const nice = frac <= 1.2 ? 1 : frac <= 2.5 ? 2 : frac <= 5.5 ? 5 : 10;
  return nice * pow;
}

function fmtTick(v) {
  if (Math.abs(v) < 1e-9) return '0';
  return String(Number(v.toFixed(4)));
}

function tickValues(min, max, explicitStep = null, target = 6) {
  const step = explicitStep && explicitStep > 0 ? explicitStep : niceTickStep(max - min, target);
  const start = Math.ceil((min - 1e-9) / step) * step;
  const out = [];
  for (let v = start; v <= max + 1e-9 && out.length < 40; v += step) {
    out.push(Number(v.toFixed(6)));
  }
  return { step, values: out };
}

function arrowHeadPoly(x1, y1, x2, y2, size = 7, color = '#0f172a') {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ax = x2 - size * Math.cos(angle - Math.PI / 6);
  const ay = y2 - size * Math.sin(angle - Math.PI / 6);
  const bx = x2 - size * Math.cos(angle + Math.PI / 6);
  const by = y2 - size * Math.sin(angle + Math.PI / 6);
  return `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}" fill="${color}"/>`;
}

function renderPlotSvg(spec, { forMcp = false } = {}) {
  const W = 540;
  const H = 270;
  const pad = { left: 48, right: 24, top: spec.title ? 30 : 18, bottom: 38 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const fs = forMcp ? 13 : 10.5;
  const mapX = (x) => pad.left + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * pw;
  const mapY = (y) => pad.top + ((spec.yMax - y) / (spec.yMax - spec.yMin)) * ph;

  const els = [];
  els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  if (spec.title) {
    els.push(`<text x="${(W / 2).toFixed(1)}" y="18" font-size="${fs + 2}" font-weight="700" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.title)}</text>`);
  }

  const xTicks = tickValues(spec.xMin, spec.xMax, spec.xStep, 8).values;
  const yTicks = tickValues(spec.yMin, spec.yMax, spec.yStep, 6).values;

  if (spec.grid) {
    for (const xv of xTicks) {
      const px = mapX(xv).toFixed(1);
      els.push(`<line x1="${px}" y1="${pad.top}" x2="${px}" y2="${pad.top + ph}" stroke="#e2e8f0" stroke-width="1"/>`);
    }
    for (const yv of yTicks) {
      const py = mapY(yv).toFixed(1);
      els.push(`<line x1="${pad.left}" y1="${py}" x2="${pad.left + pw}" y2="${py}" stroke="#e2e8f0" stroke-width="1"/>`);
    }
  }

  els.push(`<rect x="${pad.left}" y="${pad.top}" width="${pw}" height="${ph}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`);

  // Shaded areas under curves (when not blank)
  if (!spec.blank) {
    for (const area of spec.areas || []) {
      const pts = [];
      const steps = 60;
      const baseY = Math.max(spec.yMin, Math.min(spec.yMax, area.y0));
      pts.push(`${mapX(area.from).toFixed(1)},${mapY(baseY).toFixed(1)}`);
      for (let s = 0; s <= steps; s++) {
        const xv = area.from + ((area.to - area.from) * s) / steps;
        const yv = evalMathExpr(area.expr, { x: xv, t: xv });
        if (!Number.isFinite(yv)) continue;
        const cy = Math.max(spec.yMin, Math.min(spec.yMax, yv));
        pts.push(`${mapX(xv).toFixed(1)},${mapY(cy).toFixed(1)}`);
      }
      pts.push(`${mapX(area.to).toFixed(1)},${mapY(baseY).toFixed(1)}`);
      if (pts.length >= 4) {
        els.push(`<polygon points="${pts.join(' ')}" fill="${escapeHtml(area.color)}" fill-opacity="0.22" stroke="none"/>`);
      }
    }
  }

  // Axes
  const zeroXInRange = spec.xMin <= 0 && spec.xMax >= 0;
  const zeroYInRange = spec.yMin <= 0 && spec.yMax >= 0;
  const axisX = zeroXInRange ? mapX(0) : pad.left;
  const axisY = zeroYInRange ? mapY(0) : pad.top + ph;
  els.push(`<line x1="${pad.left}" y1="${axisY.toFixed(1)}" x2="${(pad.left + pw + 6).toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="#0f172a" stroke-width="1.6"/>`);
  els.push(arrowHeadPoly(pad.left, axisY, pad.left + pw + 8, axisY, 7, '#0f172a'));
  els.push(`<line x1="${axisX.toFixed(1)}" y1="${pad.top + ph}" x2="${axisX.toFixed(1)}" y2="${(pad.top - 6).toFixed(1)}" stroke="#0f172a" stroke-width="1.6"/>`);
  els.push(arrowHeadPoly(axisX, pad.top + ph, axisX, pad.top - 8, 7, '#0f172a'));

  // Tick marks & numbers
  for (const xv of xTicks) {
    if (zeroXInRange && Math.abs(xv) < 1e-9 && zeroYInRange) continue;
    const px = mapX(xv);
    const ty = Math.min(pad.top + ph + 13, axisY + 14);
    els.push(`<line x1="${px.toFixed(1)}" y1="${(axisY - 3).toFixed(1)}" x2="${px.toFixed(1)}" y2="${(axisY + 3).toFixed(1)}" stroke="#334155" stroke-width="1"/>`);
    els.push(`<text x="${px.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${fs - 1}" text-anchor="middle" fill="#334155">${escapeHtml(fmtTick(xv))}</text>`);
  }
  for (const yv of yTicks) {
    if (zeroYInRange && Math.abs(yv) < 1e-9 && zeroXInRange) continue;
    const py = mapY(yv);
    const tx = Math.max(pad.left - 6, axisX - 6);
    els.push(`<line x1="${(axisX - 3).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(axisX + 3).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#334155" stroke-width="1"/>`);
    els.push(`<text x="${tx.toFixed(1)}" y="${(py + 3.5).toFixed(1)}" font-size="${fs - 1}" text-anchor="end" fill="#334155">${escapeHtml(fmtTick(yv))}</text>`);
  }

  // Axis labels
  if (spec.xLabel) {
    els.push(`<text x="${(pad.left + pw).toFixed(1)}" y="${H - 6}" font-size="${fs}" font-weight="600" text-anchor="end" fill="#0f172a">${escapeHtml(spec.xLabel)}</text>`);
  }
  if (spec.yLabel) {
    els.push(`<text x="${Math.max(10, axisX + 10).toFixed(1)}" y="${pad.top + 10}" font-size="${fs}" font-weight="600" text-anchor="start" fill="#0f172a">${escapeHtml(spec.yLabel)}</text>`);
  }

  // Curves (skipped when blank === true)
  const legendItems = [];
  if (!spec.blank) {
    const ySpan = spec.yMax - spec.yMin;
    for (const fn of spec.functions || []) {
      const segs = [];
      let cur = [];
      let prevY = null;
      const samples = fn.points?.length
        ? fn.points
        : Array.from({ length: 161 }, (_, i) => {
            const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 160;
            return [x, evalMathExpr(fn.expr, { x, t: x })];
          });
      for (const [xv, yv] of samples) {
        if (!Number.isFinite(xv) || !Number.isFinite(yv) || yv < spec.yMin - ySpan * 0.25 || yv > spec.yMax + ySpan * 0.25) {
          if (cur.length >= 2) segs.push(cur);
          cur = [];
          prevY = null;
          continue;
        }
        if (prevY != null && Math.abs(yv - prevY) > ySpan * 0.9) {
          if (cur.length >= 2) segs.push(cur);
          cur = [];
        }
        const cy = Math.max(spec.yMin, Math.min(spec.yMax, yv));
        cur.push(`${cur.length === 0 ? 'M' : 'L'}${mapX(xv).toFixed(1)},${mapY(cy).toFixed(1)}`);
        prevY = yv;
      }
      if (cur.length >= 2) segs.push(cur);
      for (const seg of segs) {
        const dash = fn.dashed ? ' stroke-dasharray="6 4"' : '';
        els.push(`<path d="${seg.join(' ')}" fill="none" stroke="${escapeHtml(fn.color)}" stroke-width="2.2"${dash}/>`);
      }
      if (fn.label) legendItems.push({ label: fn.label, color: fn.color });
    }
  }

  // Points (shown in both blank and filled modes as given/anchor points)
  for (const pt of spec.points || []) {
    if (pt.x < spec.xMin || pt.x > spec.xMax || pt.y < spec.yMin || pt.y > spec.yMax) continue;
    const px = mapX(pt.x).toFixed(1);
    const py = mapY(pt.y).toFixed(1);
    const fill = pt.open ? '#ffffff' : escapeHtml(pt.color);
    els.push(`<circle cx="${px}" cy="${py}" r="4" fill="${fill}" stroke="${escapeHtml(pt.color)}" stroke-width="2"/>`);
    if (pt.label) {
      els.push(`<text x="${(Number(px) + 6).toFixed(1)}" y="${(Number(py) - 6).toFixed(1)}" font-size="${fs - 0.5}" font-weight="600" fill="#0f172a">${escapeHtml(pt.label)}</text>`);
    }
  }

  if (legendItems.length) {
    let lx = pad.left + 8;
    const ly = pad.top + 12;
    for (const item of legendItems.slice(0, 4)) {
      els.push(`<line x1="${lx}" y1="${ly - 3}" x2="${lx + 14}" y2="${ly - 3}" stroke="${escapeHtml(item.color)}" stroke-width="2.4"/>`);
      els.push(`<text x="${lx + 18}" y="${ly}" font-size="${fs - 1}" font-weight="600" fill="#0f172a">${escapeHtml(item.label)}</text>`);
      lx += Math.min(130, 32 + item.label.length * 6.5);
    }
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${els.join('')}</svg>`,
    width: W,
    height: H,
  };
}

function renderHistogramSvg(spec, { forMcp = false } = {}) {
  const W = 540;
  const H = 260;
  const pad = { left: 50, right: 20, top: spec.title ? 30 : 18, bottom: spec.xLabel ? 46 : 34 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const fs = forMcp ? 13 : 10.5;
  const mapY = (v) => pad.top + ((spec.yMax - v) / (spec.yMax - spec.yMin)) * ph;

  const els = [];
  els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  if (spec.title) {
    els.push(`<text x="${(W / 2).toFixed(1)}" y="18" font-size="${fs + 2}" font-weight="700" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.title)}</text>`);
  }

  const yTicks = tickValues(spec.yMin, spec.yMax, spec.yStep, 5).values;
  for (const yv of yTicks) {
    const py = mapY(yv).toFixed(1);
    els.push(`<line x1="${pad.left}" y1="${py}" x2="${pad.left + pw}" y2="${py}" stroke="#e2e8f0" stroke-width="1"/>`);
    els.push(`<line x1="${pad.left - 3}" y1="${py}" x2="${pad.left}" y2="${py}" stroke="#334155" stroke-width="1"/>`);
    els.push(`<text x="${pad.left - 6}" y="${(Number(py) + 3.5).toFixed(1)}" font-size="${fs - 1}" text-anchor="end" fill="#334155">${escapeHtml(fmtTick(yv))}</text>`);
  }

  const n = spec.bins.length;
  const slotW = pw / n;
  const gap = spec.contiguous ? 0 : Math.min(14, slotW * 0.22);
  const barW = Math.max(8, slotW - gap);

  spec.bins.forEach((bin, i) => {
    const bx = pad.left + i * slotW + gap / 2;
    const cx = bx + barW / 2;
    // Vertical column guide when blank
    if (spec.blank || bin.value == null) {
      els.push(`<rect x="${bx.toFixed(1)}" y="${pad.top}" width="${barW.toFixed(1)}" height="${ph}" fill="#f8fafc" fill-opacity="0.45" stroke="#cbd5e1" stroke-width="1"/>`);
    } else {
      const clampedVal = Math.max(spec.yMin, Math.min(spec.yMax, bin.value));
      const topY = mapY(clampedVal);
      const bh = Math.max(1, pad.top + ph - topY);
      els.push(`<rect x="${bx.toFixed(1)}" y="${topY.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${escapeHtml(bin.color)}" fill-opacity="0.78" stroke="#1e293b" stroke-width="1.2"/>`);
      if (spec.showValues) {
        els.push(`<text x="${cx.toFixed(1)}" y="${Math.max(pad.top + 10, topY - 4).toFixed(1)}" font-size="${fs - 1}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(fmtTick(bin.value))}</text>`);
      }
    }
    els.push(`<text x="${cx.toFixed(1)}" y="${(pad.top + ph + 14).toFixed(1)}" font-size="${fs - 1}" text-anchor="middle" fill="#1e293b">${escapeHtml(bin.label)}</text>`);
  });

  // Axes
  els.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + ph}" stroke="#0f172a" stroke-width="1.6"/>`);
  els.push(`<line x1="${pad.left}" y1="${pad.top + ph}" x2="${pad.left + pw}" y2="${pad.top + ph}" stroke="#0f172a" stroke-width="1.6"/>`);

  if (spec.yLabel) {
    els.push(`<text x="14" y="${(pad.top + ph / 2).toFixed(1)}" font-size="${fs}" font-weight="600" text-anchor="middle" fill="#0f172a" transform="rotate(-90 14 ${(pad.top + ph / 2).toFixed(1)})">${escapeHtml(spec.yLabel)}</text>`);
  }
  if (spec.xLabel) {
    els.push(`<text x="${(pad.left + pw / 2).toFixed(1)}" y="${H - 6}" font-size="${fs}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.xLabel)}</text>`);
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${els.join('')}</svg>`,
    width: W,
    height: H,
  };
}

// The process-state diagram drawn as by hand: one line per process (the last one on top)
// over a grid, running solid blue, ready dashed green, blocked red hatching, each stretch's
// length written under it in its colour, a dot on arrival and * when it ends.
function renderStatesSvg(spec, { forMcp = false } = {}) {
  const W = 600;
  const COLORS = { run: '#2563eb', ready: '#16a34a', blocked: '#dc2626' };
  const fs = forMcp ? 12.5 : 10.5;
  const rows = [...spec.processes].reverse();
  const maxLbl = rows.reduce((m, r) => Math.max(m, r.label.length), 1);
  const pad = { left: Math.max(30, 16 + maxLbl * 8), right: 36, top: (spec.title ? 50 : 34), bottom: 34 };
  const laneH = 46;
  // Half a lane under the last process, so its numbers do not sit on the axis.
  const ph = Math.max(1, rows.length) * laneH + laneH / 2;
  const H = pad.top + ph + pad.bottom;
  const pw = W - pad.left - pad.right;
  const mapT = (t) => pad.left + ((t - spec.tStart) / (spec.tEnd - spec.tStart)) * pw;
  const els = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`];
  if (spec.title) els.push(`<text x="${pad.left}" y="18" font-size="${fs + 2.5}" font-weight="700" fill="#0f172a">${escapeHtml(spec.title)}</text>`);
  // Legend.
  const ly = spec.title ? 36 : 16;
  let lx = spec.title ? W - pad.right - 300 : pad.left;
  const legendItem = (state, label) => {
    const x = lx, y = ly;
    if (state === 'run') els.push(`<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${COLORS.run}" stroke-width="3" stroke-linecap="round"/>`);
    if (state === 'ready') els.push(`<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${COLORS.ready}" stroke-width="2.6" stroke-dasharray="6 4"/>`);
    if (state === 'blocked') for (let k = 0; k < 26; k += 4.5) els.push(`<line x1="${x + k}" y1="${y + 4}" x2="${x + k + 3.5}" y2="${y - 4}" stroke="${COLORS.blocked}" stroke-width="1.8"/>`);
    els.push(`<text x="${x + 32}" y="${y + 3.8}" font-size="${fs}" font-weight="700" fill="${COLORS[state]}">${escapeHtml(label)}</text>`);
    lx += 40 + label.length * (fs * 0.62) + 14;
  };
  legendItem('run', spec.legend.run);
  legendItem('ready', spec.legend.ready);
  legendItem('blocked', spec.legend.blocked);
  // Grid: every tick across, two lines per lane down.
  const ticks = tickValues(spec.tStart, spec.tEnd, spec.tStep, 20).values;
  const minor = ticks.length > 1 ? (ticks[1] - ticks[0]) : (spec.tEnd - spec.tStart);
  for (let t = spec.tStart; t <= spec.tEnd + 1e-9; t += minor) {
    const x = mapT(t).toFixed(1);
    els.push(`<line x1="${x}" y1="${pad.top}" x2="${x}" y2="${pad.top + ph}" stroke="#d6dbe3" stroke-width="0.8"/>`);
  }
  for (let y = pad.top; y <= pad.top + ph - laneH / 2 + 0.1; y += laneH / 2) {
    els.push(`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + pw}" y2="${y.toFixed(1)}" stroke="#d6dbe3" stroke-width="0.8"/>`);
  }
  // Axes.
  const ax = pad.top + ph;
  els.push(`<line x1="${pad.left}" y1="${pad.top - 8}" x2="${pad.left}" y2="${ax}" stroke="#0f172a" stroke-width="1.6"/>`);
  els.push(`<line x1="${pad.left}" y1="${ax}" x2="${pad.left + pw + 10}" y2="${ax}" stroke="#0f172a" stroke-width="1.6"/>`);
  els.push(`<path d="M${pad.left + pw + 10} ${ax} l-6 -3.5 v7 z" fill="#0f172a"/>`);
  for (const tv of ticks) {
    const x = mapT(tv).toFixed(1);
    els.push(`<line x1="${x}" y1="${ax - 4}" x2="${x}" y2="${ax + 4}" stroke="#0f172a" stroke-width="1.4"/>`);
    els.push(`<text x="${x}" y="${ax + 17}" font-size="${fs - 1}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(fmtTick(tv))}</text>`);
  }
  if (spec.unit) els.push(`<text x="${pad.left + pw + 14}" y="${ax - 6}" font-size="${fs - 1.5}" fill="#475569" text-anchor="middle">${escapeHtml(spec.unit)}</text>`);
  // Processes.
  rows.forEach((p, ri) => {
    const y = pad.top + ri * laneH + laneH / 2;
    els.push(`<line x1="${pad.left - 6}" y1="${y}" x2="${pad.left + 6}" y2="${y}" stroke="#0f172a" stroke-width="1.6"/>`);
    els.push(`<text x="${pad.left - 10}" y="${y + 4}" font-size="${fs + 1.5}" font-weight="700" text-anchor="end" fill="#0f172a" font-family="Georgia, serif">${escapeHtml(p.label)}</text>`);
    if (spec.blank) return;
    for (const sg of p.segments) {
      const x1 = mapT(Math.max(spec.tStart, sg.start)), x2 = mapT(Math.min(spec.tEnd, sg.end));
      if (x2 - x1 < 1) continue;
      const c = COLORS[sg.state];
      if (sg.state === 'run') els.push(`<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`);
      else if (sg.state === 'ready') els.push(`<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="${c}" stroke-width="2.6" stroke-dasharray="6 4"/>`);
      else for (let x = x1 + 1; x < x2 - 2; x += 4.5) els.push(`<line x1="${x.toFixed(1)}" y1="${y + 5}" x2="${(x + 3.5).toFixed(1)}" y2="${y - 5}" stroke="${c}" stroke-width="1.8"/>`);
      if (x2 - x1 >= 12) els.push(`<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y + 19}" font-size="${fs + 0.5}" font-weight="700" text-anchor="middle" fill="${c}">${escapeHtml(fmtTick(sg.end - sg.start))}</text>`);
    }
    if (p.arrival != null && p.arrival >= spec.tStart && p.arrival <= spec.tEnd) {
      const first = p.segments[0];
      els.push(`<circle cx="${mapT(p.arrival).toFixed(1)}" cy="${y}" r="3.6" fill="${first ? COLORS[first.state] : COLORS.ready}"/>`);
    }
    const last = p.segments[p.segments.length - 1];
    if (last && p.done && last.end <= spec.tEnd) {
      els.push(`<text x="${(mapT(last.end) + 4).toFixed(1)}" y="${y + 6}" font-size="${fs + 6}" font-weight="700" fill="${COLORS.run}">*</text>`);
    }
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(spec.title || 'Process states')}">${els.join('')}</svg>`, width: W, height: H };
}

function renderTimelineSvg(spec, { forMcp = false } = {}) {
  const W = 560;
  const maxLblLen = spec.rows.reduce((m, r) => Math.max(m, r.label.length), 3);
  const leftPad = Math.max(54, Math.min(120, 18 + maxLblLen * 7));
  const topPad = (spec.title ? 30 : 14) + (spec.markers?.length ? 16 : 0);
  const bottomPad = 38;
  // Overlapping intervals of one row (two devices busy at once, say) go on stacked
  // sub-lanes instead of drawing over each other.
  const packed = spec.rows.map((row) => {
    const ends = [], placed = [];
    for (const iv of [...(row.intervals || [])].sort((a, b) => a.start - b.start)) {
      let lane = ends.findIndex((end) => end <= iv.start + 1e-9);
      if (lane < 0) { lane = ends.length; ends.push(iv.end); } else ends[lane] = iv.end;
      placed.push({ iv, lane });
    }
    return { placed, lanes: spec.blank ? 1 : Math.max(1, ends.length) };
  });
  const subLanes = packed.reduce((n, r) => n + r.lanes, 0);
  const laneH = Math.max(26, Math.min(44, Math.floor(170 / Math.max(1, subLanes))));
  const rowY = [];
  packed.reduce((y, r, i) => { rowY[i] = y; return y + r.lanes * laneH; }, 0);
  const ph = subLanes * laneH;
  const H = topPad + ph + bottomPad;
  const pad = { left: leftPad, right: 20, top: topPad, bottom: bottomPad };
  const pw = W - pad.left - pad.right;
  const fs = forMcp ? 12.5 : 10.5;
  const mapT = (t) => pad.left + ((t - spec.tStart) / (spec.tEnd - spec.tStart)) * pw;

  const els = [];
  els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  if (spec.title) {
    els.push(`<text x="${(W / 2).toFixed(1)}" y="18" font-size="${fs + 2}" font-weight="700" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.title)}</text>`);
  }

  // Deterministic colors per interval label
  const colorMap = new Map();
  const colorFor = (label, explicit) => {
    if (explicit) return explicit;
    const key = String(label || '').toUpperCase().trim();
    if (/^(IDLE|WAIT|WAITING|STALL|ESPERA|LISTO|READY|BLOQ(UEADO)?|BLOCKED|-)$/.test(key)) return '#e2e8f0';
    // Process-state charts (one row per process): the same colour for each state in every chart.
    if (/^(CPU|EJEC(UCI[OÓ]N)?|RUN(NING)?)$/.test(key)) return '#2563eb';
    if (/^(E\/S|I\/O|IO|ES|DISCO|DISK|IMPRESORA|PRINTER)\d*$/.test(key)) return '#f59e0b';
    if (!colorMap.has(key)) colorMap.set(key, VISUAL_PALETTE[colorMap.size % VISUAL_PALETTE.length]);
    return colorMap.get(key);
  };

  // Lanes background
  spec.rows.forEach((row, ri) => {
    const ry = pad.top + rowY[ri], rh = packed[ri].lanes * laneH;
    els.push(`<rect x="${pad.left}" y="${ry}" width="${pw}" height="${rh}" fill="${ri % 2 === 0 ? '#ffffff' : '#f8fafc'}" stroke="#cbd5e1" stroke-width="1"/>`);
    els.push(`<text x="${pad.left - 8}" y="${(ry + rh / 2 + 4).toFixed(1)}" font-size="${fs}" font-weight="700" text-anchor="end" fill="#0f172a">${escapeHtml(row.label)}</text>`);
  });

  // Vertical time gridlines & bottom ticks
  const ticks = tickValues(spec.tStart, spec.tEnd, spec.tStep, 12).values;
  for (const tv of ticks) {
    const px = mapT(tv).toFixed(1);
    els.push(`<line x1="${px}" y1="${pad.top}" x2="${px}" y2="${pad.top + ph}" stroke="#cbd5e1" stroke-width="1"/>`);
    els.push(`<line x1="${px}" y1="${pad.top + ph}" x2="${px}" y2="${pad.top + ph + 4}" stroke="#0f172a" stroke-width="1.2"/>`);
    els.push(`<text x="${px}" y="${pad.top + ph + 15}" font-size="${fs - 1}" text-anchor="middle" fill="#334155">${escapeHtml(fmtTick(tv))}</text>`);
  }

  // Intervals (skipped if blank === true)
  if (!spec.blank) {
    spec.rows.forEach((row, ri) => {
      const ih = Math.max(14, laneH - 8);
      for (const { iv, lane } of packed[ri].placed) {
        const ry = pad.top + rowY[ri] + lane * laneH + 4;
        const s = Math.max(spec.tStart, Math.min(spec.tEnd, iv.start));
        const e = Math.max(spec.tStart, Math.min(spec.tEnd, iv.end));
        if (e <= s) continue;
        const x1 = mapT(s);
        const x2 = mapT(e);
        const bw = Math.max(2, x2 - x1);
        const fill = colorFor(iv.label, iv.color);
        const isIdle = fill === '#e2e8f0';
        els.push(`<rect x="${x1.toFixed(1)}" y="${ry}" width="${bw.toFixed(1)}" height="${ih}" rx="3" fill="${escapeHtml(fill)}" fill-opacity="${isIdle ? '0.9' : '0.82'}" stroke="#1e293b" stroke-width="1.2"/>`);
        if (iv.label && bw >= 16) {
          const textColor = isIdle ? '#475569' : '#ffffff';
          els.push(`<text x="${(x1 + bw / 2).toFixed(1)}" y="${(ry + ih / 2 + 3.5).toFixed(1)}" font-size="${fs - 0.5}" font-weight="700" text-anchor="middle" fill="${textColor}">${escapeHtml(iv.label)}</text>`);
        }
      }
    });
  }

  // Optional arrival / deadline markers
  for (const mk of spec.markers || []) {
    if (mk.t < spec.tStart || mk.t > spec.tEnd) continue;
    const mx = mapT(mk.t).toFixed(1);
    els.push(`<line x1="${mx}" y1="${pad.top - 5}" x2="${mx}" y2="${pad.top + ph}" stroke="#dc2626" stroke-width="1.4"/>`);
    if (mk.label) {
      els.push(`<text x="${mx}" y="${pad.top - 8}" font-size="${fs - 1.5}" font-weight="600" text-anchor="middle" fill="#dc2626">${escapeHtml(mk.label)}</text>`);
    }
  }

  els.push(`<rect x="${pad.left}" y="${pad.top}" width="${pw}" height="${ph}" fill="none" stroke="#0f172a" stroke-width="1.4"/>`);
  if (spec.xLabel) {
    els.push(`<text x="${(pad.left + pw / 2).toFixed(1)}" y="${H - 5}" font-size="${fs}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.xLabel)}</text>`);
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${els.join('')}</svg>`,
    width: W,
    height: H,
  };
}

function renderGraphSvg(spec, { forMcp = false } = {}) {
  const W = 520;
  const H = 260;
  const pad = { x: 46, y: spec.title ? 46 : 34, bottom: 32 };
  const fs = forMcp ? 13 : 11;
  const nodes = spec.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const hasCoords = nodes.every((n) => n.x != null && n.y != null);
  if (hasCoords) {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    for (const n of nodes) {
      n.px = pad.x + ((n.x - minX) / spanX) * (W - pad.x * 2);
      n.py = pad.y + ((n.y - minY) / spanY) * (H - pad.y - pad.bottom);
    }
  } else if (spec.type === 'tree') {
    // BFS level layout
    const inDeg = new Map(nodes.map((n) => [n.id, 0]));
    const adj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of spec.edges) {
      adj.get(e.from)?.push(e.to);
      inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    }
    const roots = nodes.filter((n) => (inDeg.get(n.id) || 0) === 0);
    const queue = (roots.length ? roots : [nodes[0]]).map((n) => ({ id: n.id, depth: 0 }));
    const depthOf = new Map();
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (depthOf.has(id)) continue;
      depthOf.set(id, depth);
      for (const nxt of adj.get(id) || []) {
        if (!depthOf.has(nxt)) queue.push({ id: nxt, depth: depth + 1 });
      }
    }
    for (const n of nodes) if (!depthOf.has(n.id)) depthOf.set(n.id, 0);
    const layers = new Map();
    for (const n of nodes) {
      const d = depthOf.get(n.id);
      if (!layers.has(d)) layers.set(d, []);
      layers.get(d).push(n);
    }
    const maxDepth = Math.max(1, ...layers.keys());
    const usableW = W - pad.x * 2;
    const usableH = H - pad.y - pad.bottom;
    for (const [d, list] of layers.entries()) {
      const y = layers.size === 1 ? pad.y + usableH / 2 : pad.y + (d / maxDepth) * usableH;
      list.forEach((n, idx) => {
        n.px = pad.x + ((idx + 1) / (list.length + 1)) * usableW;
        n.py = y;
      });
    }
  } else {
    // Circle layout
    const cx = W / 2;
    const cy = (pad.y + H - pad.bottom) / 2;
    const rx = Math.min(W * 0.36, 175);
    const ry = Math.min((H - pad.y - pad.bottom) * 0.42, 85);
    nodes.forEach((n, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
      n.px = nodes.length === 1 ? cx : cx + rx * Math.cos(ang);
      n.py = nodes.length === 1 ? cy : cy + ry * Math.sin(ang);
    });
  }

  const els = [];
  els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  if (spec.title) {
    els.push(`<text x="${(W / 2).toFixed(1)}" y="18" font-size="${fs + 1.5}" font-weight="700" text-anchor="middle" fill="#0f172a">${escapeHtml(spec.title)}</text>`);
  }

  const edgeKeys = new Set(spec.edges.map((e) => `${e.from}->${e.to}`));
  const nodeR = nodes.length > 8 ? 16 : 20;

  for (const e of spec.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const dash = e.dashed ? ' stroke-dasharray="5 3"' : '';
    if (a === b) {
      // Self-loop above node
      const lx = a.px;
      const ly = a.py - nodeR;
      els.push(`<path d="M${(lx - 8).toFixed(1)},${ly.toFixed(1)} C${(lx - 22).toFixed(1)},${(ly - 34).toFixed(1)} ${(lx + 22).toFixed(1)},${(ly - 34).toFixed(1)} ${(lx + 8).toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="#334155" stroke-width="1.6"${dash}/>`);
      if (e.directed) els.push(arrowHeadPoly(lx + 12, ly - 10, lx + 8, ly, 6, '#334155'));
      if (e.label) {
        els.push(`<text x="${lx.toFixed(1)}" y="${(ly - 28).toFixed(1)}" font-size="${fs - 1}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(e.label)}</text>`);
      }
      continue;
    }

    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const hasReverse = edgeKeys.has(`${e.to}->${e.from}`);
    const sx = a.px + ux * nodeR;
    const sy = a.py + uy * nodeR;
    const ex = b.px - ux * (nodeR + (e.directed ? 2 : 0));
    const ey = b.py - uy * (nodeR + (e.directed ? 2 : 0));

    if (hasReverse) {
      const mx = (sx + ex) / 2 - uy * 22;
      const my = (sy + ey) / 2 + ux * 22;
      els.push(`<path d="M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="#334155" stroke-width="1.6"${dash}/>`);
      if (e.directed) els.push(arrowHeadPoly(mx, my, ex, ey, 6.5, '#334155'));
      if (e.label) {
        els.push(`<text x="${mx.toFixed(1)}" y="${(my - 3).toFixed(1)}" font-size="${fs - 1}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(e.label)}</text>`);
      }
    } else {
      els.push(`<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#334155" stroke-width="1.6"${dash}/>`);
      if (e.directed) els.push(arrowHeadPoly(sx, sy, ex, ey, 6.5, '#334155'));
      if (e.label) {
        const lx = (sx + ex) / 2 - uy * 9;
        const ly = (sy + ey) / 2 + ux * 9;
        els.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${fs - 1}" font-weight="600" text-anchor="middle" fill="#0f172a">${escapeHtml(e.label)}</text>`);
      }
    }
  }

  for (const n of nodes) {
    const fill = n.color || '#eff6ff';
    if (n.shape === 'rect') {
      const rw = Math.max(42, n.label.length * 7.5 + 14);
      const rh = 28;
      els.push(`<rect x="${(n.px - rw / 2).toFixed(1)}" y="${(n.py - rh / 2).toFixed(1)}" width="${rw.toFixed(1)}" height="${rh}" rx="5" fill="${escapeHtml(fill)}" stroke="#1e293b" stroke-width="1.6"/>`);
    } else {
      els.push(`<circle cx="${n.px.toFixed(1)}" cy="${n.py.toFixed(1)}" r="${nodeR}" fill="${escapeHtml(fill)}" stroke="#1e293b" stroke-width="1.6"/>`);
      if (n.shape === 'doublecircle') {
        els.push(`<circle cx="${n.px.toFixed(1)}" cy="${n.py.toFixed(1)}" r="${nodeR - 4}" fill="none" stroke="#1e293b" stroke-width="1.2"/>`);
      }
    }
    els.push(`<text x="${n.px.toFixed(1)}" y="${(n.py + 4).toFixed(1)}" font-size="${fs}" font-weight="700" text-anchor="middle" fill="#0f172a">${escapeHtml(n.label)}</text>`);
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${els.join('')}</svg>`,
    width: W,
    height: H,
  };
}

/** Generates deterministic safe inline `<svg>` markup for structured visual specs (`plot`, `histogram`, `timeline`, `tree`, `graph_nodes`, `custom_svg`). */
export function renderVisualSvg(rawSpec, { forMcp = false } = {}) {
  const spec = normalizeVisualSpec(rawSpec);
  if (!spec || spec.type === 'cutout') return null;
  if (spec.type === 'custom_svg') {
    return { svg: spec.svg, width: 520, height: 260, caption: spec.caption };
  }
  if (spec.type === 'plot') return { ...renderPlotSvg(spec, { forMcp }), caption: spec.caption };
  if (spec.type === 'histogram') return { ...renderHistogramSvg(spec, { forMcp }), caption: spec.caption };
  if (spec.type === 'timeline') return { ...renderTimelineSvg(spec, { forMcp }), caption: spec.caption };
  if (spec.type === 'states') return { ...renderStatesSvg(spec, { forMcp }), caption: spec.caption };
  if (spec.type === 'tree' || spec.type === 'graph_nodes') return { ...renderGraphSvg(spec, { forMcp }), caption: spec.caption };
  return null;
}

/** Renders a normalized visual spec (inline `<svg>` or `cutout` `<img>`) into safe `.prob-visual` HTML. */
export function renderVisualHtml(rawSpec) {
  const spec = normalizeVisualSpec(rawSpec);
  if (!spec) return '';
  if (spec.type === 'cutout') {
    if (!spec.dataUrl) return '';
    return (
      `<figure class="prob-visual prob-visual-cutout">`
      + `<img src="${escapeHtml(spec.dataUrl)}" alt="${escapeHtml(spec.alt || spec.caption || 'Source figure')}" />`
      + (spec.caption ? `<figcaption class="prob-visual-caption">${renderRichExamHtml(spec.caption)}</figcaption>` : '')
      + `</figure>`
    );
  }
  const rendered = renderVisualSvg(spec, { forMcp: false });
  if (!rendered?.svg) return '';
  return (
    `<figure class="prob-visual">`
    + rendered.svg
    // A caption that only repeats the figure's title (drawn inside it) is left out.
    + (rendered.caption && rendered.caption !== spec.title ? `<figcaption class="prob-visual-caption">${renderRichExamHtml(rendered.caption)}</figcaption>` : '')
    + `</figure>`
  );
}

/** Converts a visual spec into a NoteComplete MCP `!draw` block (or caption note for raster cutouts). */
export function renderVisualMcpMarkdown(rawSpec) {
  const spec = normalizeVisualSpec(rawSpec);
  if (!spec) return '';
  if (spec.type === 'cutout') {
    return spec.caption ? `> [Figure: ${spec.caption}]` : '';
  }
  const rendered = renderVisualSvg(spec, { forMcp: true });
  if (!rendered?.svg) return '';
  const parts = [`!draw 540`, rendered.svg, `!end`];
  if (spec.caption) parts.push(`_${spec.caption}_`);
  return parts.join('\n');
}

const VISUAL_PROMPT_GUIDE = [
  'Optional `visual` (or `answerBox.visual` / `solutionVisual`) lets you include real math/CS diagrams, blank graphs-to-fill, histograms, CPU timelines, or source cutouts:',
  '- Function/coordinate plot (set `"blank": true` + omit `functions` when asking students to sketch/fill the graph, and put the filled plot in `answerBox.visual`!):',
  '  `{"type":"plot","title":"f(x)","xMin":-4,"xMax":4,"yMin":-4,"yMax":6,"xLabel":"x","yLabel":"y","grid":true,"blank":false,"functions":[{"expr":"x^2 - 1","label":"f(x)"}],"points":[{"x":0,"y":-1,"label":"(0,-1)"}],"areas":[{"expr":"x^2","from":0,"to":2}]}`',
  '- Histogram / bar chart (set `"blank": true` + `value: null` on bins for students to fill):',
  '  `{"type":"histogram","title":"Latency Distribution","xLabel":"Bucket (ms)","yLabel":"Count","yMax":12,"blank":false,"bins":[{"label":"0-5","value":3},{"label":"5-10","value":9}]}`',
  '- PREFERRED for multiprogramming / process scheduling exercises (FIFO, SJF, SRT, RR, priorities): the process-state diagram, one line per process (listed A, B, C; drawn with the last on top), each stretch `run` (activo, CPU), `ready` (listo) or `blocked` (bloqueado / E/S); set `"blank": true` with no segments for the student version and put the solved one in `answerBox.visual`. Legend labels in the exam language:',
  '  `{"type":"states","title":"FIFO","tStart":0,"tEnd":90,"tStep":5,"unit":"u.t.","legend":{"run":"Activo","ready":"Listo","blocked":"Bloqueado"},"processes":[{"label":"A","arrival":0,"segments":[{"state":"run","start":0,"end":10},{"state":"blocked","start":10,"end":25},{"state":"run","start":25,"end":30}]},{"label":"B","arrival":5,"segments":[{"state":"ready","start":5,"end":10},{"state":"run","start":10,"end":15}]}]}`',
  '- CPU scheduling / execution timeline / Gantt chart (set `"blank": true` with empty `intervals` so students draw the schedule, and put the completed Gantt chart in `answerBox.visual` / `solutionVisual`!). For multiprogramming / resource occupancy diagrams use ONE ROW PER PROCESS, the last process on top (rows "C", "B", "A"), and label each interval with what the process is doing: "CPU", "E/S" (or the device) or "Espera" — each state keeps its own colour:',
  '  `{"type":"timeline","title":"CPU Schedule (RR q=2)","tStart":0,"tEnd":10,"tStep":1,"unit":"ms","blank":false,"rows":[{"label":"CPU","intervals":[{"label":"P1","start":0,"end":2},{"label":"P2","start":2,"end":5}]}]}`',
  '- Tree / FSM / node-edge graph: `{"type":"tree","directed":true,"nodes":[{"id":"A","label":"10"},{"id":"B","label":"5"}],"edges":[{"from":"A","to":"B","label":"L"}]}` (or `"type":"graph_nodes"` / `"type":"custom_svg"` with pure `<svg viewBox="0 0 520 260">...</svg>`).',
  '- Source figure cutout (ONLY when attached visual source pages/images exist): `{"type":"cutout","sourceIndex":0,"page":2,"bbox":[x,y,w,h],"caption":"Figure from source"}` with normalized `0..1` `[x,y,w,h]`.',
].join('\n');

export function examPrompt({
  title = '',
  sourcesText = '',
  visualCatalogText = '',
  types = ['mcq', 'fill', 'calculation', 'open', 'table', 'code'],
  countMode = 'auto',
  count = 12,
  difficulty = 'exam',
  focus = 'important',
  language = 'auto',
  includeTheory = true,
  instructions = '',
} = {}) {
  const pickedTypes = types?.length ? types : ['mcq', 'fill', 'open'];
  const focusText = FOCUS_RULES[focus] || FOCUS_RULES.important;
  const countLine = countMode === 'exact'
    ? `Create exactly ${Math.max(1, Math.min(60, Number(count) || 12))} distinct problems across logical sections.`
    : 'Choose the optimal number of problems yourself (as many as needed to match the requested focus without padding or cutting off important sections; for comprehensive requests, be thorough).';
  const langLine = language && language !== 'auto'
    ? `Write every heading, question, option, table, theory box, and answer strictly in ${language}.`
    : 'Write in the primary language of the provided sources.';
  const diffMap = {
    easy: 'Introductory / foundation check: clear conceptual checks and straightforward exercises.',
    exam: 'Authentic university/certification exam rigor: realistic edge cases, multi-step reasoning, and common pitfalls.',
    hard: 'Challenging advanced problems: synthesis across topics, tricky edge cases, proofs/derivations, and subtle traps.',
  };

  const hasRichKinds = pickedTypes.some((t) => ['open', 'calculation', 'code', 'table'].includes(t));
  const balanceRule = hasRichKinds
    ? 'CRITICAL EXERCISE MIX RULE: Whenever the sources contain algorithms, systems/architectural mechanisms, formulas, scheduling, memory management, proofs, or design tradeoffs, you MUST include genuine multi-step development, calculation, table, or code-trace exercises (`open`, `calculation`, `table`, `code` with clear sub-parts and `writingLines` / `expressions`). Do NOT default mostly to True/False or shallow one-line MCQs when real developable exercises can be crafted; keep True/False or short MCQs only as a minor share (or only when a source truly contains nothing deeper than factual T/F statements).'
    : '';

  return [
    'You are an expert professor designing a rich, printable A4 written examination from the student’s study sources.',
    title.trim() ? `Requested exam title: ${title.trim()}` : '',
    langLine,
    `Difficulty: ${diffMap[difficulty] || diffMap.exam}`,
    `Coverage focus: ${focusText}`,
    countLine,
    `Include ONLY these problem kinds (distribute them naturally based on what each topic suits best): ${pickedTypes.join(', ')}.`,
    balanceRule,
    includeTheory
      ? 'For sections or tricky questions where background intuition helps, include a concise `theory` field explaining the underlying rule.'
      : 'Omit standalone theory boxes (`"theory": ""`).',
    instructions?.trim() ? `Extra teacher instructions: ${instructions.trim()}` : '',
    '',
    'Reply with ONLY valid JSON (no markdown fences, no commentary outside JSON) with this exact schema:',
    '{',
    '  "title": "Exam title",',
    '  "subtitle": "Short scope & estimated time summary",',
    '  "sections": [',
    '    {',
    '      "heading": "Topic / Block title",',
    '      "badge": "BLOCK 1",',
    '      "badgeKind": "exam | src | prj",',
    '      "intro": "Optional 1-2 line context",',
    '      "theory": "Optional concise theory foundation for this section (2-4 sentences)",',
    '      "problems": [',
    '        {',
    '          "number": "1.1",',
    '          "kind": "mcq | fill | calculation | open | table | code",',
    '          "sourceRef": "Short source attribution if helpful",',
    '          "points": 1.5,',
    '          "prompt": "Complete problem statement or sub-question instructions",',
    '          "visual": null,',
    '          "options": ["Option A text", "Option B text", "Option C text", "Option D text"],',
    '          "expressions": [{"label": "a) Convert 0x3F to binary:", "answerWidth": "medium"}],',
    '          "writingLines": 4,',
    '          "table": {"headers": ["Col A", "Col B", "Col C"], "rows": [["given", "", ""], ["", "given", ""]]},',
    '          "code": "Optional code/assembly/pseudocode snippet for code/trace questions",',
    '          "answerBox": {',
    '            "summary": "Clear direct final answer (visible under tape!)",',
    '            "steps": "Step-by-step justification / calculation / explanation",',
    '            "visual": null,',
    '            "trap": "Optional common mistake or exam trap to avoid"',
    '          }',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Rules per problem kind:',
    '- `mcq`: include 4 plausible `options`. Put the winning option letter + brief justification in `answerBox`.',
    '- `fill`: include `expressions` (1-5 short prompts/conversions/identities that students fill on a blank line). Put exact filled results in `answerBox`.',
    '- `calculation`: state given values clearly, optionally set `writingLines` (4-8), and put complete worked formulas + numeric result in `answerBox.steps` + `answerBox.summary`.',
    '- `open`: set `writingLines` (3-7) for ruled workspace and put model grading key + expected points in `answerBox`.',
    '- `table`: include `table` with `headers` and partially blank `rows`, plus the completed values/explanation in `answerBox`.',
    '- `code`: include `code` snippet (and optional `writingLines`), plus execution output / bug fix / complexity in `answerBox`.',
    '',
    VISUAL_PROMPT_GUIDE,
    'Use `visual` whenever a question involves functions/plots, distributions/histograms, CPU scheduling/timing Gantt charts, trees/FSMs/graphs, circuits, or source figures.',
    '',
    'IMPORTANT: Answers are NOT inside dropdowns — they print as the solution under removable Noteful Tape. Keep every `answerBox` crisp, self-contained and scannable: use **bold** for the titles of the parts of a solution ("**Ejecución secuencial:**"), put each step on its own line starting with its number ("1. ", "2. " or "Paso 1: "), put the parts of a step on the following lines indented with two spaces (or as "- " bullets), and separate paragraphs with a blank line (\\n\\n) instead of one dense block. When a figure explains the answer better (completed Gantt chart, filled plot/histogram/table, tree, graph), give it as `answerBox.visual`, alone or alongside the text.',
    visualCatalogText ? `\nAVAILABLE VISUAL SOURCES FOR CUTOUTS:\n${visualCatalogText}` : '',
    '',
    'STUDY SOURCES:',
    sourcesText,
  ].filter(Boolean).join('\n');
}

const VALID_KINDS = new Set(['mcq', 'fill', 'calculation', 'open', 'table', 'code']);

export function cleanExamData(raw) {
  if (!raw || typeof raw !== 'object') throw Error('The AI did not return structured exam JSON.');
  const rawSections = Array.isArray(raw.sections) && raw.sections.length
    ? raw.sections
    : Array.isArray(raw.problems)
      ? [{ heading: 'Exam Problems', badge: 'EXAM', badgeKind: 'exam', problems: raw.problems }]
      : [];
  let seq = 1;
  const sections = rawSections.map((sec, si) => {
    const problems = (Array.isArray(sec?.problems) ? sec.problems : [])
      .filter((p) => p && typeof p.prompt === 'string' && p.prompt.trim())
      .map((p, pi) => {
        const kind = VALID_KINDS.has(String(p.kind || '').toLowerCase())
          ? String(p.kind).toLowerCase()
          : Array.isArray(p.options) && p.options.length >= 2
            ? 'mcq'
            : p.table?.headers?.length
              ? 'table'
              : typeof p.code === 'string' && p.code.trim()
                ? 'code'
                : Array.isArray(p.expressions) && p.expressions.length
                  ? 'fill'
                  : 'open';
        const ans = p.answerBox && typeof p.answerBox === 'object'
          ? p.answerBox
          : { summary: String(p.answer || p.solution || ''), steps: String(p.explanation || ''), trap: '' };
        const summary = String(ans.summary ?? ans.final ?? '').trim();
        const steps = String(ans.steps ?? ans.explanation ?? '').trim();
        const trap = String(ans.trap ?? ans.warning ?? '').trim();
        const visual = normalizeVisualSpec(p.visual ?? p.figure ?? null);
        const ansVisual = normalizeVisualSpec(ans.visual ?? ans.figure ?? null);
        return {
          number: String(p.number || `${si + 1}.${pi + 1 || seq++}`),
          kind,
          sourceRef: String(p.sourceRef || '').trim(),
          points: Number.isFinite(Number(p.points)) && Number(p.points) > 0 ? Number(p.points) : null,
          prompt: p.prompt.trim(),
          visual,
          options: Array.isArray(p.options) ? p.options.map((o) => String(o ?? '').trim()).filter(Boolean) : [],
          expressions: Array.isArray(p.expressions)
            ? p.expressions
                .map((ex) => (typeof ex === 'string' ? { label: ex, answerWidth: 'medium' } : ex))
                .filter((ex) => ex && String(ex.label || '').trim())
            : [],
          writingLines: Math.max(0, Math.min(10, Number(p.writingLines) || (kind === 'open' ? 6 : kind === 'calculation' ? 7 : 0))),
          table: p.table && Array.isArray(p.table.headers) && Array.isArray(p.table.rows) ? p.table : null,
          code: typeof p.code === 'string' ? p.code.trim() : '',
          answerBox: {
            summary: summary || steps || 'See worked solution.',
            steps: summary && steps && steps !== summary ? steps : (summary ? steps : ''),
            visual: ansVisual,
            trap,
          },
        };
      });
    return {
      heading: String(sec?.heading || `Section ${si + 1}`).trim(),
      badge: String(sec?.badge || `PART ${si + 1}`).trim(),
      badgeKind: ['exam', 'src', 'prj'].includes(sec?.badgeKind) ? sec.badgeKind : 'exam',
      intro: String(sec?.intro || '').trim(),
      theory: String(sec?.theory || '').trim(),
      problems,
    };
  }).filter((s) => s.problems.length > 0);

  if (!sections.length) throw Error('The exam response contained no valid problems.');
  return {
    title: String(raw.title || 'Practice Examination').trim(),
    subtitle: String(raw.subtitle || '').trim(),
    sections,
  };
}

export const EXAM_PRINT_CSS = `
  @page { size: 210mm 297mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 10.2pt;
    line-height: 1.48;
    color: #1a202c;
    background: #ffffff;
  }
  .exam-page {
    width: 210mm;
    height: 297mm;
    padding: 9mm 11mm;
    background: #ffffff;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .exam-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .exam-hdr {
    border-bottom: 2.2px solid #0f172a;
    padding-bottom: 7px;
    margin-bottom: 12px;
  }
  .exam-hdr h1 {
    font-size: 15.5pt;
    color: #0f172a;
    margin: 0 0 4px 0;
    letter-spacing: -0.2px;
  }
  .exam-meta {
    font-size: 9pt;
    color: #475569;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
  }
  .student-strip {
    margin-top: 7px;
    padding: 6px 9px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 9pt;
    color: #334155;
    display: flex;
    gap: 14px;
  }
  .student-strip span { flex: 1; border-bottom: 1px dashed #94a3b8; padding-bottom: 1px; }
  .sec-hdr {
    margin-top: 8px;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 11.4pt;
    background: #0f172a;
    color: #ffffff;
    padding: 5px 9px;
    margin: 0 0 6px 0;
    border-radius: 3px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .sec-intro {
    margin: 0 0 7px 0;
    color: #334155;
    font-size: 9.5pt;
  }
  .badge {
    display: inline-block;
    padding: 1.5px 6px;
    border-radius: 3px;
    font-size: 7.4pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    vertical-align: middle;
  }
  .badge.exam { background: #dc2626; color: #ffffff; }
  .badge.src  { background: #2563eb; color: #ffffff; }
  .badge.prj  { background: #059669; color: #ffffff; }
  .theory-box {
    background: #eff6ff;
    border: 1px solid #93c5fd;
    border-left: 4px solid #2563eb;
    padding: 9px 12px;
    border-radius: 4px;
    margin: 8px 0 12px 0;
    font-size: 9.5pt;
    line-height: 1.5;
    color: #1e3a8a;
  }
  .theory-box strong.lbl {
    color: #1d4ed8;
    font-size: 8.4pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    display: block;
    margin-bottom: 4px;
  }
  /* No card box: problems use the page's full width, separated by a thin rule. */
  .prob-card {
    padding: 4px 0 14px 0;
    margin-bottom: 14px;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
    break-inside: avoid;
  }
  .prob-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 5px;
  }
  .prob-num {
    font-weight: 800;
    color: #0f172a;
    font-size: 10.4pt;
  }
  .prob-kind {
    font-size: 7.6pt;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: 3px;
    background: #e2e8f0;
    color: #334155;
  }
  .prob-pts {
    margin-left: auto;
    font-size: 8.4pt;
    color: #475569;
    font-weight: 600;
  }
  .prob-prompt {
    margin: 0 0 7px 0;
    white-space: pre-wrap;
  }
  .mc-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px 12px;
    margin: 6px 0;
  }
  .mc-opt {
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 9.4pt;
    background: #f8fafc;
  }
  .expr-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin: 6px 0;
    font-size: 9.6pt;
  }
  .fill-line {
    flex: 1;
    min-width: 75px;
    border-bottom: 1.5px solid #475569;
    height: 18px;
  }
  .writing-lines { margin: 10px 0 4px 0; }
  .wline { border-bottom: 1px solid #cbd5e1; height: 32px; }
  table.exam-tbl {
    width: 100%;
    border-collapse: collapse;
    margin: 7px 0;
    font-size: 9.2pt;
  }
  table.exam-tbl th {
    background: #1e293b;
    color: #ffffff;
    text-align: left;
    padding: 5px 7px;
    border: 1px solid #334155;
  }
  table.exam-tbl td {
    border: 1px solid #cbd5e1;
    padding: 5px 7px;
    min-height: 20px;
  }
  pre.exam-code {
    background: #0f172a;
    color: #e2e8f0;
    padding: 7px 9px;
    border-radius: 4px;
    font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
    font-size: 8.6pt;
    line-height: 1.44;
    margin: 6px 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* The solution (covered by answer tape): plain text across the full width, no box,
     larger and airier than the question so it reads well once the tape is peeled. */
  .key {
    margin-top: 16px;
    padding: 6px 0 4px 0;
    font-size: 10.6pt;
    line-height: 1.72;
    color: #14532d;
  }
  .key strong.lbl {
    display: block;
    color: #15803d;
    font-size: 8.2pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 4px;
  }
  .key p.sp { margin: 0 0 10px 0; }
  .key p.sp:last-child { margin-bottom: 0; }
  .key .ln { display: block; }
  /* Steps: bold label with a hanging indent; their parts and bullets indented under them. */
  .key .ln.step { padding-left: 1.7em; text-indent: -1.7em; margin-top: 4px; }
  .key .ln.step:first-child { margin-top: 0; }
  .key .step-n { font-weight: 700; color: #0f172a; }
  .key .sp-head { font-weight: 700; color: #0f172a; }
  .key .key-sum .sp-head { color: inherit; }
  .key .ln.in1 { padding-left: 1.7em; }
  .key .ln.in2 { padding-left: 3.2em; }
  .key .ln.in3 { padding-left: 4.7em; }
  .key .ln.bul { position: relative; }
  .key .ln.bul::before { content: "•"; position: absolute; margin-left: -0.9em; color: #64748b; }
  .key .ln.in1.step { padding-left: 3.4em; text-indent: -1.7em; }
  .key-steps { margin-top: 12px; line-height: 1.75; color: #1f2937; }
  .key .prob-visual { margin: 12px 0; border: 0; }
  /* The rest of a problem or solution continued on the next page (exam-pdf.js splitting). */
  .split-cont { border-top: 0; margin-top: 0; padding-top: 0; }
  .bad {
    margin-top: 12px;
    font-size: 10pt;
    line-height: 1.65;
    color: #991b1b;
  }
  .bad strong { color: #b91c1c; }
  math { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", "Noto Serif", Georgia, serif; font-size: 1.05em; }
  .math-block { display: block; margin: 7px 0; text-align: center; }
  .solve-steps-box {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-left: 4px solid #475569;
    padding: 9px 11px;
    border-radius: 4px;
    margin: 9px 0;
  }
  .solve-steps-box strong.lbl {
    display: block;
    font-size: 8.6pt;
    text-transform: uppercase;
    letter-spacing: 0.35px;
    color: #334155;
    margin-bottom: 6px;
  }
  .solve-step-item { margin: 6px 0 8px 0; }
  .solve-step-work { border-bottom: 1px dashed #cbd5e1; height: 24px; margin-top: 4px; }
  .solve-sol-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0f172a;
    color: #ffffff;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 11px;
    font-size: 11.2pt;
    font-weight: 700;
  }
  .solve-part-ans { margin: 14px 0; padding: 4px 0; font-size: 10.6pt; line-height: 1.72; }
  .solve-part-ans .ans-final { font-weight: 700; color: #14532d; }
  .solve-part-ans .ans-work { margin-top: 8px; line-height: 1.75; white-space: pre-wrap; color: #1f2937; }
  .solve-card-free { break-inside: auto; }
  .prob-visual {
    margin: 6px 0;
    padding: 5px 6px;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    background: #ffffff;
    break-inside: avoid;
    page-break-inside: avoid;
    text-align: center;
  }
  .prob-visual svg {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    height: auto;
    max-height: 280px;
  }
  .prob-visual img {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    max-height: 280px;
    width: auto;
    height: auto;
    object-fit: contain;
  }
  .prob-visual-caption {
    margin-top: 3px;
    font-size: 7.8pt;
    color: #475569;
    font-style: italic;
  }
  @media screen {
    body { background: #e2e8f0; padding: 14px 0; }
    .exam-page { margin: 0 auto 14px auto; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
  }
`;

function renderProblemHtml(p) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const parts = [];
  parts.push(`<article class="prob-card">`);
  parts.push(
    `<div class="prob-head">`
      + `<span class="prob-num">${escapeHtml(p.number)}</span>`
      + `<span class="prob-kind">${escapeHtml(p.kind)}</span>`
      + (p.sourceRef ? `<span class="badge src">${escapeHtml(p.sourceRef)}</span>` : '')
      + (p.points != null ? `<span class="prob-pts">${escapeHtml(p.points)} pts</span>` : '')
      + `</div>`,
  );
  parts.push(`<p class="prob-prompt">${renderRichExamHtml(p.prompt)}</p>`);

  if (p.visual) {
    const visHtml = renderVisualHtml(p.visual);
    if (visHtml) parts.push(visHtml);
  }
  if (p.code) {
    parts.push(`<pre class="exam-code"><code>${escapeHtml(p.code)}</code></pre>`);
  }
  if (p.options?.length) {
    parts.push(
      `<div class="mc-grid">`
        + p.options.map((opt, idx) => `<div class="mc-opt"><strong>${letters[idx] || idx + 1})</strong> ${renderRichExamHtml(opt)}</div>`).join('')
        + `</div>`,
    );
  }
  if (p.expressions?.length) {
    for (const ex of p.expressions) {
      parts.push(`<div class="expr-row"><span>${renderRichExamHtml(ex.label)}</span><span class="fill-line"></span></div>`);
    }
  }
  if (p.table?.headers?.length) {
    const ths = p.table.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
    const rows = (p.table.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
    parts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (p.writingLines > 0) {
    parts.push(`<div class="writing-lines">${'<div class="wline"></div>'.repeat(p.writingLines)}</div>`);
  }

  const ansVisHtml = p.answerBox?.visual ? renderVisualHtml(p.answerBox.visual) : '';
  parts.push(
    `<div class="key" data-tape-answer="solution">`
      + `<strong class="lbl">Solution</strong>`
      + `<div class="key-sum">${renderExamParagraphs(p.answerBox.summary)}</div>`
      + (p.answerBox.steps ? `<div class="key-steps">${renderExamParagraphs(p.answerBox.steps)}</div>` : '')
      + ansVisHtml
      + (p.answerBox.trap ? `<div class="bad"><strong>Watch out:</strong> ${renderRichExamHtml(p.answerBox.trap)}</div>` : '')
      + `</div>`,
  );
  parts.push(`</article>`);
  return parts.join('\n');
}

export function buildPaginatedExamHtml(exam, { showTheory = true, interactiveFallback = false } = {}) {
  const totalProblems = exam.sections.reduce((acc, s) => acc + s.problems.length, 0);
  const totalPts = exam.sections.reduce((acc, s) => acc + s.problems.reduce((a, p) => a + (p.points || 0), 0), 0);
  const blocks = [];

  blocks.push(
    `<header class="exam-hdr">`
      + `<h1>${escapeHtml(exam.title)}</h1>`
      + `<div class="exam-meta">`
      + `<span>${escapeHtml(exam.subtitle || 'AI-generated practice exam with pre-applied Noteful tape answers')}</span>`
      + `<span>${totalProblems} problem${totalProblems === 1 ? '' : 's'}${totalPts > 0 ? ` · ${totalPts.toFixed(1).replace(/\.0$/, '')} pts` : ''}</span>`
      + `</div>`
      + `<div class="student-strip"><span>Name:</span><span>Date:</span><span>Score: ____ / ${totalPts > 0 ? totalPts.toFixed(1).replace(/\.0$/, '') : totalProblems}</span></div>`
      + `</header>`,
  );

  for (const sec of exam.sections) {
    blocks.push(
      `<div class="sec-hdr">`
        + `<h2><span class="badge ${escapeHtml(sec.badgeKind)}">${escapeHtml(sec.badge)}</span> ${renderRichExamHtml(sec.heading)}</h2>`
        + (sec.intro ? `<p class="sec-intro">${renderRichExamHtml(sec.intro)}</p>` : '')
        + (showTheory && sec.theory
          ? `<div class="theory-box" data-tape-answer="theory"><strong class="lbl">Theory Foundation</strong>${renderRichExamHtml(sec.theory)}</div>`
          : '')
        + `</div>`,
    );
    for (const p of sec.problems) {
      blocks.push(renderProblemHtml(p));
    }
  }

  return wrapExamHtmlDocument(exam.title, blocks, { interactiveFallback });
}

function wrapExamHtmlDocument(title, blocks, { interactiveFallback = false } = {}) {
  const interactiveCss = interactiveFallback
    ? `.key[data-tape-answer],.theory-box[data-tape-answer]{cursor:pointer;position:relative;}
       .key[data-tape-answer]:not(.revealed)::after,.theory-box[data-tape-answer]:not(.revealed)::after{
         content:"Click to peel Noteful answer tape";position:absolute;inset:0;display:grid;place-items:center;
         font-weight:700;font-size:8.5pt;color:#422006;background:repeating-linear-gradient(-45deg,#facc15,#facc15 10px,#eab308 10px,#eab308 20px);border-radius:4px;
       }
       .theory-box[data-tape-answer]:not(.revealed)::after{color:#0c4a6e;background:repeating-linear-gradient(-45deg,#7dd3fc,#7dd3fc 10px,#38bdf8 10px,#38bdf8 20px);}`
    : '';
  const interactiveScript = interactiveFallback
    ? `<script>document.addEventListener('click',function(e){var b=e.target.closest('[data-tape-answer]');if(b)b.classList.toggle('revealed');});</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';${interactiveFallback ? " script-src 'unsafe-inline';" : ''} img-src data:; font-src data:;" />
  <title>${escapeHtml(title)}</title>
  <style>${EXAM_PRINT_CSS}${interactiveCss}</style>
</head>
<body>
  <div class="exam-flow">${blocks.join('\n')}</div>
  <div class="exam-pages"></div>
  ${interactiveScript}
</body>
</html>`;
}

// ---- Stage 1 / Stage 2 / Stage 3 parallel exam planning & solving ----

export function buildSourceCatalog(docs = [], maxExcerptChars = 360) {
  return (docs || []).map((d, idx) => {
    const clean = String(d?.text || '').replace(/\s+/g, ' ').trim();
    const snippet = clean.length > maxExcerptChars ? `${clean.slice(0, maxExcerptChars)}…` : clean;
    const folder = d?.folderName ? ` [${d.folderName}]` : '';
    return `[${idx}] "${d?.title || `Source ${idx + 1}`}"${folder} (${String(d?.text || '').length} chars): ${snippet || '(scanned/image content)'}`;
  }).join('\n');
}

export function buildFallbackExamPlan(docs = [], { countMode = 'auto', count = 12, maxChunks = 4, targetChars = 15000 } = {}) {
  const nDocs = docs?.length || 0;
  if (!nDocs) return [];
  const totalChars = docs.reduce((s, d) => s + String(d?.text || '').length, 0);
  const desiredChunks = nDocs === 1
    ? 1
    : Math.max(1, Math.min(maxChunks, nDocs, Math.max(2, Math.ceil(totalChars / targetChars))));

  const buckets = Array.from({ length: desiredChunks }, () => ({ docIndices: [], chars: 0 }));
  docs.forEach((d, idx) => {
    // Place each doc into the lightest bucket so parallel subagents finish at similar times.
    let best = 0;
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].chars < buckets[best].chars) best = i;
    }
    buckets[best].docIndices.push(idx);
    buckets[best].chars += String(d?.text || '').length || 1200;
  });

  const nonEmpty = buckets.filter((b) => b.docIndices.length > 0);
  const exactTotal = countMode === 'exact' ? Math.max(1, Math.min(60, Number(count) || 12)) : 0;
  return nonEmpty.map((b, i) => {
    const share = exactTotal
      ? Math.max(1, Math.floor(exactTotal / nonEmpty.length) + (i < exactTotal % nonEmpty.length ? 1 : 0))
      : 0;
    const firstTitle = docs[b.docIndices[0]]?.title || `Block ${i + 1}`;
    const heading = b.docIndices.length === 1 ? firstTitle : `${firstTitle} & related (${b.docIndices.length} sources)`;
    return {
      heading,
      badge: `BLOCK ${i + 1}`,
      badgeKind: i === 0 ? 'exam' : i % 2 === 1 ? 'src' : 'prj',
      docIndices: b.docIndices,
      count: share,
      focusNote: '',
    };
  });
}

export function examPlanPrompt({
  title = '',
  catalogText = '',
  docCount = 1,
  countMode = 'auto',
  count = 12,
  focus = 'important',
  language = 'auto',
} = {}) {
  const langLine = language && language !== 'auto'
    ? `Use ${language} for headings and subtitles.`
    : 'Match the primary language of the catalog sources.';
  const countRule = countMode === 'exact'
    ? `Distribute exactly ${Math.max(1, Math.min(60, Number(count) || 12))} total questions across the chunks (sum of all \`count\` fields MUST equal ${Math.max(1, Math.min(60, Number(count) || 12))}).`
    : 'Set each chunk `count` to 3-6 questions depending on content density (or 0 to let the worker decide).';
  return [
    'You are the orchestrator separating study sources into 2 to 4 balanced, cohesive topic blocks so parallel subagents can write questions simultaneously.',
    title ? `Exam title: "${title}"` : '',
    langLine,
    `Coverage focus: ${focus}.`,
    countRule,
    `Every source index 0..${Math.max(0, docCount - 1)} must appear in at least one chunk.`,
    'CRITICAL: Organize blocks by SUBJECT TOPIC — NEVER create blocks dedicated solely to "True/False" or shallow trivia when sources cover developable concepts, formulas, algorithms, or system exercises. In `focusNote`, tell each block worker to include genuine multi-step development, calculation, derivation, or trace exercises whenever the assigned sources support them.',
    '',
    'Reply with ONLY valid JSON:',
    '{',
    '  "title": "Suggested exam title",',
    '  "subtitle": "Short exam scope summary",',
    '  "chunks": [',
    '    {',
    '      "heading": "Cohesive block topic name",',
    '      "badge": "BLOCK 1",',
    '      "badgeKind": "exam | src | prj",',
    '      "docIndices": [0, 1],',
    '      "count": 4,',
    '      "focusNote": "Key concepts to emphasize in this block"',
    '    }',
    '  ]',
    '}',
    '',
    'SOURCE CATALOG:',
    catalogText,
  ].filter(Boolean).join('\n');
}

export function cleanExamPlan(raw, docs = [], { countMode = 'auto', count = 12 } = {}) {
  const maxIdx = Math.max(0, (docs?.length || 1) - 1);
  const rawChunks = Array.isArray(raw?.chunks) ? raw.chunks : [];
  const valid = rawChunks
    .map((c, i) => ({
      heading: String(c?.heading || `Block ${i + 1}`).trim(),
      badge: String(c?.badge || `BLOCK ${i + 1}`).trim().slice(0, 16),
      badgeKind: ['exam', 'src', 'prj'].includes(c?.badgeKind) ? c.badgeKind : 'exam',
      docIndices: [...new Set((Array.isArray(c?.docIndices) ? c.docIndices : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxIdx))],
      count: Math.max(0, Math.min(30, Number(c?.count) || 0)),
      focusNote: String(c?.focusNote || '').trim(),
    }))
    .filter((c) => c.docIndices.length > 0)
    .slice(0, 6);

  if (!valid.length) return { title: '', subtitle: '', chunks: buildFallbackExamPlan(docs, { countMode, count }) };

  // Ensure every document was assigned somewhere.
  const covered = new Set(valid.flatMap((c) => c.docIndices));
  for (let i = 0; i < (docs?.length || 0); i++) {
    if (!covered.has(i)) valid[i % valid.length].docIndices.push(i);
  }
  if (countMode === 'exact') {
    const want = Math.max(1, Math.min(60, Number(count) || 12));
    let sum = valid.reduce((a, c) => a + c.count, 0);
    if (sum <= 0) {
      valid.forEach((c, i) => { c.count = Math.max(1, Math.floor(want / valid.length) + (i < want % valid.length ? 1 : 0)); });
    } else if (sum !== want) {
      valid[valid.length - 1].count = Math.max(1, valid[valid.length - 1].count + (want - sum));
    }
  }
  return {
    title: String(raw?.title || '').trim(),
    subtitle: String(raw?.subtitle || '').trim(),
    chunks: valid,
  };
}

// Deterministic Stage-3 Composer: stitches ordered parallel worker JSON results without extra LLM calls.
export function mergeExamSections(chunkExams = [], { title = '', subtitle = '' } = {}) {
  const sections = [];
  const seenPrompts = new Set();
  for (let ci = 0; ci < (chunkExams || []).length; ci++) {
    const ex = chunkExams[ci];
    if (!ex?.sections?.length) continue;
    for (const sec of ex.sections) {
      const secIndex = sections.length + 1;
      const problems = [];
      for (const p of sec.problems || []) {
        const key = String(p.prompt || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        if (!key || seenPrompts.has(key)) continue;
        seenPrompts.add(key);
        problems.push({ ...p, number: `${secIndex}.${problems.length + 1}` });
      }
      if (problems.length) {
        sections.push({
          ...sec,
          badge: sec.badge || `BLOCK ${secIndex}`,
          problems,
        });
      }
    }
  }
  if (!sections.length) throw Error('Parallel workers produced no valid exam problems.');
  return {
    title: String(title || chunkExams[0]?.title || 'Practice Examination').trim(),
    subtitle: String(subtitle || chunkExams[0]?.subtitle || '').trim(),
    sections,
  };
}

// ---- Solve Fed Exam: Stage 1 Splitter -> Stage 2 Parallel Solvers -> Stage 3 Alternating Composer ----

export function splitExamHeuristically(sourcesText = '', title = 'Solved Exam') {
  const text = String(sourcesText || '').trim();
  if (!text) return [];
  const rawParts = text
    .split(/(?=(?:^|\n)\s*(?:Ejercicio|Exercise|Problema|Problem|Cuesti[oó]n|Pregunta|Question|Parte|Part)\s*\d+[\s.:)-])/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  const chunks = rawParts.length ? rawParts : [text];
  return chunks.slice(0, 20).map((statement, i) => ({
    number: String(i + 1),
    title: statement.split('\n')[0].trim().slice(0, 90) || `${title} — ${i + 1}`,
    kind: 'open',
    points: null,
    statement,
    parts: [],
    options: [],
    code: '',
    table: null,
  }));
}

export function solveSplitPrompt({ title = '', sourcesText = '', visualCatalogText = '', language = 'auto', instructions = '' } = {}) {
  const langLine = language && language !== 'auto'
    ? `Detected/target language hint: ${language}. Keep the exact problem wording in its original language.`
    : 'Preserve the original language and verbatim wording of every question.';
  return [
    'You are the Exam Splitter agent. Cut the provided exam into clean, ordered, self-contained exercises/questions so separate solver subagents can solve each one independently in parallel.',
    title ? `Exam label: "${title}"` : '',
    langLine,
    instructions?.trim() ? `User notes: ${instructions.trim()}` : '',
    '',
    'Rules:',
    '- Preserve EVERY exercise/problem/question and all sub-parts (a), b), c)...) accurately; keep formulas in $...$ or $$...$$ LaTeX.',
    '- Keep tables, code snippets, numeric values, and MCQ options intact inside their exercise object.',
    '- If an exercise has a figure/graph/diagram/circuit on an attached source page/image, preserve it in `visual` using `{"type":"cutout","sourceIndex":0,"page":P,"bbox":[x,y,w,h],"caption":"..."}` (normalized `0..1` coordinates) OR reconstruct a structured `visual` (`plot`, `histogram`, `timeline`, `tree`, `graph_nodes`).',
    '- Do NOT solve the questions yet — ONLY split and transcribe each exercise cleanly.',
    '',
    'Reply with ONLY valid JSON:',
    '{',
    '  "title": "Exam title",',
    '  "language": "Spanish | English | French | German | ...",',
    '  "exercises": [',
    '    {',
    '      "number": "1",',
    '      "title": "Short descriptive topic",',
    '      "kind": "mcq | fill | calculation | open | table | code",',
    '      "points": 2.5,',
    '      "statement": "Complete problem statement (preserve formulas in $...$ and sub-parts)",',
    '      "visual": null,',
    '      "parts": ["a) First sub-question...", "b) Second sub-question..."],',
    '      "options": [],',
    '      "code": "",',
    '      "table": null',
    '    }',
    '  ]',
    '}',
    visualCatalogText ? `\nAVAILABLE VISUAL SOURCES FOR CUTOUTS:\n${visualCatalogText}` : '',
    '',
    'EXAM CONTENT TO SPLIT:',
    sourcesText,
  ].filter(Boolean).join('\n');
}

export function cleanSplitExercises(raw, fallbackText = '', title = 'Solved Exam') {
  const rawList = Array.isArray(raw?.exercises) ? raw.exercises : [];
  const exercises = rawList
    .filter((ex) => ex && String(ex.statement || ex.prompt || '').trim())
    .map((ex, i) => ({
      number: String(ex.number || i + 1).trim(),
      title: String(ex.title || `Exercise ${i + 1}`).trim(),
      kind: VALID_KINDS.has(String(ex.kind || '').toLowerCase()) ? String(ex.kind).toLowerCase() : 'open',
      points: Number.isFinite(Number(ex.points)) && Number(ex.points) > 0 ? Number(ex.points) : null,
      statement: String(ex.statement || ex.prompt || '').trim(),
      visual: normalizeVisualSpec(ex.visual ?? ex.figure ?? null),
      parts: Array.isArray(ex.parts) ? ex.parts.map((p) => String(p || '').trim()).filter(Boolean) : [],
      options: Array.isArray(ex.options) ? ex.options.map((o) => String(o || '').trim()).filter(Boolean) : [],
      code: typeof ex.code === 'string' ? ex.code.trim() : '',
      table: ex.table && Array.isArray(ex.table.headers) && Array.isArray(ex.table.rows) ? ex.table : null,
    }));
  if (!exercises.length) {
    return {
      title,
      language: '',
      exercises: splitExamHeuristically(fallbackText, title),
    };
  }
  return {
    title: String(raw?.title || title).trim(),
    language: String(raw?.language || '').trim(),
    exercises,
  };
}

export function solveChunkPrompt({
  exercise,
  examTitle = '',
  referenceText = '',
  language = 'auto',
  instructions = '',
} = {}) {
  const langTarget = language && language !== 'auto'
    ? language
    : '';
  const langRule = langTarget
    ? `Write ALL headings ("Pasos" / "Steps", "Solución (Ejercicio N)" / "Solution (Exercise N)"), hints, and worked explanations strictly in ${langTarget}.`
    : 'Write ALL headings ("Steps"/"Pasos", "Solution (Exercise N)"/"Solución (Ejercicio N)"), hints, and worked explanations in the SAME language as the exercise.';
  const exForPrompt = exercise?.visual?.type === 'cutout' && exercise.visual.dataUrl
    ? { ...exercise, visual: { ...exercise.visual, dataUrl: '[attached image]' } }
    : exercise;
  return [
    `You are an expert Solver subagent solving ONE exercise from "${examTitle || 'Exam'}".`,
    langRule,
    'Use clear mathematical LaTeX (`$...$` inline, `$$...$$` display) for every formula, equation, vector, matrix, or derivation.',
    instructions?.trim() ? `Extra instructions: ${instructions.trim()}` : '',
    '',
    'Produce TWO clearly separated pieces for an alternating Study-then-Solution layout:',
    '1) `partSteps`: For the QUESTION page, break each sub-part a), b), c)... down into a short guiding step / approach hint (NO final answers revealed — leave room for the student to solve it).',
    '2) `partSolutions`: For the NEW PAGE right after it, provide the complete, rigorous worked solution for each sub-part a), b), c)... showing every intermediate formula, substitution, unit, completed table row, or code trace.',
    '3) Optional `solutionVisual` (or `partSolutions[i].visual`): whenever a visual solution helps (filled function `plot`, filled `histogram`, completed CPU scheduling `timeline`/Gantt chart, `tree`, `graph_nodes`), emit a structured visual spec!',
    '',
    VISUAL_PROMPT_GUIDE,
    '',
    'Reply with ONLY valid JSON matching this schema:',
    '{',
    `  "number": ${JSON.stringify(String(exercise?.number || '1'))},`,
    `  "title": ${JSON.stringify(String(exercise?.title || ''))},`,
    '  "exerciseHeading": "Exercise 1: Title (or localized: Ejercicio 1: Título)",',
    '  "stepsHeading": "Steps (or localized: Pasos / Étapes / Schritte)",',
    '  "solutionHeading": "Solution (Exercise 1) (or localized: Solución (Ejercicio 1))",',
    '  "statement": "Clean problem statement with $LaTeX$ formulas",',
    '  "visual": null,',
    '  "theory": "Concise key formula / theorem used (1-3 sentences)",',
    '  "partSteps": [',
    '    { "label": "a)", "hint": "Sub-part statement + brief method step hint (without giving away the final answer)" }',
    '  ],',
    '  "partSolutions": [',
    '    { "label": "a)", "answer": "Direct final answer / chosen option", "work": "Full step-by-step derivation with $...$ / $$...$$ math", "visual": null }',
    '  ],',
    '  "solvedTable": null,',
    '  "solutionVisual": null,',
    '  "trap": "Common mistake or exam trap to double-check"',
    '}',
    '',
    'EXERCISE TO SOLVE:',
    JSON.stringify(exForPrompt, null, 2),
    referenceText ? `\nREFERENCE NOTES:\n${referenceText}` : '',
  ].filter(Boolean).join('\n');
}

export function cleanSolvedExercise(raw, fallbackEx = {}, index = 0) {
  const num = String(raw?.number || fallbackEx.number || index + 1).trim();
  const title = String(raw?.title || fallbackEx.title || '').trim();
  const partSteps = Array.isArray(raw?.partSteps) && raw.partSteps.length
    ? raw.partSteps.map((s, idx) => ({
        label: String(s?.label || `${String.fromCharCode(97 + idx)})`).trim(),
        hint: String(s?.hint || s?.step || s || '').trim(),
      })).filter((s) => s.hint)
    : (fallbackEx.parts || []).map((p, idx) => ({
        label: `${String.fromCharCode(97 + idx)})`,
        hint: String(p).trim(),
      }));
  const partSolutions = Array.isArray(raw?.partSolutions) && raw.partSolutions.length
    ? raw.partSolutions.map((s, idx) => ({
        label: String(s?.label || partSteps[idx]?.label || `${String.fromCharCode(97 + idx)})`).trim(),
        answer: String(s?.answer || s?.final || '').trim(),
        work: String(s?.work || s?.steps || s?.explanation || '').trim(),
        visual: normalizeVisualSpec(s?.visual ?? s?.figure ?? null),
      })).filter((s) => s.answer || s.work || s.visual)
    : [{
        label: 'a)',
        answer: String(raw?.answer || raw?.summary || 'See solution below.').trim(),
        work: String(raw?.work || raw?.solution || raw?.steps || '').trim(),
        visual: null,
      }];

  const fallbackVisual = normalizeVisualSpec(fallbackEx.visual ?? fallbackEx.figure ?? null);
  const rawVisual = normalizeVisualSpec(raw?.visual ?? raw?.figure ?? null);
  // Preserve resolved cutout dataUrl from fallbackEx if the LLM echoed cutout without dataUrl
  const visual = fallbackVisual?.type === 'cutout' && fallbackVisual.dataUrl && (!rawVisual || (rawVisual.type === 'cutout' && !rawVisual.dataUrl))
    ? fallbackVisual
    : (rawVisual || fallbackVisual);

  return {
    number: num,
    title,
    kind: fallbackEx.kind || 'open',
    points: fallbackEx.points ?? null,
    exerciseHeading: String(raw?.exerciseHeading || `Exercise ${num}${title ? `: ${title}` : ''}`).trim(),
    stepsHeading: String(raw?.stepsHeading || 'Steps').trim(),
    solutionHeading: String(raw?.solutionHeading || `Solution (Exercise ${num})`).trim(),
    statement: String(raw?.statement || fallbackEx.statement || '').trim(),
    visual,
    options: Array.isArray(fallbackEx.options) ? fallbackEx.options : [],
    code: fallbackEx.code || '',
    table: fallbackEx.table || null,
    solvedTable: raw?.solvedTable && Array.isArray(raw.solvedTable.headers) ? raw.solvedTable : null,
    solutionVisual: normalizeVisualSpec(raw?.solutionVisual ?? raw?.solutionFigure ?? null),
    theory: String(raw?.theory || '').trim(),
    partSteps,
    partSolutions,
    trap: String(raw?.trap || '').trim(),
  };
}

// Deterministic Stage-3 Composer (A4 PDF): Exercise N (Steps a, b, c) -> NEW PAGE -> Solution (Exercise N) (a, b, c) -> NEW PAGE ...
export function buildSolvedExamHtml(solvedExam, { showTheory = true, tapeSolutions = false, interactiveFallback = false } = {}) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const exercises = Array.isArray(solvedExam?.exercises) ? solvedExam.exercises : [];
  if (!exercises.length) throw Error('No solved exercises to compose.');
  const blocks = [];

  blocks.push(
    `<header class="exam-hdr">`
      + `<h1>${escapeHtml(solvedExam.title || 'Solved Examination')}</h1>`
      + `<div class="exam-meta">`
      + `<span>Exercise-by-exercise workspace followed by worked step-by-step solutions</span>`
      + `<span>${exercises.length} exercise${exercises.length === 1 ? '' : 's'}</span>`
      + `</div>`
      + `</header>`,
  );

  exercises.forEach((ex, idx) => {
    // 1. Exercise Question + Steps page
    const qParts = [];
    qParts.push(`<article class="prob-card solve-card-free">`);
    qParts.push(
      `<div class="sec-hdr" style="margin-top:0"><h2>`
        + `<span class="badge exam">EXERCISE ${escapeHtml(ex.number)}</span> `
        + `${renderRichExamHtml(ex.exerciseHeading)}`
        + (ex.points != null ? `<span class="prob-pts" style="color:#e2e8f0;margin-left:auto">${escapeHtml(ex.points)} pts</span>` : '')
        + `</h2></div>`,
    );
    qParts.push(`<p class="prob-prompt">${renderRichExamHtml(ex.statement)}</p>`);
    if (ex.visual) {
      const qVisHtml = renderVisualHtml(ex.visual);
      if (qVisHtml) qParts.push(qVisHtml);
    }
    if (ex.code) qParts.push(`<pre class="exam-code"><code>${escapeHtml(ex.code)}</code></pre>`);
    if (ex.options?.length) {
      qParts.push(
        `<div class="mc-grid">`
          + ex.options.map((opt, oi) => `<div class="mc-opt"><strong>${letters[oi] || oi + 1})</strong> ${renderRichExamHtml(opt)}</div>`).join('')
          + `</div>`,
      );
    }
    if (ex.table?.headers?.length) {
      const ths = ex.table.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
      const rows = (ex.table.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
      qParts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (ex.partSteps?.length) {
      qParts.push(`<div class="solve-steps-box"><strong class="lbl">${escapeHtml(ex.stepsHeading)}:</strong>`);
      for (const st of ex.partSteps) {
        qParts.push(
          `<div class="solve-step-item">`
            + `<div><strong>${escapeHtml(st.label)}</strong> ${renderRichExamHtml(st.hint)}</div>`
            + `<div class="solve-step-work"></div><div class="solve-step-work"></div>`
            + `</div>`,
        );
      }
      qParts.push(`</div>`);
    } else {
      qParts.push(`<div class="writing-lines">${'<div class="wline"></div>'.repeat(8)}</div>`);
    }
    qParts.push(`</article>`);
    blocks.push(qParts.join('\n'));

    // 2. NEW PAGE -> Worked Solution (Exercise N)
    blocks.push(`<div class="page-break"></div>`);

    const sParts = [];
    sParts.push(`<article class="prob-card solve-card-free">`);
    sParts.push(
      `<div class="solve-sol-banner">`
        + `<span class="badge prj">SOLUTION</span> `
        + `<span>${renderRichExamHtml(ex.solutionHeading)}:</span>`
        + `</div>`,
    );
    if (showTheory && ex.theory) {
      const tapeAttr = tapeSolutions ? ' data-tape-answer="theory"' : '';
      sParts.push(`<div class="theory-box"${tapeAttr}><strong class="lbl">Formula / Key Concept</strong>${renderRichExamHtml(ex.theory)}</div>`);
    }
    const solTapeAttr = tapeSolutions ? ' data-tape-answer="solution"' : '';
    sParts.push(`<div class="key"${solTapeAttr}>`);
    for (const sol of ex.partSolutions || []) {
      const partVisHtml = sol.visual ? renderVisualHtml(sol.visual) : '';
      sParts.push(
        `<div class="solve-part-ans">`
          + `<div><strong>${escapeHtml(sol.label)}</strong> `
          + (sol.answer ? `<span class="ans-final">${renderRichExamHtml(sol.answer)}</span>` : '')
          + `</div>`
          + (sol.work ? `<div class="ans-work">${renderRichExamHtml(sol.work)}</div>` : '')
          + partVisHtml
          + `</div>`,
      );
    }
    if (ex.solutionVisual) {
      const solVisHtml = renderVisualHtml(ex.solutionVisual);
      if (solVisHtml) sParts.push(solVisHtml);
    }
    if (ex.solvedTable?.headers?.length) {
      const ths = ex.solvedTable.headers.map((h) => `<th>${renderRichExamHtml(h)}</th>`).join('');
      const rows = (ex.solvedTable.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : []).map((c) => `<td>${renderRichExamHtml(c)}</td>`).join('')}</tr>`).join('');
      sParts.push(`<table class="exam-tbl"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (ex.trap) {
      sParts.push(`<div class="bad"><strong>Watch out:</strong> ${renderRichExamHtml(ex.trap)}</div>`);
    }
    sParts.push(`</div></article>`);
    blocks.push(sParts.join('\n'));

    if (idx < exercises.length - 1) {
      blocks.push(`<div class="page-break"></div>`);
    }
  });

  return wrapExamHtmlDocument(solvedExam.title || 'Solved Exam', blocks, { interactiveFallback: interactiveFallback && tapeSolutions });
}

// Deterministic Stage-3 Composer (MCP Ink Engine): emits NoteComplete dialect Markdown with \pagebreak, !tape, !draw, and $...$/$$...$$ native math boxes.
export function buildSolvedExamMcpMarkdown(solvedExam, { tapeSolutions = false, showTheory = true } = {}) {
  const exercises = Array.isArray(solvedExam?.exercises) ? solvedExam.exercises : [];
  if (!exercises.length) throw Error('No solved exercises to compose.');
  const out = [`# ${solvedExam.title || 'Solved Exam'}`, ''];

  exercises.forEach((ex, idx) => {
    if (idx > 0) out.push('\\pagebreak', '');
    out.push(`## ${ex.exerciseHeading}`, '');
    out.push(ex.statement, '');
    if (ex.visual) {
      const drawMd = renderVisualMcpMarkdown(ex.visual);
      if (drawMd) out.push(drawMd, '');
    }
    if (ex.code) {
      out.push('```', ex.code, '```', '');
    }
    if (ex.options?.length) {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      ex.options.forEach((opt, oi) => out.push(`- **${letters[oi] || oi + 1})** ${opt}`));
      out.push('');
    }
    if (ex.partSteps?.length) {
      out.push(`### ${ex.stepsHeading}:`, '');
      for (const st of ex.partSteps) {
        out.push(`- **${st.label}** ${st.hint}`, '', '');
      }
    }
    out.push('\\pagebreak', '');
    out.push(`## ${ex.solutionHeading}:`, '');
    if (showTheory && ex.theory) {
      if (tapeSolutions) out.push('!tape sky');
      out.push(`=={sky}${ex.theory}==`, '');
    }
    for (const sol of ex.partSolutions || []) {
      if (tapeSolutions) out.push('!tape yellow');
      const line = sol.answer ? `**${sol.label}** ${sol.answer}` : `**${sol.label}**`;
      out.push(line, '');
      if (sol.work) {
        if (tapeSolutions) out.push('!tape yellow');
        out.push(sol.work, '');
      }
      if (sol.visual) {
        const pDraw = renderVisualMcpMarkdown(sol.visual);
        if (pDraw) out.push(pDraw, '');
      }
    }
    if (ex.solutionVisual) {
      const sDraw = renderVisualMcpMarkdown(ex.solutionVisual);
      if (sDraw) out.push(sDraw, '');
    }
    if (ex.trap) {
      out.push(`> **Watch out:** ${ex.trap}`, '');
    }
  });

  return out.join('\n').trim();
}
