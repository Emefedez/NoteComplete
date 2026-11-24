// Lag log (View → Lag log…): while on, every freeze of the page of more than 100 ms is written
// down with what was going on at that moment: engine calls in flight and how long they took,
// a stroke in progress, auto-save, PDF pages being drawn, network requests, memory, the page
// being hidden. Kept in localStorage, so it survives the browser reloading the page (iOS
// does that when a tab takes too much memory: that shows as "reloaded without closing").
// Off by default; costs one requestAnimationFrame per frame while on.

const ON_KEY = 'notecomplete-lag-log';
const LOG_KEY = 'notecomplete-lag-log-events';
const ALIVE_KEY = 'notecomplete-lag-log-alive';
const FREEZE_MS = 100, SLOW_CALL_MS = 150, KEPT = 300;

const now = () => Math.round(performance.now());
const busy = new Map(); // activity → count in flight
const calls = new Map(); // id → { op, at }
let callIds = 0, fetches = 0, events = [], on = false, frame = 0, last = 0, stroke = false, lastStrokeAt = -1e9;
const recentCalls = []; // last finished engine calls: { op, ms, end }
const recentMarks = []; // what just happened on screen: { text, at } (a page shown…)

function read() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } }
function save() { try { localStorage.setItem(LOG_KEY, JSON.stringify(events.slice(-KEPT))); } catch { /* Full: kept in memory. */ } }
function push(event) {
  events.push({ t: new Date().toISOString(), ...event });
  if (events.length > KEPT) events.splice(0, events.length - KEPT);
  save();
}

// What was going on: the snapshot written with each event.
function context() {
  const t = now();
  const out = {};
  const inFlight = [...calls.values()].map((c) => `${c.op} ${t - c.at}ms`);
  if (inFlight.length) out.engine = inFlight;
  const done = recentCalls.filter((c) => t - c.end < 1500).map((c) => `${c.op} ${c.ms}ms`);
  if (done.length) out.engineJustDone = done;
  const doing = [...busy.entries()].filter(([, n]) => n > 0).map(([k]) => k);
  if (doing.length) out.doing = doing;
  const marks = recentMarks.filter((m) => t - m.at < 1000).map((m) => `${m.text} ${t - m.at}ms ago`);
  if (marks.length) out.justShown = marks;
  if (stroke || t - lastStrokeAt < 300) out.writing = true;
  if (fetches) out.network = fetches;
  if (performance.memory) out.jsHeapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
  out.nodes = document.getElementsByTagName('*').length;
  out.canvases = document.getElementsByTagName('canvas').length;
  if (document.visibilityState !== 'visible') out.hidden = true;
  return out;
}

function tick(ts) {
  if (!on) return;
  if (last && ts - last > FREEZE_MS && document.visibilityState === 'visible') push({ kind: 'freeze', ms: Math.round(ts - last), ...context() });
  last = ts;
  frame = requestAnimationFrame(tick);
}

export const lagLog = {
  get on() { return on; },
  events: () => [...events],
  start() {
    events = read();
    try { on = localStorage.getItem(ON_KEY) === '1'; } catch { on = false; }
    if (!on) return;
    // The page went away last time without pagehide: the browser reloaded or killed it.
    try {
      if (localStorage.getItem(ALIVE_KEY) === '1') push({ kind: 'reloaded without closing (the browser may have run out of memory)' });
      localStorage.setItem(ALIVE_KEY, '1');
    } catch { /* Optional. */ }
    push({ kind: 'start', ua: navigator.userAgent, screen: `${screen.width}×${screen.height}@${devicePixelRatio}`, memoryGB: navigator.deviceMemory ?? null });
    last = 0;
    frame = requestAnimationFrame(tick);
  },
  set(value) {
    try { localStorage.setItem(ON_KEY, value ? '1' : '0'); } catch { /* Session only. */ }
    if (value && !on) { this.start(); if (!on) { on = true; push({ kind: 'start', ua: navigator.userAgent }); frame = requestAnimationFrame(tick); } }
    else if (!value && on) { on = false; cancelAnimationFrame(frame); try { localStorage.removeItem(ALIVE_KEY); } catch { /* Optional. */ } }
  },
  clear() { events = []; save(); },
  // An engine call: returns the function to call when it answers.
  call(op) {
    if (!on) return () => {};
    const id = ++callIds, at = now();
    calls.set(id, { op, at });
    return () => {
      calls.delete(id);
      const end = now(), ms = end - at;
      recentCalls.push({ op, ms, end });
      if (recentCalls.length > 20) recentCalls.shift();
      // A slow answer holds the stroke or the page even when the page itself does not freeze.
      if (ms > SLOW_CALL_MS) push({ kind: 'slow engine call', op, ms, ...context() });
    };
  },
  // Something that may hold the page (auto-save, a PDF page drawn): begin, then end.
  begin(name) {
    if (!on) return () => {};
    busy.set(name, (busy.get(name) || 0) + 1);
    return () => busy.set(name, Math.max(0, (busy.get(name) || 1) - 1));
  },
  // Something that just changed on screen (a page shown), named in the freezes that follow it.
  mark(text) {
    if (!on) return;
    recentMarks.push({ text, at: now() });
    if (recentMarks.length > 12) recentMarks.shift();
  },
  pointer(down) { if (down) stroke = true; else { stroke = false; lastStrokeAt = now(); } },
  // Plain text, to copy or save and send.
  report() {
    const lines = [`NoteComplete lag log, ${new Date().toISOString()}`, ''];
    const freezes = events.filter((e) => e.kind === 'freeze');
    if (freezes.length) {
      const ms = freezes.map((e) => e.ms).sort((a, b) => a - b);
      lines.push(`${freezes.length} freezes over ${FREEZE_MS} ms; median ${ms[ms.length >> 1]} ms, longest ${ms.at(-1)} ms; while writing: ${freezes.filter((e) => e.writing).length}.`, '');
    }
    for (const e of events) {
      const { t, kind, ...rest } = e;
      lines.push(`${t}  ${kind}${Object.keys(rest).length ? '  ' + JSON.stringify(rest) : ''}`);
    }
    return lines.join('\n');
  },
};

// Requests to the network, counted while in flight (a sync, a sign-in, a module loaded late).
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const original = window.fetch.bind(window);
  window.fetch = (...args) => {
    if (!on) return original(...args);
    fetches++;
    return original(...args).finally(() => { fetches--; });
  };
  addEventListener('pagehide', () => { try { localStorage.removeItem(ALIVE_KEY); } catch { /* Optional. */ } });
  addEventListener('pageshow', () => { if (on) try { localStorage.setItem(ALIVE_KEY, '1'); } catch { /* Optional. */ } });
  addEventListener('visibilitychange', () => { if (on) push({ kind: document.visibilityState === 'hidden' ? 'hidden' : 'shown' }); });
  for (const type of ['pointerdown', 'pointerup', 'pointercancel']) addEventListener(type, () => { if (on) lagLog.pointer(type === 'pointerdown'); }, { capture: true, passive: true });
}
