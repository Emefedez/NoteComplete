// A model dropdown for an AI tool: the tool's default, the models it offers,
// and "Other…" for a name typed by hand. The choice is remembered per tool.
// The dropdown opens at once with the list kept on this device; the tool is asked
// again in the background and its answer replaces the list, keeping the choice
// when it is still offered (listing models can take many seconds, e.g. `agy models`).
const OTHER = '__other';
const storageKey = provider => `notecomplete-ai-model:${provider}`;
const listKey = provider => `notecomplete-ai-models:${provider}`;

// The options for a model list and a choice: [options, selected value, text for Other].
// A typed name stays under Other unless the list now offers it; a listed model that
// is gone falls back to the tool's default.
export function modelOptions(models, choice, typed = false) {
  const options = [['Tool default', ''], ...models.map(m => [m.label, m.id]), ['Other…', OTHER]];
  if (!choice || models.some(m => m.id === choice)) return { options, value: choice, other: '' };
  return typed ? { options, value: OTHER, other: choice } : { options, value: '', other: '' };
}

export function modelPicker(select, other, ai) {
  let provider = '', loads = 0;
  const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
  function remember() {
    try { localStorage.setItem(storageKey(provider), value()); } catch { /* Optional. */ }
  }
  function value() {
    return select.value === OTHER ? other.value.trim() : select.value;
  }
  function fill(models, choice, typed) {
    const next = modelOptions(models, choice, typed);
    select.replaceChildren(...next.options.map(([label, id]) => new Option(label, id)));
    select.value = next.value;
    other.value = next.other;
    other.hidden = next.value !== OTHER;
  }
  async function load(next) {
    provider = next;
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
  });
  other.addEventListener('change', remember);
  return { load, get value() { return value(); } };
}
