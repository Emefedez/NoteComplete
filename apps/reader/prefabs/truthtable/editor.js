// The truth table module's editor (docs/PREFAB-MODULES-GUIDE.md), built only with the kit: the
// table in the middle as it will be on the page, its variables, expression and output column
// on the right. Every change redraws it; Ctrl Z / Ctrl Shift Z step through the changes.
import { editorShell, field, textInput, selectInput, make } from '../kit/index.js';
import { normalize, render, evaluate, MAX_VARIABLES } from './render.js';

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  const past = [], future = [];
  const shell = editorShell(root, {
    id: 'truthtable',
    title: 'Truth table',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{ title: 'Truth table', icon: 'table', rows: [
      { icon: 'settings', does: 'Variables, expression and output column on the right; the table follows' },
      { does: 'Operators: and ∧ & ·  or ∨ | +  not ¬ ! ~ or A\'  xor ⊕  -> →  <-> ↔  and 1 0' },
      { keys: 'Ctrl Z / Ctrl Shift Z', does: 'Undo · redo' },
      { keys: 'Ctrl Enter', does: editing ? 'Apply' : 'Insert' },
      { keys: 'Esc', does: 'Cancel' },
    ] }],
  });
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
  function draw(rebuild) {
    shell.canvas.innerHTML = render(model).svg;
    shell.history(past.length > 0, future.length > 0);
    const { error } = evaluate(model);
    shell.say(error && model.output === 'values' ? `Expression: ${error}` : '', !!error);
    if (rebuild) panel();
  }
  function panel() {
    shell.panel.replaceChildren(
      field('Title', textInput(model.title, (title) => change({ title }))),
      field('Variables', textInput(model.variables.join(', '), (variables) => change({ variables }), { placeholder: 'A, B, C' }), `Names separated by commas, up to ${MAX_VARIABLES}`),
      make('h4', { textContent: 'Output column' }),
      field('Expression', textInput(model.expr, (expr) => change({ expr }), { placeholder: '(A and B) or not C' })),
      field('Heading', textInput(model.label, (label) => change({ label }), { placeholder: 'The expression' })),
      field('Show', selectInput([['values', 'Its values'], ['blank', 'Empty, to fill in'], ['none', 'No output column']], model.output, (output) => change({ output }))),
      field('Write', selectInput([['10', '1 and 0'], ['VF', 'V and F'], ['TF', 'T and F']], model.notation, (notation) => change({ notation }))),
    );
  }
  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
