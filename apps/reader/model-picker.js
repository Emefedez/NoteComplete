// A model dropdown for an AI tool: the tool's default, the models it offers,
// and "Other…" for a name typed by hand. The choice is remembered per tool.
// The dropdown opens at once with the list kept on this device; the tool is asked
// again in the background and its answer replaces the list, keeping the choice
// when it is still offered (listing models can take many seconds, e.g. `agy models`).
import { icon } from './icons.js';
import { smallSetting, rememberSmall } from './small-model.js';

const OTHER = '__other';
const storageKey = provider => `notecomplete-ai-model:${provider}`;
const listKey = provider => `notecomplete-ai-models:${provider}`;

// The options for a model list and a choice: [options, selected value, text for Other].
// A typed name stays under Other unless the list now offers it; a listed model that
// is gone falls back to the tool's default.
export function modelOptions(models, choice, typed = false, defaultLabel = 'Tool default') {
  const options = [[defaultLabel, ''], ...models.map(m => [m.label, m.id]), ['Other…', OTHER]];
  if (!choice || models.some(m => m.id === choice)) return { options, value: choice, other: '' };
  return typed ? { options, value: OTHER, other: choice } : { options, value: '', other: '' };
}

// Models whose label or id contains every word typed (any order, any case).
export function filterModels(models, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(m => { const text = `${m.label} ${m.id}`.toLowerCase(); return words.every(w => text.includes(w)); });
}
const SEARCH_FROM = 8; // shorter lists need no search

