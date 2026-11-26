// Model Explorer side panel (Visual Paradigm-style): tree of model elements across every UML
// diagram and Textual Analysis prefab in the open note, grouped by Candidate Items folders,
// element kinds, and Diagrams. Clicking an occurrence jumps to that page and opens the prefab;
// right-clicking offers Jump to…, Rename everywhere…, and Show occurrences.
import { DIAGRAMS } from './uml.js';
import { icon } from './icons.js';
import { openContextMenu } from './context-menu.js';
import { formatOccurrenceLabel, modelTree } from './project-model.js';

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'ariaLabel') node.setAttribute('aria-label', v);
    else if (k in node) node[k] = v;
    else if (v != null && v !== false) node.setAttribute(k, String(v));
  }
  for (const ch of children) if (ch != null && ch !== false) node.append(ch);
  return node;
};

// Crisp 14x14 kind glyph matching UML & Textual Analysis visual language.
function kindGlyph(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'me-kind-icon');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    class: '<rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.2"/>',
    interface: '<circle cx="8" cy="5.5" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="8" y1="8.5" x2="8" y2="14" stroke="currentColor" stroke-width="1.4"/>',
    enumeration: '<rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="9" x2="11" y2="9" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.2"/>',
    package: '<path d="M2 5V3.5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1V12.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    actor: '<circle cx="8" cy="3.8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.8v4.5M4.5 7.5h7M8 10.3l-2.6 3.7M8 10.3l2.6 3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    usecase: '<ellipse cx="8" cy="8" rx="6" ry="4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    activity: '<rect x="2" y="4" width="12" height="8" rx="4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
    state: '<rect x="2" y="3.5" width="12" height="9" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.1"/>',
    sequence: '<rect x="3.5" y="2" width="9" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="6" x2="8" y2="14" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.8"/>',
    system: '<rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 1.5"/>',
    attribute: '<circle cx="4.5" cy="8" r="2" fill="currentColor"/><line x1="8" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    operation: '<path d="M3 5l3 3-3 3M8 11h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    note: '<path d="M3 2.5h7l3 3V13.5H3Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
    'textual-analysis': '<path d="M3 3h10M3 6.5h7M3 10h10M3 13h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  };
  svg.innerHTML = paths[kind] || '<rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/>';
  return svg;
}

// Modal dialog: "Rename everywhere…" (from Model Explorer or context menu).
// Resolves to `{ name, scope: 'everywhere' }` or null if cancelled.
export function promptRenameEverywhere({ element, oldName, occurrenceCount = 1, host = null } = {}) {
  const currentName = oldName ?? element?.name ?? '';
  const count = occurrenceCount || element?.occurrences?.length || 1;
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'me-dialog nc-modal', ariaLabel: 'Rename model element' });
    const input = el('input', {
      type: 'text',
      className: 'me-dialog-input',
      value: currentName,
      spellcheck: false,
      ariaLabel: 'New name',
    });
    const note = el('p', {
      className: 'me-dialog-note',
      textContent: count === 1
        ? 'This element appears in 1 diagram.'
        : `Updates all ${count} diagrams and analyses where “${currentName}” appears.`,
    });
    const cancelBtn = el('button', { type: 'button', className: 'me-btn', textContent: 'Cancel' });
    const okBtn = el('button', { type: 'submit', className: 'me-btn primary', textContent: count > 1 ? `Rename everywhere (${count})` : 'Rename' });
    const form = el('form', { className: 'me-dialog-form' },
      el('h3', { textContent: `Rename “${currentName}”` }),
      input,
      note,
      el('div', { className: 'me-dialog-actions' }, cancelBtn, okBtn),
    );
    dialog.append(form);
    (host || document.body).append(dialog);

    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(val);
    };
    cancelBtn.onclick = () => done(null);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    form.onsubmit = (e) => {
      e.preventDefault();
      const next = input.value.trim();
      if (!next || next === currentName) return done(null);
      done({ name: next, scope: 'everywhere' });
    };
    dialog.showModal();
    input.focus();
    input.select();
  });
}

