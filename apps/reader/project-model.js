// Unified project model across all UML diagrams and Textual Analysis prefabs in a note (or a
// folder of notes). Pure (no DOM): used by the Model Explorer panel, the UML editor's "Show in…"
// and rename-everywhere actions, the Textual Analysis editor, and unit tests.
import { DIAGRAMS, ELEMENTS } from './uml.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Short deterministic FNV-1a hash (base 36), matching textual-analysis/model.js.
function hash(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const nameKey = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Canonical model element groups (Visual Paradigm-style Model Explorer categories).
export const MODEL_GROUPS = [
  { id: 'class', label: 'Classes', icon: 'class' },
  { id: 'interface', label: 'Interfaces', icon: 'interface' },
  { id: 'enumeration', label: 'Enumerations', icon: 'enumeration' },
  { id: 'package', label: 'Packages', icon: 'package' },
  { id: 'actor', label: 'Actors', icon: 'actor' },
  { id: 'usecase', label: 'Use Cases', icon: 'useCase' },
  { id: 'activity', label: 'Activities', icon: 'action' },
  { id: 'state', label: 'States', icon: 'state' },
  { id: 'sequence', label: 'Sequence', icon: 'lifeline' },
  { id: 'system', label: 'Systems', icon: 'system' },
  { id: 'node', label: 'Nodes', icon: 'node' },
  { id: 'attribute', label: 'Attributes', icon: 'attribute' },
  { id: 'operation', label: 'Operations', icon: 'operation' },
  { id: 'note', label: 'Notes', icon: 'note' },
  { id: 'other', label: 'Other', icon: 'other' },
];

const GROUP_MAP = new Map(MODEL_GROUPS.map((g) => [g.id, g]));

// Maps any UML element type or Textual Analysis candidate kind to a canonical group id.
export function canonicalKind(typeOrKind) {
  switch (typeOrKind) {
    case 'class': return 'class';
    case 'interface': return 'interface';
    case 'enumeration': return 'enumeration';
    case 'package': return 'package';
    case 'actor':
    case 'actorLifeline': return 'actor';
    case 'useCase':
    case 'usecase': return 'usecase';
    case 'action':
    case 'objectNode':
    case 'partition':
    case 'region':
    case 'decision':
    case 'merge':
    case 'inputPin':
    case 'outputPin': return 'activity';
    case 'state':
    case 'compositeState':
    case 'choice': return 'state';
    case 'lifeline':
    case 'fragment': return 'sequence';
    case 'system': return 'system';
    case 'node':
    case 'boxNode': return 'node';
    case 'attribute': return 'attribute';
    case 'operation': return 'operation';
    case 'note': return 'note';
    default: return 'other';
  }
}

export function groupLabel(groupId) {
  return GROUP_MAP.get(groupId)?.label || 'Other';
}

// Parse a prefab spec defensively (object or JSON string).
function parseSpec(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return typeof raw === 'object' ? raw : null;
}

// Extract UML and Textual Analysis prefabs from page views (`{ pageIndex, parts, noteId?, noteTitle? }`).
export function extractPrefabsFromPages(pages) {
  const out = [];
  for (const page of pages || []) {
    const parts = page?.parts;
    if (!Array.isArray(parts) || !parts.length) continue;
    const byPart = new Map();
    for (const q of parts) {
      if (!q?.id || q.kind !== 'prefab') continue;
      let g = byPart.get(q.id);
      if (!g) { g = { partId: q.id, items: [], frame: null, specRaw: null }; byPart.set(q.id, g); }
      g.items.push(q.item);
      if (q.spec) { g.frame = q.item; g.specRaw = q.spec; }
    }
    for (const g of byPart.values()) {
      const spec = parseSpec(g.specRaw);
      if (!spec || (spec.type !== 'uml' && spec.type !== 'textual-analysis')) continue;
      out.push({
        pageIndex: Number(page.pageIndex) || 0,
        partId: g.partId,
        frame: g.frame ?? g.items[0] ?? null,
        items: g.items,
        spec,
        ...(page.noteId ? { noteId: page.noteId } : {}),
        ...(page.noteTitle ? { noteTitle: page.noteTitle } : {}),
      });
    }
  }
  return out;
}

export function makeDiagramKey({ noteId, pageIndex, partId, id }, fallbackIndex = 0) {
  const prefix = noteId ? `${noteId}:` : '';
  return `${prefix}p${Number(pageIndex) || 0}:${partId || id || `d${fallbackIndex}`}`;
}

// Human-readable label for a diagram or occurrence, e.g. "Class diagram: Classes (p. 2)".
export function formatOccurrenceLabel(occ) {
  const pageText = Number.isInteger(occ.pageIndex) ? `p. ${occ.pageIndex + 1}` : '';
  const notePrefix = occ.noteTitle ? `${occ.noteTitle} · ` : '';
  const loc = [notePrefix && occ.noteTitle, pageText].filter(Boolean).join(' · ');
  if (occ.module === 'textual-analysis') {
    const title = occ.diagramName && occ.diagramName !== 'Textual analysis'
      ? `Textual Analysis: ${occ.diagramName}`
      : 'Textual Analysis';
    return loc ? `${title} (${loc})` : title;
  }
  const kindLabel = DIAGRAMS[occ.diagramKind]?.label || 'UML diagram';
  const name = occ.diagramName && occ.diagramName.toLowerCase() !== kindLabel.toLowerCase()
    ? `${kindLabel}: ${occ.diagramName}`
    : kindLabel;
  return loc ? `${name} (${loc})` : name;
}

// UML member name normalization (matching uml-from.js) for attribute/operation rename matching.
const umlMemberName = (name) => String(name ?? '').trim().replace(/\s+(\p{L})/gu, (_, c) => c.toUpperCase()).replace(/\s+/g, '');

// Build the unified project model from a list of prefab entries:
//   [{ pageIndex, partId, spec, items?, frame?, noteId?, noteTitle? }]
export function buildProjectModel(prefabs = []) {
  const normalized = [];
  prefabs.forEach((entry, idx) => {
    const spec = parseSpec(entry?.spec);
    if (!spec || (spec.type !== 'uml' && spec.type !== 'textual-analysis')) return;
    const pageIndex = Number.isInteger(entry.pageIndex) ? entry.pageIndex : 0;
    const partId = entry.partId || spec.id || `part-${idx}`;
    const key = makeDiagramKey({ noteId: entry.noteId, pageIndex, partId, id: spec.id }, idx);
    normalized.push({
      key,
      pageIndex,
      partId,
      frame: entry.frame ?? null,
      items: Array.isArray(entry.items) ? entry.items : [],
      noteId: entry.noteId || null,
      noteTitle: entry.noteTitle || null,
      spec,
    });
  });

  const diagrams = [];
  const byDiagram = new Map();
  const byId = new Map(); // modelId -> model element
  const byKindName = new Map(); // `${group}:${nameKey}` -> modelId
  // Reverse lookup from `(diagramId, elementId)` -> candidate modelId (and member links).
  const umlLinkToCand = new Map(); // `${diagramId}:${elementId}` -> candidateId
  const memberLinks = new Map(); // `${diagramId}:${elementId}` -> [{ candidateId, list }]

  function ensureElement({ modelId, name, kind, folder = '', description = '', colour = '', candidateId = null }) {
    let el = byId.get(modelId);
    if (!el) {
      el = {
        modelId,
        name: String(name ?? '').trim(),
        kind,
        group: kind,
        folder: folder || '',
        description: description || '',
        colour: colour || '',
        candidateId: candidateId || null,
        occurrences: [],
      };
      byId.set(modelId, el);
    } else {
      if (!el.name && name) el.name = String(name).trim();
      if (!el.folder && folder) el.folder = folder;
      if (!el.description && description) el.description = description;
      if (!el.colour && colour) el.colour = colour;
      if (!el.candidateId && candidateId) el.candidateId = candidateId;
    }
    const nk = nameKey(el.name);
    if (nk && !byKindName.has(`${el.group}:${nk}`)) {
      byKindName.set(`${el.group}:${nk}`, el.modelId);
    }
    return el;
  }

  function addOccurrence(el, occ) {
    const dup = el.occurrences.some(
      (o) => o.diagramKey === occ.diagramKey && o.elementId === occ.elementId && o.role === occ.role
    );
    if (!dup) el.occurrences.push(occ);
  }

  // Pass 1: index Textual Analysis prefabs first so candidate ids are primary modelIds.
  for (const item of normalized) {
    if (item.spec.type !== 'textual-analysis') continue;
    const spec = item.spec;
    const diagramId = ID_RE.test(spec.id || '') ? spec.id : item.partId;
    const diagramName = String(spec.title || '').trim() || 'Textual analysis';
    const cands = Array.isArray(spec.candidates) ? spec.candidates : [];
    const diag = {
      key: item.key,
      id: diagramId,
      name: diagramName,
      kind: 'textual-analysis',
      module: 'textual-analysis',
      pageIndex: item.pageIndex,
      partId: item.partId,
      noteId: item.noteId,
      noteTitle: item.noteTitle,
      elementCount: cands.length,
      spec,
    };
    diagrams.push(diag);
    byDiagram.set(item.key, diag);

    for (const c of cands) {
      if (!c || typeof c !== 'object') continue;
      const cid = ID_RE.test(c.id || '') ? c.id : `c-${hash(nameKey(c.text || c.name || ''))}`;
      const group = canonicalKind(c.kind);
      const name = String(c.name || c.text || '').trim();
      if (!name) continue;
      const existingByName = byKindName.get(`${group}:${nameKey(name)}`);
      const modelId = byId.has(cid) ? cid : (existingByName || cid);
      const el = ensureElement({
        modelId,
        name,
        kind: group,
        folder: String(c.folder || '').trim(),
        description: String(c.description || '').trim(),
        colour: String(c.colour || '').trim(),
        candidateId: cid,
      });
      addOccurrence(el, {
        diagramKey: item.key,
        diagramId,
        diagramName,
        diagramKind: 'textual-analysis',
        module: 'textual-analysis',
        pageIndex: item.pageIndex,
        partId: item.partId,
        noteId: item.noteId,
        noteTitle: item.noteTitle,
        elementId: cid,
        candidateId: cid,
        elementType: c.kind || 'class',
        role: 'candidate',
        folder: String(c.folder || '').trim(),
        owner: String(c.owner || '').trim(),
      });
      if (Array.isArray(c.uml)) {
        for (const u of c.uml) {
          if (!u?.diagram || !u?.element) continue;
          const k = `${u.diagram}:${u.element}`;
          if (u.list === 'attributes' || u.list === 'operations') {
            let arr = memberLinks.get(k);
            if (!arr) { arr = []; memberLinks.set(k, arr); }
            arr.push({ modelId, candidateId: cid, list: u.list });
          } else if (!umlLinkToCand.has(k)) {
            umlLinkToCand.set(k, modelId);
          }
        }
      }
    }
  }

  // Pass 2: index UML diagrams.
  for (const item of normalized) {
    if (item.spec.type !== 'uml') continue;
    const spec = item.spec;
    const diagramKind = DIAGRAMS[spec.diagram] ? spec.diagram : 'class';
    const diagramId = ID_RE.test(spec.id || '') ? spec.id : item.partId;
    const diagramName = String(spec.name || spec.title || '').trim() || DIAGRAMS[diagramKind]?.label || 'UML diagram';
    const rawElements = Array.isArray(spec.elements) ? spec.elements : [];

    const namedElements = rawElements.filter((e) => {
      if (!e || typeof e !== 'object') return false;
      const def = ELEMENTS[e.type];
      if (def?.noName) return false;
      const hasName = String(e.name ?? '').trim().length > 0;
      const hasType = String(e.props?.type ?? '').trim().length > 0;
      return hasName || hasType || (typeof e.modelId === 'string' && ID_RE.test(e.modelId));
    });

    const diag = {
      key: item.key,
      id: diagramId,
      name: diagramName,
      kind: diagramKind,
      module: 'uml',
      pageIndex: item.pageIndex,
      partId: item.partId,
      noteId: item.noteId,
      noteTitle: item.noteTitle,
      elementCount: namedElements.length,
      spec,
    };
    diagrams.push(diag);
    byDiagram.set(item.key, diag);

    for (const e of namedElements) {
      const group = canonicalKind(e.type);
      const name = String(e.name ?? '').trim();
      const nk = nameKey(name);
      const originCandId = spec.origin?.candidates?.[e.id];
      const reverseCandId = umlLinkToCand.get(`${diagramId}:${e.id}`);

      // Priority for model identity:
      // 1. Explicit element.modelId (survives renames across diagrams)
      // 2. Diagram origin.candidates[e.id] (survives renames from Textual Analysis)
      // 3. Reverse link from a Textual Analysis candidate's `uml` list
      // 4. Same (canonicalKind, normalizedName) across diagrams
      // 5. Deterministic new id
      let modelId = null;
      if (typeof e.modelId === 'string' && ID_RE.test(e.modelId)) {
        modelId = e.modelId;
      } else if (typeof originCandId === 'string' && ID_RE.test(originCandId)) {
        modelId = originCandId;
      } else if (reverseCandId) {
        modelId = reverseCandId;
      } else if (nk && byKindName.has(`${group}:${nk}`)) {
        modelId = byKindName.get(`${group}:${nk}`);
      } else {
        modelId = `m-${group}-${hash(nk || `${diagramId}:${e.id}`)}`;
      }

      const el = ensureElement({
        modelId,
        name: name || String(e.props?.type || ELEMENTS[e.type]?.label || e.type),
        kind: group,
      });
      addOccurrence(el, {
        diagramKey: item.key,
        diagramId,
        diagramName,
        diagramKind,
        module: 'uml',
        pageIndex: item.pageIndex,
        partId: item.partId,
        noteId: item.noteId,
        noteTitle: item.noteTitle,
        elementId: e.id,
        elementType: e.type,
        role: 'element',
      });

      // If this is a sequence lifeline typed by a known class/interface (e.g. props.type = "Cliente"
      // or name "c : Cliente"), also link it as a lifeline occurrence on that class!
      if (e.type === 'lifeline') {
        const typeStr = String(e.props?.type || '').trim() || (name.includes(':') ? name.split(':').slice(1).join(':').trim() : '');
        const tk = nameKey(typeStr);
        const classId = tk ? (byKindName.get(`class:${tk}`) || byKindName.get(`interface:${tk}`)) : null;
        if (classId && classId !== modelId) {
          const cls = byId.get(classId);
          if (cls) {
            addOccurrence(cls, {
              diagramKey: item.key,
              diagramId,
              diagramName,
              diagramKind,
              module: 'uml',
              pageIndex: item.pageIndex,
              partId: item.partId,
              noteId: item.noteId,
              noteTitle: item.noteTitle,
              elementId: e.id,
              elementType: e.type,
              role: 'lifeline',
            });
          }
        }
      }

      // Attach UML diagram occurrences to attribute/operation candidates linked to this class.
      const members = memberLinks.get(`${diagramId}:${e.id}`);
      if (members) {
        for (const m of members) {
          const memberEl = byId.get(m.modelId);
          if (memberEl) {
            addOccurrence(memberEl, {
              diagramKey: item.key,
              diagramId,
              diagramName,
              diagramKind,
              module: 'uml',
              pageIndex: item.pageIndex,
              partId: item.partId,
              noteId: item.noteId,
              noteTitle: item.noteTitle,
              elementId: e.id,
              elementType: e.type,
              role: 'member',
              list: m.list,
            });
          }
        }
      }
    }
  }

  // Sort diagrams by note, page, then name.
  diagrams.sort((a, b) =>
    String(a.noteTitle || '').localeCompare(String(b.noteTitle || ''))
    || a.pageIndex - b.pageIndex
    || a.name.localeCompare(b.name)
  );

  // Sort elements by name; sort each element's occurrences by page & module (TA first on same page).
  const elements = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const el of elements) {
    el.occurrences.sort((a, b) =>
      a.pageIndex - b.pageIndex
      || (a.module === 'textual-analysis' ? 0 : 1) - (b.module === 'textual-analysis' ? 0 : 1)
      || a.diagramName.localeCompare(b.diagramName)
    );
  }

  return { diagrams, elements, byId, byDiagram };
}

