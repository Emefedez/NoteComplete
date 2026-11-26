// NoteComplete Math Mode toolbar (math/math-bar.js):
// Compact bar styled with NoteComplete's native chrome tokens (--chrome, --surface, --line, --accent).
// Offers quick LaTeX/plain formula entry with live KaTeX preview, numeric & symbolic CAS
// (= Evaluate, d/dx Derivative, ∫ Integral, Solve), 1-click Plot to Function Graph, Insert as
// Math Text Box, R Math & Statistics prefabs, and Launch/Connect R Commander Studio.
import { icon } from '../icons.js';
import { loadKatex } from '../rich-text.js';
import { evaluateMath, symbolicDerivative, numericIntegral, solveEquation, isPlottable } from './cas.js';
import { mathSettings, openMathSettings } from './settings.js';

export function createMathBar({
  container,
  onInsertMathBox,
  onPlotFunction,
  onInsertRPrefab,
  onInsertPrefabId,
  status = () => {},
} = {}) {
  if (!container) return { sync: () => {}, toggle: () => {}, openSettings: () => {} };

  container.innerHTML = `
    <div class="math-bar-row">
      <span class="math-bar-badge" title="Math Mode active (Ctrl+Shift+M)">∑ Math</span>
      <input type="text" class="math-bar-input" placeholder="Formula or LaTeX: x^3 - 3x, \\sin(\\pi/6), 2x^2 - 8 = 0…" spellcheck="false" autocomplete="off" aria-label="Math expression" />
      <div class="math-bar-preview" aria-live="polite" role="button" tabindex="0" title="Click to copy formula to clipboard"></div>
      <div class="math-bar-actions" role="group" aria-label="Math actions">
        <button type="button" data-ma="eval" title="Evaluate numeric expression"><b>=</b></button>
        <button type="button" data-ma="diff" title="Symbolic derivative d/dx">d/dx</button>
        <button type="button" data-ma="int" title="Definite integral ∫ₐᵇ f(x) dx">∫</button>
        <button type="button" data-ma="solve" title="Solve equation (= 0)">Solve</button>
        <span class="math-bar-sep"></span>
        <button type="button" data-ma="plot" title="Plot as Function Graph prefab">Plot</button>
        <button type="button" data-ma="insert" class="primary math-icon-btn" aria-label="Insert Math Text Box" title="Insert formula (or result) as a Math Text Box on the page"></button>
        <span class="math-bar-sep"></span>
        <button type="button" data-ma="r-prefab" class="math-icon-btn" aria-label="Insert R Plot" title="Insert R Math &amp; Statistics figure (Normal, t, Chi-squared, Histogram, Boxplot, Scatter, Custom R)"></button>
        <button type="button" data-ma="r-studio" class="math-icon-btn" aria-label="Open R Commander Studio" title="Open R Commander Studio"></button>
        <button type="button" data-ma="settings" aria-label="Math Mode &amp; R Bridge settings" title="Math Mode &amp; R Bridge settings"></button>
        <button type="button" data-ma="close" aria-label="Hide Math Mode bar" title="Hide Math Mode bar (Ctrl+Shift+M)"></button>
      </div>
    </div>
    <div class="math-bar-int" hidden>
      <span>∫ from</span>
      <input type="number" class="math-int-a" value="0" step="any" aria-label="Lower bound" />
      <span>to</span>
      <input type="number" class="math-int-b" value="1" step="any" aria-label="Upper bound" />
      <button type="button" class="primary" data-ma="int-go">Compute</button>
      <button type="button" data-ma="int-cancel">Cancel</button>
    </div>
  `;

  const input = container.querySelector('.math-bar-input');
  const preview = container.querySelector('.math-bar-preview');
  const intRow = container.querySelector('.math-bar-int');
  const intA = container.querySelector('.math-int-a');
  const intB = container.querySelector('.math-int-b');
  container.querySelector('[data-ma="insert"]').append(icon('mathBox'));
  container.querySelector('[data-ma="r-prefab"]').append(icon('rplot'));
  container.querySelector('[data-ma="r-studio"]').append(icon('rstudio'));
  container.querySelector('[data-ma="settings"]').append(icon('settings'));
  container.querySelector('[data-ma="close"]').append(icon('close'));

  let lastResultLatex = '';
  let lastPreviewLatex = '';
  let katexMod = null;

  async function copyPreview() {
    const tex = (lastPreviewLatex || lastResultLatex || input.value.trim()).trim();
    if (!tex || preview.classList.contains('is-error')) return;
    try {
      await navigator.clipboard.writeText(tex);
      preview.classList.add('copied');
      setTimeout(() => preview.classList.remove('copied'), 900);
      status(`Copied to clipboard: ${tex}`);
    } catch {
      status('Could not copy to clipboard.', true);
    }
  }
  preview.addEventListener('click', copyPreview);
  preview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyPreview(); }
  });

  async function renderPreview(latex, note = '', isError = false) {
    preview.classList.toggle('is-error', isError);
    lastPreviewLatex = isError ? '' : String(latex || '').trim();
    if (!latex && !note) {
      preview.textContent = '';
      return;
    }
    if (isError) {
      preview.textContent = note || latex;
      return;
    }
    try {
      katexMod ||= await loadKatex();
      preview.innerHTML = katexMod.renderToString(latex, { throwOnError: false, displayMode: false })
        + (note ? `<span class="math-bar-note">${note}</span>` : '');
    } catch {
      preview.textContent = note ? `${latex} ${note}` : latex;
    }
  }

  function liveUpdate() {
    const raw = input.value.trim();
    lastResultLatex = '';
    if (!raw) {
      renderPreview('');
      return;
    }
    const cfg = mathSettings();
    if (cfg.autoEval && !raw.includes('=')) {
      try {
        const res = evaluateMath(raw, { angleUnit: cfg.angleUnit, precision: cfg.precision });
        lastResultLatex = `${raw} = ${res.latex}`;
        renderPreview(lastResultLatex);
        return;
      } catch { /* Expression may contain x; render raw LaTeX cleanly. */ }
    }
    renderPreview(raw);
  }

  input.addEventListener('input', liveUpdate);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      container.querySelector('[data-ma="eval"]').click();
    }
  });

  container.querySelector('[data-ma="eval"]').onclick = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const cfg = mathSettings();
    try {
      const res = evaluateMath(raw, { angleUnit: cfg.angleUnit, precision: cfg.precision });
      lastResultLatex = `${raw} = ${res.latex}`;
      renderPreview(lastResultLatex);
    } catch (e) {
      renderPreview('', e.message, true);
    }
  };

  container.querySelector('[data-ma="diff"]').onclick = () => {
    const raw = input.value.trim();
    if (!raw) return;
    try {
      const res = symbolicDerivative(raw, 'x');
      lastResultLatex = `\\frac{d}{dx}\\left(${raw.replace(/^\s*(?:y|f\(x\))\s*=\s*/i, '')}\\right) = ${res.latex}`;
      renderPreview(lastResultLatex);
    } catch (e) {
      renderPreview('', e.message, true);
    }
  };

  container.querySelector('[data-ma="int"]').onclick = () => {
    intRow.hidden = !intRow.hidden;
    if (!intRow.hidden) intA.focus();
  };
  container.querySelector('[data-ma="int-cancel"]').onclick = () => { intRow.hidden = true; };
  container.querySelector('[data-ma="int-go"]').onclick = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const cfg = mathSettings();
    try {
      const res = numericIntegral(raw, intA.value, intB.value, { angleUnit: cfg.angleUnit, precision: cfg.precision });
      lastResultLatex = `\\int_{${intA.value}}^{${intB.value}} ${raw.replace(/^\s*(?:y|f\(x\))\s*=\s*/i, '')}\\,dx \\approx ${res.latex}`;
      renderPreview(lastResultLatex);
      intRow.hidden = true;
    } catch (e) {
      renderPreview('', e.message, true);
    }
  };

  container.querySelector('[data-ma="solve"]').onclick = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const cfg = mathSettings();
    try {
      const res = solveEquation(raw, { angleUnit: cfg.angleUnit, precision: cfg.precision });
      lastResultLatex = res.latex;
      renderPreview(lastResultLatex);
    } catch (e) {
      renderPreview('', e.message, true);
    }
  };

  container.querySelector('[data-ma="plot"]').onclick = () => {
    const raw = input.value.trim();
    if (raw && !isPlottable(raw)) {
      renderPreview('', 'Plot expects an expression in x (e.g. x^2 - 1 or sin(x)).', true);
      return;
    }
    onPlotFunction?.(raw || 'x^2');
  };

  container.querySelector('[data-ma="insert"]').onclick = () => {
    const tex = (lastResultLatex || input.value.trim());
    if (!tex) {
      status('Type a formula in the Math bar first.');
      input.focus();
      return;
    }
    onInsertMathBox?.(tex);
  };

  container.querySelector('[data-ma="r-prefab"]').onclick = () => {
    onInsertRPrefab?.();
  };

  container.querySelector('[data-ma="r-studio"]').onclick = async () => {
    if (!window.notecompleteRBridge) {
      openMathSettings({ tab: 'rbridge', status, onInsertRPrefab });
      return;
    }
    const raw = input.value.trim();
    const res = await window.notecompleteRBridge.openInStudio({
      title: 'NoteComplete_Math.R',
      code: raw ? `# From NoteComplete Math Mode: ${raw}\n` : '# Connected from NoteComplete Math Mode\n',
      kind: 'r',
    });
    if (res?.ok) status(res.connected ? 'Opened in R Commander Studio.' : 'Launching R Commander Studio…');
    else openMathSettings({ tab: 'rbridge', status, onInsertRPrefab });
  };

  container.querySelector('[data-ma="settings"]').onclick = () => {
    openMathSettings({ tab: 'math', status, onInsertRPrefab });
  };
  container.querySelector('[data-ma="close"]').onclick = () => {
    mathSettings({ enabled: false });
  };

  function sync() {
    const s = mathSettings();
    container.hidden = !s.enabled;
    const pill = document.getElementById('mathModePill');
    const menuItem = document.getElementById('viewMathMode');
    if (pill) pill.setAttribute('aria-pressed', String(s.enabled));
    if (menuItem) menuItem.setAttribute('aria-checked', String(s.enabled));
  }

  function toggle() {
    const next = !mathSettings().enabled;
    mathSettings({ enabled: next });
    if (next) requestAnimationFrame(() => input.focus());
  }

  globalThis.addEventListener?.('math-settings', sync);
  sync();
  return {
    sync,
    toggle,
    openSettings: (tab = 'math') => openMathSettings({ tab, status, onInsertRPrefab }),
    insertPrefabId: (id) => onInsertPrefabId?.(id),
  };
}
