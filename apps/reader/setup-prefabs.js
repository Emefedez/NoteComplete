// The "Prefabs" step of the setup wizard (docs/TABLES-AND-OFFICE.md, phase 7): a tri-state
// tree of Everything ▸ packs ▸ individual prefabs, with sizes when known. Selections stay in
// `draft.prefabs` until Finish, which runs `applyPrefabDraft()` with progress.
import { icon } from './icons.js';
import { packs as registryPacks, cards as registryCards } from './prefab-registry.js';
import { readPackState, treeState, toggleNode, selectionFrom, planFrom } from './prefab-pack-state.js';
import { packSizes, formatSize, applyPlan } from './prefab-packs.js';

const make = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return el;
};

// Normalised pack list with each pack's cards for the tree: [{ id, label, summary, icon,
// core, requires, cards: [ids], items: [{ id, label, hint }] }].
export function buildPackTree(packList = registryPacks(), allCards = registryCards({ all: true })) {
  return packList.map((p) => {
    const items = allCards.filter((c) => c.pack === p.id).map((c) => ({ id: c.id, label: c.label, hint: c.hint }));
    return {
      id: p.id,
      label: p.label,
      summary: p.summary || '',
      icon: p.icon || 'graph',
      core: !!p.core,
      requires: p.requires || [],
      cards: items.map((c) => c.id),
      items,
    };
  });
}

// Initialises (or returns) the draft state for the Prefabs step.
export function initPrefabDraft(draft, env = {}) {
  if (draft.prefabs) return draft.prefabs;
  const storage = env.storage ?? globalThis.localStorage;
  const packList = env.prefabs?.packs ? env.prefabs.packs() : registryPacks();
  const allCards = env.prefabs?.cards ? env.prefabs.cards() : registryCards({ all: true });
  const tree = buildPackTree(packList, allCards);
  const initial = readPackState(storage);
  const selected = selectionFrom(tree, initial);
  const expanded = new Set();
  draft.prefabs = {
    tree,
    initial,
    selected,
    expanded,
    sizes: null,
    touched: false,
    apply: env.prefabs?.applyPlan || applyPlan,
    plan() { return planFrom(tree, this.selected, this.initial); },
  };
  return draft.prefabs;
}

// Whether the user changed anything in the Prefabs step that Finish needs to apply.
export function hasPrefabChanges(draft) {
  const pf = draft?.prefabs;
  if (!pf || !pf.touched) return false;
  const p = pf.plan();
  const offChanged = JSON.stringify([...p.state.off].sort()) !== JSON.stringify([...pf.initial.off].sort());
  return p.install.length > 0 || p.remove.length > 0 || offChanged || p.state.all !== pf.initial.all;
}

// Applies the Prefabs draft on Finish, reporting progress to `onProgress({ fraction, text })`.
export async function applyPrefabDraft(draft, onProgress = () => {}) {
  if (!hasPrefabChanges(draft)) return [];
  const pf = draft.prefabs;
  return await pf.apply(pf.plan(), onProgress);
}