// Organize the project model into a Visual Paradigm-style tree (Candidate Items folders +
// kind groups + Diagrams list), with optional case-insensitive search filter.
export function modelTree(projectModel, { filter = '' } = {}) {
  const q = String(filter || '').trim().toLowerCase();
  const matchesEl = (el) => {
    if (!q) return true;
    return el.name.toLowerCase().includes(q)
      || el.folder.toLowerCase().includes(q)
      || groupLabel(el.group).toLowerCase().includes(q)
      || el.occurrences.some((o) => o.diagramName.toLowerCase().includes(q));
  };
  const matchesDiag = (d) => {
    if (!q) return true;
    return d.name.toLowerCase().includes(q)
      || (DIAGRAMS[d.kind]?.label || 'Textual analysis').toLowerCase().includes(q);
  };

  // Candidate Items (elements that appear in Textual Analysis, grouped by folder).
  const candidateFolderMap = new Map();
  for (const el of projectModel.elements) {
    if (!el.occurrences.some((o) => o.module === 'textual-analysis')) continue;
    if (!matchesEl(el)) continue;
    const f = el.folder || '';
    if (!candidateFolderMap.has(f)) candidateFolderMap.set(f, []);
    candidateFolderMap.get(f).push(el);
  }
  const candidateFolders = [...candidateFolderMap.entries()]
    .sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b))
    .map(([folder, items]) => ({ folder: folder || 'Unfiled', rawFolder: folder, items }));

  // Model elements grouped by canonical kind.
  const groups = [];
  for (const def of MODEL_GROUPS) {
    const items = projectModel.elements.filter((el) => el.group === def.id && matchesEl(el));
    if (items.length) groups.push({ id: def.id, label: def.label, icon: def.icon, items });
  }

  const diagrams = projectModel.diagrams.filter(matchesDiag);

  return { candidateFolders, groups, diagrams };
}

