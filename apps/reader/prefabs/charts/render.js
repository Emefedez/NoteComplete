// The charts module's renderer (prefabs/charts/module.json): exam figures as SVG (plots,
// histograms and bar charts, process states, CPU timelines, trees and node graphs, and the
// exams' own custom SVG) from their visual spec. Pure: no DOM, so it runs in the reader, in
// workers and in Node (the MCP add_prefab tool). Moved from exam-html.js, which re-exports it.
import { escapeHtml, evalMathExpr, sanitizeSvg } from '../kit/svg.js';
import { displaySpec } from '../../chart-model.js';

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
    const end = Number.isFinite(Number(r.end)) && r.end !== null && r.end !== '' ? Number(r.end) : null;
    return { label: String(r.label ?? r.name ?? r.process ?? `P${ri + 1}`).trim(), arrival, end, segments, done: r.done !== false };
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
    const defaultDirected = typeof raw.directed === 'boolean' ? raw.directed : ['tree', 'fsm', 'automaton', 'dag'].includes(rawType);
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

// The process-state diagram drawn as by hand: one line per process, top to bottom as listed (as
// the chart editor shows them)
// over a grid, running solid blue, ready dashed green, blocked red hatching, each stretch's
// length written under it in its colour, a dot on arrival and * when it ends.
function renderStatesSvg(spec, { forMcp = false } = {}) {
  const W = 600;
  const COLORS = { run: '#2563eb', ready: '#16a34a', blocked: '#dc2626' };
  const fs = forMcp ? 12.5 : 10.5;
  const rows = spec.processes;
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
    // Where it ends: its end marker when it has one, else the end of its last stretch.
    const endsAt = p.end ?? last?.end;
    if (endsAt != null && p.done && endsAt <= spec.tEnd) {
      els.push(`<text x="${(mapT(endsAt) + 4).toFixed(1)}" y="${y + 6}" font-size="${fs + 6}" font-weight="700" fill="${COLORS.run}">*</text>`);
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

// --- The module's hooks (docs/PREFAB-MODULES.md, api 1) -------------------------------------
const NAMES = { plot: 'Exam plot', histogram: 'Histogram', states: 'Process states', timeline: 'CPU timeline', tree: 'Tree or node graph', graph_nodes: 'Tree or node graph' };
// The figure as drawn on the page: an exercise shows the student's answer, not its solution.
export function render(spec) {
  const out = renderVisualSvg(displaySpec(spec), { forMcp: false });
  return out?.svg ? out : null;
}
// Its name in menus ("Edit histogram…"): separate bars are a bar chart.
export function name(spec) {
  const s = normalizeVisualSpec(spec);
  if (s?.type === 'histogram' && !s.contiguous) return 'Bar chart';
  return NAMES[s?.type] || 'Prefab';
}