// A magnifier beside the dropdown: type to narrow a long list (OpenCode offers hundreds)
// and pick from it. `pick(id)` selects it as the dropdown would.
function searchButton(select, models, current, pick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button model-search';
  button.setAttribute('aria-label', 'Search models');
  button.title = 'Search this tool’s models';
  button.append(icon('search'));
  select.after(button);
  let pop = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); button.setAttribute('aria-expanded', 'false'); };
  const outside = event => { if (pop && !pop.contains(event.target) && !button.contains(event.target)) close(); };
  function open() {
    pop = document.createElement('div');
    pop.className = 'model-search-pop';
    const input = Object.assign(document.createElement('input'), { type: 'search', placeholder: `Search ${models().length} models…`, autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', 'Search models');
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    let shown = [], active = 0;
    const draw = () => {
      shown = filterModels(models(), input.value);
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren(...shown.map((m, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = m.label;
        if (m.label !== m.id) li.title = m.id;
        if (m.id === current()) li.classList.add('current');
        if (i === active) li.classList.add('active');
        li.onpointerdown = event => { event.preventDefault(); pick(m.id); close(); };
        return li;
      }));
      if (!shown.length) list.append(Object.assign(document.createElement('li'), { className: 'none', textContent: 'No model matches.' }));
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    input.oninput = () => { active = 0; draw(); };
    input.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); button.focus(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); active = Math.max(0, Math.min(shown.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); draw(); }
      else if (event.key === 'Enter' && shown[active]) { event.preventDefault(); pick(shown[active].id); close(); }
    };
    pop.append(input, list);
    document.body.append(pop);
    const r = button.getBoundingClientRect(), w = Math.min(300, innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.maxHeight = `${Math.max(160, innerHeight - r.bottom - 20)}px`;
    button.setAttribute('aria-expanded', 'true');
    draw();
    input.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  button.onclick = () => (pop ? close() : open());
  return { button, close };
}

function manageButton(after, open) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button model-search model-manage';
  button.setAttribute('aria-label', 'Downloaded models');
  button.title = 'Downloaded models…';
  button.append(icon('settings'));
  button.hidden = true;
  button.onclick = () => open();
  after.after(button);
  return button;
}

// Small model (small-model.js), beside every model list: the work split into
// one page at a time. Remembered per tool; on by default for the model in this
// app. The badge says when the chosen model cannot read page images.
function smallControls(after) {
  const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
  const label = document.createElement('label');
  label.className = 'small-model';
  label.title = 'Small model: each page is read and worked on alone, in short steps. Best for the model in this app; for large AI tools it is slower and sees less at once.';
  label.append(box, ' Small model');
  const badge = Object.assign(document.createElement('span'), { className: 'text-only-badge', textContent: 'Text only', hidden: true });
  badge.title = 'This model cannot read page images: it gets the text extracted from the pages (typed, PDF, recognized handwriting, transcripts). For handwriting, run Recognize handwriting first, or choose Phi 3.5 Vision.';
  after.after(label, badge);
  return { box, badge };
}

// Every picker gets the magnifier (it hides itself for short lists): study (quiz,
// flashcards), explain, handwriting conversion and chat alike.
export function modelPicker(select, other, ai, { search = true } = {}) {
  let provider = '', loads = 0, models = [];
  const finder = search ? searchButton(select, () => models, () => select.value, id => {
    select.value = id;
    if (select.value !== id) return;
    select.dispatchEvent(new Event('change'));
  }) : null;
  // Tools whose models live on this device (the model in this app, local-ai.js)
  // get a button to see and delete what is downloaded.
  const manage = typeof ai.manage === 'function' ? manageButton(finder?.button || select, () => ai.manage(provider)) : null;
  const small = smallControls(manage || finder?.button || select);
  const capabilities = () => ai.capabilities?.(provider, value()) || { vision: true, contextTokens: 0 };
  const showBadge = () => { small.badge.hidden = capabilities().vision !== false; };
  small.box.addEventListener('change', () => rememberSmall(provider, small.box.checked));
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  function remember() {
    try { localStorage.setItem(storageKey(provider), value()); } catch { /* Optional. */ }
  }
  function value() {
    return select.value === OTHER ? other.value.trim() : select.value;
  }
  function fill(list, choice, typed) {
    models = list;
    if (finder) finder.button.hidden = list.length < SEARCH_FROM;
    const next = modelOptions(list, choice, typed, ai.defaultLabel?.(provider) || 'Tool default');
    select.replaceChildren(...next.options.map(([label, id]) => new Option(label, id)));
    select.value = next.value;
    other.value = next.other;
    other.hidden = next.value !== OTHER;
    showBadge();
  }
  async function load(next) {
    provider = next;
    if (manage) manage.hidden = !ai.canManage?.(next);
    small.box.checked = smallSetting(next, { ai });
    const mine = ++loads;
    let cached = [];
    try { cached = JSON.parse(read(listKey(next), '[]')) || []; } catch { /* Kept list unreadable: start empty. */ }
    // A saved name the kept list does not offer was typed by hand (or the list is not known yet).
    const saved = read(storageKey(next), read('notecomplete-ai-model', '')) || '';
    fill(cached, saved, true);
    select.disabled = false;
    // Ask the tool again; its answer replaces the list without closing anything.
    (async () => {
      const models = await (ai.models?.(next, { fresh: true }) ?? Promise.resolve(null)).catch(() => null);
      if (mine !== loads || !Array.isArray(models)) return;
      if (models.length) { try { localStorage.setItem(listKey(next), JSON.stringify(models)); } catch { /* Optional. */ } }
      const list = models.length ? models : cached;
      const typed = select.value === OTHER, choice = value();
      fill(list, choice, typed);
      if (value() !== choice) remember();
    })();
  }
  select.addEventListener('change', () => {
    other.hidden = select.value !== OTHER;
    if (!other.hidden) other.focus();
    remember();
    showBadge();
  });
  other.addEventListener('change', () => { remember(); showBadge(); });
  return {
    load,
    get value() { return value(); },
    // What a request needs to know: split into small steps, and whether the model reads images.
    get small() { return small.box.checked; },
    get vision() { return capabilities().vision !== false; },
    get contextTokens() { return capabilities().contextTokens || 0; },
  };
}
