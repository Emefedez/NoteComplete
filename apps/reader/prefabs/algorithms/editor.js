// The algorithms module's editor: a player in the kit's movable window. On the left the
// catalog (search, topic, order) and the input of the chosen algorithm (presets, random,
// edge list or a drawn graph, arrays, n…); in the middle the structures of the current step,
// its caption, the timeline and the controls; on the right the code with the step's line,
// the variables, the call stack and what changed. Moves are tweened between steps (not with
// prefers-reduced-motion). "Show this step on the page" and Insert/Apply put that step on the
// page; changing the input runs the algorithm again.
import { editorShell, make, button, field, textInput, numberInput, checkInput, selectInput, icon } from '../kit/index.js';
import { normalize, render, traceOf, stepIndex, name, prefabs, codeOf, errorText, rememberTrace, JAVA_TEMPLATE, JAVA_VERSIONS } from './render.js';
import { javaProgramForEditing } from './catalog/java-versions.js';
import { ALGORITHMS, algorithmById, ordered, fullName, TOPICS, topicOf } from './catalog/index.js';
import { parseEdges, edgesText, normalizeGraph, placed } from './catalog/common.js';
import { LEGEND, markStyle, theme as themeOf, show } from './structures/theme.js';
import { highlightLines, codeEditor } from '../../code-highlight.js';

const RECENT = 'nc-algorithms-recent';
const SPEEDS = [['0.5', '0.5×'], ['1', '1×'], ['2', '2×'], ['4', '4×']];
const BASE_MS = 1100;

function loadStyles() {
  if (document.querySelector('link[data-algorithms-css]')) return;
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./algorithms.css', import.meta.url).href });
  link.dataset.algorithmsCss = '';
  document.head.append(link);
}
const recentIds = () => { try { const v = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const noteRecent = (id) => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 12))); } catch { /* Optional. */ } };
const remembered = (key, fallback) => { try { return localStorage.getItem(`nc-algorithms-${key}`) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(`nc-algorithms-${key}`, value); } catch { /* Optional. */ } };

