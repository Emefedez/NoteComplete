// Settings → Math Mode & R Bridge (localStorage "notecomplete-math-<name>").
// Styled identically to Chinese settings (chinese/settings.js) using NoteComplete's design tokens.
import { icon } from '../icons.js';
import { rOpenWith, setROpenWith } from '../open-with-pref.js';

export const MATH_DEFAULTS = Object.freeze({
  enabled: false,         // Show Math Mode bar & quick tools (Ctrl+Shift+M)
  angleUnit: 'rad',       // rad | deg
  precision: 6,           // 2..10 significant digits
  autoEval: true,         // Show live numeric result while typing in Math Mode bar
  rAutoFallback: true,    // Use local Rscript when R Commander Studio is not running
  studioOpenMode: 'window', // window | embedded
});

const KEY = (k) => `notecomplete-math-${k}`;
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function mathSettings(patch = null) {
  const ls = store();
  if (patch && ls) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in MATH_DEFAULTS)) continue;
      let val = v;
      if (k === 'angleUnit') val = v === 'deg' ? 'deg' : 'rad';
      else if (k === 'studioOpenMode') val = v === 'embedded' ? 'embedded' : 'window';
      else if (k === 'precision') val = Math.max(2, Math.min(10, Number(v) || 6));
      else val = Boolean(v);
      try { ls.setItem(KEY(k), JSON.stringify(val)); } catch { /* Storage full or blocked. */ }
    }
    globalThis.dispatchEvent?.(new CustomEvent('math-settings', { detail: mathSettings() }));
  }
  const out = { ...MATH_DEFAULTS };
  if (ls) {
    for (const k of Object.keys(MATH_DEFAULTS)) {
      try {
        const raw = ls.getItem(KEY(k));
        if (raw != null) out[k] = JSON.parse(raw);
      } catch { /* Keep default. */ }
    }
  }
  out.angleUnit = out.angleUnit === 'deg' ? 'deg' : 'rad';
  out.studioOpenMode = out.studioOpenMode === 'embedded' ? 'embedded' : 'window';
  out.precision = Math.max(2, Math.min(10, Number(out.precision) || 6));
  return out;
}

let dialog = null;

export function openMathSettings({ tab = 'math', status = () => {}, onInsertRPrefab = null } = {}) {
  if (!dialog) dialog = build({ status, onInsertRPrefab });
  fill();
  const tabBtn = dialog.querySelector(`[data-math-tab="${tab}"]`) || dialog.querySelector('[data-math-tab="math"]');
  tabBtn?.click();
  if (!dialog.open) dialog.showModal();
  refreshBridgeStatus();
}

