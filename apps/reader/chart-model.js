// The data behind the chart editor (chart-editor.js), with no DOM: process-state diagrams and
// CPU timelines as a grid of time cells per row, bar charts and histograms as their bars, and
// exercises: a figure whose own data is the solution, with the student's answer beside it
// (`answer`), drawn on the page in place of the solution until the solution is shown.

export const STATES = ['run', 'ready', 'blocked'];
const STATE_TYPES = ['states', 'process_states', 'occupancy', 'ocupacion', 'ocupación', 'estados'];
const TIMELINE_TYPES = ['timeline', 'gantt', 'cpu', 'schedule', 'timing'];
const BAR_TYPES = ['histogram', 'bar', 'barchart', 'freq', 'frequency'];
const PLOT_TYPES = ['plot', 'graph', 'function', 'axes', 'curve'];
const STATE_WORDS = [
  ['run', /^(cpu|run(ning)?|activo|active|ejec(uci[oó]n|utando)?|exec(uting)?)$/i],
  ['ready', /^(ready|listo|espera|wait(ing)?|preparado)$/i],
  ['blocked', /^(blocked|bloq(ueado|\.)?|block|e\/s|i\/o|io|es|disco|disk|impresora|printer)\d*$/i],
];
export function stateOf(label) {
  const t = String(label || '').trim();
  for (const [state, re] of STATE_WORDS) if (re.test(t)) return state;
  return '';
}
const num = (v, d = null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const clone = (v) => JSON.parse(JSON.stringify(v));
const EPS = 1e-6;

// Which editor a spec opens in: 'states', 'timeline', 'bars', 'plot', or null (its JSON).
export function editorKind(spec) {
  const t = String(spec?.type || spec?.kind || '').trim().toLowerCase();
  if (STATE_TYPES.includes(t)) return 'states';
  if (TIMELINE_TYPES.includes(t)) return 'timeline';
  if (BAR_TYPES.includes(t)) return 'bars';
  if (PLOT_TYPES.includes(t)) return 'plot';
  return null;
}
// Kinds that can be an exercise filled in in the editor.
export const canBeExercise = (spec) => ['states', 'timeline', 'bars'].includes(editorKind(spec));

// --- Rows of a states diagram or timeline --------------------------------------------------
// The raw rows with their stretches: [{ label, arrival, done, spans: [{ value, start, end }] }].
// `value`: a state (run, ready, blocked) for a states diagram, the interval's label otherwise.
function rowsOf(kind, data) {
  if (kind === 'states') {
    const raw = Array.isArray(data.processes) ? data.processes : Array.isArray(data.rows) ? data.rows : [];
    return raw.filter((r) => r && typeof r === 'object').map((r, i) => ({
      label: String(r.label ?? r.name ?? `P${i + 1}`),
      arrival: num(r.arrival),
      // Where it ends (a second marker on its line): nothing is painted from there on.
      end: num(r.end),
      done: r.done !== false,
      spans: (Array.isArray(r.segments) ? r.segments : Array.isArray(r.intervals) ? r.intervals : [])
        .map((s) => ({ value: STATES.includes(s?.state) ? s.state : stateOf(s?.state ?? s?.label), start: num(s?.start ?? s?.from), end: num(s?.end ?? s?.to) }))
        .filter((s) => s.value && s.start != null && s.end != null && s.end > s.start),
    }));
  }
  const raw = Array.isArray(data.rows) ? data.rows : Array.isArray(data.lanes) ? data.lanes : Array.isArray(data.processes) ? data.processes : [];
  const rows = raw.map((r, i) => (typeof r === 'string' ? { label: r, intervals: [] } : r)).filter((r) => r && typeof r === 'object').map((r, i) => ({
    label: String(r.label ?? r.name ?? `Row ${i + 1}`),
    spans: (Array.isArray(r.intervals) ? r.intervals : [])
      .map((s) => (Array.isArray(s) ? { label: s[0], start: s[1], end: s[2] } : s))
      .map((s) => ({ value: String(s?.label ?? s?.proc ?? s?.name ?? '').trim() || '?', start: num(s?.start ?? s?.from), end: num(s?.end ?? s?.to) }))
      .filter((s) => s.start != null && s.end != null && s.end > s.start),
  }));
  // Intervals given at the top level go to their row (or the first one).
  for (const s of Array.isArray(data.intervals) ? data.intervals : []) {
    const start = num(s?.start), end = num(s?.end);
    if (start == null || end == null || end <= start) continue;
    const name = String(s.row || '').trim() || 'CPU';
    let row = rows.find((r) => r.label === name);
    if (!row) rows.push(row = { label: name, spans: [] });
    row.spans.push({ value: String(s.label ?? '').trim() || '?', start, end });
  }
  return rows;
}

// The time cell that fits every boundary: 1 when they are whole numbers, finer otherwise,
// and coarser when there would be too many cells.
export function cellFor(times, tStart, tEnd, tStep = null) {
  const fits = (c) => times.every((t) => Math.abs((t - tStart) / c - Math.round((t - tStart) / c)) < EPS);
  const span = tEnd - tStart;
  for (const c of [1, 0.5, 0.25, 0.2, 0.1]) if (fits(c) && span / c <= 240) return c;
  if (tStep && fits(tStep) && span / tStep <= 400) return tStep;
  return Math.max(span / 120, 0.01);
}

// A states diagram or timeline as a grid: { kind, tStart, tEnd, cell, rows: [{ label,
// arrival, done, cells }] }, a cell holding a state or label, or '' when nothing happens.
// `data`: where the rows come from (the spec, or its answer).
export function gridOf(spec, data = spec) {
  const kind = editorKind(spec);
  const rows = rowsOf(kind, data || {});
  const structure = data === spec ? rows : rowsOf(kind, spec);
  const all = structure.concat(rows).flatMap((r) => r.spans);
  const tStart = num(spec.tStart, 0);
  let tEnd = num(spec.tEnd);
  if (tEnd == null || tEnd <= tStart) tEnd = Math.max(tStart + (kind === 'states' ? 20 : 12), ...all.map((s) => s.end));
  const cell = num(spec.cell) > 0 ? num(spec.cell) : cellFor(all.flatMap((s) => [s.start, s.end]).concat(structure.map((r) => r.arrival).filter((a) => a != null)), tStart, tEnd, num(spec.tStep));
  const n = Math.max(1, Math.round((tEnd - tStart) / cell));
  const base = data === spec ? rows : structure;
  return {
    kind, tStart, tEnd, cell,
    rows: base.map((r, i) => {
      const cells = Array(n).fill('');
      const spans = data === spec ? r.spans : rows[i]?.spans || [];
      for (const s of spans) {
        const a = Math.max(0, Math.round((s.start - tStart) / cell)), b = Math.min(n, Math.round((s.end - tStart) / cell));
        for (let k = a; k < b; k++) cells[k] = s.value;
      }
      const out = { label: r.label, arrival: r.arrival ?? null, done: r.done !== false, cells };
      if (r.end != null) out.end = r.end;
      return out;
    }),
  };
}

// Cells back to stretches: runs of one value, at the cell's times.
export function spansOf(cells, tStart, cell) {
  const out = [];
  const at = (k) => Math.round((tStart + k * cell) * 1e6) / 1e6;
  cells.forEach((v, k) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.value === v && last.k === k) { last.k = k + 1; last.end = at(k + 1); return; }
    out.push({ value: v, start: at(k), end: at(k + 1), k: k + 1 });
  });
  return out.map(({ value, start, end }) => ({ value, start, end }));
}

