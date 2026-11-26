// A search box over an editor's tools (the UML palette, the chart editor's brushes): typing
// hides the tools whose name does not match, Enter takes the first one left, Escape empties
// it. The query outlives the palette being rebuilt (pass `state`, an object kept by the editor).
// `list`: the element holding the tools; `items`: their selector; `name(el)`: a tool's name.
export function toolSearch(list, { items, name = (el) => el.textContent, state = {}, className = '' } = {}) {
  const box = document.createElement('input');
  Object.assign(box, { type: 'search', className: `tool-search ${className}`.trim(), placeholder: 'Search tools', value: state.query || '', spellcheck: false });
  box.setAttribute('aria-label', 'Search the tools');
  const filter = () => {
    const q = (state.query || '').trim().toLowerCase();
    for (const el of list.querySelectorAll(items)) el.hidden = !!q && !String(name(el) || '').toLowerCase().includes(q);
  };
  box.oninput = () => { state.query = box.value; filter(); };
  box.onkeydown = (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); [...list.querySelectorAll(items)].find((el) => !el.hidden)?.click(); }
    else if (ev.key === 'Escape' && box.value) { ev.preventDefault(); ev.stopPropagation(); box.value = state.query = ''; filter(); }
  };
  filter();
  return box;
}
