// The diagram module's hooks (prefabs/uml/module.json): UML diagrams of every kind and node
// graphs, drawn by uml.js (or PlantUML's own SVG, kept in the spec, when that drawing was
// chosen), named for menus, and its picker cards built from the diagram kinds.
import { DIAGRAMS, renderUml, starterModel, umlName } from '../../uml.js';

function svgSize(svg) {
  const tag = String(svg || '').match(/<svg\b[^>]*>/i)?.[0] || '';
  const vb = tag.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  if (vb) return [Number(vb[1]) || 600, Number(vb[2]) || 400];
  const w = Number(tag.match(/\bwidth=["']([\d.]+)/i)?.[1]), h = Number(tag.match(/\bheight=["']([\d.]+)/i)?.[1]);
  return [w || 600, h || 400];
}

export function render(spec) {
  if (spec.style === 'plantuml' && typeof spec.plantumlSvg === 'string' && spec.plantumlSvg.includes('<svg')) {
    const [width, height] = svgSize(spec.plantumlSvg);
    return { svg: spec.plantumlSvg, width, height };
  }
  return renderUml(spec);
}

export const name = (spec) => umlName(spec);

// The node graph first, then every UML kind (the full editor last, marked not recommended).
export function prefabs() {
  return [
    { id: 'tree', group: 'diagram', label: 'Tree or node graph', hint: 'Nodes and arrows: trees, automata, graphs. Drag from a node to connect or grow it', icon: 'share', spec: starterModel('graph') },
    ...Object.entries(DIAGRAMS).filter(([, d]) => !d.notUml).map(([diagram, d]) => ({
      id: `uml-${diagram}`,
      group: 'diagram',
      label: d.notRecommended ? 'UML full editor' : `UML ${d.label.replace(/ diagram$/, '').toLowerCase()}`,
      hint: d.notRecommended ? 'Every element and connector of every UML diagram. Not recommended: it follows no single kind, and exports only as a picture or a NoteComplete diagram' : `${d.label}, as in Visual Paradigm: opens the diagram editor`,
      icon: 'uml',
      spec: starterModel(diagram),
    })),
  ];
}
