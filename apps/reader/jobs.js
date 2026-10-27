// Background AI jobs (quiz and flashcard generation) shown as a chip in the
// command bar, so the reader stays usable. Progress moves continuously: page
// preparation fills the first fifth, each AI batch then creeps towards its
// share by elapsed time and jumps when the batch returns.
const $ = id => document.getElementById(id);

export function progressAt({ prepared, pages, done, batches, started, expected = 45 }, now = Date.now()) {
  const prep = pages ? prepared / pages : 1;
  if (prep < 1) return 0.2 * prep;
  const slot = 0.8 / Math.max(1, batches);
  const creep = started ? Math.min(0.92, 1 - Math.exp(-(now - started) / 1000 / expected)) : 0;
  return Math.min(0.99, 0.2 + slot * (done + creep));
}

export function jobChip({ status }) {
  let job = null, timer = 0;
  function render() {
    if (!job) { $('jobChip').hidden = true; return; }
    $('jobChip').hidden = false;
    const seconds = Math.round((Date.now() - job.begun) / 1000);
    $('jobLabel').textContent = `${job.label} · ${job.phase} · ${seconds} s`;
    $('jobBar').style.width = `${Math.round(progressAt(job) * 100)}%`;
  }
  $('jobStop').onclick = () => job?.cancel?.();
  return {
    get busy() { return !!job; },
    start(label, { pages, batches, cancel }) {
      job = { label, pages, batches, prepared: 0, done: 0, started: 0, begun: Date.now(), phase: 'preparing pages', cancel };
      clearInterval(timer);
      timer = setInterval(render, 500);
      render();
      return {
        prepared(n) { job.prepared = n; job.phase = `preparing page ${n} of ${pages}`; render(); },
        asking(batch, provider) { job.started = Date.now(); job.phase = `${provider} reading batch ${batch + 1} of ${batches}`; render(); },
        answered(batch) { job.done = batch + 1; job.started = 0; render(); },
        finish(message, action) {
          clearInterval(timer); job = null; render();
          status(message);
          if (action) { $('jobReady').hidden = false; $('jobReady').textContent = action.label; $('jobReady').onclick = () => { $('jobReady').hidden = true; action.run(); }; }
        },
        fail(message) { clearInterval(timer); job = null; render(); status(message, true); },
      };
    },
  };
}
