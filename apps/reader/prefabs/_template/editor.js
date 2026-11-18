// The template module's editor (docs/PREFAB-MODULES-GUIDE.md), built only with the kit: the
// figure in the middle as it will be on the page, its fields on the right. Every change
// redraws it; Ctrl Z / Ctrl Shift Z step through the changes.
import { editorShell, field, textInput, listInput, make } from '../kit/index.js';
import { normalize, render } from './render.js';

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  const past = [], future = [];
  const shell = editorShell(root, {
    id: 'example',
    title: 'Example list',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{ title: 'Example list', icon: 'note', rows: [
      { keys: 'Ctrl Z / Ctrl Shift Z', does: 'Undo · redo' },
      { keys: 'Ctrl Enter', does: editing ? 'Apply' : 'Insert' },
      { keys: 'Esc', does: 'Cancel' },
    ] }],
  });
  // Undo and redo: whole models as JSON, moved between the two stacks.
  function step(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    draw(true);
  }
  function change(next) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next });
    draw(false);
  }
  // The canvas always; the panel only after undo/redo (rebuilding it while typing would take
  // the focus away from the field being typed in).
  function draw(rebuild) {
    shell.canvas.innerHTML = render(model).svg;
    shell.history(past.length > 0, future.length > 0);
    if (rebuild) panel();
  }
  function panel() {
    shell.panel.replaceChildren(
      field('Title', textInput(model.title, (title) => change({ title }))),
      make('h4', { textContent: 'Lines' }),
      listInput(model.lines, {
        row: (l, update) => textInput(l.text, (text) => update({ text }), { placeholder: 'Text' }),
        blank: () => ({ text: '' }),
        change: (lines) => change({ lines }),
        addLabel: 'Add line',
      }),
    );
  }
  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
