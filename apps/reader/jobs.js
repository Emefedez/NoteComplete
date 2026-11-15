// Background jobs (quiz and flashcard generation, transcription), each shown as
// a chip in the command bar so the reader stays usable. Progress moves
// continuously: page preparation fills a fifth, each AI batch creeps towards
// its share by elapsed time and jumps when it returns. Several batches may be
// in flight at once (`inflight` holds their start times).
// Jobs that know their own progress (transcription) set it directly.
import { icon } from './icons.js';

const $ = id => document.getElementById(id);

const TAG_LABELS = {
  exam: 'Exam generator',
  'exam-plan': 'Exam planner',
  'solve-split': 'Exam splitter',
  'solve-chunk': 'Solver subagent',
  'expand-exam': 'Expand exam',
  'expand-note': 'Expand notes',
  'batch-notes': 'Take notes',
  study: 'Study',
  quiz: 'Quiz',
  cards: 'Flashcards',
  check: 'Fact check',
  chat: 'Ask AI',
  revise: 'Revise transcript',
  handwriting: 'Handwritten note',
};

const labelOfRequest = (request = {}) => {
  const tag = String(request?.tag || '').trim();
  if (TAG_LABELS[tag]) return TAG_LABELS[tag];
  if (tag) return tag;
  return request?.provider ? `AI (${request.provider})` : 'AI agent';
};

// Tracks currently running AI calls for optional live inspection.
// While nobody is inspecting (`watching === false`), zero chunk text is buffered
// unless the caller itself already supplied an `onDelta` callback; any finished
// agent entry and any closed-viewer buffer is discarded immediately so no history
// accumulates in memory.
export function createAiMonitor({ maxChars = 64000, onChange = () => {} } = {}) {
  let watching = false;
  let nextId = 1;
  const agents = new Map();

  function notify() {
    onChange();
  }

  const api = {
    get watching() { return watching; },
    setWatching(next) {
      const want = !!next;
      if (want === watching) return;
      watching = want;
      if (!watching) {
        for (const a of agents.values()) { a.text = ''; a.chars = 0; }
      }
      notify();
    },
    active() {
      return [...agents.values()].map(a => {
        const peeked = a.peek ? String(a.peek() || '') : '';
        const text = peeked ? (peeked.length > maxChars ? peeked.slice(-maxChars) : peeked) : a.text;
        const chars = peeked ? peeked.length : a.chars;
        const { peek: _p, ...rest } = a;
        return { ...rest, text, chars };
      });
    },
    start({ label = 'AI agent', provider = '', model = '', streams = false, peek = null } = {}) {
      const id = nextId++;
      const entry = {
        id,
        label,
        provider,
        model,
        startedAt: Date.now(),
        streams: !!streams,
        peek: typeof peek === 'function' ? peek : null,
        text: '',
        chars: 0,
      };
      agents.set(id, entry);
      if (watching) notify();
      return {
        id,
        append(chunk) {
          if (!watching || !chunk) return;
          const live = agents.get(id);
          if (!live) return;
          if (live.peek) { notify(); return; }
          const s = String(chunk);
          live.chars += s.length;
          const combined = live.text + s;
          live.text = combined.length > maxChars ? combined.slice(-maxChars) : combined;
          notify();
        },
        finish() {
          const had = agents.delete(id);
          if (had && watching) notify();
        },
      };
    },
    wrap(ai) {
      if (!ai) return null;
      return {
        ...ai,
        run(request = {}, onDelta = null) {
          const { label: customLabel, peek, ...cleanReq } = request || {};
          const callerStreams = typeof onDelta === 'function';
          const handle = api.start({
            label: customLabel || labelOfRequest(cleanReq),
            provider: cleanReq?.provider || '',
            model: cleanReq?.model || '',
            streams: callerStreams || watching,
            peek,
          });
          const forward = callerStreams
            ? (chunk) => { onDelta(chunk); handle.append(chunk); }
            : (watching ? (chunk) => handle.append(chunk) : undefined);
          let out;
          try {
            out = forward ? ai.run(cleanReq, forward) : ai.run(cleanReq);
          } catch (e) {
            handle.finish();
            throw e;
          }
          return Promise.resolve(out).finally(() => handle.finish());
        },
      };
    },
  };
  return api;
}