// The rows of a grid as the spec writes them: { processes } or { rows }.
export function rowsData(grid) {
  if (grid.kind === 'states') {
    return {
      processes: grid.rows.map((r) => ({
        label: r.label,
        ...(r.arrival != null ? { arrival: r.arrival } : {}),
        ...(r.end != null ? { end: r.end } : {}),
        ...(r.done === false ? { done: false } : {}),
        segments: spansOf(r.cells, grid.tStart, grid.cell).map((s) => ({ state: s.value, start: s.start, end: s.end })),
      })),
    };
  }
  return { rows: grid.rows.map((r) => ({ label: r.label, intervals: spansOf(r.cells, grid.tStart, grid.cell).map((s) => ({ label: s.value, start: s.start, end: s.end })) })) };
}

// The spec with the grid's rows and times, keeping everything else it says.
export function withGrid(spec, grid) {
  const out = { ...spec, tStart: grid.tStart, tEnd: grid.tEnd, ...rowsData(grid) };
  delete out.intervals; delete out.lanes;
  if (grid.kind === 'states') delete out.rows; else delete out.processes;
  return out;
}

// TRI of a process row: its time running plus its time blocked, in time units (a whole number
// when the cells allow).
export function triOf(row, cell) {
  const n = row.cells.filter((v) => v === 'run' || v === 'blocked').length * cell;
  return Math.round(n * 1e6) / 1e6;
}

// The labels used in a timeline, in order of appearance (the palette's brushes).
export function labelsOf(grid) {
  const seen = [];
  for (const r of grid.rows) for (const v of r.cells) if (v && !seen.includes(v)) seen.push(v);
  return seen;
}

