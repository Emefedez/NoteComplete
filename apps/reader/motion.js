// Animations (View ▸ Animations, Setup ▸ Look): things fade and slide in as they appear
// (menus, dialogs, panels, cards, pages), on <html class="motion"> in motion.css. Two scale
// bars stretch or shorten the durations, as Android's animation scales do: "pop" for menus,
// dialogs and pop-ups, "content" for lists, cards, pages and panels. Kept in localStorage,
// shared by every tab (a change in one reaches the others through the storage event).
export const MOTION_KEY = 'notecomplete-motion';
export const SCALES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const clampScale = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1);
};

// ---- State (pure, tested) ----
export function readMotion(storage = globalThis.localStorage, reduced = false) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(MOTION_KEY) || 'null'); } catch { raw = null; }
  const v = raw && typeof raw === 'object' ? raw : {};
  return { on: typeof v.on === 'boolean' ? v.on : !reduced, pop: clampScale(v.pop ?? 1), content: clampScale(v.content ?? 1) };
}
export function saveMotion(patch, storage = globalThis.localStorage, reduced = false) {
  const next = { ...readMotion(storage, reduced), ...patch };
  next.pop = clampScale(next.pop); next.content = clampScale(next.content); next.on = !!next.on;
  try { storage?.setItem(MOTION_KEY, JSON.stringify(next)); } catch { /* Kept for this visit only. */ }
  return next;
}
export const scaleLabel = (s) => `${clampScale(s)}×`;

// ---- In the page ----
const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const listeners = new Set();
let state = null;
function apply(next) {
  state = next;
  const root = document.documentElement;
  root.classList.toggle('motion', next.on);
  root.style.setProperty('--motion-pop', String(next.pop));
  root.style.setProperty('--motion-content', String(next.content));
  for (const fn of listeners) fn(next);
}
export const motion = {
  get: () => state || readMotion(globalThis.localStorage, reducedMotion()),
  set(patch) { apply(saveMotion(patch, globalThis.localStorage, reducedMotion())); return state; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
export function installMotion() {
  apply(readMotion(globalThis.localStorage, reducedMotion()));
  addEventListener('storage', (e) => { if (e.key === MOTION_KEY) apply(readMotion(globalThis.localStorage, reducedMotion())); });
  // Lists drawn in one go come in one by one: each item's place in the list sets its delay.
  const stagger = (list) => {
    let i = 0;
    for (const el of list.children) el.style.setProperty('--motion-i', String(Math.min(i++, 14)));
  };
  const watch = new MutationObserver((records) => {
    if (!state?.on) return;
    for (const r of records) {
      if (!r.target.matches?.('.motion-list, #recentList, #pages, .page-list')) continue;
      // A list drawn in one go is staggered; one item added later comes in at once.
      if (r.addedNodes.length > 1) stagger(r.target);
      else for (const n of r.addedNodes) n.style?.setProperty('--motion-i', '0');
    }
  });
  watch.observe(document.body, { childList: true, subtree: true });
}

// The two scale bars (and their values), for the wizard and the Animations dialog.
export function motionScales(make) {
  const row = (key, title, hint) => {
    const value = make('output', { className: 'motion-scale-value' });
    const input = make('input', { type: 'range', min: '0', max: String(SCALES.length - 1), step: '1', className: 'motion-scale-input' });
    input.setAttribute('aria-label', `${title}: animation scale`);
    const show = () => { const s = motion.get()[key]; input.value = String(SCALES.indexOf(s)); value.textContent = scaleLabel(s); input.disabled = !motion.get().on; };
    input.oninput = () => { motion.set({ [key]: SCALES[Number(input.value)] }); show(); };
    show();
    motion.onChange(show);
    return make('label', { className: 'motion-scale' },
      make('span', { className: 'motion-scale-title' }, make('strong', { textContent: title }), make('span', { className: 'motion-scale-hint', textContent: hint })),
      input, value);
  };
  return make('div', { className: 'motion-scales' },
    row('pop', 'Menus and dialogs', 'Menus, dialogs, pop-ups'),
    row('content', 'Lists, pages and panels', 'Cards, pages, side panels, conversations'));
}
