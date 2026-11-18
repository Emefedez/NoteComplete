// Shared UML clipboard across editors, .puml documents and note pages: keeps element
// positions, sizes, container nesting and connector waypoints.
import { CODE_DIAGRAMS, DIAGRAMS, normalizeModel } from './uml.js';
import { parsePlantUml, toPlantUml } from './uml-plantuml.js';

export const UML_CLIP_KEY = 'notecomplete.uml.clip';
let memoryClip = null;

function storeClip(entry) {
  memoryClip = entry;
  try { localStorage.setItem(UML_CLIP_KEY, JSON.stringify(entry)); } catch { /* Optional. */ }
  return entry;
}

export function getSharedUmlClip() {
  if (memoryClip) return memoryClip;
  try {
    const raw = localStorage.getItem(UML_CLIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.elements) && parsed.elements.length) return (memoryClip = parsed);
  } catch { /* Optional. */ }
  return null;
}

// Serializes selected elements (or a whole diagram) to the shared buffer and clipboard text.
export function writeUmlClip({ diagram, elements, connectors, preamble = [], whole = false }) {
  const clean = normalizeModel({ diagram, elements, connectors });
  const entry = storeClip({
    notecompleteUml: true,
    at: Date.now(),
    diagram: clean.diagram,
    elements: clean.elements,
    connectors: clean.connectors,
    preamble: Array.isArray(preamble) ? preamble : [],
    whole,
  });
  let text = '';
  if (CODE_DIAGRAMS.has(clean.diagram)) {
    try { text = toPlantUml(clean, { preamble, layout: true }); } catch { text = ''; }
  }
  if (!text) text = JSON.stringify({ notecompleteUml: true, diagram: clean.diagram, elements: clean.elements, connectors: clean.connectors, preamble });
  return { clip: entry, text };
}

// Mirror a UML prefab copied from a note page so Ctrl+V in any UML editor pastes its contents.
export function saveNoteUmlClip(spec) {
  if (!spec || spec.type !== 'uml' || !Array.isArray(spec.elements) || !spec.elements.length) return null;
  const clean = normalizeModel(spec);
  return storeClip({
    notecompleteUml: true,
    fromNote: true,
    at: Date.now(),
    diagram: clean.diagram,
    elements: clean.elements,
    connectors: clean.connectors,
    preamble: Array.isArray(spec.preamble) ? spec.preamble : [],
    whole: true,
  });
}

// Reads UML elements/connectors from clipboard text (PlantUML or NoteComplete UML JSON).
export function readUmlClipFromText(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      if ((data?.notecompleteUml || data?.type === 'uml') && Array.isArray(data.elements) && data.elements.length) {
        const clean = normalizeModel(data);
        return { diagram: clean.diagram, elements: clean.elements, connectors: clean.connectors, preamble: Array.isArray(data.preamble) ? data.preamble : [], laidOut: true, whole: Boolean(data.whole || data.type === 'uml') };
      }
    } catch { /* Not JSON. */ }
  }
  if (/@startuml/i.test(text)) {
    try {
      const parsed = parsePlantUml(text);
      if (!parsed.model.elements.length) return null;
      return { diagram: parsed.model.diagram, elements: parsed.model.elements, connectors: parsed.model.connectors, preamble: parsed.preamble, laidOut: parsed.laidOut, whole: true };
    } catch { return null; }
  }
  return null;
}

// Whether two diagram kinds can share pasted elements cleanly.
export function clipFitsDiagram(clip, diagram) {
  if (!clip?.elements?.length) return false;
  if (clip.diagram === diagram) return true;
  // The full editor takes the elements of every kind.
  if (DIAGRAMS[diagram]?.notRecommended) return clip.elements.every((e) => DIAGRAMS[diagram].elements.includes(e.type));
  if (CODE_DIAGRAMS.has(clip.diagram) && CODE_DIAGRAMS.has(diagram)) {
    const known = new Set(DIAGRAMS[diagram]?.elements || []);
    return clip.elements.every((e) => known.has(e.type));
  }
  const known = new Set(DIAGRAMS[diagram]?.elements || []);
  return clip.elements.every((e) => known.has(e.type));
}