// Modal dialog shown when renaming an element inside an editor that also appears in other diagrams.
// Resolves to `'everywhere'` or `'here'`.
export function askRenameScope({ oldName, newName, otherCount = 1, otherLabels = [], host = null } = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'me-dialog nc-modal', ariaLabel: 'Rename across project' });
    const listItems = otherLabels.slice(0, 5).map((lbl) => el('li', { textContent: lbl }));
    if (otherLabels.length > 5) listItems.push(el('li', { className: 'muted', textContent: `…and ${otherLabels.length - 5} more` }));
    const onlyBtn = el('button', { type: 'button', className: 'me-btn', textContent: 'Only here' });
    const allBtn = el('button', { type: 'button', className: 'me-btn primary', textContent: `Rename everywhere (${otherCount + 1})` });
    const body = el('div', { className: 'me-dialog-form' },
      el('h3', { textContent: `Rename “${oldName}” to “${newName}”?` }),
      el('p', {
        className: 'me-dialog-note',
        textContent: `This element also appears in ${otherCount} other ${otherCount === 1 ? 'diagram or analysis' : 'diagrams / analyses'}:`,
      }),
      listItems.length ? el('ul', { className: 'me-dialog-list' }, ...listItems) : null,
      el('div', { className: 'me-dialog-actions' }, onlyBtn, allBtn),
    );
    dialog.append(body);
    (host || document.body).append(dialog);

    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(val);
    };
    onlyBtn.onclick = () => done('here');
    allBtn.onclick = () => done('everywhere');
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done('here'); });
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.showModal();
    allBtn.focus();
  });
}

