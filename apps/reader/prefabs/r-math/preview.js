// A small vector preview of each R preset, drawn here in JavaScript from the figure's own
// parameters, for the card shown until the figure is run in R (render.js placeholderCard) and
// in the prefab menu: the normal, t and chi-squared curves with their shaded region, the
// binomial bars, the histogram with its density line, the two boxplots and the scatter with
// its fitted line. It follows buildPresetRCode's defaults, so it looks like what R will draw.
// Pure: returns SVG markup for the box [x0, y0, x1, y1], no DOM.
import { escapeHtml } from '../kit/svg.js';

const clamp = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const nums = (raw, fallback) => {
  const list = String(raw ?? '').split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  return list.length ? list : fallback;
};
const f = (n) => (Math.round(n * 10) / 10).toString();

// log Γ(x) (Lanczos), for the t and chi-squared densities and the binomial coefficients.
function lgamma(x) {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
export const dnorm = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
export const dt = (x, df) => Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (x * x) / df));
export const dchisq = (x, df) => (x <= 0 ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - lgamma(df / 2)));
export const dbinom = (k, n, p) => {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
};
// R's default quantile (type 7).
export function quantile(sorted, q) {
  const h = (sorted.length - 1) * q, lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)]) - sorted[lo]);
}

// A density curve over [lo, hi] scaled into the box, with the region [a, b] shaded.
function curve(box, density, lo, hi, shade, col) {
  const [x0, y0, x1, y1] = box, n = 80;
  const xs = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  const ys = xs.map(density).map((y) => (Number.isFinite(y) ? y : 0));
  const top = Math.max(...ys) || 1;
  const X = (x) => x0 + ((x - lo) / (hi - lo)) * (x1 - x0), Y = (y) => y1 - (Math.min(y, top * 1.05) / (top * 1.08)) * (y1 - y0);
  const line = xs.map((x, i) => `${f(X(x))},${f(Y(ys[i]))}`).join(' ');
  let area = '';
  if (shade) {
    const a = Math.max(lo, Math.min(shade[0], shade[1])), b = Math.min(hi, Math.max(shade[0], shade[1]));
    if (b > a) {
      const sx = Array.from({ length: 41 }, (_, i) => a + ((b - a) * i) / 40);
      area = `<polygon points="${f(X(a))},${f(y1)} ${sx.map((x) => `${f(X(x))},${f(Y(density(x)))}`).join(' ')} ${f(X(b))},${f(y1)}" fill="${col}" fill-opacity="0.22"/>`;
    }
  }
  return `${area}<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>`;
}
// Vertical bars of `heights` across the box, as barplot and hist draw them.
function bars(box, heights, col, { gap = 0.18, fill = 0.78 } = {}) {
  const [x0, y0, x1, y1] = box, top = Math.max(...heights) || 1, w = (x1 - x0) / heights.length;
  return heights.map((h, i) => {
    const bh = (h / (top * 1.08)) * (y1 - y0);
    return `<rect x="${f(x0 + i * w + (w * gap) / 2)}" y="${f(y1 - bh)}" width="${f(w * (1 - gap))}" height="${f(bh)}" fill="${col}" fill-opacity="${fill}" stroke="${col}" stroke-width="0.8"/>`;
  }).join('');
}
function boxplot(box, values, cx, half, col) {
  const [, y0, , y1] = box;
  return (lo, hi) => {
    const s = [...values].sort((a, b) => a - b);
    const [q1, med, q3] = [0.25, 0.5, 0.75].map((q) => quantile(s, q));
    const iqr = q3 - q1, inside = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
    const Y = (v) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
    const wl = Math.min(...inside), wh = Math.max(...inside);
    const outliers = s.filter((v) => v < wl || v > wh).map((v) => `<circle cx="${f(cx)}" cy="${f(Y(v))}" r="2.2" fill="none" stroke="${col}"/>`).join('');
    return `<line x1="${f(cx)}" y1="${f(Y(wl))}" x2="${f(cx)}" y2="${f(Y(q1))}" stroke="${col}" stroke-dasharray="3 2"/><line x1="${f(cx)}" y1="${f(Y(q3))}" x2="${f(cx)}" y2="${f(Y(wh))}" stroke="${col}" stroke-dasharray="3 2"/>`
      + `<line x1="${f(cx - half / 2)}" y1="${f(Y(wl))}" x2="${f(cx + half / 2)}" y2="${f(Y(wl))}" stroke="${col}"/><line x1="${f(cx - half / 2)}" y1="${f(Y(wh))}" x2="${f(cx + half / 2)}" y2="${f(Y(wh))}" stroke="${col}"/>`
      + `<rect x="${f(cx - half)}" y="${f(Y(q3))}" width="${f(2 * half)}" height="${f(Math.max(1, Y(q1) - Y(q3)))}" fill="${col}" fill-opacity="0.35" stroke="${col}" stroke-width="1.2"/>`
      + `<line x1="${f(cx - half)}" y1="${f(Y(med))}" x2="${f(cx + half)}" y2="${f(Y(med))}" stroke="${col}" stroke-width="2.4"/>${outliers}`;
  };
}