export function progressAt({ prepared, pages, done, batches, inflight = [], expected = 45, fraction }, now = Date.now()) {
  if (Number.isFinite(fraction)) return Math.max(0, Math.min(0.99, fraction));
  const prep = pages ? Math.min(1, prepared / pages) : 1;
  const creep = inflight.reduce((sum, started) => sum + Math.min(0.92, 1 - Math.exp(-(now - started) / 1000 / expected)), 0);
  return Math.min(0.99, 0.2 * prep + 0.8 * (done + creep) / Math.max(1, batches));
}

export function jobChip({ status }) {
  const jobs = new Set();
  let timer = 0;
  let liveDialog = null;
  let liveTick = 0;
  let liveFrame = 0;

  const monitor = createAiMonitor({
    onChange() {
      if (!liveDialog?.open) return;
      if (liveFrame) return;
      liveFrame = setTimeout(() => { liveFrame = 0; renderLive(); }, 80);
    },
  });

  function ensureLiveDialog() {
    if (liveDialog) return liveDialog;
    liveDialog = document.createElement('dialog');
    liveDialog.id = 'jobLiveDialog';
    liveDialog.className = 'job-live-dialog';
    liveDialog.innerHTML = `
      <div class="job-live-head">
        <strong id="jobLiveTitle">Live AI output</strong>
        <span id="jobLiveCount" class="muted"></span>
        <span class="spacer"></span>
        <button id="jobLiveClose" type="button" class="dlg-close" title="Close" aria-label="Close"></button>
      </div>
      <div id="jobLiveBody" class="job-live-body"></div>
    `;
    liveDialog.querySelector('#jobLiveClose').append(icon('close'));
    liveDialog.querySelector('#jobLiveClose').onclick = () => liveDialog.close();
    liveDialog.addEventListener('close', () => {
      monitor.setWatching(false);
      clearInterval(liveTick); liveTick = 0;
      clearTimeout(liveFrame); liveFrame = 0;
      const body = liveDialog.querySelector('#jobLiveBody');
      if (body) body.replaceChildren();
    });
    document.body.append(liveDialog);
    return liveDialog;
  }

  function renderLive() {
    if (!liveDialog?.open) return;
    const body = liveDialog.querySelector('#jobLiveBody');
    const count = liveDialog.querySelector('#jobLiveCount');
    const agents = monitor.active();
    count.textContent = agents.length ? `${agents.length} running` : '';
    if (!agents.length) {
      const empty = document.createElement('p');
      empty.className = 'muted job-live-empty';
      empty.textContent = 'No AI agents currently running. Completed output is cleared automatically.';
      body.replaceChildren(empty);
      return;
    }
    const existing = new Map(Array.from(body.querySelectorAll('.job-live-agent'), el => [Number(el.dataset.agentId), el]));
    const nextIds = new Set(agents.map(a => a.id));
    for (const [id, el] of existing) {
      if (!nextIds.has(id)) el.remove();
    }
    for (const a of agents) {
      let card = existing.get(a.id);
      const sec = Math.max(0, Math.round((Date.now() - a.startedAt) / 1000));
      const meta = [a.provider, a.model || 'tool default', `${sec} s`, a.chars ? `${a.chars} chars` : ''].filter(Boolean).join(' · ');
      if (!card) {
        card = document.createElement('section');
        card.className = 'job-live-agent';
        card.dataset.agentId = String(a.id);
        card.innerHTML = `<header class="job-live-agent-head"><strong></strong><span class="muted"></span></header><pre class="job-live-out"></pre>`;
        body.append(card);
      }
      card.querySelector('strong').textContent = a.label;
      card.querySelector('span').textContent = meta;
      const pre = card.querySelector('pre');
      const stickBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
      const text = a.text || (a.streams
        ? 'Connected — waiting for first model token…'
        : 'Running batch (opened mid-step); next parallel batch will stream live…');
      pre.classList.toggle('is-streaming', !!a.text);
      if (pre.textContent !== text) pre.textContent = text;
      if (stickBottom) pre.scrollTop = pre.scrollHeight;
    }
  }

  function openLive() {
    const dlg = ensureLiveDialog();
    monitor.setWatching(true);
    if (!dlg.open) dlg.showModal();
    liveTick ||= setInterval(renderLive, 1000);
    renderLive();
  }

  function render() {
    for (const job of jobs) {
      const seconds = Math.round((Date.now() - job.begun) / 1000);
      job.label.textContent = `${job.title} · ${job.phase} · ${seconds} s`;
      job.bar.style.width = `${Math.round(progressAt({ ...job, inflight: [...job.inflight.values()] }) * 100)}%`;
    }
    if (!jobs.size) { clearInterval(timer); timer = 0; }
  }
  function ready(text, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'job-ready'; button.textContent = action.label;
    button.onclick = () => { button.remove(); action.run(); };
    $('jobArea').append(button);
  }
  return {
    monitor,
    watchAi: ai => monitor.wrap(ai),
    openLive,
    // True while a job of that kind runs (one quiz/flashcard generation at a time).
    busy(kind = 'ai') { return [...jobs].some(j => j.kind === kind); },
    start(title, { pages = 0, batches = 1, cancel, onCancel, kind = 'ai' } = {}) {
      const stopFn = cancel || onCancel;
      const el = document.createElement('div');
      el.className = 'job-chip'; el.setAttribute('role', 'status');
      const label = document.createElement('span'), track = document.createElement('span'), bar = document.createElement('span'), stop = document.createElement('button');
      track.className = 'job-track'; bar.className = 'job-bar'; track.append(bar);
      stop.type = 'button'; stop.textContent = 'Stop'; stop.title = 'Stop';
      stop.onclick = () => stopFn?.();
      if (kind === 'ai' || kind === 'revise') {
        const inspect = document.createElement('button');
        inspect.type = 'button';
        inspect.className = 'job-inspect';
        inspect.title = 'Watch live AI output';
        inspect.setAttribute('aria-label', 'Watch live AI output');
        inspect.append(icon('eye'));
        inspect.onclick = openLive;
        el.append(label, track, inspect, stop);
      } else {
        el.append(label, track, stop);
      }
      $('jobArea').append(el);
      const job = { title, kind, pages, batches, prepared: 0, done: 0, inflight: new Map(), begun: Date.now(), phase: pages ? 'preparing pages' : 'starting', el, label, bar };
      jobs.add(job);
      timer ||= setInterval(render, 500);
      render();
      const end = () => { jobs.delete(job); el.remove(); render(); };
      const asking = () => {
        job.phase = batches > 1 ? `${job.provider} · ${job.done} of ${batches} parts done${job.inflight.size ? `, ${job.inflight.size} running` : ''}` : `${job.provider} reading the pages`;
        render();
      };
      const finish = (message, action) => { end(); status(message); if (action) ready(message, action); };
      return {
        prepared(n) { job.prepared = n; if (!job.inflight.size) job.phase = `preparing page ${n} of ${pages}`; render(); },
        asking(batch, provider) { job.inflight.set(batch, Date.now()); job.provider = provider; asking(); },
        answered(batch) { job.done++; job.inflight.delete(batch); asking(); },
        set(fraction, phase) { job.fraction = fraction; if (phase) job.phase = phase; render(); },
        progress(phase) { if (phase) job.phase = phase; render(); },
        finish,
        done: finish,
        fail(message) { end(); status(message, true); },
      };
    },
  };
}