// Same length of cells in every row after the time range or cell size changes.
export function resample(grid, { tStart = grid.tStart, tEnd = grid.tEnd, cell = grid.cell } = {}) {
  const n = Math.max(1, Math.round((tEnd - tStart) / cell));
  return {
    ...grid, tStart, tEnd, cell,
    rows: grid.rows.map((r) => {
      const cells = Array(n).fill('');
      for (const s of spansOf(r.cells, grid.tStart, grid.cell)) {
        const a = Math.max(0, Math.round((s.start - tStart) / cell)), b = Math.min(n, Math.round((s.end - tStart) / cell));
        for (let k = a; k < b; k++) cells[k] = s.value;
      }
      return { ...r, cells };
    }),
  };
}

// --- Bars ----------------------------------------------------------------------------------
export function barsOf(data) {
  const raw = Array.isArray(data?.bins) ? data.bins : Array.isArray(data?.bars) ? data.bars : Array.isArray(data?.data) ? data.data : [];
  return raw.map((b, i) => {
    if (Array.isArray(b)) return { label: String(b[0] ?? i + 1), value: num(b[1]) };
    if (typeof b === 'string') return { label: b, value: null };
    return { label: String(b?.label ?? b?.bin ?? b?.name ?? i + 1), value: num(b?.value ?? b?.count ?? b?.freq ?? b?.y), ...(b?.color ? { color: b.color } : {}) };
  });
}

// --- Exercises -----------------------------------------------------------------------------
// An empty answer with the solution's rows (or bars): what the student starts from.
export function emptyAnswer(spec) {
  const kind = editorKind(spec);
  if (kind === 'bars') return { bins: barsOf(spec).map((b) => ({ label: b.label, value: null })) };
  const grid = gridOf(spec);
  for (const r of grid.rows) r.cells.fill('');
  return rowsData(grid);
}

// The student's answer as a grid laid out as the solution (its rows and times).
export function answerGrid(spec) {
  return gridOf(spec, spec.answer || emptyAnswer(spec));
}

// The answer kept in the spec, with the solution's own structure (labels, arrivals).
export function withAnswer(spec, answer) {
  return { ...spec, answer: clone(answer) };
}

// What the page draws: the solution, or for an exercise the student's answer with the
// solution's structure (an empty figure when nothing is answered), unless it is revealed.
export function displaySpec(spec) {
  if (!spec?.exercise || spec.reveal || !canBeExercise(spec)) return spec;
  const kind = editorKind(spec);
  const { answer, exercise, reveal, ...rest } = spec;
  if (kind === 'bars') {
    const given = barsOf(answer || {});
    const bins = barsOf(spec).map((b, i) => ({ label: b.label, value: given[i]?.value ?? null, ...(b.color ? { color: b.color } : {}) }));
    return { ...rest, bins, ...(spec.yMax == null ? { yMax: niceMax(barsOf(spec)) } : {}), blank: bins.every((b) => b.value == null) };
  }
  const grid = answerGrid(spec);
  // The axis stays the solution's, even with nothing drawn yet.
  const out = withGrid({ ...rest, tEnd: grid.tEnd }, grid);
  const any = grid.rows.some((r) => r.cells.some(Boolean));
  if (!any) out.blank = true;
  return out;
}
// The axis top of a bar chart from its solution, so the empty exercise does not give it away
// by changing when it is filled in.
function niceMax(bars) {
  const m = Math.max(0, ...bars.map((b) => b.value ?? 0));
  if (m <= 0) return 10;
  const top = m * 1.15, p = 10 ** Math.floor(Math.log10(top)), f = top / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// The answer marked against the solution: { right, total, wrong: Set of "row:cell" (or bar
// index), done }. For grids every cell counts (an empty one where the solution has nothing
// is right); bars count each value within `tolerance`.
export function checkAnswer(spec, { tolerance = 1e-6 } = {}) {
  const kind = editorKind(spec);
  const wrong = new Set();
  if (kind === 'bars') {
    const sol = barsOf(spec), ans = barsOf(spec.answer || {});
    sol.forEach((b, i) => {
      const v = ans[i]?.value;
      if (v == null || b.value == null || Math.abs(v - b.value) > tolerance) wrong.add(String(i));
    });
    return { right: sol.length - wrong.size, total: sol.length, wrong, done: wrong.size === 0 };
  }
  const sol = gridOf(spec), ans = answerGrid(spec);
  let total = 0;
  const norm = (v) => (kind === 'timeline' ? String(v || '').trim().toLowerCase() : v || '');
  sol.rows.forEach((r, ri) => r.cells.forEach((v, k) => {
    total++;
    if (norm(v) !== norm(ans.rows[ri]?.cells[k])) wrong.add(`${ri}:${k}`);
  }));
  return { right: total - wrong.size, total, wrong, done: wrong.size === 0 };
}