// Renders the Prefabs tree into `body` (inside the wizard's section).
export function renderPrefabsStep(body, draft, env, refresh) {
  const pf = initPrefabDraft(draft, env);
  if (pf.sizes === null) {
    pf.sizes = {};
    const fetchSizes = env.prefabs?.packSizes || packSizes;
    Promise.resolve(fetchSizes()).then((s) => {
      pf.sizes = s || {};
      refresh('prefabs');
    }).catch(() => {});
  }

  const state = treeState(pf.tree, pf.selected);
  const totalBytes = pf.tree.reduce((n, p) => n + (pf.sizes?.[p.id] || 0), 0);
  const totalCards = pf.tree.reduce((n, p) => n + (p.cards.length || 1), 0);
  const selectedCount = pf.selected.size;

  const treeEl = make('div', { className: 'wizard-prefab-tree', role: 'tree' });
  treeEl.setAttribute('aria-label', 'Prefab packs');

  const applyToggle = (node, on) => {
    pf.selected = toggleNode(pf.tree, pf.selected, node, on);
    pf.touched = true;
    refresh('prefabs');
  };

  // Root row: Everything
  const allBox = make('input', { type: 'checkbox', checked: state.all === 'on' });
  allBox.indeterminate = state.all === 'some';
  allBox.setAttribute('aria-label', 'Everything');
  allBox.onchange = () => applyToggle('all', allBox.checked);
  const rootRow = make('div', { className: 'wizard-tree-row wizard-tree-root', role: 'treeitem' },
    make('label', { className: 'wizard-tree-check' },
      allBox,
      make('strong', { textContent: 'Everything' }),
      make('span', { className: 'wizard-tree-meta', textContent: `${selectedCount} of ${totalCards} prefabs${totalBytes ? ` · ${formatSize(totalBytes)}` : ''}` })));
  treeEl.append(rootRow);

  // Pack rows + collapsible individual prefabs
  for (const pack of pf.tree) {
    const pst = state.packs[pack.id];
    const isOpen = pf.expanded.has(pack.id);
    const sz = formatSize(pf.sizes?.[pack.id] || 0);
    const chev = make('button', {
      type: 'button',
      className: `wizard-tree-toggle${isOpen ? ' open' : ''}`,
      title: isOpen ? `Collapse ${pack.label}` : `Expand ${pack.label}`,
      hidden: !pack.items.length,
    }, icon('chevronRight'));
    chev.setAttribute('aria-expanded', String(isOpen));
    chev.setAttribute('aria-label', `${isOpen ? 'Collapse' : 'Expand'} ${pack.label}`);
    chev.onclick = () => {
      if (pf.expanded.has(pack.id)) pf.expanded.delete(pack.id);
      else pf.expanded.add(pack.id);
      refresh('prefabs');
    };

    const box = make('input', { type: 'checkbox', checked: pst === 'on' });
    box.indeterminate = pst === 'some';
    box.setAttribute('aria-label', pack.label);
    box.onchange = () => applyToggle(pack.id, box.checked);

    const tags = [];
    if (pack.core) tags.push('Always installed');
    if (sz) tags.push(sz);
    if (pack.requires.length) {
      const reqNames = pack.requires.map((id) => pf.tree.find((q) => q.id === id)?.label || id).join(', ');
      tags.push(`needs ${reqNames}`);
    }

    const packRow = make('div', { className: 'wizard-tree-row wizard-tree-pack', role: 'treeitem' },
      chev,
      make('label', { className: 'wizard-tree-check' },
        box,
        make('span', { className: 'wizard-tree-ico' }, icon(pack.icon)),
        make('span', { className: 'wizard-tree-text' },
          make('strong', { textContent: pack.label }),
          pack.summary ? make('span', { className: 'wizard-tree-summary', textContent: pack.summary }) : null),
        tags.length ? make('span', { className: 'wizard-tree-meta', textContent: tags.join(' · ') }) : null));
    packRow.dataset.pack = pack.id;
    treeEl.append(packRow);

    if (isOpen && pack.items.length) {
      const children = make('div', { className: 'wizard-tree-children', role: 'group' });
      for (const item of pack.items) {
        const cbox = make('input', { type: 'checkbox', checked: pf.selected.has(item.id) });
        cbox.setAttribute('aria-label', item.label);
        cbox.onchange = () => applyToggle(item.id, cbox.checked);
        children.append(make('label', { className: 'wizard-tree-row wizard-tree-leaf', role: 'treeitem' },
          cbox,
          make('span', { className: 'wizard-tree-leaf-name', textContent: item.label }),
          item.hint ? make('span', { className: 'wizard-tree-leaf-hint', textContent: item.hint }) : null));
      }
      treeEl.append(children);
    }
  }

  // Pending changes note
  const plan = pf.plan();
  const parts = [];
  if (plan.install.length) parts.push(`install ${plan.install.length} ${plan.install.length === 1 ? 'pack' : 'packs'}`);
  if (plan.remove.length) parts.push(`remove ${plan.remove.length} ${plan.remove.length === 1 ? 'pack' : 'packs'}`);
  const summaryText = parts.length
    ? `Applied on Finish: ${parts.join(', ')}. Figures already on pages always keep showing.`
    : 'No pack changes yet. You can also download or remove packs anytime from Insert prefab.';

  body.append(treeEl, make('p', { className: 'wizard-hint wizard-prefab-note', textContent: summaryText }));
}