function build({ status, onInsertRPrefab }) {
  const d = document.createElement('dialog');
  d.className = 'ocr-dialog zh-settings math-settings';
  d.setAttribute('aria-labelledby', 'mathSettingsTitle');
  d.innerHTML = `<div class="math-rc-head">
    <div class="math-rc-title-row">
      <h2 id="mathSettingsTitle">Math Mode &amp; R Bridge</h2>
      <button type="button" class="math-rc-close" data-close-x aria-label="Close" title="Close"></button>
    </div>
    <div class="math-rc-tabs" role="tablist" aria-label="Math settings sections">
      <button type="button" role="tab" data-math-tab="math" aria-selected="true">Math &amp; CAS</button>
      <button type="button" role="tab" data-math-tab="rbridge" aria-selected="false">R &amp; Studio Bridge</button>
    </div>
  </div>
  <div class="zh-settings-panel" data-math-panel="math">
    <label class="zh-set-row zh-set-check"><input type="checkbox" data-ms="enabled"> <span>Show Math Mode bar (quick formula composer, CAS evaluate/d/dx/solve &amp; R figures · Ctrl+Shift+M)</span></label>
    <div class="math-rc-grid">
      <label class="zh-set-row"><span>Angle unit</span><select data-ms="angleUnit"><option value="rad">Radians (rad)</option><option value="deg">Degrees (deg)</option></select></label>
      <label class="zh-set-row"><span>Numeric precision</span><select data-ms="precision"><option value="4">4 digits</option><option value="6">6 digits</option><option value="8">8 digits</option><option value="10">10 digits</option></select></label>
    </div>
    <label class="zh-set-row zh-set-check"><input type="checkbox" data-ms="autoEval"> <span>Auto-evaluate numeric expressions live in the Math Mode bar</span></label>
  </div>
  <div class="zh-settings-panel" data-math-panel="rbridge" hidden>
    <div class="math-bridge-card">
      <div class="math-bridge-status-row">
        <span class="math-bridge-dot" data-rb-dot></span>
        <strong data-rb-label>Checking R environment…</strong>
        <span class="spacer"></span>
        <button type="button" class="math-rc-btn" data-rb-refresh>Refresh</button>
      </div>
      <p class="muted math-bridge-detail" data-rb-detail></p>
      <div class="math-bridge-pkgs" data-rb-pkgs></div>
      <div class="math-bridge-actions">
        <button type="button" class="math-rc-btn primary" data-rb-test>Test SVG Render</button>
        <button type="button" class="math-rc-btn" data-rb-studio>Launch R Commander Studio</button>
        <button type="button" class="math-rc-btn primary" data-rb-install hidden>Install R Commander Studio</button>
        <button type="button" class="math-rc-btn" data-rb-insert>Insert R Figure…</button>
        <button type="button" class="math-rc-btn" data-rb-copy-install>Copy R Install Cmd</button>
      </div>
      <progress data-rb-install-prog max="1" value="0" hidden style="width:100%;margin-top:8px;"></progress>
      <div class="math-bridge-preview" data-rb-preview hidden></div>
    </div>
    <label class="zh-set-row" style="margin-top:10px;"><span>Open R scripts (.R, .Rmd, .qmd) with</span><select data-ms-r-open><option value="text">Text view (NoteComplete)</option><option value="r-studio">R Commander Studio</option><option value="ask">Ask each time</option></select></label>
    <label class="zh-set-row zh-set-check" style="margin-top:8px;"><input type="checkbox" data-ms="rAutoFallback"> <span>Use local Rscript fallback when R Commander Studio is not running</span></label>
    <p class="muted math-rc-footnote">Security: NoteComplete never executes R code automatically when opening a note. Cached vector SVGs render offline on every device; R runs only when you explicitly click Run / Update.</p>
  </div>
  <div class="ocr-actions math-rc-foot"><button type="button" class="math-rc-btn primary" data-close>Done</button></div>`;

  const closeBtn = d.querySelector('[data-close]');
  closeBtn.onclick = () => d.close();
  const closeX = d.querySelector('[data-close-x]');
  if (closeX) { closeX.append(icon('close')); closeX.onclick = () => d.close(); }
  d.addEventListener('keydown', (e) => e.stopPropagation());

  for (const btn of d.querySelectorAll('[data-math-tab]')) {
    btn.onclick = () => {
      const target = btn.dataset.mathTab;
      for (const b of d.querySelectorAll('[data-math-tab]')) b.setAttribute('aria-selected', String(b === btn));
      for (const p of d.querySelectorAll('[data-math-panel]')) p.hidden = p.dataset.mathPanel !== target;
      if (target === 'rbridge') refreshBridgeStatus();
    };
  }

  for (const input of d.querySelectorAll('[data-ms]')) {
    input.onchange = () => {
      const key = input.dataset.ms;
      const val = input.type === 'checkbox' ? input.checked : input.value;
      mathSettings({ [key]: val });
    };
  }
  const rOpenSel = d.querySelector('[data-ms-r-open]');
  if (rOpenSel) {
    rOpenSel.value = rOpenWith();
    rOpenSel.onchange = () => setROpenWith(rOpenSel.value);
  }

  d.querySelector('[data-rb-refresh]').onclick = () => refreshBridgeStatus();
  d.querySelector('[data-rb-copy-install]').onclick = async () => {
    const cmd = 'install.packages(c("svglite", "ggplot2", "RcmdrMisc", "car", "rmarkdown", "knitr", "languageserver"), repos = "https://cloud.r-project.org")';
    try {
      await navigator.clipboard.writeText(cmd);
      status('Copied R package install command to clipboard.');
    } catch {
      status(cmd);
    }
  };
  d.querySelector('[data-rb-studio]').onclick = async () => {
    if (!window.notecompleteRBridge) return status('R Bridge is available in the desktop app.', true);
    const res = await window.notecompleteRBridge.openInStudio({ title: 'NoteComplete.R', code: '# Connected from NoteComplete\ncurve(dnorm(x), -3, 3, main = "Standard Normal")\n' });
    if (res?.ok) {
      status(res.connected ? 'Opened in R Commander Studio.' : 'Launching R Commander Studio…');
      setTimeout(refreshBridgeStatus, 1800);
    } else {
      status(res?.error || 'Could not launch R Commander Studio.', true);
    }
  };
  d.querySelector('[data-rb-install]').onclick = async () => {
    if (!window.notecompleteRBridge?.installStudio) return;
    const btn = d.querySelector('[data-rb-install]');
    const prog = d.querySelector('[data-rb-install-prog]');
    const detail = d.querySelector('[data-rb-detail]');
    btn.disabled = true;
    prog.hidden = false;
    prog.removeAttribute('value');
    try {
      const res = await window.notecompleteRBridge.installStudio((p) => {
        if (p?.total > 0) prog.value = Math.min(1, p.received / p.total);
        detail.textContent = p?.phase === 'downloading'
          ? `Downloading ${p.name || 'R Commander Studio'}… ${p.total ? `${Math.round((p.received / p.total) * 100)}%` : ''}`
          : p?.phase === 'verifying' ? 'Verifying SHA-256 checksum…'
          : p?.phase === 'installing' ? 'Installing R Commander Studio…'
          : 'Checking latest release…';
      });
      if (res?.ok) {
        status(`Installed R Commander Studio (${res.platform}).`);
        await refreshBridgeStatus();
      } else {
        status(res?.error || 'Could not install R Commander Studio.', true);
      }
    } catch (e) {
      status(e.message, true);
    } finally {
      btn.disabled = false;
      prog.hidden = true;
    }
  };
  d.querySelector('[data-rb-insert]').onclick = () => {
    d.close();
    onInsertRPrefab?.();
  };
  d.querySelector('[data-rb-test]').onclick = async () => {
    const preview = d.querySelector('[data-rb-preview]');
    if (!window.notecompleteRBridge) {
      preview.hidden = false;
      preview.textContent = 'Desktop app required for live R execution (Web/Mobile renders cached SVG snapshots).';
      return;
    }
    preview.hidden = false;
    preview.textContent = 'Running test plot in R…';
    try {
      const res = await window.notecompleteRBridge.evalFigure({
        rCode: 'par(mar=c(3.5,3.5,2.2,1)); x <- seq(-3,3,length=200); y <- dnorm(x); plot(x, y, type="l", lwd=2, col="#245dc4", main="Normal(0, 1) — Self-Test", xlab="z", ylab="Density"); sx <- seq(-1.96, 1.96, length=100); polygon(c(-1.96, sx, 1.96), c(0, dnorm(sx), 0), col=rgb(36,93,196,45,maxColorValue=255), border=NA)',
        width: 420,
        height: 240,
      });
      if (res?.ok && res.svg) {
        const { sanitizeRPlotSvg } = await import('../prefabs/r-math/render.js');
        preview.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:4px;">Rendered via <b>${res.backend}</b> in ${res.elapsedMs ?? 0} ms</div>${sanitizeRPlotSvg(res.svg)}`;
      } else {
        preview.textContent = res?.error || 'Self-test failed.';
      }
    } catch (e) {
      preview.textContent = `Error: ${e.message}`;
    }
  };

  const head = d.querySelector('.math-rc-head');
  if (head) head.querySelector('h2').prepend(icon('rstudio'));
  d.querySelector('[data-rb-refresh]')?.prepend(icon('restart'));
  d.querySelector('[data-rb-studio]')?.prepend(icon('rstudio'));
  d.querySelector('[data-rb-insert]')?.prepend(icon('rplot'));
  d.querySelector('[data-rb-copy-install]')?.prepend(icon('copy'));
  document.body.append(d);
  return d;
}

