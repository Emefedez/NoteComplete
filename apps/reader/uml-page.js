// uml.html: the UML editor on its own page (the desktop app's Tools menu, a bookmark, or
// Insert → UML diagram editor). What is drawn is kept in this browser between visits; Export
// saves it as Visual Paradigm XML, XMI, a picture or a NoteComplete diagram, which Insert
// prefab → UML can bring into a note.
import { mountUmlEditor } from './uml-editor.js';
import { starterModel, DIAGRAMS, umlName } from './uml.js';

const KEY = 'notecomplete.uml.draft';
const params = new URLSearchParams(location.search);
let initial = null;
try { initial = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* A fresh start. */ }
const asked = params.get('diagram');
if (asked && DIAGRAMS[asked] && initial?.diagram !== asked) initial = starterModel(asked);
const save = (model) => {
  document.title = `${model.name || umlName(model)} · NoteComplete`;
  try { localStorage.setItem(KEY, JSON.stringify(model)); } catch { /* Private window: not kept. */ }
};
const editor = mountUmlEditor(document.getElementById('umlRoot'), initial || starterModel('class'), { onChange: save });
save(editor.model());
