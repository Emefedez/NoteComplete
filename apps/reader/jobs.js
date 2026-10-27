// Background jobs (quiz and flashcard generation, transcription), each shown as
// a chip in the command bar so the reader stays usable. Progress moves
// continuously: page preparation fills a fifth, each AI batch creeps towards
// its share by elapsed time and jumps when it returns. Several batches may be
// in flight at once (`inflight` holds their start times).
// Jobs that know their own progress (transcription) set it directly.
const $ = id => document.getElementById(id);

export function progressAt({ prepared, pages, done, batches, inflight = [], expected = 45, fraction }, now = Date.now()) {
  if (Number.isFinite(fraction)) return Math.max(0, Math.min(0.99, fraction));
  const prep = pages ? Math.min(1, prepared / pages) : 1;
  const creep = inflight.reduce((sum, started) => sum + Math.min(0.92, 1 - Math.exp(-(now - started) / 1000 / expected)), 0);
  return Math.min(0.99, 0.2 * prep + 0.8 * (done + creep) / Math.max(1, batches));
}

export function jobChip({ status }) {
  const jobs = new Set();
  let timer = 0;
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
    // True while a job of that kind runs (one quiz/flashcard generation at a time).
    busy(kind = 'ai') { return [...jobs].some(j => j.kind === kind); },
    start(title, { pages = 0, batches = 1, cancel, kind = 'ai' }) {
      const el = document.createElement('div');
      el.className = 'job-chip'; el.setAttribute('role', 'status');
      const label = document.createElement('span'), track = document.createElement('span'), bar = document.createElement('span'), stop = document.createElement('button');
      track.className = 'job-track'; bar.className = 'job-bar'; track.append(bar);
      stop.type = 'button'; stop.textContent = 'Stop'; stop.title = 'Stop';
      stop.onclick = () => cancel?.();
      el.append(label, track, stop);
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
      return {
        prepared(n) { job.prepared = n; if (!job.inflight.size) job.phase = `preparing page ${n} of ${pages}`; render(); },
        asking(batch, provider) { job.inflight.set(batch, Date.now()); job.provider = provider; asking(); },
        answered(batch) { job.done++; job.inflight.delete(batch); asking(); },
        set(fraction, phase) { job.fraction = fraction; if (phase) job.phase = phase; render(); },
        finish(message, action) { end(); status(message); if (action) ready(message, action); },
        fail(message) { end(); status(message, true); },
      };
    },
  };
}