export function open(root, { spec, editing, host }) {
  loadStyles();
  let model = normalize(spec);
  const past = [], future = [];
  let run = traceOf(model);
  let index = model.step === null ? 0 : stepIndex(model, run.trace);
  let timer = 0, speed = Number(remembered('speed', '1')) || 1;
  let tab = 'catalog';
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const isJava = () => model.algorithm === 'java';
  const algo = () => algorithmById(model.algorithm) || { id: 'java', name: 'Your Java code', hint: '', fields: [], presets: [], source: model.source || '' };

  const finish = () => { stop(); host.done({ ...model, step: index }); };
  const shell = editorShell(root, {
    id: 'algorithms',
    title: name(model),
    applyLabel: host.applyLabel,
    onApply: finish,
    onCancel: () => { stop(); host.cancel(); },
    undo: () => back(past, future),
    redo: () => back(future, past),
    palette: true,
    help: [{ title: 'Player', icon: 'animation', rows: [
      { keys: 'Space', does: 'Play · pause' },
      { keys: '← →', does: 'Step back · forward' },
      { keys: 'Home / End', does: 'First · last step' },
      { does: 'Drag the timeline to any step' },
      { keys: 'Ctrl Enter', does: `${host.applyLabel} this step on the page` },
      { keys: 'Ctrl Z / Ctrl Shift Z', does: 'Undo · redo a change of algorithm or input' },
      { keys: 'Esc', does: 'Close without changes' },
    ] }, { title: 'Drawing a graph', icon: 'graph', rows: [
      { does: 'Drag a vertex to move it' },
      { keys: 'Double-click', does: 'An empty place adds a vertex; a vertex removes it' },
      { keys: 'Shift drag', does: 'From a vertex to another: an edge' },
    ] }],
  });
  root.classList.add('alg-editor');
  shell.canvas.classList.add('alg-canvas');
  shell.canvas.removeAttribute('tabindex');

  // ── The middle: stage, caption, timeline, controls ──
  const stage = make('div', { className: 'alg-stage', role: 'img' });
  const caption = make('p', { className: 'alg-caption', role: 'status' });
  const timeline = make('input', { type: 'range', className: 'alg-timeline', min: 0, step: 1 });
  timeline.setAttribute('aria-label', 'Step');
  const count = make('span', { className: 'alg-count' });
  const firstBtn = button('flagStart', 'First step (Home)', { iconOnly: true });
  const prevBtn = button('chevronLeft', 'Step back (←)', { iconOnly: true });
  const playBtn = button('play', 'Play (Space)', { iconOnly: true, primary: true });
  const nextBtn = button('chevronRight', 'Step forward (→)', { iconOnly: true });
  const lastBtn = button('flagEnd', 'Last step (End)', { iconOnly: true });
  const playIcon = (name, title) => { playBtn.replaceChildren(icon(name)); playBtn.title = title; playBtn.setAttribute('aria-label', title); };
  const speedSel = selectInput(SPEEDS, String(speed), (v) => { speed = Number(v) || 1; keep('speed', String(speed)); if (timer) { stop(); play(); } });
  speedSel.title = 'Speed';
  const pageBtn = button('check', 'Show this step on the page');
  pageBtn.classList.add('alg-page');
  pageBtn.onclick = finish;
  const controls = make('div', { className: 'alg-controls' }, firstBtn, prevBtn, playBtn, nextBtn, lastBtn, count, make('label', { className: 'alg-speed' }, make('span', { textContent: 'Speed' }), speedSel), make('span', { className: 'pk-spacer' }), pageBtn);
  shell.canvas.append(stage, caption, timeline, controls);

  firstBtn.onclick = () => { stop(); go(0); };
  prevBtn.onclick = () => { stop(); go(index - 1); };
  nextBtn.onclick = () => { stop(); go(index + 1); };
  lastBtn.onclick = () => { stop(); go(run.trace.steps.length - 1); };
  playBtn.onclick = () => (timer ? stop() : play());
  timeline.oninput = () => { stop(); go(Number(timeline.value), false); };

  // ── The right: code, variables, call stack, changes, legend ──
  const code = make('div', { className: 'alg-code', role: 'region' });
  code.setAttribute('aria-label', 'Code');
  const vars = make('dl', { className: 'alg-vars' });
  const calls = make('ol', { className: 'alg-calls' });
  const changes = make('ul', { className: 'alg-changes' });
  const legend = make('div', { className: 'alg-legend' });
  // Long lines scroll sideways (the step's line kept in sight), or wrap (remembered).
  let wrapped = remembered('wrap', '0') === '1';
  code.classList.toggle('wrap', wrapped);
  const wrapBox = checkInput('Wrap lines', wrapped, (v) => { wrapped = v; keep('wrap', v ? '1' : '0'); code.classList.toggle('wrap', v); showLine(false); });
  wrapBox.classList.add('alg-wrap');
  const codeNote = make('p', { className: 'alg-hint alg-code-note', hidden: true, textContent: 'This algorithm has no Java version to run: its code is shown, not edited. "New from Java…" (Algorithms) writes and runs your own.' });
  // Your own Java (algorithm "java"): edited here (highlighted, no errors while typing), run
  // with Run; the run's steps then show in the pane, with the line of each step.
  const editHost = make('div', { className: 'alg-code-edit', hidden: true });
  const errorBox = make('p', { className: 'alg-code-error', role: 'alert', hidden: true });
  const editBtn = button('draw', 'Edit the code');
  editBtn.classList.add('alg-edit-code');
  editBtn.hidden = true;
  let editor = null, codeEditing = false;
  editBtn.onclick = () => setEditing(true);
  shell.panel.append(make('div', { className: 'alg-code-head' }, make('h4', { textContent: 'Code (Java)' }), wrapBox, editBtn), codeNote, errorBox, editHost, code, make('h4', { textContent: 'Variables' }), vars, make('h4', { textContent: 'Call stack' }), calls, make('h4', { textContent: 'Changes in this step' }), changes, legend);
  let codeFor = '';
  function setEditing(on) {
    codeEditing = on && isJava();
    if (codeEditing && !editor) {
      editor = codeEditor(editHost, { value: model.source, lang: 'java', label: 'Java code', onChange: (text) => { model = { ...model, source: text }; shell.say('Run (in the Input tab) to see the steps of the code as it is now'); } });
    } else if (editor && editor.value !== model.source) editor.value = model.source;
    editHost.hidden = !codeEditing;
    code.hidden = codeEditing;
    wrapBox.hidden = codeEditing;
    editBtn.hidden = codeEditing || !isJava();
    if (codeEditing) requestAnimationFrame(() => editor?.focus());
  }
  // The error of the last run, at its line in the pane.
  function showError() {
    const err = run.trace.error && typeof run.trace.error === 'object' ? run.trace.error : null;
    errorBox.hidden = !err;
    errorBox.textContent = err ? errorText(err) : '';
    for (const l of code.querySelectorAll('.alg-line.error')) l.classList.remove('error');
    if (err?.line) code.querySelector(`[data-line="${err.line}"]`)?.classList.add('error');
  }
  const paintCode = () => {
    const source = codeOf(model);
    if (codeFor === source) return;
    codeFor = source;
    code.replaceChildren(...highlightLines(source, 'java').map((html, i) => {
      const line = make('div', { className: 'alg-line' }, make('span', { className: 'alg-ln', textContent: String(i + 1) }));
      const text = make('code', {});
      text.innerHTML = html || ' ';
      line.append(text);
      line.dataset.line = String(i + 1);
      return line;
    }));
  };

  // ── Drawing a step ──
  const themeName = () => (dark.matches ? 'dark' : 'light');
  const positions = () => {
    const out = new Map();
    for (const el of stage.querySelectorAll('[data-k]')) {
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el.getAttribute('transform') || '');
      if (m) out.set(el.dataset.k, { x: +m[1], y: +m[2], el, text: el.querySelector('[data-v]')?.textContent ?? null });
    }
    return out;
  };
  function paintStage(animate) {
    const before = animate ? positions() : null;
    const svg = render({ ...model, step: index }, { theme: themeName(), bare: true }).svg;
    stage.innerHTML = svg;
    if (!before || reduced.matches) return;
    const ms = Math.min(520, (BASE_MS / speed) * 0.55);
    const now = positions();
    for (const [k, p] of now) {
      const old = before.get(k);
      if (!old) { p.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' }); continue; }
      if (old.x !== p.x || old.y !== p.y) p.el.animate([{ transform: `translate(${old.x}px, ${old.y}px)` }, { transform: `translate(${p.x}px, ${p.y}px)` }], { duration: ms, easing: 'ease-in-out' });
      const a = Number(old.text), b = Number(p.text);
      if (old.text !== p.text && old.text !== null && Number.isFinite(a) && Number.isFinite(b) && Number.isInteger(a) && Number.isInteger(b)) tweenNumber(p.el.querySelector('[data-v]'), a, b, ms);
    }
    // What left: its old picture fades where it was.
    for (const [k, old] of before) {
      if (now.has(k)) continue;
      const box = old.el.closest('[data-s]')?.dataset.s;
      const parent = box && stage.querySelector(`[data-s="${CSS.escape(box)}"] > g`);
      if (!parent) continue;
      const ghost = old.el.cloneNode(true);
      ghost.removeAttribute('data-k');
      parent.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in' }).onfinish = () => ghost.remove();
    }
  }
  function tweenNumber(el, a, b, ms) {
    if (!el) return;
    const t0 = performance.now();
    const tick = (t) => {
      if (!el.isConnected) return;
      const f = Math.min(1, (t - t0) / ms);
      el.textContent = String(Math.round(a + (b - a) * f));
      if (f < 1) requestAnimationFrame(tick); else el.textContent = String(b);
    };
    requestAnimationFrame(tick);
  }
  function paintStep(animate = true) {
    const steps = run.trace.steps;
    index = Math.max(0, Math.min(steps.length - 1, index));
    const step = steps[index];
    paintStage(animate);
    caption.textContent = step.caption;
    caption.classList.toggle('error', !!run.error && index === steps.length - 1);
    timeline.max = String(steps.length - 1);
    timeline.value = String(index);
    count.textContent = `${index + 1} / ${steps.length}`;
    firstBtn.disabled = prevBtn.disabled = index === 0;
    nextBtn.disabled = lastBtn.disabled = index === steps.length - 1;
    paintCode();
    showError();
    for (const line of code.querySelectorAll('.alg-line.on')) line.classList.remove('on');
    const on = step.line && code.querySelector(`[data-line="${step.line}"]`);
    if (on) on.classList.add('on');
    showLine(animate);
    const entries = Object.entries(step.vars || {});
    vars.replaceChildren(...(entries.length ? entries.flatMap(([k, v]) => [make('dt', { textContent: k }), make('dd', { textContent: show(v) })]) : [make('dd', { className: 'alg-none', textContent: '—' })]));
    calls.replaceChildren(...(step.calls?.length ? [...step.calls].reverse().map((c, i) => make('li', { className: i === 0 ? 'on' : '', textContent: `${c.fn}(${c.args})` })) : [make('li', { className: 'alg-none', textContent: '—' })]));
    changes.replaceChildren(...(step.changes?.length ? step.changes.map((c) => make('li', {}, make('b', { textContent: run.trace.structures[c.id]?.label || c.id }), ` ${describe(c)}`)) : [make('li', { className: 'alg-none', textContent: 'Nothing changed' })]));
    const used = [...new Set(Object.values(step.marks || {}).flatMap((m) => Object.values(m)))].filter((m) => LEGEND[m]);
    const c = themeOf(themeName());
    legend.replaceChildren(...used.map((m) => { const st = markStyle(m, c); const sw = make('i', {}); Object.assign(sw.style, { background: st.fill, borderColor: st.stroke, borderStyle: st.dash ? 'dashed' : 'solid' }); return make('span', {}, sw, LEGEND[m]); }));
    if (!timer) playIcon(index === steps.length - 1 ? 'restart' : 'play', index === steps.length - 1 ? 'Play again (Space)' : 'Play (Space)');
  }
  // The step's line in the middle of the pane, and its text (from its indent) in sight.
  function showLine(animate) {
    const on = code.querySelector('.alg-line.on');
    if (!on) return;
    const top = on.offsetTop - code.clientHeight / 2 + on.offsetHeight / 2;
    let left = code.scrollLeft;
    if (!wrapped) {
      const text = on.querySelector('code'), ln = on.querySelector('.alg-ln');
      const indent = (text.textContent.match(/^\s*/)[0].length) * (text.getBoundingClientRect().width / Math.max(1, text.textContent.length));
      const start = ln.offsetWidth + indent, end = ln.offsetWidth + text.getBoundingClientRect().width;
      // The numbers cover the pane's left edge (they stay put), so the text starts after them.
      if (start < left + ln.offsetWidth + 8 || start > left + code.clientWidth - 60) left = Math.max(0, start - ln.offsetWidth - 24);
      else if (end > left + code.clientWidth && end - start < code.clientWidth - 30) left = Math.max(0, end - code.clientWidth + 12);
    } else left = 0;
    code.scrollTo({ top: Math.max(0, top), left, behavior: reduced.matches || !animate ? 'auto' : 'smooth' });
  }
  const describe = (c) => {
    const at = c.path === null || c.path === undefined ? '' : Array.isArray(c.path) ? `[${c.path.join('][')}]` : ` ${show(c.path)}`;
    if (c.op === 'set') return `${at.trim() || 'value'}: ${show(c.from)} → ${show(c.to)}`;
    if (c.op === 'add') return `+ ${show(c.to)}${at && !Array.isArray(c.path) && typeof c.path !== 'number' ? '' : at ? ` at${at}` : ''}`;
    if (c.op === 'remove') return `− ${show(c.from)}`;
    if (c.op === 'swap') return `swap${at}`;
    return `${c.op}${at}`;
  };
  function go(i, animate = true) {
    const n = run.trace.steps.length;
    const next = Math.max(0, Math.min(n - 1, i));
    const near = Math.abs(next - index) === 1;
    index = next;
    paintStep(animate && near);
  }
  function play() {
    if (index >= run.trace.steps.length - 1) { index = 0; paintStep(false); }
    playIcon('pause', 'Pause (Space)');
    const tick = () => {
      if (index >= run.trace.steps.length - 1) return stop();
      go(index + 1);
      timer = setTimeout(tick, BASE_MS / speed);
    };
    timer = setTimeout(tick, Math.min(400, BASE_MS / speed));
  }
  function stop() {
    clearTimeout(timer);
    timer = 0;
    playIcon(index >= run.trace.steps.length - 1 ? 'restart' : 'play', index >= run.trace.steps.length - 1 ? 'Play again (Space)' : 'Play (Space)');
  }

  // ── Changes of algorithm or input (undoable) ──
  function back(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    rerun(true, 0);
  }
  function change(next, { rebuild = false } = {}) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next });
    rerun(rebuild, 'input' in next || 'algorithm' in next ? 0 : index);
  }
  function rerun(rebuild, at) {
    stop();
    if (isJava() && !hasRun(model)) { pendingRun(); return; }
    run = traceOf(model);
    index = at;
    shell.say(run.error ? run.error : '', !!run.error);
    shell.history(past.length > 0, future.length > 0);
    root.querySelector('.pk-title').textContent = name(model);
    if (rebuild) side();
    else graphView?.redraw();
    editBtn.hidden = codeEditing || !isJava();
    codeNote.hidden = !(host.mode === 'code' && !isJava());
    paintStep(false);
  }

  // ── Running Java: in a worker, cancellable, step-limited ──
  let worker = null, runBtn = null, cancelBtn = null;
  const ran = new Set();
  const runKey = (m) => JSON.stringify([m.source, m.entry, m.args, m.stdin, m.maxSteps]);
  const hasRun = (m) => ran.has(runKey(m));
  // A Java spec not run yet in this player (just written, or opened from a page): run it.
  function pendingRun() { runJava({ auto: true }); }
  function runJava({ auto = false } = {}) {
    if (!isJava()) return;
    if (editor) model = { ...model, source: editor.value };
    cancelRun(false);
    let args;
    try { args = JSON.parse(model.args || '[]'); if (!Array.isArray(args)) args = [args]; } catch (e) { shell.say(`The arguments are not JSON: ${e.message}`, true); return; }
    const spec = { ...model };
    shell.say('Running…');
    if (runBtn) { runBtn.disabled = true; cancelBtn.hidden = false; }
    worker = new Worker(new URL('./java/worker.js', import.meta.url), { type: 'module' });
    const started = performance.now();
    worker.onmessage = ({ data }) => {
      finishRun();
      rememberTrace(spec, data.trace);
      ran.add(runKey(spec));
      run = traceOf(spec);
      index = 0;
      const err = data.trace.error;
      shell.say(err ? errorText(err) : `Ran in ${Math.round(performance.now() - started)} ms: ${data.trace.steps.length} steps${data.trace.truncated ? ' (stopped at the step limit)' : ''}${data.trace.resultText != null ? `; returned ${data.trace.resultText}` : ''}`, !!err);
      // Run shows the steps (an error: its step, at its line); a run on its own (a new program)
      // leaves the editor as it was.
      if (err?.kind === 'compile' || err?.kind === 'runtime') { setEditing(false); index = run.trace.steps.length - 1; }
      else if (!auto) setEditing(false);
      root.querySelector('.pk-title').textContent = name(model);
      paintStep(false);
    };
    worker.onerror = (e) => { finishRun(); shell.say(`The run failed: ${e.message || 'the worker stopped'}`, true); };
    worker.postMessage({ id: 1, source: spec.source, options: { entry: spec.entry || undefined, args, input: spec.stdin, maxFrames: spec.maxSteps, maxMs: 20000 } });
  }
  function finishRun() {
    worker?.terminate();
    worker = null;
    if (runBtn) { runBtn.disabled = false; cancelBtn.hidden = true; }
  }
  function cancelRun(say = true) {
    if (!worker) return;
    finishRun();
    if (say) shell.say('Cancelled');
  }

  // ── The left: catalog and input ──
  let graphView = null;
  const tabs = make('div', { className: 'alg-tabs', role: 'tablist' });
  const sideBody = make('div', { className: 'alg-side' });
  for (const [id, label] of [['catalog', 'Algorithms'], ['input', 'Input']]) {
    const b = make('button', { type: 'button', textContent: label, role: 'tab' });
    b.dataset.tab = id;
    b.onclick = () => { tab = id; side(); };
    tabs.append(b);
  }
  shell.palette.append(tabs, sideBody);
  let query = '', topic = remembered('topic', ''), sort = remembered('sort', 'topic');
  function side() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    graphView = null;
    sideBody.replaceChildren(...(tab === 'catalog' ? catalog() : inputForm()));
  }
  function catalog() {
    const search = make('input', { type: 'search', className: 'alg-search', placeholder: 'Search algorithms', value: query, spellcheck: false });
    search.setAttribute('aria-label', 'Search algorithms');
    const list = make('div', { className: 'alg-list', role: 'listbox' });
    const topicSel = selectInput([['', 'All topics'], ...TOPICS.filter((t) => ALGORITHMS.some((a) => a.topic === t.id)).map((t) => [t.id, t.heading])], topic, (v) => { topic = v; keep('topic', v); fill(); });
    const sortSel = selectInput([['topic', 'By topic'], ['name', 'By name'], ['recent', 'Recently used']], sort, (v) => { sort = v; keep('sort', v); fill(); });
    topicSel.setAttribute('aria-label', 'Topic'); sortSel.setAttribute('aria-label', 'Order');
    let thumbs = [];
    const fill = () => {
      thumbs = [];
      const q = query.trim().toLowerCase();
      const shown = ordered(sort, recentIds()).filter((a) => (!topic || a.topic === topic) && (!q || `${fullName(a)} ${a.hint} ${topicOf(a.topic).heading}`.toLowerCase().includes(q)));
      const rows = [];
      let heading = null;
      for (const a of shown) {
        if (sort === 'topic' && heading !== a.topic) { heading = a.topic; rows.push(make('h5', { className: 'alg-heading', textContent: topicOf(a.topic).heading })); }
        const thumb = make('span', { className: 'alg-thumb', 'aria-hidden': 'true' });
        thumbs.push([a.id, thumb]);
        const b = make('button', { type: 'button', className: `alg-item${a.id === model.algorithm ? ' on' : ''}`, role: 'option', title: a.hint }, thumb, make('span', { className: 'alg-item-text' }, make('strong', { textContent: fullName(a) }), make('small', { textContent: a.hint })));
        b.setAttribute('aria-selected', String(a.id === model.algorithm));
        b.dataset.algorithm = a.id;
        b.onclick = () => choose(a.id);
        rows.push(b);
      }
      list.replaceChildren(...(rows.length ? rows : [make('p', { className: 'alg-none', textContent: 'No algorithm matches' })]));
      drawThumbs(thumbs);
    };
    search.oninput = () => { query = search.value; fill(); };
    fill();
    const fromJava = button('code', 'New from Java…');
    fromJava.classList.add('alg-new-java');
    fromJava.title = 'Write your own Java (the course\'s TADs are there: Graph, Map, BinaryTree, Queue…) and play its run';
    fromJava.onclick = () => newJava(JAVA_TEMPLATE, 'Main.run', '[[5, 3, 8, 1]]');
    return [fromJava, search, make('div', { className: 'alg-row' }, topicSel, sortSel), list];
  }
  // The list's small pictures (each algorithm's middle step on its first preset), a few at a
  // time so the list shows at once; kept for the next time the list is drawn.
  let thumbTimer = 0;
  function drawThumbs(list) {
    clearTimeout(thumbTimer);
    const next = () => {
      const until = performance.now() + 14;
      while (list.length && performance.now() < until) {
        const [id, el] = list.shift();
        if (!el.isConnected) continue;
        if (!thumbCache.has(id)) {
          const card = cards.find((c) => c.spec.algorithm === id);
          thumbCache.set(id, card ? render(card.spec, { theme: themeName(), bare: true }).svg : '');
        }
        el.innerHTML = thumbCache.get(id);
      }
      if (list.length) thumbTimer = setTimeout(next, 16);
    };
    thumbTimer = setTimeout(next, 30);
  }
  const cards = prefabs();
  const thumbCache = new Map();
  // A Java program of your own: the code in the editor, the Input tab to run it.
  function newJava(source, entry, args) {
    codeFor = '';
    change({ algorithm: 'java', source, entry, args, stdin: '', input: undefined, java: undefined });
    tab = 'input';
    side();
    setEditing(true);
  }
  function choose(id) {
    noteRecent(id);
    if (id === model.algorithm) { tab = 'input'; side(); return; }
    const a = algorithmById(id);
    codeFor = '';
    change({ algorithm: id, input: structuredClone(a.presets[0].input) });
    side();
  }
  function javaForm() {
    runBtn = button('play', 'Run', { primary: true });
    runBtn.classList.add('alg-run');
    runBtn.onclick = () => runJava();
    cancelBtn = button('close', 'Cancel the run');
    cancelBtn.hidden = !worker;
    cancelBtn.onclick = () => cancelRun();
    if (worker) runBtn.disabled = true;
    const keepJava = (k, v) => { model = { ...model, [k]: v }; };
    return [
      make('h4', { textContent: 'Your Java code' }),
      make('p', { className: 'alg-hint', textContent: 'Write it on the right; Run plays its steps. The course\'s TADs are there (Graph, Vertex, Edge, Map/HashMap, Set, List, Queue, Stack, BinaryTree, Tree, BinaryMaxHeap) and java.util.' }),
      field('Entry (Class.method)', textInput(model.entry, (v) => keepJava('entry', v), { placeholder: 'Main.run' })),
      field('Arguments (JSON)', textInput(model.args, (v) => keepJava('args', v), { placeholder: '[[5, 3, 8, 1]]' }), 'A list, one value per parameter: arrays, numbers, "A-B 4, B-C 2" for a Graph…'),
      field('Input (System.in)', (() => { const a = make('textarea', { value: model.stdin || '', rows: 2, spellcheck: false, className: 'alg-text' }); a.oninput = () => keepJava('stdin', a.value); return a; })()),
      field('Step limit', numberInput(model.maxSteps, (n) => keepJava('maxSteps', n), { min: 10, max: 20000, step: 100 })),
      make('div', { className: 'alg-row alg-run-row' }, runBtn, cancelBtn),
      make('h4', { textContent: 'On the page' }), checkInput('Name and caption over it', model.caption, (v) => change({ caption: v })), checkInput('The code beside it', model.code, (v) => change({ code: v })),
    ];
  }
  function inputForm() {
    if (isJava()) return javaForm();
    const a = algo();
    let input;
    try { input = a.normalize(model.input); } catch { input = model.input; }
    const set = (key, value, rebuild = false) => change({ input: { ...model.input, [key]: value } }, { rebuild });
    const presets = make('div', { className: 'alg-presets' }, ...a.presets.map((p) => {
      const b = button('', p.label);
      b.onclick = () => change({ input: structuredClone(p.input) }, { rebuild: true });
      return b;
    }));
    const random = button('shuffle', 'Random input');
    random.onclick = () => change({ input: a.random(Date.now() & 0xffffff) }, { rebuild: true });
    const out = [make('h4', { textContent: fullName(a) }), make('p', { className: 'alg-hint', textContent: a.hint }), make('h4', { textContent: 'Presets' }), presets, random];
    if (JAVA_VERSIONS[a.id]) {
      const toJava = button('code', 'Open as Java code…');
      toJava.title = 'This algorithm as a Java program of your own, to change and run';
      toJava.onclick = () => openAsJava(a);
      out.push(checkInput('Run the Java version (the code on the right, through the Java interpreter)', !!model.java, (v) => change({ java: v || undefined })), toJava);
    }
    out.push(make('h4', { textContent: 'Input' }));
    for (const f of a.fields) {
      const value = model.input?.[f.key];
      if (f.type === 'graph') out.push(...graphInput(f, input?.graph || value));
      else if (f.type === 'vertex') {
        const g = input?.[f.of] || { nodes: [] };
        out.push(field(f.label, selectInput(g.nodes.map((n) => [n.id, n.id]), String(input?.[f.key] ?? ''), (v) => set(f.key, v))));
      } else if (f.type === 'array') {
        out.push(field(f.label, textInput((Array.isArray(value) ? value : input?.[f.key] || []).join(', '), (text) => set(f.key, text.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite)), { placeholder: '5, 3, 8, 1' }), 'Numbers separated by commas'));
      } else if (f.type === 'int' || f.type === 'number') {
        out.push(field(f.label, numberInput(value ?? input?.[f.key], (n) => set(f.key, n), { min: f.min, max: f.max, step: f.step || (f.type === 'int' ? 1 : 'any') })));
      } else if (f.type === 'choice') {
        out.push(field(f.label, selectInput(f.options, String(value ?? input?.[f.key] ?? f.options[0][0]), (v) => set(f.key, v))));
      } else if (f.type === 'line') {
        out.push(field(f.label, textInput(String(value ?? input?.[f.key] ?? ''), (text) => set(f.key, text), { placeholder: f.placeholder || '' }), f.hint || ''));
      } else if (f.type === 'text') {
        const area = make('textarea', { value: String(value ?? input?.[f.key] ?? ''), rows: 6, spellcheck: false, className: 'alg-text' });
        area.oninput = () => set(f.key, area.value);
        out.push(field(f.label, area, f.hint || ''));
      }
    }
    out.push(make('h4', { textContent: 'On the page' }), checkInput('Name and caption over it', model.caption, (v) => change({ caption: v })), checkInput('The code beside it', model.code, (v) => change({ code: v })));
    return out;
  }

  // A graph: its edge list as text, and a small drawing to move, add and join vertices.
  function graphInput(f, raw) {
    const weighted = !!f.weighted;
    const fixedDirection = typeof f.directed === 'boolean';
    let graph = normalizeGraph(raw, { weighted, directed: fixedDirection ? f.directed : null });
    const commit = (g, rebuildText = true) => {
      graph = g;
      change({ input: { ...model.input, [f.key]: g } });
      if (rebuildText) area.value = edgesText(g);
    };
    const area = make('textarea', { value: edgesText(graph), rows: 6, spellcheck: false, className: 'alg-text' });
    area.oninput = () => {
      const p = parseEdges(area.value);
      if (p.problems.length) { shell.say(`Not an edge: "${p.problems[0]}" (write A-B 4, A->B 4 or a lone vertex)`, true); return; }
      const at = new Map(graph.nodes.map((n) => [n.id, n]));
      const directed = fixedDirection ? f.directed : p.edges.some((e) => e.arrow) || (graph.directed && !p.edges.length);
      const g = normalizeGraph({ nodes: p.nodes.map((id) => ({ id, ...(at.has(id) && Number.isFinite(at.get(id).x) ? { x: at.get(id).x, y: at.get(id).y } : {}) })), edges: p.edges, directed }, { weighted, directed });
      commit(g, false);
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('alg-draw');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Graph: drag vertices; double-click to add or remove; Shift drag to join');
    let box = null;
    const toSvg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 }; };
    const nodesNow = () => placed(graph);
    function redraw() {
      graph = normalizeGraph(model.input?.[f.key] ?? graph, { weighted, directed: fixedDirection ? f.directed : null });
      const nodes = nodesNow();
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const minX = Math.min(0, ...xs) - 30, minY = Math.min(0, ...ys) - 30, maxX = Math.max(300, ...xs) + 30, maxY = Math.max(200, ...ys) + 30;
      box = { minX, minY, w: maxX - minX, h: maxY - minY };
      svg.setAttribute('viewBox', `${minX} ${minY} ${box.w} ${box.h}`);
      const at = new Map(nodes.map((n) => [n.id, n]));
      const parts = graph.edges.map((e) => { const p = at.get(e.from), q = at.get(e.to); return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="e"/>${e.w != null ? `<text x="${(p.x + q.x) / 2}" y="${(p.y + q.y) / 2 - 4}" class="w">${e.w}</text>` : ''}${graph.directed ? `<circle cx="${q.x - (q.x - p.x) * 18 / (Math.hypot(q.x - p.x, q.y - p.y) || 1)}" cy="${q.y - (q.y - p.y) * 18 / (Math.hypot(q.x - p.x, q.y - p.y) || 1)}" r="3.5" class="tip"/>` : ''}`; });
      for (const n of nodes) parts.push(`<g class="v" data-id="${n.id.replace(/"/g, '')}" transform="translate(${n.x} ${n.y})"><circle r="15"/><text y="4.5">${n.id.replace(/[<&]/g, '')}</text></g>`);
      parts.push('<line class="link" hidden x1="0" y1="0" x2="0" y2="0"/>');
      svg.innerHTML = parts.join('');
    }
    svg.addEventListener('pointerdown', (e) => {
      const v = e.target.closest?.('.v');
      if (!v || e.button > 0) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const id = v.dataset.id, nodes = nodesNow(), node = nodes.find((n) => n.id === id);
      const start = toSvg(e), link = svg.querySelector('.link');
      const joining = e.shiftKey;
      let moved = false;
      const move = (m) => {
        const p = toSvg(m);
        moved = moved || Math.hypot(p.x - start.x, p.y - start.y) > 3;
        if (joining) { Object.assign(link.attributes, {}); link.removeAttribute('hidden'); link.setAttribute('x1', node.x); link.setAttribute('y1', node.y); link.setAttribute('x2', p.x); link.setAttribute('y2', p.y); return; }
        v.setAttribute('transform', `translate(${Math.round(p.x)} ${Math.round(p.y)})`);
        node.x = Math.round(p.x); node.y = Math.round(p.y);
      };
      const up = (u) => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
        if (joining) {
          link.setAttribute('hidden', '');
          const target = document.elementFromPoint(u.clientX, u.clientY)?.closest?.('.v');
          const to = target?.dataset.id;
          if (to && to !== id) commit(normalizeGraph({ ...graph, nodes, edges: [...graph.edges, { from: id, to, ...(weighted ? { w: 1 } : {}) }] }, { weighted, directed: graph.directed }));
          return;
        }
        if (moved) commit({ ...graph, nodes });
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    });
    svg.addEventListener('dblclick', (e) => {
      const v = e.target.closest?.('.v');
      const nodes = nodesNow();
      if (v) {
        const id = v.dataset.id;
        commit({ ...graph, nodes: nodes.filter((n) => n.id !== id), edges: graph.edges.filter((ed) => ed.from !== id && ed.to !== id) });
        return;
      }
      const p = toSvg(e);
      let k = 0, id = '';
      do { id = k < 26 ? String.fromCharCode(65 + k) : `V${k}`; k++; } while (nodes.some((n) => n.id === id));
      if (nodes.length >= 16) return shell.say('At most 16 vertices', true);
      commit({ ...graph, nodes: [...nodes, { id, x: Math.round(p.x), y: Math.round(p.y) }] });
    });
    graphView = { redraw };
    redraw();
    const directed = fixedDirection ? null : checkInput('Directed (arrows)', graph.directed, (d) => commit(normalizeGraph({ ...graph, nodes: nodesNow(), directed: d }, { weighted, directed: d })));
    return [field(f.label, area, weighted ? 'One edge per line: A-B 4 (A->B 4 for an arrow); a lone vertex: E' : 'One edge per line: A-B (A->B for an arrow); a lone vertex: E'), directed, svg, make('small', { className: 'alg-hint', textContent: 'Drag to move · double-click to add or remove · Shift drag to join' })];
  }

  // ── Keys: Space, arrows, Home/End (not while typing in a field) ──
  const typing = (t) => t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(t.type));
  const keys = (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = run.trace.steps.length;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); return timer ? stop() : play(); }
    if (e.target === timeline && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); go(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); stop(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); stop(); go(n - 1); }
  };
  // Pressed in the player, or with the focus left on the page behind it (a click on the
  // stage, a list redrawn under the pointer): the window stops keys going further, so this
  // listens first.
  const anyKeys = (e) => {
    if (!root.isConnected) return;
    if (root.contains(e.target) || e.target === document.body || e.target === document.documentElement) keys(e);
  };
  document.addEventListener('keydown', anyKeys, true);
  stage.tabIndex = -1;
  stage.addEventListener('pointerdown', () => stage.focus({ preventScroll: true }));
  const retheme = () => paintStep(false);
  dark.addEventListener?.('change', retheme);

  // A built-in with a Java version, as a program of your own (its input as the arguments).
  function openAsJava(a) {
    const v = JAVA_VERSIONS[a.id];
    let args = [];
    try { args = v.args(a.normalize(model.input)); } catch { /* Its presets' input. */ args = v.args(a.normalize(a.presets[0].input)); }
    newJava(javaProgramForEditing(a), v.entry, JSON.stringify(args));
  }
  if (model.step === null && !isJava()) noteRecent(model.algorithm);
  // Opened from the figure's menu (module.json "menu"): Play… plays it from the start; Edit
  // input… shows the input; Edit code… the code, large (read only until the Java layer).
  const mode = host.mode || 'author';
  tab = mode === 'input' ? 'input' : 'catalog';
  if (mode === 'code') {
    code.classList.add('tall');
    // Edit code…: your Java in the editor; a built-in with a Java version becomes a program of
    // your own (keeping its figure's input as the arguments); the others are only shown.
    if (!isJava() && JAVA_VERSIONS[model.algorithm]) openAsJava(algo());
    else if (!isJava()) codeNote.hidden = false;
  }
  side();
  if (isJava()) setEditing(mode === 'code' || model.step === null);
  shell.history(false, false);
  if (run.error) shell.say(run.error, true);
  paintStep(false);
  requestAnimationFrame(() => playBtn.focus({ preventScroll: true }));
  if (mode === 'play') { index = 0; paintStep(false); play(); }
  if (mode === 'input') requestAnimationFrame(() => sideBody.querySelector('textarea, input, select')?.focus({ preventScroll: true }));
  // The chosen algorithm in sight in the list.
  requestAnimationFrame(() => sideBody.querySelector('.alg-item.on')?.scrollIntoView({ block: 'nearest' }));
  return {
    destroy() {
      stop();
      worker?.terminate();
      editor?.destroy();
      clearTimeout(thumbTimer);
      document.removeEventListener('keydown', anyKeys, true);
      dark.removeEventListener?.('change', retheme);
      shell.destroy();
      root.classList.remove('alg-editor');
    },
  };
}