function fill() {
  if (!dialog) return;
  const s = mathSettings();
  for (const input of dialog.querySelectorAll('[data-ms]')) {
    const k = input.dataset.ms;
    if (input.type === 'checkbox') input.checked = Boolean(s[k]);
    else input.value = String(s[k]);
  }
}

async function refreshBridgeStatus() {
  if (!dialog) return;
  const dot = dialog.querySelector('[data-rb-dot]');
  const label = dialog.querySelector('[data-rb-label]');
  const detail = dialog.querySelector('[data-rb-detail]');
  const pkgsEl = dialog.querySelector('[data-rb-pkgs]');
  if (!window.notecompleteRBridge) {
    dot.dataset.state = 'offline';
    label.textContent = 'Offline Preview Mode (Browser / Mobile)';
    detail.textContent = 'Cached R vector plots display at full resolution. Use NoteComplete Desktop to run live R figures.';
    pkgsEl.replaceChildren();
    return;
  }
  label.textContent = 'Checking R environment…';
  try {
    const st = await window.notecompleteRBridge.status();
    const installBtn = dialog.querySelector('[data-rb-install]');
    if (installBtn) {
      const canInstall = !st.studioInstalled && !st.studioConnected && Boolean(st.platformSupport?.supported);
      installBtn.hidden = !canInstall;
      if (canInstall) installBtn.textContent = `Install Studio (${st.platformSupport.label})`;
    }
    dot.dataset.state = st.mode;
    if (st.mode === 'studio') {
      label.textContent = `R Commander Studio Connected (v${st.studioVersion || '0.1.0'})`;
      detail.textContent = `${st.rVersion || 'R'} · ${st.datasets?.length || 0} active dataset(s) · Live bridge on 127.0.0.1`;
    } else if (st.mode === 'rscript') {
      label.textContent = 'Local Rscript Ready (Headless Fallback)';
      detail.textContent = `${st.rVersion || 'R'} at ${st.rPath || 'Rscript'}${st.arfAvailable ? ' · arf detected' : ''}`;
    } else {
      label.textContent = 'R Not Found (Offline Preview Only)';
      detail.textContent = 'Install R (Rscript) or launch R Commander Studio to render live statistical figures.';
    }
    const chips = Object.entries(st.packages || {}).map(([name, ok]) => {
      const span = document.createElement('span');
      span.className = `math-pkg-chip ${ok ? 'ok' : 'missing'}`;
      span.textContent = `${ok ? '✓' : '○'} ${name}`;
      return span;
    });
    pkgsEl.replaceChildren(...chips);
  } catch (e) {
    dot.dataset.state = 'offline';
    label.textContent = 'R Bridge Unavailable';
    detail.textContent = e.message;
  }
}
