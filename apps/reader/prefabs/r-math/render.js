// R Math & Statistics prefab renderer (docs/R-PREFABS-PLAN.md):
// Pure, offline-safe, zero-DOM renderer. Never executes R!
// Renders cached vector SVGs through strict sanitization (resolving Cairo <use href="#glyph">
// references inline into safe <g><path/></g> elements), or draws a crisp vector preview card
// when the figure has not been rendered in R yet.
import { escapeHtml } from '../kit/svg.js';

export const PRESET_LABELS = {
  normal: 'Normal distribution',
  t: 'Student t distribution',
  chisq: 'Chi-squared distribution',
  binomial: 'Binomial PMF',
  histogram: 'Histogram + Density',
  boxplot: 'Boxplot comparison',
  scatter: 'Scatterplot + Fit',
  custom: 'Custom R plot',
};

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

const safeColor = (c, fallback = '#245dc4') => (/^#[0-9a-fA-F]{6}$/.test(String(c || '').trim()) ? String(c).trim() : fallback);

function parseNumList(raw, fallback) {
  const nums = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => Number(s))
    .filter(Number.isFinite);
  return nums.length ? nums : fallback;
}

const rStr = (s) => JSON.stringify(String(s ?? ''));

export function normalize(raw = {}) {
  const preset = PRESET_LABELS[raw.preset] ? raw.preset : 'normal';
  const width = Math.round(clamp(raw.width, 200, 1200, 480));
  const height = Math.round(clamp(raw.height, 140, 900, 300));
  const params = raw.params && typeof raw.params === 'object' ? { ...raw.params } : {};
  const cache = raw.cache && typeof raw.cache === 'object' && typeof raw.cache.svg === 'string'
    ? {
        svg: raw.cache.svg,
        stdout: String(raw.cache.stdout ?? ''),
        generatedAt: String(raw.cache.generatedAt ?? ''),
        rVersion: String(raw.cache.rVersion ?? ''),
      }
    : null;
  return {
    type: 'r_figure',
    schemaVersion: 1,
    preset,
    title: String(raw.title ?? '').slice(0, 120),
    params,
    rCode: typeof raw.rCode === 'string' ? raw.rCode.slice(0, 20000) : '',
    width,
    height,
    ...(cache ? { cache } : {}),
  };
}

