// Focus dimming: a sun button in the head of study/review windows darkens
// everything behind them. One remembered preference for all of them; the veil
// shows only while one of those windows is really shown (not small, put away,
// closed or docked). Floating windows stack from --window-z, which
// body.focus-dim raises above the veil, so their order doesn't change.
//
// <button class="icon-button dim-toggle" aria-pressed="false" aria-label="Dim the background"
//   title="Dim everything behind the quiz"><svg class="icon"><use href="#i-sun"/></svg></button>

export function focusDim({ toggles, windows, key = 'focus-dim', compact = 'compact' }) {
  let on = false;
  try { on = localStorage.getItem(key) === '1'; } catch { /* Optional. */ }
  const shown = el => !el.hidden && (el.tagName !== 'DIALOG' || el.open)
    && !el.classList.contains(compact) && !el.classList.contains('in-tray')
    && (!el.dataset.floatingOnly || el.classList.contains('floating'));
  function sync() {
    document.body.classList.toggle('focus-dim', on && windows.some(shown));
    for (const t of toggles) t.setAttribute('aria-pressed', String(on));
  }
  for (const t of toggles) t.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* Optional. */ }
    sync();
  });
  // Follow the windows themselves instead of every place that opens, shrinks or closes them.
  for (const el of windows) new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  sync();
  return { sync, get on() { return on; } };
}
