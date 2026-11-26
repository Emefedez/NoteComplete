// uml.html: the UML editor on its own page (the desktop app's Tools menu, a bookmark, or
// Insert → UML diagram editor). What is drawn is kept in this browser between visits, as a
// workspace of diagrams in tabs (uml-workspace.js): "+" starts another, closing a tab keeps
// it in the list button's menu. Export saves the shown one as Visual Paradigm XML, XMI, a
// picture or a NoteComplete diagram, which Insert prefab → UML can bring into a note.
import { mountUmlWorkspace } from './uml-workspace.js';
import { starterModel, DIAGRAMS, umlName } from './uml.js';

const KEY = 'notecomplete.uml.workspace', OLD_KEY = 'notecomplete.uml.draft';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
// { diagrams: { key: model }, open: [keys], active: key }; the single draft of before, as one tab.
let saved = read(KEY);
if (!saved?.diagrams || !Object.keys(saved.diagrams).length) {
  const draft = read(OLD_KEY);
  saved = { diagrams: { d1: draft?.type === 'uml' ? draft : starterModel('class') }, open: ['d1'], active: 'd1' };
}
const params = new URLSearchParams(location.search);
const asked = params.get('diagram');
if (asked && DIAGRAMS[asked] && saved.diagrams[saved.active]?.diagram !== asked) {
  const key = `d${Date.now().toString(36)}`;
  saved.diagrams[key] = starterModel(asked);
  saved.open = [...(saved.open || []), key];
  saved.active = key;
}
const entry = (key) => ({ key, spec: saved.diagrams[key] });
const openKeys = (saved.open || []).filter((k) => saved.diagrams[k]);
if (!openKeys.length) openKeys.push(Object.keys(saved.diagrams)[0]);

let timer = 0;
const write = () => { timer = 0; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* Private window: not kept. */ } };
// A moment after the last change (typing does not serialize every diagram per key): each
// diagram as it is now, open tabs from their editors, and which are open.
function store(w) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const t of w.tabs()) saved.diagrams[t.key] = t.output;
    saved.open = w.openKeys();
    saved.active = w.active();
    const shown = saved.diagrams[saved.active];
    if (shown) document.title = `${shown.name || umlName(shown)} · NoteComplete`;
    write();
  }, 300);
}
const ws = mountUmlWorkspace(document.getElementById('umlRoot'), {
  tabs: openKeys.map(entry),
  active: saved.active,
  // Diagrams of this page that are not in a tab now.
  catalog: () => Object.keys(saved.diagrams).filter((k) => !ws?.openKeys().includes(k)).map(entry),
  onChange: (w) => store(w),
});
store(ws);
addEventListener('pagehide', () => {
  if (!timer) return;
  clearTimeout(timer);
  for (const t of ws.tabs()) saved.diagrams[t.key] = t.output;
  saved.open = ws.openKeys();
  saved.active = ws.active();
  write();
});
