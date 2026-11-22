// Sticky note prefab editor (module.json): live preview in the middle, colour swatches,
// title, multiline note body, author footer, font size, fold/lines toggles and size presets.
import { editorShell, field, textInput, numberInput, checkInput, make } from '../kit/index.js';
import { PALETTE, normalize, render } from './render.js';

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  const past = [], future = [];
  const shell = editorShell(root, {
    id: 'stickynote',
    title: 'Sticky note',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{
      title: 'Sticky note',
      icon: 'note',
      rows: [
        { icon: 'settings', does: 'Choose a colour, title, text, lines or corner fold on the right' },
        { keys: 'Ctrl Z / Ctrl Shift Z', does: 'Undo · redo' },
        { keys: 'Ctrl Enter', does: editing ? 'Apply' : 'Insert' },
        { keys: 'Esc', does: 'Cancel' },
      ],
    }],
  });

  function step(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(model));
    model = JSON.parse(from.pop());
    draw(true);
  }
  function change(next, rebuild = false) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next });
    draw(rebuild);
  }
  function draw(rebuild) {
    shell.canvas.innerHTML = render(model).svg;
    shell.history(past.length > 0, future.length > 0);
    if (rebuild) panel();
  }
  function panel() {
    const swatches = make('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;' });
    for (const c of PALETTE) {
      const active = model.color.toLowerCase() === c.hex.toLowerCase();
      const b = make('button', {
        type: 'button',
        title: c.name,
        style: `width:26px;height:26px;border-radius:6px;background:${c.hex};border:${active ? '2px solid var(--accent,#2563eb)' : '1px solid rgba(0,0,0,0.22)'};cursor:pointer;padding:0;`,
        onclick: () => change({ color: c.hex }, true),
      });
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-pressed', String(active));
      swatches.append(b);
    }
    const picker = make('input', {
      type: 'color',
      value: model.color,
      title: 'Custom colour',
      style: 'width:30px;height:26px;padding:0;border:none;background:none;cursor:pointer;',
    });
    picker.oninput = () => change({ color: picker.value }, false);
    swatches.append(picker);

    const bodyArea = make('textarea', {
      rows: 6,
      value: model.text,
      placeholder: 'Write note text… (or leave blank to handwrite on top)',
      style: 'width:100%;resize:vertical;font:inherit;padding:6px 8px;border-radius:6px;border:1px solid var(--border,#cbd5e1);background:var(--surface,#fff);color:inherit;box-sizing:border-box;',
    });
    bodyArea.oninput = () => change({ text: bodyArea.value });

    const presets = make('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
      ...[['Square', 256, 256], ['Wide', 360, 240], ['Tall', 240, 340]].map(([label, w, h]) =>
        make('button', {
          type: 'button',
          className: 'pk-button',
          textContent: label,
          onclick: () => change({ width: w, height: h }, true),
        }),
      ),
    );

    shell.panel.replaceChildren(
      field('Colour', swatches),
      field('Title', textInput(model.title, (title) => change({ title }), { placeholder: 'Optional heading' })),
      field('Note', bodyArea),
      field('Footer / author', textInput(model.author, (author) => change({ author }), { placeholder: 'Optional' })),
      field('Text size', numberInput(model.fontSize, (fontSize) => change({ fontSize }), { min: 8, max: 48, step: 1 })),
      checkInput('Folded corner', model.fold, (fold) => change({ fold })),
      checkInput('Ruled lines', model.lines, (lines) => change({ lines })),
      make('h4', { textContent: 'Size' }),
      presets,
      field('Width', numberInput(model.width, (width) => change({ width }), { min: 120, max: 800, step: 10 })),
      field('Height', numberInput(model.height, (height) => change({ height }), { min: 120, max: 800, step: 10 })),
    );
  }
  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