/** Generates clean, reproducible base-R plotting code for the selected preset. */
export function buildPresetRCode(rawSpec) {
  const s = normalize(rawSpec);
  if (s.preset === 'custom') return s.rCode || 'plot(1:10, main = "Custom R Plot")';
  const p = s.params;
  const col = safeColor(p.color, '#245dc4');
  const title = s.title || PRESET_LABELS[s.preset];
  const basePar = 'par(mar = c(4.1, 4.2, 2.8, 1.2), family = "sans", bg = "#ffffff")';

  if (s.preset === 'normal') {
    const mean = clamp(p.mean, -1e6, 1e6, 0);
    const sd = clamp(p.sd, 1e-6, 1e6, 1);
    const lo = mean - 4 * sd, hi = mean + 4 * sd;
    const from = clamp(p.from, lo, hi, mean - 1.96 * sd);
    const to = clamp(p.to, lo, hi, mean + 1.96 * sd);
    const region = ['between', 'lower', 'upper', 'none'].includes(p.region) ? p.region : 'between';
    const shadeCode = region === 'none'
      ? ''
      : region === 'lower'
        ? `sx <- seq(${lo}, ${to}, length.out = 200); polygon(c(${lo}, sx, ${to}), c(0, dnorm(sx, ${mean}, ${sd}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA)\nprob <- pnorm(${to}, ${mean}, ${sd})`
        : region === 'upper'
          ? `sx <- seq(${from}, ${hi}, length.out = 200); polygon(c(${from}, sx, ${hi}), c(0, dnorm(sx, ${mean}, ${sd}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA)\nprob <- pnorm(${from}, ${mean}, ${sd}, lower.tail = FALSE)`
          : `a <- min(${from}, ${to}); b <- max(${from}, ${to}); sx <- seq(a, b, length.out = 200); polygon(c(a, sx, b), c(0, dnorm(sx, ${mean}, ${sd}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA)\nprob <- pnorm(b, ${mean}, ${sd}) - pnorm(a, ${mean}, ${sd})`;
    return [
      basePar,
      `x <- seq(${lo}, ${hi}, length.out = 400)`,
      `y <- dnorm(x, mean = ${mean}, sd = ${sd})`,
      `plot(x, y, type = "l", lwd = 2.2, col = ${rStr(col)}, main = ${rStr(title)}, xlab = "x", ylab = "Density", bty = "l")`,
      'grid(col = "#e5e7eb", lty = 1)',
      shadeCode,
      `lines(x, y, lwd = 2.2, col = ${rStr(col)})`,
      region !== 'none' ? `legend("topright", legend = sprintf("P = %.4f", prob), bty = "n", text.col = ${rStr(col)})` : '',
      region !== 'none' ? 'cat(sprintf("Shaded probability: %.6f\\n", prob))' : '',
    ].filter(Boolean).join('\n');
  }

  if (s.preset === 't') {
    const df = clamp(p.df, 1, 1e5, 12);
    const from = clamp(p.from, -10, 10, 2.179);
    const to = clamp(p.to, -10, 10, 5);
    const region = ['between', 'lower', 'upper', 'none'].includes(p.region) ? p.region : 'upper';
    const shade = region === 'lower'
      ? `sx <- seq(-5, ${to}, length.out = 200); polygon(c(-5, sx, ${to}), c(0, dt(sx, ${df}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA); prob <- pt(${to}, ${df})`
      : region === 'upper'
        ? `sx <- seq(${from}, 5, length.out = 200); polygon(c(${from}, sx, 5), c(0, dt(sx, ${df}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA); prob <- pt(${from}, ${df}, lower.tail = FALSE)`
        : region === 'between'
          ? `a <- min(${from}, ${to}); b <- max(${from}, ${to}); sx <- seq(a, b, length.out = 200); polygon(c(a, sx, b), c(0, dt(sx, ${df}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA); prob <- pt(b, ${df}) - pt(a, ${df})`
          : '';
    return [
      basePar,
      `x <- seq(-5, 5, length.out = 400)`,
      `y <- dt(x, df = ${df})`,
      `plot(x, y, type = "l", lwd = 2.2, col = ${rStr(col)}, main = ${rStr(title)}, xlab = "t", ylab = "Density", bty = "l")`,
      'grid(col = "#e5e7eb", lty = 1)',
      shade,
      `lines(x, y, lwd = 2.2, col = ${rStr(col)})`,
      shade ? `legend("topright", legend = sprintf("P = %.4f", prob), bty = "n", text.col = ${rStr(col)})` : '',
    ].filter(Boolean).join('\n');
  }

  if (s.preset === 'chisq') {
    const df = clamp(p.df, 1, 500, 5);
    const hi = Math.max(12, Math.ceil(df + 5 * Math.sqrt(2 * df)));
    const from = clamp(p.from, 0, hi, 11.07);
    const region = ['upper', 'lower', 'none'].includes(p.region) ? p.region : 'upper';
    const shade = region === 'upper'
      ? `sx <- seq(${from}, ${hi}, length.out = 200); polygon(c(${from}, sx, ${hi}), c(0, dchisq(sx, ${df}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA); prob <- pchisq(${from}, ${df}, lower.tail = FALSE)`
      : region === 'lower'
        ? `sx <- seq(0, ${from}, length.out = 200); polygon(c(0, sx, ${from}), c(0, dchisq(sx, ${df}), 0), col = adjustcolor(${rStr(col)}, alpha.f = 0.22), border = NA); prob <- pchisq(${from}, ${df})`
        : '';
    return [
      basePar,
      `x <- seq(0.01, ${hi}, length.out = 400)`,
      `y <- dchisq(x, df = ${df})`,
      `plot(x, y, type = "l", lwd = 2.2, col = ${rStr(col)}, main = ${rStr(title)}, xlab = expression(chi^2), ylab = "Density", bty = "l")`,
      'grid(col = "#e5e7eb", lty = 1)',
      shade,
      `lines(x, y, lwd = 2.2, col = ${rStr(col)})`,
      shade ? `legend("topright", legend = sprintf("P = %.4f", prob), bty = "n", text.col = ${rStr(col)})` : '',
    ].filter(Boolean).join('\n');
  }

  if (s.preset === 'binomial') {
    const size = Math.round(clamp(p.size, 1, 200, 15));
    const prob = clamp(p.prob, 0, 1, 0.4);
    return [
      basePar,
      `k <- 0:${size}`,
      `pmf <- dbinom(k, size = ${size}, prob = ${prob})`,
      `barplot(pmf, names.arg = k, col = adjustcolor(${rStr(col)}, alpha.f = 0.78), border = ${rStr(col)}, main = ${rStr(title)}, xlab = "k (Successes)", ylab = "P(X = k)")`,
      'grid(nx = NA, ny = NULL, col = "#e5e7eb", lty = 1)',
      `cat(sprintf("Mean = %.4f, SD = %.4f\\n", ${size} * ${prob}, sqrt(${size} * ${prob} * (1 - ${prob}))))`,
    ].join('\n');
  }

  if (s.preset === 'histogram') {
    const vals = parseNumList(p.values, [12, 15, 14, 18, 19, 21, 17, 16, 22, 24]);
    const bins = Math.round(clamp(p.bins, 2, 60, 7));
    const density = p.density !== false;
    return [
      basePar,
      `v <- c(${vals.join(', ')})`,
      `hist(v, breaks = ${bins}, probability = ${density ? 'TRUE' : 'FALSE'}, col = adjustcolor(${rStr(col)}, alpha.f = 0.28), border = ${rStr(col)}, main = ${rStr(title)}, xlab = ${rStr(p.xlab || 'Value')})`,
      density ? `lines(density(v), lwd = 2.2, col = ${rStr(col)})` : '',
      'cat(sprintf("n = %d, mean = %.4f, sd = %.4f, median = %.4f\\n", length(v), mean(v), sd(v), median(v)))',
    ].filter(Boolean).join('\n');
  }

  if (s.preset === 'boxplot') {
    const a = parseNumList(p.groupA, [14, 16, 15, 19, 18, 17, 21]);
    const b = parseNumList(p.groupB, [19, 22, 24, 21, 25, 23, 27]);
    const la = String(p.labelA || 'Group A');
    const lb = String(p.labelB || 'Group B');
    return [
      basePar,
      `a <- c(${a.join(', ')})`,
      `b <- c(${b.join(', ')})`,
      `boxplot(list(${rStr(la)} = a, ${rStr(lb)} = b), col = c(adjustcolor(${rStr(col)}, alpha.f = 0.35), adjustcolor("#1d7a4a", alpha.f = 0.35)), border = c(${rStr(col)}, "#1d7a4a"), main = ${rStr(title)}, ylab = ${rStr(p.ylab || 'Value')})`,
      'grid(nx = NA, ny = NULL, col = "#e5e7eb", lty = 1)',
      'print(t.test(a, b))',
    ].join('\n');
  }

  // scatter
  const xs = parseNumList(p.x, [1, 2, 3, 4, 5, 6, 7, 8]);
  const ys = parseNumList(p.y, [2.1, 3.8, 6.2, 7.9, 10.4, 11.7, 14.2, 15.8]);
  const n = Math.min(xs.length, ys.length);
  const fit = p.fit !== false;
  return [
    basePar,
    `x <- c(${xs.slice(0, n).join(', ')})`,
    `y <- c(${ys.slice(0, n).join(', ')})`,
    `plot(x, y, pch = 19, col = ${rStr(col)}, main = ${rStr(title)}, xlab = ${rStr(p.xlab || 'x')}, ylab = ${rStr(p.ylab || 'y')}, bty = "l")`,
    'grid(col = "#e5e7eb", lty = 1)',
    fit ? 'm <- lm(y ~ x)\nabline(m, col = "#b83228", lwd = 2)\ns <- summary(m)\nlegend("topleft", legend = sprintf("y = %.3f + %.3fx  (R² = %.3f)", coef(m)[1], coef(m)[2], s$r.squared), bty = "n", text.col = "#b83228")\ncat(sprintf("Intercept = %.4f, Slope = %.4f, R^2 = %.4f\\n", coef(m)[1], coef(m)[2], s$r.squared))' : '',
  ].filter(Boolean).join('\n');
}

