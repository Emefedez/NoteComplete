// The number line module's editor, built only with the kit (prefabs/kit): the figure in the
// middle as it will be on the page, its range, points and intervals on the right. Every change
// redraws it; Ctrl Z / Ctrl Shift Z step through the changes.
import { editorShell, field, textInput, numberInput, checkInput, listInput, make } from '../kit/index.js';
import { normalize, render } from './render.js';

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  const past = [], future = [];
  const shell = editorShell(root, {
    id: 'numberline',
    title: 'Number line',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{ title: 'Number line', icon: 'minus', rows: [
      { icon: 'settings', does: 'Range, ticks, points and intervals on the right; the line follows' },
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
    if (rebuild) panel();
  }
  function panel() {
    shell.panel.replaceChildren(
      field('Title', textInput(model.title, (title) => change({ title }))),
      make('h4', { textContent: 'Range' }),
      field('From', numberInput(model.min, (min) => change({ min }))),
      field('To', numberInput(model.max, (max) => change({ max }))),
      field('Ticks every', numberInput(model.step, (step) => change({ step }), { min: 0 })),
      make('h4', { textContent: 'Points' }),
      listInput(model.points, {
        row: (p, update) => [numberInput(p.x, (x) => update({ x })), textInput(p.label, (label) => update({ label }), { placeholder: 'Label' })],
        blank: () => ({ x: (model.min + model.max) / 2, label: '' }),
        change: (points) => change({ points }),
        addLabel: 'Add point',
      }),
      make('h4', { textContent: 'Intervals' }),
      listInput(model.intervals, {
        row: (v, update) => [numberInput(v.from, (from) => update({ from })), checkInput('closed', v.closedFrom, (closedFrom) => update({ closedFrom })), numberInput(v.to, (to) => update({ to })), checkInput('closed', v.closedTo, (closedTo) => update({ closedTo }))],
        blank: () => ({ from: model.min, to: (model.min + model.max) / 2, closedFrom: true, closedTo: false }),
        change: (intervals) => change({ intervals }),
        addLabel: 'Add interval',
      }),
    );
  }
  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
