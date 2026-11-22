// R Math & Statistics prefab editor (docs/R-PREFABS-PLAN.md):
// Dynamic form for R statistical presets + live R code preview + explicit Run in R button
// connected to NoteComplete's R Bridge (R Commander Studio primary, local Rscript fallback).
import { editorShell, field, textInput, numberInput, selectInput, checkInput, button, make } from '../kit/index.js';
import { PRESET_LABELS, normalize, buildPresetRCode, render } from './render.js';

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  let trustedCustom = !editing || model.preset !== 'custom';
  let running = false;
  const past = [], future = [];

  const shell = editorShell(root, {
    id: 'r-math',
    title: 'R Math & Statistics',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{
      title: 'R Math & Statistics',
      icon: 'graph',
      rows: [
        { icon: 'play', does: 'Click Run in R to render a crisp vector SVG via R Commander Studio or local Rscript' },
        { icon: 'settings', does: 'Cached SVGs stay inside the note and work offline on Web and Mobile' },
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

  function setParam(key, val) {
    change({ params: { ...model.params, [key]: val } }, false);
  }

  function effectiveCode() {
    return model.preset === 'custom' ? model.rCode : buildPresetRCode(model);
  }

  async function runInR() {
    if (running) return;
    if (!window.notecompleteRBridge) {
      shell.say('Live R execution requires NoteComplete Desktop (cached SVGs still display offline).', true);
      return;
    }
    if (model.preset === 'custom' && !trustedCustom) {
      const ok = window.confirm('Run this imported custom R snippet locally on your machine?\n\nReview the R code in the panel before continuing.');
      if (!ok) return;
      trustedCustom = true;
    }
    running = true;
    shell.say('Running R…');
    try {
      const rCode = effectiveCode();
      const res = await window.notecompleteRBridge.evalFigure({
        rCode,
        width: model.width,
        height: model.height,
        bg: '#ffffff',
      });
      if (!res?.ok || !res.svg) throw new Error(res?.error || 'R returned no SVG.');
      change({
        rCode,
        cache: {
          svg: res.svg,
          stdout: res.stdout || '',
          generatedAt: new Date().toISOString(),
          rVersion: res.rVersion || '',
        },
      }, true);
      shell.say(`Rendered via ${res.backend || 'R'} in ${res.elapsedMs ?? 0} ms${res.stdout ? ` · ${res.stdout.split('\n')[0]}` : ''}`);
    } catch (e) {
      shell.say(e.message, true);
    } finally {
      running = false;
    }
  }

  async function openInStudio() {
    if (!window.notecompleteRBridge) {
      shell.say('Open in R Commander Studio requires NoteComplete Desktop.', true);
      return;
    }
    const res = await window.notecompleteRBridge.openInStudio({
      title: `${(model.title || model.preset || 'figure').replace(/[^A-Za-z0-9_-]+/g, '_')}.R`,
      code: effectiveCode(),
      kind: 'r',
    });
    if (res?.ok) shell.say(res.connected ? 'Opened in R Commander Studio.' : 'Launching R Commander Studio…');
    else shell.say(res?.error || 'R Commander Studio not found.', true);
  }

  function draw(rebuild) {
    shell.canvas.innerHTML = render(model).svg;
    shell.history(past.length > 0, future.length > 0);
    if (rebuild) panel();
  }

  function presetFields() {
    const p = model.params;
    const colorField = () => {
      const input = make('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#245dc4', style: 'width:38px;height:26px;padding:0;border:none;background:none;cursor:pointer;' });
      input.oninput = () => setParam('color', input.value);
      return field('Colour', input);
    };
    switch (model.preset) {
      case 'normal':
        return [
          field('Mean (μ)', numberInput(p.mean ?? 0, (v) => setParam('mean', v))),
          field('Std Dev (σ)', numberInput(p.sd ?? 1, (v) => setParam('sd', v), { min: 0.0001 })),
          field('Shaded region', selectInput([['between', 'Between (from → to)'], ['lower', 'Lower tail (≤ to)'], ['upper', 'Upper tail (≥ from)'], ['none', 'No shading']], p.region || 'between', (v) => setParam('region', v))),
          field('From', numberInput(p.from ?? -1.96, (v) => setParam('from', v))),
          field('To', numberInput(p.to ?? 1.96, (v) => setParam('to', v))),
          colorField(),
        ];
      case 't':
        return [
          field('Degrees of freedom', numberInput(p.df ?? 12, (v) => setParam('df', v), { min: 1 })),
          field('Shaded region', selectInput([['upper', 'Upper tail'], ['lower', 'Lower tail'], ['between', 'Between'], ['none', 'None']], p.region || 'upper', (v) => setParam('region', v))),
          field('From', numberInput(p.from ?? 2.179, (v) => setParam('from', v))),
          field('To', numberInput(p.to ?? 5, (v) => setParam('to', v))),
          colorField(),
        ];
      case 'chisq':
        return [
          field('Degrees of freedom', numberInput(p.df ?? 5, (v) => setParam('df', v), { min: 1 })),
          field('Shaded region', selectInput([['upper', 'Upper tail'], ['lower', 'Lower tail'], ['none', 'None']], p.region || 'upper', (v) => setParam('region', v))),
          field('Critical value', numberInput(p.from ?? 11.07, (v) => setParam('from', v), { min: 0 })),
          colorField(),
        ];
      case 'binomial':
        return [
          field('Trials (n)', numberInput(p.size ?? 15, (v) => setParam('size', v), { min: 1, max: 200, step: 1 })),
          field('Success prob (p)', numberInput(p.prob ?? 0.4, (v) => setParam('prob', v), { min: 0, max: 1, step: 0.05 })),
          colorField(),
        ];
      case 'histogram':
        return [
          field('Values (comma-separated)', textInput(p.values ?? '12, 15, 14, 18, 19, 21, 17, 16, 22, 24', (v) => setParam('values', v))),
          field('Bins', numberInput(p.bins ?? 7, (v) => setParam('bins', v), { min: 2, max: 50, step: 1 })),
          field('X label', textInput(p.xlab ?? 'Value', (v) => setParam('xlab', v))),
          checkInput('Overlay density curve', p.density !== false, (v) => setParam('density', v)),
          colorField(),
        ];
      case 'boxplot':
        return [
          field('Group A label', textInput(p.labelA ?? 'Control', (v) => setParam('labelA', v))),
          field('Group A values', textInput(p.groupA ?? '14, 16, 15, 19, 18, 17, 21', (v) => setParam('groupA', v))),
          field('Group B label', textInput(p.labelB ?? 'Treatment', (v) => setParam('labelB', v))),
          field('Group B values', textInput(p.groupB ?? '19, 22, 24, 21, 25, 23, 27', (v) => setParam('groupB', v))),
          field('Y label', textInput(p.ylab ?? 'Score', (v) => setParam('ylab', v))),
          colorField(),
        ];
      case 'scatter':
        return [
          field('X values', textInput(p.x ?? '1, 2, 3, 4, 5, 6, 7, 8', (v) => setParam('x', v))),
          field('Y values', textInput(p.y ?? '2.1, 3.8, 6.2, 7.9, 10.4, 11.7, 14.2, 15.8', (v) => setParam('y', v))),
          field('X label', textInput(p.xlab ?? 'x', (v) => setParam('xlab', v))),
          field('Y label', textInput(p.ylab ?? 'y', (v) => setParam('ylab', v))),
          checkInput('Linear regression line', p.fit !== false, (v) => setParam('fit', v)),
          colorField(),
        ];
      default:
        return [];
    }
  }

  function panel() {
    const runBtn = button('play', 'Run in R', { primary: true });
    runBtn.onclick = runInR;
    const studioBtn = button('code', 'Open in R Studio');
    studioBtn.onclick = openInStudio;
    const actionsRow = make('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;' }, runBtn, studioBtn);

    const codeArea = make('textarea', {
      rows: model.preset === 'custom' ? 10 : 6,
      value: effectiveCode(),
      readOnly: model.preset !== 'custom',
      spellcheck: false,
      style: 'width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:6px 8px;border-radius:6px;border:1px solid var(--line,#dce0e5);background:var(--surface,#fff);color:inherit;box-sizing:border-box;resize:vertical;',
    });
    if (model.preset === 'custom') {
      codeArea.oninput = () => { trustedCustom = true; change({ rCode: codeArea.value }, false); };
    }

    const stdoutBox = model.cache?.stdout
      ? make('pre', {
          textContent: model.cache.stdout,
          style: 'margin:6px 0 0;padding:6px 8px;font-size:11px;border-radius:6px;background:var(--fill,#eef0f3);overflow:auto;max-height:110px;',
        })
      : null;

    shell.panel.replaceChildren(
      actionsRow,
      field('Preset', selectInput(Object.entries(PRESET_LABELS), model.preset, (preset) => {
        if (preset === 'custom' && !model.rCode) change({ preset, rCode: buildPresetRCode(model) }, true);
        else change({ preset }, true);
      })),
      field('Title', textInput(model.title, (title) => change({ title }, false), { placeholder: 'Figure title' })),
      ...presetFields(),
      make('h4', { textContent: 'Size' }),
      field('Width', numberInput(model.width, (width) => change({ width }, false), { min: 200, max: 1200, step: 20 })),
      field('Height', numberInput(model.height, (height) => change({ height }, false), { min: 140, max: 900, step: 20 })),
      make('details', { open: model.preset === 'custom' },
        make('summary', { textContent: model.preset === 'custom' ? 'R code' : 'Generated R code (read-only)' }),
        codeArea,
      ),
      stdoutBox,
    );
  }

  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