const SAFE_TAGS = new Set([
  'svg', 'g', 'defs', 'clippath', 'line', 'rect', 'circle', 'ellipse',
  'path', 'polygon', 'polyline', 'text', 'tspan', 'marker',
]);
const DROP_CONTENT_TAGS = ['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image'];
const ATTR_CASE = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  clippathunits: 'clipPathUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  refx: 'refX',
  refy: 'refY',
  markerunits: 'markerUnits',
};
const SAFE_ATTRS = new Set([
  'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height', 'id', 'class',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy',
  'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'clip-path', 'clippathunits', 'style',
]);
const SAFE_STYLE_PROPS = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity',
  'font-size', 'font-weight', 'font-style', 'font-family', 'text-anchor', 'dominant-baseline',
]);

function sanitizeStyle(raw) {
  return String(raw || '')
    .split(';')
    .map((decl) => {
      const i = decl.indexOf(':');
      if (i === -1) return '';
      const prop = decl.slice(0, i).trim().toLowerCase();
      const val = decl.slice(i + 1).trim();
      if (!SAFE_STYLE_PROPS.has(prop) || !val || /url\(|expression\(|javascript:|vbscript:|data:/i.test(val)) return '';
      return `${prop}:${val}`;
    })
    .filter(Boolean)
    .join(';');
}

/**
 * Strictly sanitizes R-generated SVG (`grDevices::svg` or `svglite`):
 * - Inlines local Cairo `<use xlink:href="#glyph-...">` into `<g transform="translate(x y)"><path .../></g>`
 *   so zero `<use>` elements remain and fonts render identically on every browser & PDF export.
 * - Preserves local `<clipPath id="...">` and `clip-path="url(#...)"` fragments only.
 * - Strips scripts, event handlers, foreignObject, images, style blocks, and external URLs.
 */
export function sanitizeRPlotSvg(rawSvg) {
  const src = String(rawSvg ?? '').trim();
  if (!src) return '';
  const match = src.match(/<svg\b[\s\S]*?<\/svg>|<svg\b[^>]*\/>/i);
  if (!match) return '';
  let body = match[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

  for (const tag of DROP_CONTENT_TAGS) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    body = body.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }

  // Extract local glyph definitions (<g id="glyph-...">...</g>) emitted by Cairo grDevices::svg.
  const glyphs = new Map();
  body = body.replace(/<g\s+id="(glyph-[A-Za-z0-9_-]+)"[^>]*>([\s\S]*?)<\/g>/gi, (_, id, inner) => {
    glyphs.set(id, inner.trim());
    return '';
  });

  // Inline local <use xlink:href="#glyph-..." x="..." y="..."/> references safely.
  if (glyphs.size) {
    body = body.replace(/<use\b([^>]*?)\/?>(?:\s*<\/use>)?/gi, (_, attrStr) => {
      const href = /(?:xlink:)?href\s*=\s*["']#(glyph-[A-Za-z0-9_-]+)["']/i.exec(attrStr)?.[1];
      if (!href || !glyphs.has(href)) return '';
      const x = Number(/\bx\s*=\s*["']([^"']+)["']/i.exec(attrStr)?.[1] || 0);
      const y = Number(/\by\s*=\s*["']([^"']+)["']/i.exec(attrStr)?.[1] || 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
      return `<g transform="translate(${x} ${y})">${glyphs.get(href)}</g>`;
    });
  }

  const out = [];
  const stack = [];
  let cursor = 0;
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9:_-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body)) !== null) {
    if (m.index > cursor) {
      const txt = body.slice(cursor, m.index).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (txt) out.push(escapeHtml(txt));
    }
    cursor = m.index + m[0].length;
    const isClose = m[1] === '/';
    const rawName = m[2].includes(':') ? m[2].split(':').pop() : m[2];
    const tag = rawName.toLowerCase();
    const attrText = m[3] || '';
    const selfClose = m[4] === '/';
    if (!SAFE_TAGS.has(tag)) continue;
    const canonTag = tag === 'clippath' ? 'clipPath' : tag;
    if (isClose) {
      while (stack.length) {
        const top = stack.pop();
        out.push(`</${top}>`);
        if (top === canonTag) break;
      }
      continue;
    }
    const attrs = new Map();
    const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const lowerKey = am[1].toLowerCase();
      if (lowerKey.startsWith('on') || !SAFE_ATTRS.has(lowerKey)) continue;
      const val = am[2] ?? am[3] ?? am[4] ?? '';
      if (/javascript:|vbscript:|data:|expression\s*\(/i.test(val)) continue;
      if (/url\(/i.test(val)) {
        if (lowerKey !== 'clip-path' || !/^url\(\s*#[A-Za-z_][A-Za-z0-9_.:-]*\s*\)$/.test(val.trim())) continue;
      }
      const cleanVal = lowerKey === 'style' ? sanitizeStyle(val) : val;
      if (lowerKey === 'style' && !cleanVal) continue;
      attrs.set(ATTR_CASE[lowerKey] || lowerKey, cleanVal);
    }
    if (canonTag === 'svg') {
      attrs.set('xmlns', 'http://www.w3.org/2000/svg');
      if (!attrs.has('viewBox')) attrs.set('viewBox', '0 0 480 300');
    }
    const attrStr = [...attrs.entries()].map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
    out.push(`<${canonTag}${attrStr}${selfClose ? '/>' : '>'}`);
    if (!selfClose) stack.push(canonTag);
  }
  if (cursor < body.length) out.push(escapeHtml(body.slice(cursor)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  const finalSvg = out.join('');
  return finalSvg.startsWith('<svg') ? finalSvg : '';
}

function placeholderCard(s) {
  const w = s.width, h = s.height;
  const title = s.title || PRESET_LABELS[s.preset] || 'R Figure';
  // Decorative miniature curve preview matching NoteComplete's accent blue palette.
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = -3 + (6 * i) / 40;
    const px = 48 + ((w - 96) * i) / 40;
    const py = h - 62 - Math.exp(-0.5 * t * t) * (h - 140);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  const shadePts = `48,${h - 62} ${pts.slice(10, 31).join(' ')} ${(48 + ((w - 96) * 30) / 40).toFixed(1)},${h - 62}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="#ffffff" stroke="#dce0e5" stroke-width="1.5"/>
    <rect x="14" y="12" width="44" height="20" rx="5" fill="#eaf0fc"/>
    <text x="36" y="26" text-anchor="middle" font-size="11" font-weight="700" fill="#245dc4">R</text>
    <text x="68" y="27" font-size="14" font-weight="600" fill="#242830">${escapeHtml(title)}</text>
    <line x1="44" y1="${h - 62}" x2="${w - 44}" y2="${h - 62}" stroke="#94a3b8" stroke-width="1.2"/>
    <polygon points="${shadePts}" fill="#245dc4" fill-opacity="0.18"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#245dc4" stroke-width="2.2"/>
    <text x="${w / 2}" y="${h - 24}" text-anchor="middle" font-size="12" fill="#626b76">Click Run in R inside the editor to generate the live vector plot</text>
  </svg>`;
  return { svg, width: w, height: h };
}

export function render(raw) {
  const s = normalize(raw);
  if (s.cache?.svg) {
    const clean = sanitizeRPlotSvg(s.cache.svg);
    if (clean) return { svg: clean, width: s.width, height: s.height };
  }
  return placeholderCard(s);
}

export const name = (spec) => (spec?.title ? `R: ${spec.title}` : PRESET_LABELS[spec?.preset] || 'R figure');
