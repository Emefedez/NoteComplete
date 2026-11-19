// The truth table module's editor (docs/PREFAB-MODULES-GUIDE.md): interactive logical
// conditions, visual association/relation builder (AND, OR, XOR, IMPLIES, IFF, NAND, NOR, NOT),
// multi-column intermediate sub-conditions, quick operator chips, and clickable truth table
// output cells on the canvas that synthesize canonical boolean formulas.
import { editorShell, field, textInput, selectInput, make, button } from '../kit/index.js';
import { normalize, render, evaluate, extractSubExpressions, synthesizeDnf, MAX_VARIABLES, MAX_COLUMNS } from './render.js';

const RELATIONS = [
  ['∧', '∧  AND (both true)'],
  ['∨', '∨  OR (at least one true)'],
  ['⊕', '⊕  XOR (exactly one true)'],
  ['→', '→  IMPLIES (if left then right)'],
  ['↔', '↔  IFF (equivalent / same truth)'],
  ['⊼', '⊼  NAND (not both true)'],
  ['⊽', '⊽  NOR (neither true)'],
  ['¬', '¬  NOT (negate left condition)'],
];

const QUICK_OPS = [
  ['¬', 'NOT (¬)'],
  ['∧', 'AND (∧)'],
  ['∨', 'OR (∨)'],
  ['⊕', 'XOR (⊕)'],
  ['→', 'IMPLIES (→)'],
  ['↔', 'IFF (↔)'],
  ['(', '('],
  [')', ')'],
];

const NEXT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'P', 'Q', 'R', 'S', 'X', 'Y', 'Z'];

