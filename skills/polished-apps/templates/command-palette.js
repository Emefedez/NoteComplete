// Ctrl/Cmd+K palette over every command the app registers, plus dynamic
// entries (recent files, "go to 12.5 s", open tabs) produced from the typed query.

// Subsequence match: consecutive and word-start hits score higher. null = no match.
export function score(query, text) {
  const q = query.trim().toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  let at = -1, total = 0, run = 0;
  for (const ch of q) {
    if (ch === ' ') { run = 0; continue; }
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return null;
    run = next === at + 1 ? run + 1 : 1;
    total += run * 2 + (next === 0 || /[\s\-_./(]/.test(t[next - 1]) ? 6 : 0) - Math.min(next - at - 1, 5) * 0.5;
    at = next;
  }
  return total - t.length * 0.01;
}

// Commands: { id, title, group, hint, keywords, enabled(): bool, run() }.
export function rank(commands, query, limit = 50) {
  const q = query.trim();
  return commands
    .filter(c => c.enabled?.() !== false)
    .map(c => ({ c, s: q ? score(q, `${c.title} ${c.keywords || ''}`) : 0 }))
    .filter(x => x.s !== null)
    .sort((a, b) => q ? b.s - a.s : 0)
    .slice(0, limit)
    .map(x => x.c);
}

export function commandPalette({ dialog, input, list, commands, dynamic = () => [] }) {
  let shown = [], selected = 0;
  function render() {
    const query = input.value;
    shown = [...dynamic(query), ...rank(commands(), query)];
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    const fragment = document.createDocumentFragment();
    let group = null;
    shown.forEach((command, index) => {
      if (command.group !== group && !query.trim()) {
        group = command.group;
        const heading = document.createElement('li');
        heading.className = 'palette-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group || '';
        fragment.append(heading);
      }
      const item = document.createElement('li');
      item.id = `palette-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === selected));
      const title = document.createElement('span');
      title.textContent = command.title;
      item.append(title);
      if (command.hint) {
        const hint = document.createElement('kbd');
        hint.textContent = command.hint;
        item.append(hint);
      }
      item.onpointerdown = event => { event.preventDefault(); selected = index; choose(); };
      fragment.append(item);
    });
    if (!shown.length) {
      const empty = document.createElement('li');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching commands';
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    input.setAttribute('aria-activedescendant', shown.length ? `palette-${selected}` : '');
    list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }
  function choose() {
    const command = shown[selected];
    if (!command) return;
    dialog.close();
    command.run();
  }
  input.oninput = () => { selected = 0; render(); };
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (shown.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (event.key === 'Enter') { event.preventDefault(); choose(); }
  };
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  return {
    open(query = '') {
      input.value = query; selected = 0;
      if (!dialog.open) dialog.showModal();
      render();
      input.focus(); input.select?.();
    },
  };
}
