// Keep native selects as the data source; expose one consistent, opaque menu.
const controls = new Map();
let active = null;
export function refreshSelects() { for (const control of controls.values()) control.sync(); }
export function enhanceSelects() {
  // Dialog selects (data-native) and multi-selects stay native controls.
  for (const select of document.querySelectorAll('select:not([multiple]):not([data-native])')) {
    if (controls.has(select)) continue;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'select-trigger';
    button.dataset.select = select.id;
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    button.append(label);
    select.hidden = true; select.after(button);
    let menu = null;
    const sync = () => {
      label.textContent = select.selectedOptions[0]?.textContent || select.getAttribute('aria-label');
      button.disabled = select.disabled;
      button.setAttribute('aria-label', `${select.getAttribute('aria-label')}: ${label.textContent}`);
      button.title = label.textContent;
    };
    const close = (focus = false) => {
      menu?.remove(); menu = null; button.setAttribute('aria-expanded', 'false');
      if (active?.button === button) active = null;
      if (focus) button.focus();
    };
    const open = (last = false) => {
      if (button.disabled) return;
      active?.close();
      menu = document.createElement('div'); menu.className = 'select-menu';
      const compact = !!select.closest('#toolOptions');
      if (compact) menu.classList.add('compact-select');
      menu.id = `${select.id}-options`; menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', select.getAttribute('aria-label'));
      button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'true');
      const heading = document.createElement('div'); heading.className = 'select-heading';
      heading.textContent = select.getAttribute('aria-label'); menu.append(heading);
      for (const option of select.options) {
        const row = document.createElement('button'); row.type = 'button'; row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected)); row.disabled = option.disabled;
        row.textContent = option.textContent; row.title = option.textContent; row.tabIndex = -1;
        row.onclick = () => { select.value = option.value; sync(); close(true); select.dispatchEvent(new Event('change', {bubbles: true})); };
        menu.append(row);
      }
      document.body.append(menu);
      const rect = button.getBoundingClientRect(), margin = 12;
      menu.style.width = `${Math.min(Math.max(rect.width, select.id === 'recording' ? 330 : compact ? 140 : 210), innerWidth - margin * 2)}px`;
      const below = innerHeight - rect.bottom - margin, above = rect.top - margin;
      menu.style.maxHeight = `${Math.min(380, Math.max(below, above))}px`;
      menu.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - menu.offsetWidth - margin))}px`;
      menu.style.top = `${below >= menu.offsetHeight || below >= above ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6}px`;
      active = {button, close};
      const rows = [...menu.querySelectorAll('[role=option]:not(:disabled)')];
      (rows.find(row => row.getAttribute('aria-selected') === 'true') || (last ? rows.at(-1) : rows[0]))?.focus();
      let search = '', searchedAt = 0;
      menu.onkeydown = event => {
        const index = rows.indexOf(document.activeElement);
        let target;
        if (event.key === 'ArrowDown') target = rows[(index + 1) % rows.length];
        if (event.key === 'ArrowUp') target = rows[(index - 1 + rows.length) % rows.length];
        if (event.key === 'Home') target = rows[0];
        if (event.key === 'End') target = rows.at(-1);
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        if (event.key === 'Tab') close(true);
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
          search = (Date.now() - searchedAt > 700 ? '' : search) + event.key.toLocaleLowerCase(); searchedAt = Date.now();
          target = rows.find(row => row.textContent.toLocaleLowerCase().startsWith(search));
        }
        if (target) { event.preventDefault(); target.focus(); }
      };
    };
    button.onclick = () => menu ? close() : open();
    button.onkeydown = event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(event.key === 'ArrowUp'); } };
    select.addEventListener('change', sync);
    new MutationObserver(() => { sync(); if (menu) close(); }).observe(select, {subtree: true, childList: true, attributes: true, characterData: true});
    controls.set(select, {sync}); sync();
  }
}
document.addEventListener('pointerdown', event => { if (active && !event.target.closest('.select-menu') && !active.button.contains(event.target)) active.close(); });
window.addEventListener('resize', () => active?.close());
document.addEventListener('scroll', event => { if (!event.target.closest?.('.select-menu')) active?.close(); }, true);
