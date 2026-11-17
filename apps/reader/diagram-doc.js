// A PlantUML file (.puml) opened as a document: class, package and use case diagrams open in
// the UML editor of the prefabs (uml-editor.js) and every change is written back as PlantUML
// (uml-plantuml.js); other kinds (activity, sequence…) return null and show as a picture.
import { parsePlantUml, toPlantUml, layoutFromPlantuml } from './uml-plantuml.js';

// draw(text): PlantUML's own drawing ({ svg }), used once to place the boxes where it puts them.
// onText(text): the file's new text after each change. Resolves with { zoom, focus, destroy } or null.
export async function mountDiagramDoc(host, { text, draw = null, onText, onError = () => {}, ignoreKey = null, markdown = null }) {
  let parsed;
  try { parsed = parsePlantUml(text); } catch { return null; }
  if (!parsed.model.elements.length) return null;
  if (!parsed.laidOut && draw) {
    try { const drawn = await draw(text); if (drawn?.svg) layoutFromPlantuml(parsed.model, drawn.svg); } catch { /* Laid out in rows instead. */ }
  }
  const { mountUmlEditor } = await import('./uml-editor.js');
  let ready = false, last = text;
  const editor = mountUmlEditor(host, parsed.model, {
    markdown,
    preamble: parsed.preamble,
    draw,
    ignoreKey,
    onChange: (model) => {
      if (!ready) return;
      try {
        const next = toPlantUml(model, { preamble: editor.preamble() });
        if (next !== last) { last = next; onText(next); }
      } catch (error) { onError(error.message); }
    },
  });
  ready = true;
  return {
    zoom: (dir) => editor.zoom(dir),
    focus: () => editor.focus(),
    model: () => {
      const m = editor.model();
      const pre = editor.preamble();
      if (pre.length) m.preamble = pre;
      const svg = editor.renderedSvg();
      if (svg) { m.style = 'plantuml'; m.plantumlSvg = svg; }
      return m;
    },
    plantuml: () => toPlantUml(editor.model(), { preamble: editor.preamble() }),
    destroy: () => editor.destroy(),
  };
}