// Mount the Model Explorer inside `panelEl` (e.g. `<aside id="modelExplorerPanel">`).
export function createModelExplorer(panelEl, { onJump = null, onRename = null, onRefresh = null, onClose = null } = {}) {
  let currentModel = { diagrams: [], elements: [], byId: new Map(), byDiagram: new Map() };
  let filter = '';
  const expanded = new Set(); // modelIds expanded to show occurrences
  const collapsedSections = new Set(); // section keys collapsed by user

  const refreshBtn = el('button', { type: 'button', className: 'icon-button', ariaLabel: 'Refresh model', title: 'Refresh Model Explorer' }, icon('restart'));
  refreshBtn.onclick = () => onRefresh?.();
  const closeBtn = el('button', { type: 'button', className: 'icon-button', ariaLabel: 'Close Model Explorer', title: 'Close' }, icon('close'));
  closeBtn.onclick = () => onClose?.();

  const header = el('div', { className: 'me-head' },
    el('h2', { textContent: 'Model Explorer' }),
    el('span', { className: 'spacer' }),
    refreshBtn,
    closeBtn,
  );

  const filterInput = el('input', {
    type: 'search',
    className: 'me-filter',
    placeholder: 'Filter elements & diagrams…',
    ariaLabel: 'Filter model elements and diagrams',
  });
  filterInput.oninput = () => {
    filter = filterInput.value;
    render();
  };
  const summary = el('div', { className: 'me-summary' });
  const treeHost = el('div', { className: 'me-tree', role: 'tree', ariaLabel: 'Project model tree' });

  panelEl.replaceChildren(header, el('div', { className: 'me-search-row' }, filterInput), summary, treeHost);

  async function triggerRename(element) {
    const res = await promptRenameEverywhere({ element, occurrenceCount: element.occurrences.length });
    if (res?.name) await onRename?.(element, res.name);
  }

  function openElementMenu(ev, element) {
    ev.preventDefault();
    ev.stopPropagation();
    const occs = element.occurrences || [];
    const jumpEntry = occs.length > 1
      ? {
        label: 'Show in…',
        icon: 'link',
        submenu: occs.map((o) => ({
          label: formatOccurrenceLabel(o),
          icon: o.module === 'textual-analysis' ? 'text' : 'uml',
          run: () => onJump?.(o),
        })),
      }
      : occs.length === 1
        ? { label: `Jump to ${formatOccurrenceLabel(occs[0])}`, icon: 'link', run: () => onJump?.(occs[0]) }
        : null;
    openContextMenu(ev.clientX, ev.clientY, [
      jumpEntry,
      { label: 'Rename everywhere…', icon: 'text', run: () => triggerRename(element) },
      {
        label: expanded.has(element.modelId) ? 'Hide occurrences' : 'Show occurrences',
        icon: 'eye',
        run: () => {
          if (expanded.has(element.modelId)) expanded.delete(element.modelId);
          else expanded.add(element.modelId);
          render();
        },
      },
    ], { title: element.name });
  }

  function renderElementNode(element, keyPrefix = '') {
    const isOpen = expanded.has(element.modelId);
    const count = element.occurrences.length;
    const toggleBtn = el('button', {
      type: 'button',
      className: `me-el-row marquee-host${isOpen ? ' open' : ''}`,
      role: 'treeitem',
      ariaExpanded: String(isOpen),
      title: `${element.name} — appears in ${count} ${count === 1 ? 'place' : 'places'}. Click to expand, right-click for actions.`,
    },
      el('span', { className: 'me-caret', textContent: isOpen ? '▾' : '▸' }),
      kindGlyph(element.group),
      el('span', { className: 'me-el-name marquee', textContent: element.name }),
      el('span', { className: `me-badge${count > 1 ? ' shared' : ''}`, textContent: String(count) }),
    );
    toggleBtn.dataset.modelId = element.modelId;
    toggleBtn.onclick = () => {
      if (expanded.has(element.modelId)) expanded.delete(element.modelId);
      else expanded.add(element.modelId);
      render();
    };
    toggleBtn.oncontextmenu = (ev) => openElementMenu(ev, element);

    const renameBtn = el('button', {
      type: 'button',
      className: 'me-el-action',
      ariaLabel: `Rename ${element.name} everywhere`,
      title: 'Rename everywhere…',
    }, icon('text'));
    renameBtn.onclick = (ev) => {
      ev.stopPropagation();
      triggerRename(element);
    };

    const rowWrap = el('div', { className: 'me-el-wrap' }, toggleBtn, renameBtn);
    const box = el('div', { className: 'me-el-node', 'data-key': `${keyPrefix}${element.modelId}` }, rowWrap);

    if (isOpen) {
      const occList = el('div', { className: 'me-occs', role: 'group' },
        ...element.occurrences.map((occ) => {
          const btn = el('button', {
            type: 'button',
            className: 'me-occ-item marquee-host',
            title: `Jump to ${formatOccurrenceLabel(occ)}`,
          },
            kindGlyph(occ.module === 'textual-analysis' ? 'textual-analysis' : occ.diagramKind === 'useCase' ? 'usecase' : occ.diagramKind),
            el('span', { className: 'me-occ-label marquee', textContent: formatOccurrenceLabel(occ) }),
            occ.role === 'lifeline' ? el('small', { className: 'me-occ-tag', textContent: 'lifeline' }) : null,
            occ.role === 'member' ? el('small', { className: 'me-occ-tag', textContent: occ.list === 'operations' ? 'op' : 'attr' }) : null,
          );
          btn.onclick = () => onJump?.(occ);
          return btn;
        }),
      );
      box.append(occList);
    }
    return box;
  }

  function renderSection(secKey, title, count, contentNodes) {
    const isCollapsed = collapsedSections.has(secKey);
    const headBtn = el('button', {
      type: 'button',
      className: `me-sec-head${isCollapsed ? ' collapsed' : ''}`,
      ariaExpanded: String(!isCollapsed),
    },
      el('span', { className: 'me-caret', textContent: isCollapsed ? '▸' : '▾' }),
      el('span', { className: 'me-sec-title', textContent: title }),
      el('span', { className: 'me-sec-count', textContent: String(count) }),
    );
    headBtn.onclick = () => {
      if (collapsedSections.has(secKey)) collapsedSections.delete(secKey);
      else collapsedSections.add(secKey);
      render();
    };
    const sec = el('section', { className: 'me-section' }, headBtn);
    if (!isCollapsed) sec.append(el('div', { className: 'me-sec-body' }, ...contentNodes));
    return sec;
  }

  function render() {
    const totalEls = currentModel.elements.length;
    const totalDiags = currentModel.diagrams.length;
    const sharedCount = currentModel.elements.filter((e) => e.occurrences.length > 1).length;
    summary.textContent = totalDiags === 0
      ? 'No UML diagrams or Textual Analysis in this note yet.'
      : `${totalEls} ${totalEls === 1 ? 'element' : 'elements'} · ${totalDiags} ${totalDiags === 1 ? 'diagram' : 'diagrams'}${sharedCount ? ` · ${sharedCount} linked` : ''}`;

    const tree = modelTree(currentModel, { filter });
    const nodes = [];

    // 1. Candidate Items (Visual Paradigm's Textual Analysis folders)
    if (tree.candidateFolders.length) {
      const folderNodes = tree.candidateFolders.map((f) =>
        el('div', { className: 'me-folder' },
          el('div', { className: 'me-folder-head' }, icon('folder'), el('span', { textContent: f.folder }), el('small', { textContent: String(f.items.length) })),
          ...f.items.map((item) => renderElementNode(item, 'cand:')),
        )
      );
      const totalCands = tree.candidateFolders.reduce((n, f) => n + f.items.length, 0);
      nodes.push(renderSection('candidates', 'Candidate Items', totalCands, folderNodes));
    }

    // 2. Model elements grouped by kind (Classes, Actors, Use Cases, Activities, States…)
    for (const g of tree.groups) {
      nodes.push(renderSection(`group:${g.id}`, g.label, g.items.length, g.items.map((item) => renderElementNode(item, `${g.id}:`))));
    }

    // 3. Diagrams list
    if (tree.diagrams.length) {
      const diagNodes = tree.diagrams.map((d) => {
        const label = d.module === 'textual-analysis' ? 'Textual Analysis' : (DIAGRAMS[d.kind]?.label || 'UML');
        const btn = el('button', {
          type: 'button',
          className: 'me-diag-row marquee-host',
          title: `${d.name} (${label}, p. ${d.pageIndex + 1})`,
        },
          kindGlyph(d.module === 'textual-analysis' ? 'textual-analysis' : d.kind === 'useCase' ? 'usecase' : d.kind),
          el('span', { className: 'me-el-name marquee', textContent: d.name }),
          el('small', { className: 'me-diag-page', textContent: `p. ${d.pageIndex + 1}` }),
        );
        btn.onclick = () => onJump?.({
          diagramKey: d.key,
          diagramId: d.id,
          diagramName: d.name,
          diagramKind: d.kind,
          module: d.module,
          pageIndex: d.pageIndex,
          partId: d.partId,
          noteId: d.noteId,
          noteTitle: d.noteTitle,
          elementId: null,
          role: 'diagram',
        });
        return btn;
      });
      nodes.push(renderSection('diagrams', 'Diagrams', tree.diagrams.length, diagNodes));
    }

    if (!nodes.length) {
      nodes.push(el('p', {
        className: 'me-empty',
        textContent: filter.trim()
          ? `No elements or diagrams matching “${filter.trim()}”.`
          : 'Insert a Textual Analysis or UML diagram to populate the Model Explorer.',
      }));
    }

    treeHost.replaceChildren(...nodes);
  }

  render();

  return {
    update(projectModel) {
      currentModel = projectModel || { diagrams: [], elements: [], byId: new Map(), byDiagram: new Map() };
      render();
    },
    setFilter(q) {
      filter = String(q ?? '');
      filterInput.value = filter;
      render();
    },
    expandElement(modelId) {
      if (modelId) expanded.add(modelId);
      render();
    },
    getModel: () => currentModel,
  };
}