// SVG for preset `s` (normalized) inside `box`, in colour `col`. Axes included.
export function presetPreview(s, box, col = '#245dc4') {
  const p = s.params || {};
  const [x0, y0, x1, y1] = box;
  const axes = `<line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="#94a3b8" stroke-width="1.2"/><line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="#94a3b8" stroke-width="1.2"/>`;
  const label = (text, x, y, anchor = 'middle') => `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-size="10" fill="#626b76">${escapeHtml(text)}</text>`;
  if (s.preset === 'normal') {
    const mean = clamp(p.mean, -1e6, 1e6, 0), sd = clamp(p.sd, 1e-6, 1e6, 1), lo = mean - 4 * sd, hi = mean + 4 * sd;
    const from = clamp(p.from, lo, hi, mean - 1.96 * sd), to = clamp(p.to, lo, hi, mean + 1.96 * sd);
    const region = ['between', 'lower', 'upper', 'none'].includes(p.region) ? p.region : 'between';
    const shade = region === 'none' ? null : region === 'lower' ? [lo, to] : region === 'upper' ? [from, hi] : [from, to];
    return axes + curve(box, (x) => dnorm(x, mean, sd), lo, hi, shade, col) + label(`N(${mean}, ${sd})`, x1, y0 + 10, 'end');
  }
  if (s.preset === 't') {
    const df = clamp(p.df, 1, 1e5, 12), from = clamp(p.from, -10, 10, 2.179), to = clamp(p.to, -10, 10, 5);
    const region = ['between', 'lower', 'upper', 'none'].includes(p.region) ? p.region : 'upper';
    const shade = region === 'none' ? null : region === 'lower' ? [-5, to] : region === 'upper' ? [from, 5] : [from, to];
    return axes + curve(box, (x) => dt(x, df), -5, 5, shade, col) + label(`t, df = ${df}`, x1, y0 + 10, 'end');
  }
  if (s.preset === 'chisq') {
    const df = clamp(p.df, 1, 500, 5), hi = Math.max(12, Math.ceil(df + 5 * Math.sqrt(2 * df))), from = clamp(p.from, 0, hi, 11.07);
    const region = ['upper', 'lower', 'none'].includes(p.region) ? p.region : 'upper';
    const shade = region === 'none' ? null : region === 'lower' ? [0, from] : [from, hi];
    // df 1 and 2 start at infinity / their maximum at 0: from a little after it.
    return axes + curve(box, (x) => dchisq(x, df), df <= 2 ? hi / 200 : 0, hi, shade, col) + label(`χ², df = ${df}`, x1, y0 + 10, 'end');
  }
  if (s.preset === 'binomial') {
    const n = Math.round(clamp(p.size, 1, 200, 15)), prob = clamp(p.prob, 0, 1, 0.4);
    return axes + bars(box, Array.from({ length: n + 1 }, (_, k) => dbinom(k, n, prob)), col) + label(`B(${n}, ${prob})`, x1, y0 + 10, 'end');
  }
  if (s.preset === 'histogram') {
    const vals = nums(p.values, [12, 15, 14, 18, 19, 21, 17, 16, 22, 24]), bins = Math.round(clamp(p.bins, 2, 60, 7));
    const lo = Math.min(...vals), hi = Math.max(...vals), width = (hi - lo || 1) / bins;
    const counts = Array(bins).fill(0);
    for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
    let svg = axes + bars(box, counts, col, { gap: 0, fill: 0.28 });
    if (p.density !== false && vals.length > 1) {
      // A Gaussian kernel density with R's default bandwidth (bw.nrd0), over the bars.
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
      const sorted = [...vals].sort((a, b) => a - b), iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
      const bw = 0.9 * Math.min(sd, iqr / 1.34 || sd) * vals.length ** -0.2 || 1;
      const kde = (x) => vals.reduce((a, v) => a + dnorm(x, v, bw), 0) / vals.length;
      // Density and bars share the vertical scale (probability = TRUE): counts / (n · width).
      const top = Math.max(...counts) / (vals.length * width);
      const X = (x) => x0 + ((x - lo) / (hi - lo || 1)) * (x1 - x0), Y = (y) => y1 - (y / (top * 1.08)) * (y1 - y0);
      const pts = Array.from({ length: 61 }, (_, i) => lo + ((hi - lo) * i) / 60).map((x) => `${f(X(x))},${f(Math.max(y0, Y(kde(x))))}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>`;
    }
    return svg + label(`n = ${vals.length}`, x1, y0 + 10, 'end');
  }
  if (s.preset === 'boxplot') {
    const a = nums(p.groupA, [14, 16, 15, 19, 18, 17, 21]), b = nums(p.groupB, [19, 22, 24, 21, 25, 23, 27]);
    const all = [...a, ...b], span = Math.max(...all) - Math.min(...all) || 1;
    const lo = Math.min(...all) - span * 0.08, hi = Math.max(...all) + span * 0.08;
    const w = x1 - x0, half = Math.min(36, w / 8);
    return axes + boxplot(box, a, x0 + w * 0.3, half, col)(lo, hi) + boxplot(box, b, x0 + w * 0.7, half, '#1d7a4a')(lo, hi)
      + label(String(p.labelA || 'Group A'), x0 + w * 0.3, y1 + 12) + label(String(p.labelB || 'Group B'), x0 + w * 0.7, y1 + 12);
  }
  if (s.preset === 'scatter') {
    const xs = nums(p.x, [1, 2, 3, 4, 5, 6, 7, 8]), ys = nums(p.y, [2.1, 3.8, 6.2, 7.9, 10.4, 11.7, 14.2, 15.8]);
    const n = Math.min(xs.length, ys.length);
    const X0 = Math.min(...xs.slice(0, n)), X1 = Math.max(...xs.slice(0, n)), Y0 = Math.min(...ys.slice(0, n)), Y1 = Math.max(...ys.slice(0, n));
    const px = (x) => x0 + 8 + ((x - X0) / (X1 - X0 || 1)) * (x1 - x0 - 16), py = (y) => y1 - 8 - ((y - Y0) / (Y1 - Y0 || 1)) * (y1 - y0 - 16);
    let svg = axes + xs.slice(0, n).map((x, i) => `<circle cx="${f(px(x))}" cy="${f(py(ys[i]))}" r="3.2" fill="${col}"/>`).join('');
    if (p.fit !== false && n > 1) {
      // Least squares, as lm(y ~ x).
      const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n, my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
      const slope = sxx ? sxy / sxx : 0, cut = my - slope * mx;
      svg += `<line x1="${f(px(X0))}" y1="${f(py(cut + slope * X0))}" x2="${f(px(X1))}" y2="${f(py(cut + slope * X1))}" stroke="#c0392b" stroke-width="2"/>`
        + label(`y = ${Math.round(cut * 100) / 100} + ${Math.round(slope * 100) / 100}x`, x0 + 8, y0 + 10, 'start');
    }
    return svg;
  }
  // custom: the first lines of its R code, as a code card clipped to the box.
  const maxLines = Math.max(1, Math.floor((y1 - y0 - 16) / 15));
  const maxChars = Math.max(12, Math.floor((x1 - x0 - 20) / 6.8));
  const code = String(s.rCode || 'plot(1:10, main = "Custom R Plot")').split('\n').filter((l) => l.trim()).slice(0, maxLines);
  const clipId = `rc_${Math.round(x0)}_${Math.round(y0)}_${Math.round(x1 - x0)}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x0 + 4}" y="${y0 + 4}" width="${Math.max(0, x1 - x0 - 8)}" height="${Math.max(0, y1 - y0 - 8)}" rx="4"/></clipPath></defs>`
    + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="6" fill="#f5f7fa" stroke="#dce0e5"/>`
    + `<g clip-path="url(#${clipId})">`
    + code.map((line, i) => `<text x="${x0 + 10}" y="${f(y0 + 18 + i * 15)}" font-family="monospace" font-size="11" fill="#33415c">${escapeHtml(line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line)}</text>`).join('')
    + '</g>';
}