// Find the unified model element for a UML element currently open in the diagram editor.
export function findElementForUml(projectModel, { diagramId = '', partId = '', elementId = '', elementType = '', elementName = '', modelId = '' } = {}) {
  if (!projectModel) return null;
  if (modelId && projectModel.byId.has(modelId)) return projectModel.byId.get(modelId);
  if (elementId) {
    for (const el of projectModel.elements) {
      const hit = el.occurrences.find((o) =>
        o.module === 'uml'
        && o.elementId === elementId
        && ((diagramId && o.diagramId === diagramId) || (partId && o.partId === partId))
      );
      if (hit) return el;
    }
  }
  const nk = nameKey(elementName);
  const g = canonicalKind(elementType);
  if (nk) {
    const match = projectModel.elements.find((el) => el.group === g && nameKey(el.name) === nk);
    if (match) return match;
  }
  return null;
}

// Find the unified model element for a Textual Analysis candidate.
export function findElementForCandidate(projectModel, { analysisId = '', partId = '', candidateId = '', candidateName = '', candidateKind = '' } = {}) {
  if (!projectModel) return null;
  if (candidateId && projectModel.byId.has(candidateId)) return projectModel.byId.get(candidateId);
  if (candidateId) {
    for (const el of projectModel.elements) {
      const hit = el.occurrences.find((o) =>
        o.module === 'textual-analysis'
        && o.candidateId === candidateId
        && ((analysisId && o.diagramId === analysisId) || (partId && o.partId === partId))
      );
      if (hit) return el;
    }
  }
  const nk = nameKey(candidateName);
  const g = canonicalKind(candidateKind);
  if (nk) {
    const match = projectModel.elements.find((el) => el.group === g && nameKey(el.name) === nk);
    if (match) return match;
  }
  return null;
}