export function open(root, { spec, editing, host }) {
  let model = normalize(spec);
  let builderLeft = model.variables[0] || 'A';
  let builderOp = '→';
  let builderRight = model.variables[1] || model.variables[0] || 'B';
  let exprInputEl = null;
  const past = [], future = [];

  const shell = editorShell(root, {
    id: 'truthtable',
    title: 'Truth table',
    applyLabel: host.applyLabel,
    onApply: () => host.done(model),
    onCancel: () => host.cancel(),
    undo: () => step(past, future),
    redo: () => step(future, past),
    help: [{ title: 'Truth table & conditions', icon: 'table', rows: [
      { icon: 'plus', does: 'Add or remove conditions (variables A, B, C / P, Q, R) or pick a preset' },
      { icon: 'settings', does: 'Association builder: pick two conditions and their relation (∧, ∨, ⊕, →, ↔, ⊼, ⊽, ¬) to set the main expression or add an intermediate column' },
      { icon: 'draw', does: 'Click any output cell directly on the table canvas to toggle its 0/1 (F/T) value and automatically synthesize the matching boolean expression' },
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

  function change(next, rebuild = false) {
    past.push(JSON.stringify(model));
    future.length = 0;
    model = normalize({ ...model, ...next });
    draw(rebuild);
  }

  function availableOperands() {
    const ops = [];
    for (const v of model.variables) {
      ops.push([v, v], [`¬${v}`, `¬${v} (not ${v})`]);
    }
    for (const ec of model.extraColumns || []) {
      const e = ec.expr?.trim();
      if (e && !ops.some(([k]) => k === `(${e})` || k === e)) {
        const wrapped = /[∧∨⊕→↔⊼⊽\s]/.test(e) ? `(${e})` : e;
        ops.push([wrapped, `${ec.label || e}`]);
      }
    }
    return ops;
  }

  function builtExpression() {
    if (builderOp === '¬') {
      const clean = builderLeft.startsWith('¬') ? builderLeft.slice(1) : `¬${builderLeft}`;
      return clean;
    }
    return `${builderLeft} ${builderOp} ${builderRight}`;
  }

  function insertIntoExpr(token) {
    const cur = model.expr || '';
    if (exprInputEl && document.activeElement === exprInputEl) {
      const a = exprInputEl.selectionStart ?? cur.length;
      const b = exprInputEl.selectionEnd ?? a;
      const padBefore = a > 0 && !/[\s(¬!~]$/.test(cur.slice(0, a)) && !/^[)']$/.test(token) ? ' ' : '';
      const padAfter = b < cur.length && !/^[\s)]/.test(cur.slice(b)) && !/^[(¬!~]$/.test(token) ? ' ' : '';
      const inserted = `${padBefore}${token}${padAfter}`;
      const next = cur.slice(0, a) + inserted + cur.slice(b);
      change({ expr: next }, false);
      exprInputEl.value = model.expr;
      const caret = a + inserted.length;
      exprInputEl.setSelectionRange(caret, caret);
      exprInputEl.focus();
      return;
    }
    const sep = cur.trim() && !/[(¬!~]$/.test(cur.trim()) && !/^[)']$/.test(token) ? ' ' : '';
    change({ expr: `${cur.trim()}${sep}${token}` }, true);
  }

  // Clicking an output cell in the SVG canvas toggles its truth value and synthesizes the DNF expression.
  shell.canvas.addEventListener('click', (event) => {
    const cell = event.target.closest?.('[data-tt-row]');
    if (!cell) return;
    const rowIdx = Number(cell.getAttribute('data-tt-row'));
    const colKey = cell.getAttribute('data-tt-col');
    if (!Number.isInteger(rowIdx)) return;
    const { rows } = evaluate(model);
    if (rowIdx < 0 || rowIdx >= rows.length) return;
    if (colKey === 'main') {
      const outs = rows.map((r) => Boolean(r.out));
      outs[rowIdx] = !outs[rowIdx];
      const nextExpr = synthesizeDnf(model.variables, outs);
      change({ expr: nextExpr, output: 'values' }, true);
      shell.say(`Row ${rowIdx + 1} toggled → synthesized expression: ${nextExpr}`);
    } else {
      const idx = Number(colKey);
      const extra = [...(model.extraColumns || [])];
      if (!extra[idx]) return;
      const outs = rows.map((r) => Boolean(r.extraOuts?.[idx]));
      outs[rowIdx] = !outs[rowIdx];
      const nextExpr = synthesizeDnf(model.variables, outs);
      extra[idx] = { ...extra[idx], expr: nextExpr, output: 'values' };
      change({ extraColumns: extra }, true);
      shell.say(`Column ${idx + 1}, row ${rowIdx + 1} toggled → ${nextExpr}`);
    }
  });

  function draw(rebuild) {
    shell.canvas.innerHTML = render(model).svg;
    shell.canvas.style.cursor = 'pointer';
    shell.history(past.length > 0, future.length > 0);
    const { error } = evaluate(model);
    shell.say(error && model.output === 'values' ? `Expression: ${error}` : 'Tip: click any output value in the table to toggle 0 ↔ 1 and update the formula', !!error);
    if (rebuild) panel();
  }

  function panel() {
    const operands = availableOperands();
    if (!operands.some(([k]) => k === builderLeft)) builderLeft = operands[0]?.[0] || 'A';
    if (!operands.some(([k]) => k === builderRight)) builderRight = operands[Math.min(2, operands.length - 1)]?.[0] || builderLeft;

    // 1. Conditions (variables) chips + presets
    const varChips = make('div', { style: 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px' });
    model.variables.forEach((v) => {
      const chip = make('span', {
        style: 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--pk-line, #d0d7de);border-radius:6px;background:var(--pk-surface, #f6f8fa);font-size:12px;font-weight:600',
      }, make('span', { textContent: v }));
      if (model.variables.length > 1) {
        const rm = make('button', {
          type: 'button',
          textContent: '×',
          title: `Remove condition ${v}`,
          style: 'border:0;background:none;color:inherit;cursor:pointer;padding:0 2px;font-size:13px;line-height:1',
          onclick: () => change({ variables: model.variables.filter((x) => x !== v) }, true),
        });
        chip.append(rm);
      }
      varChips.append(chip);
    });
    if (model.variables.length < MAX_VARIABLES) {
      const nextVar = NEXT_NAMES.find((n) => !model.variables.includes(n)) || `X${model.variables.length + 1}`;
      const addVarBtn = button('plus', `Add ${nextVar}`);
      addVarBtn.onclick = () => change({ variables: [...model.variables, nextVar] }, true);
      varChips.append(addVarBtn);
    }

    const presetRow = make('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px' });
    for (const [label, vars] of [['A, B', ['A', 'B']], ['A, B, C', ['A', 'B', 'C']], ['P, Q', ['P', 'Q']], ['P, Q, R', ['P', 'Q', 'R']]]) {
      const b = make('button', {
        type: 'button',
        className: 'pk-button',
        textContent: label,
        style: 'height:22px;padding:0 7px;font-size:11px',
        onclick: () => change({ variables: vars }, true),
      });
      presetRow.append(b);
    }

    // 2. Visual Association & Relation Builder
    const leftSelect = selectInput(operands, builderLeft, (v) => { builderLeft = v; updatePreviewChip(); });
    const opSelect = selectInput(RELATIONS, builderOp, (v) => {
      builderOp = v;
      rightSelect.disabled = v === '¬';
      updatePreviewChip();
    });
    const rightSelect = selectInput(operands, builderRight, (v) => { builderRight = v; updatePreviewChip(); });
    rightSelect.disabled = builderOp === '¬';

    const previewFormula = make('code', {
      style: 'display:block;padding:5px 8px;border-radius:6px;background:var(--pk-fill, rgba(127,127,127,0.1));font-size:12.5px;font-weight:600;text-align:center',
      textContent: builtExpression(),
    });
    function updatePreviewChip() {
      previewFormula.textContent = builtExpression();
    }

    const applyMainBtn = button('check', 'Set as main output');
    applyMainBtn.onclick = () => change({ expr: builtExpression(), output: 'values' }, true);

    const addColBtn = button('plus', 'Add as step column');
    addColBtn.onclick = () => {
      const extra = [...(model.extraColumns || [])];
      if (extra.length >= MAX_COLUMNS - 1) return;
      extra.push({ expr: builtExpression(), label: '', output: 'values' });
      change({ extraColumns: extra }, true);
    };

    const builderBox = make('div', {
      style: 'display:grid;gap:6px;padding:8px;border:1px solid var(--pk-line, #d0d7de);border-radius:8px',
    },
      field('Condition 1', leftSelect),
      field('Relation / Operation', opSelect),
      field('Condition 2', rightSelect),
      previewFormula,
      make('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, applyMainBtn, addColBtn),
    );

    // 3. Quick insert chips + Main expression
    const chipBar = make('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px' });
    for (const v of model.variables) {
      chipBar.append(make('button', {
        type: 'button',
        className: 'pk-button',
        textContent: v,
        title: `Insert ${v}`,
        style: 'height:24px;min-width:26px;padding:0 6px;font-weight:600;font-size:12px',
        onclick: () => insertIntoExpr(v),
      }));
    }
    for (const [sym, title] of QUICK_OPS) {
      chipBar.append(make('button', {
        type: 'button',
        className: 'pk-button',
        textContent: sym,
        title: `Insert ${title}`,
        style: 'height:24px;min-width:26px;padding:0 6px;font-size:12px',
        onclick: () => insertIntoExpr(sym),
      }));
    }

    exprInputEl = textInput(model.expr, (expr) => change({ expr }, false), { placeholder: '(A ∧ B) → ¬C' });

    const autoStepsBtn = button('plus', 'Auto-add sub-conditions');
    autoStepsBtn.title = 'Automatically add intermediate columns for negated variables and parenthesized groups';
    autoStepsBtn.onclick = () => {
      const subs = extractSubExpressions(model.expr, model.variables);
      if (!subs.length) {
        shell.say('Add parentheses like (A ∧ B) → ¬C or negations like ¬B to extract intermediate steps.');
        return;
      }
      const existing = new Set((model.extraColumns || []).map((c) => c.expr.trim()));
      const extra = [...(model.extraColumns || [])];
      for (const s of subs) {
        if (!existing.has(s) && extra.length < MAX_COLUMNS - 1) {
          extra.push({ expr: s, label: '', output: 'values' });
          existing.add(s);
        }
      }
      change({ extraColumns: extra }, true);
    };

    // 4. Intermediate / extra association columns list
    const extraList = make('div', { style: 'display:grid;gap:6px' });
    (model.extraColumns || []).forEach((col, idx) => {
      const row = make('div', {
        style: 'display:grid;grid-template-columns:1fr auto auto;gap:4px;align-items:center',
      },
        textInput(col.expr, (expr) => {
          const next = [...(model.extraColumns || [])];
          next[idx] = { ...next[idx], expr };
          change({ extraColumns: next }, false);
        }, { placeholder: `Step ${idx + 1} formula` }),
        selectInput([['values', 'Values'], ['blank', 'Blank']], col.output, (output) => {
          const next = [...(model.extraColumns || [])];
          next[idx] = { ...next[idx], output };
          change({ extraColumns: next }, false);
        }),
        make('button', {
          type: 'button',
          className: 'pk-button',
          textContent: '×',
          title: 'Remove column',
          style: 'height:28px;min-width:28px;padding:0',
          onclick: () => {
            const next = (model.extraColumns || []).filter((_, i) => i !== idx);
            change({ extraColumns: next }, true);
          },
        }),
      );
      extraList.append(row);
    });

    shell.panel.replaceChildren(
      field('Title', textInput(model.title, (title) => change({ title }, false))),
      make('h4', { textContent: 'Conditions (Variables)' }),
      varChips,
      presetRow,
      field('Names (comma-separated)', textInput(model.variables.join(', '), (variables) => change({ variables }, true), { placeholder: 'A, B, C' }), `Up to ${MAX_VARIABLES} conditions`),
      make('h4', { textContent: 'Association & Relation Builder' }),
      builderBox,
      make('h4', { textContent: 'Main Output Expression' }),
      chipBar,
      field('Formula', exprInputEl),
      field('Column heading', textInput(model.label, (label) => change({ label }, false), { placeholder: 'Defaults to the formula' })),
      autoStepsBtn,
      ...(model.extraColumns?.length ? [make('h4', { textContent: 'Intermediate Step Columns' }), extraList] : []),
      make('h4', { textContent: 'Display' }),
      field('Show values', selectInput([['values', 'Computed values'], ['blank', 'Empty cells (for students to fill in)'], ['none', 'Hide main output column']], model.output, (output) => change({ output }, false))),
      field('Notation', selectInput([['10', '1 and 0'], ['VF', 'V and F'], ['TF', 'T and F']], model.notation, (notation) => change({ notation }, false))),
    );
  }

  panel();
  draw(false);
  return { destroy: () => shell.destroy() };
}
