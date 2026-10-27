// A model dropdown for an AI tool: the tool's default, the models it offers,
// and "Other…" for a name typed by hand. The choice is remembered per tool.
const OTHER = '__other';
const storageKey = provider => `notecomplete-ai-model:${provider}`;

export function modelPicker(select, other, ai) {
  let provider = '';
  function remember() {
    try { localStorage.setItem(storageKey(provider), value()); } catch { /* Optional. */ }
  }
  function value() {
    return select.value === OTHER ? other.value.trim() : select.value;
  }
  async function load(next) {
    provider = next;
    select.replaceChildren(new Option('Tool default', ''));
    other.hidden = true;
    let saved = '';
    try { saved = localStorage.getItem(storageKey(provider)) ?? localStorage.getItem('notecomplete-ai-model') ?? ''; } catch { /* Optional. */ }
    select.disabled = true;
    const models = await (ai.models?.(provider) ?? Promise.resolve([])).catch(() => []);
    if (provider !== next) return;
    for (const m of models) select.add(new Option(m.label, m.id));
    select.add(new Option('Other…', OTHER));
    select.disabled = false;
    if (!saved || models.some(m => m.id === saved)) select.value = saved;
    else { select.value = OTHER; other.value = saved; other.hidden = false; }
  }
  select.addEventListener('change', () => {
    other.hidden = select.value !== OTHER;
    if (!other.hidden) other.focus();
    remember();
  });
  other.addEventListener('change', remember);
  return { load, get value() { return value(); } };
}