// Occurrences of `element` outside the current diagram/prefab (for "Show in…").
export function otherOccurrences(element, { diagramKey = '', diagramId = '', partId = '' } = {}) {
  if (!element?.occurrences?.length) return [];
  return element.occurrences.filter((o) => {
    if (diagramKey && o.diagramKey === diagramKey) return false;
    if (partId && o.partId === partId) return false;
    if (!diagramKey && !partId && diagramId && o.diagramId === diagramId) return false;
    return true;
  });
}

// Pure rename propagation planner: computes the updated prefab specs across the note for
// renaming `modelId` to `newName`. When `onlyDiagramKey` is given, only that prefab is updated.
export function planRename(prefabs, projectModel, modelId, rawNewName, { onlyDiagramKey = null } = {}) {
  const newName = String(rawNewName ?? '').trim();
  const el = projectModel?.byId?.get(modelId);
  if (!el || !newName || newName === el.name) {
    return { modelId, oldName: el?.name || '', newName, updates: [], totalDiagrams: 0, totalChanges: 0 };
  }
  const oldName = el.name;
  const oldMember = umlMemberName(oldName);
  const newMember = umlMemberName(newName);

  // Index prefabs by their diagramKey so we can clone & mutate only the affected ones.
  const prefabByKey = new Map();
  prefabs.forEach((entry, idx) => {
    const spec = parseSpec(entry?.spec);
    if (!spec) return;
    const pageIndex = Number.isInteger(entry.pageIndex) ? entry.pageIndex : 0;
    const partId = entry.partId || spec.id || `part-${idx}`;
    const key = makeDiagramKey({ noteId: entry.noteId, pageIndex, partId, id: spec.id }, idx);
    prefabByKey.set(key, { ...entry, pageIndex, partId, key, spec });
  });

  // Group occurrences by diagramKey.
  const occsByDiagram = new Map();
  for (const occ of el.occurrences) {
    if (onlyDiagramKey && occ.diagramKey !== onlyDiagramKey) continue;
    let list = occsByDiagram.get(occ.diagramKey);
    if (!list) { list = []; occsByDiagram.set(occ.diagramKey, list); }
    list.push(occ);
  }

  const updates = [];
  let totalChanges = 0;

  for (const [diagramKey, occs] of occsByDiagram.entries()) {
    const entry = prefabByKey.get(diagramKey);
    if (!entry) continue;
    const beforeSpec = entry.spec;
    const afterSpec = structuredClone(beforeSpec);
    let changes = 0;

    if (afterSpec.type === 'uml' && Array.isArray(afterSpec.elements)) {
      for (const occ of occs) {
        const target = afterSpec.elements.find((e) => e.id === occ.elementId);
        if (!target) continue;
        if (occ.role === 'lifeline') {
          if (target.props && nameKey(target.props.type) === nameKey(oldName)) {
            target.props.type = newName;
            changes++;
          } else if (typeof target.name === 'string' && target.name.includes(':')) {
            const [lhs, ...rhs] = target.name.split(':');
            if (nameKey(rhs.join(':')) === nameKey(oldName)) {
              target.name = `${lhs.trim()} : ${newName}`;
              changes++;
            }
          }
        } else if (occ.role === 'member' && (occ.list === 'attributes' || occ.list === 'operations')) {
          const list = target.props?.[occ.list];
          if (Array.isArray(list)) {
            for (const m of list) {
              if (nameKey(m?.name) === nameKey(oldMember) || nameKey(m?.name) === nameKey(oldName)) {
                m.name = newMember;
                changes++;
              }
            }
          }
        } else {
          if (target.name !== newName) {
            target.name = newName;
            changes++;
          }
          // Stamp stable modelId so future renames stay connected even across diagrams.
          if (!target.modelId && ID_RE.test(modelId)) target.modelId = modelId;
        }
      }
    } else if (afterSpec.type === 'textual-analysis' && Array.isArray(afterSpec.candidates)) {
      const targetIds = new Set(occs.map((o) => o.candidateId || o.elementId));
      for (const c of afterSpec.candidates) {
        if (targetIds.has(c.id)) {
          if (c.name !== newName) {
            c.name = newName;
            changes++;
          }
        }
      }
      // Also update `owner` references in the same Textual Analysis (matching model.js update()).
      for (const c of afterSpec.candidates) {
        if (c.owner && nameKey(c.owner) === nameKey(oldName)) {
          c.owner = newName;
          changes++;
        }
      }
    }

    if (changes > 0) {
      totalChanges += changes;
      updates.push({
        pageIndex: entry.pageIndex,
        partId: entry.partId,
        frame: entry.frame ?? null,
        items: entry.items || [],
        diagramKey,
        diagramName: projectModel.byDiagram.get(diagramKey)?.name || '',
        module: afterSpec.type,
        beforeSpec,
        afterSpec,
        changes,
      });
    }
  }

  return { modelId, oldName, newName, updates, totalDiagrams: updates.length, totalChanges };
}
