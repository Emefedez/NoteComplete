// The setup wizard's Modules step: the one place for optional features, one card each with
// its icon, a one-line summary, its state and one action. Two kinds share the registry:
//   kind 'feature': built in, turned on or off (toggle): status() → { state: 'on' | 'off' },
//     setEnabled(on) turns it on or off through the feature's own settings.
//   kind 'install': installs separately: status() resolves to { state, version?, detail?, action? }:
//     'installed'   ready (version when known); action 'Open' or 'Update' when it has one,
//     'missing'     can be installed here; action 'Install' (or 'Connect'),
//     'unavailable' not on this device (detail says why),
//     'desktop'     needs the desktop app (the website),
//     'soon'        not released yet,
//     'error'       the check failed (detail).
//     install(onProgress, status) runs the action; onProgress({ text, fraction? }) reports how
//     it goes (fraction 0–1, or none while the length is unknown); it resolves to { ok, text }.
// Every card may have `settings(el, ui)`: its few settings, drawn inside the card when it is
// on or installed (or always, with `settingsAlways`), with the wizard's controls (`ui`), and
// `children`: smaller cards inside it (R Commander Studio inside Math & R).
// Later modules add one entry with registerModule(); Euro-Office (Sprint 6) fills in its
// status() and install().
import { mathSettings } from './math/settings.js';
import { zhSettings, zhEverUsed, setZhEverUsed } from './chinese/settings.js';
import { OFFICE_KINDS, openWithPrefs, setOpenWith } from './open-with-pref.js';

const registry = new Map();

export function registerModule(module) {
  if (!module?.id || typeof module.status !== 'function') throw Error('A module needs an id and status().');
  registry.set(module.id, module);
  return module;
}
export const moduleList = () => [...registry.values()];
export const NEEDS_DESKTOP = 'Needs the desktop app';

// ---- R Commander Studio (desktop r-bridge.js through notecompleteRBridge) ----

// The card's state from notecompleteRBridge.status(): see r-bridge.js status().
export function rStudioState(status, { bridge = true } = {}) {
  if (!bridge) return { state: 'desktop', detail: NEEDS_DESKTOP };
  if (!status) return { state: 'error', detail: 'Could not check for R Commander Studio.' };
  const r = !status.rAvailable ? 'R not found: install R to run it' : status.rVersion ? `R ${status.rVersion} found` : 'R found';
  if (status.studioInstalled || status.studioConnected) {
    return { state: 'installed', version: status.studioVersion || '', detail: status.studioConnected ? `Running · ${r}` : r, action: 'Open' };
  }
  if (status.platformSupport && status.platformSupport.supported === false) {
    return { state: 'unavailable', detail: `Not available on this device (${status.platformSupport.label || 'this system'})` };
  }
  return { state: 'missing', detail: r, action: 'Install' };
}

// installStudio's progress ({ phase, received, total, name }) as the card shows it.
export function rStudioProgress(p = {}) {
  const fraction = p.total > 0 ? Math.min(1, p.received / p.total) : undefined;
  if (p.phase === 'downloading') return { text: `Downloading ${p.name || 'R Commander Studio'}${fraction === undefined ? '' : ` ${Math.round(fraction * 100)}%`}`, fraction };
  if (p.phase === 'verifying') return { text: 'Checking the download', fraction };
  if (p.phase === 'installing') return { text: 'Installing', fraction };
  return { text: 'Looking for the latest release' };
}

export function rStudioModule(bridge = globalThis.notecompleteRBridge) {
  return {
    id: 'r-studio', kind: 'install',
    icon: './r-commander-studio.svg',
    name: 'R Commander Studio',
    summary: 'R statistics and graphs in a friendly editor',
    async status() {
      if (!bridge) return rStudioState(null, { bridge: false });
      try { return rStudioState(await bridge.status()); } catch (e) { return { state: 'error', detail: e.message }; }
    },
    async install(onProgress = () => {}, current = {}) {
      if (current.action === 'Open') {
        const res = await bridge.openInStudio({ title: '' });
        if (!res?.ok) throw Error(res?.error || 'Could not open R Commander Studio.');
        return { ok: true, text: res.connected ? 'Opened' : 'Starting R Commander Studio' };
      }
      const res = await bridge.installStudio((p) => onProgress(rStudioProgress(p)));
      if (!res?.ok) throw Error(res?.error || 'Could not install R Commander Studio.');
      return { ok: true, text: res.openedInstaller ? 'The installer is open: finish it there' : `Installed${res.version ? ` ${res.version}` : ''}` };
    },
  };
}

// ---- Math & R (math/settings.js; R Commander Studio inside it) ----

export function mathModule({ rBridge = globalThis.notecompleteRBridge } = {}) {
  return {
    id: 'math', kind: 'feature',
    icon: 'math',
    name: 'Math & R',
    summary: 'Calculator bar, formulas and R statistics in your notes',
    status: async () => ({ state: mathSettings().enabled ? 'on' : 'off' }),
    setEnabled: (on) => { mathSettings({ enabled: on === true }); },
    settings(el, ui) {
      const m = mathSettings();
      el.append(
        ui.row('Angles', ui.segmented('Angle unit', [{ value: 'rad', label: 'Radians' }, { value: 'deg', label: 'Degrees' }], m.angleUnit, (v) => mathSettings({ angleUnit: v }))),
        ui.row('Precision', ui.segmented('Precision', [4, 6, 8, 10].map((n) => ({ value: n, label: `${n} digits` })), m.precision, (v) => mathSettings({ precision: v }))),
        ui.toggle({ get: () => mathSettings().rAutoFallback, set: (on) => mathSettings({ rAutoFallback: on }) }, 'Use R on this computer when R Commander Studio is not running'));
    },
    children: [rStudioModule(rBridge)],
  };
}

// ---- Office suite (Euro-Office: desktop office-bridge.js through notecompleteOffice) ----

export const OFFICE_NAMES = { documents: ['Documents', '.docx, .odt, .rtf'], spreadsheets: ['Spreadsheets', '.xlsx, .ods, .csv'], presentations: ['Presentations', '.pptx, .odp'] };

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1e9) return `~${(bytes / 1e9).toFixed(1)} GB`;
  return `~${Math.round(bytes / 1e6)} MB`;
}

// The card's state from notecompleteOffice.status(): see office-bridge.js status().
export function euroOfficeState(status, { bridge = true } = {}) {
  if (!bridge) return { state: 'desktop', detail: NEEDS_DESKTOP };
  if (!status) return { state: 'error', detail: 'Could not check Euro-Office.' };
  const meta = {
    version: status.version || '',
    tag: status.tag || '',
    licence: status.licence || 'AGPL-3.0-only; illustrations and icons CC BY-SA 4.0',
    notice: status.notice || '',
    sourceUrl: status.sourceUrl || '',
    downloadBytes: status.downloadBytes || 0,
    diskBytes: status.diskBytes || 0,
    runner: status.runner || '',
    formats: status.formats || null,
  };
  if (status.installed) {
    return { ...meta, state: 'installed', detail: status.detail || 'Ready', canRemove: true };
  }
  if (status.state === 'unavailable') {
    return { ...meta, state: 'unavailable', detail: status.detail || 'Not available on this device' };
  }
  const dl = formatSize(status.downloadBytes) || '~1 GB';
  const disk = formatSize(status.diskBytes) || '~3.2 GB';
  const extra = status.detail && !/^Built-in|^Using /.test(status.detail) ? ` · ${status.detail}` : '';
  return {
    ...meta,
    state: 'missing',
    detail: `Download ${dl} (${disk} on disk)${extra}`,
    action: 'Install',
  };
}

export function euroOfficeProgress(p = {}) {
  const fraction = Number.isFinite(p.fraction) ? Math.max(0, Math.min(1, p.fraction)) : (p.total > 0 ? Math.min(1, p.received / p.total) : undefined);
  if (p.text) return { text: p.text, fraction };
  if (p.phase === 'downloading') return { text: `Downloading Euro-Office${fraction === undefined ? '' : ` ${Math.round(fraction * 100)}%`}`, fraction };
  if (p.phase === 'verifying') return { text: 'Verifying download', fraction };
  if (p.phase === 'unpacking') return { text: 'Unpacking Euro-Office', fraction };
  if (p.phase === 'enabling') return { text: 'Enabling WSL2', fraction };
  return { text: 'Preparing Euro-Office', fraction };
}

export function euroOfficeModule({ storage = globalThis.localStorage, bridge = globalThis.notecompleteOffice } = {}) {
  const module = {
    id: 'euro-office', kind: 'install',
    icon: 'office',
    name: 'Office suite (Euro-Office)',
    summary: 'Edit Word, Excel and PowerPoint files',
    async status() {
      if (!bridge) return euroOfficeState(null, { bridge: false });
      try { return euroOfficeState(await bridge.status()); } catch (e) { return { state: 'error', detail: e.message }; }
    },
    async install(onProgress = () => {}) {
      if (!bridge?.install) throw Error('Installing Euro-Office needs the desktop app.');
      const res = await bridge.install((p) => onProgress(euroOfficeProgress(p)));
      if (!res?.ok) {
        if (res?.rebootNeeded) return { ok: false, text: res.text || 'Restart Windows, then click Install again.' };
        throw Error(res?.error || 'Could not install Euro-Office.');
      }
      return { ok: true, text: `Installed Euro-Office${res.version ? ` ${res.version}` : ''}` };
    },
    async uninstall() {
      if (!bridge?.uninstall) throw Error('Removing Euro-Office needs the desktop app.');
      const res = await bridge.uninstall();
      if (!res?.ok) throw Error(res?.error || 'Could not remove Euro-Office.');
      return { ok: true, text: 'Euro-Office removed' };
    },
    // The default way to open each kind, wanted before Euro-Office is installed too (Text view or
    // Ask each time): drawn always. Euro-Office is offered once it is installed.
    settingsAlways: true,
    settings(el, ui, status = {}) {
      const prefs = openWithPrefs(storage), installed = status.state === 'installed';
      el.append(ui.hint('Open by default with:'));
      for (const kind of OFFICE_KINDS) {
        el.append(ui.row(OFFICE_NAMES[kind][0], ui.segmented(OFFICE_NAMES[kind][0], [
          { value: 'text', label: 'Text view', title: 'Read in NoteComplete, as text and tables' },
          { value: 'euro-office', label: 'Euro-Office', disabled: !installed, title: installed ? '' : 'Once Euro-Office is installed' },
          { value: 'ask', label: 'Ask each time' },
        ], prefs[kind], (v) => setOpenWith(kind, v, storage)), OFFICE_NAMES[kind][1]));
      }
      if (status.licence || status.sourceUrl || status.notice) {
        const doc = el.ownerDocument;
        const info = doc.createElement('div');
        info.className = 'wizard-office-licence';
        const line = doc.createElement('p');
        line.className = 'wizard-hint';
        line.textContent = `${status.tag ? `Euro-Office ${status.tag} · ` : ''}${status.licence || ''}`;
        if (status.sourceUrl) {
          line.append(' · ');
          const link = doc.createElement('a');
          link.href = status.sourceUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Source code';
          line.append(link);
        }
        info.append(line);
        if (status.notice) {
          const details = doc.createElement('details');
          details.className = 'wizard-office-notice';
          const summary = doc.createElement('summary');
          summary.textContent = 'Licence & NOTICE';
          const pre = doc.createElement('pre');
          pre.className = 'wizard-mono';
          pre.textContent = status.notice;
          details.append(summary, pre);
          info.append(details);
        }
        el.append(info);
      }
    },
  };
  return module;
}

// ---- Chinese (chinese/settings.js) ----

export function chineseModule() {
  return {
    id: 'chinese', kind: 'feature',
    icon: 'language',
    name: 'Chinese',
    summary: 'Type Chinese with pinyin, with Pinyin over characters and a dictionary',
    // On: every text field gets its small 中 button to switch it to Chinese.
    status: async () => ({ state: zhEverUsed() || zhSettings().mode !== 'off' ? 'on' : 'off' }),
    setEnabled: (on) => { setZhEverUsed(on === true); if (!on) zhSettings({ mode: 'off' }); },
    settings(el, ui) {
      const z = zhSettings();
      el.append(
        ui.row('New fields', ui.segmented('New fields start in', [{ value: 'off', label: 'Latin letters' }, { value: 'hanzi', label: 'Chinese' }], z.mode, (v) => zhSettings({ mode: v }))),
        ui.row('Characters', ui.segmented('Script', [{ value: 'simplified', label: 'Simplified' }, { value: 'traditional', label: 'Traditional' }], z.script, (v) => zhSettings({ script: v }))),
        ui.hint('Ctrl Shift Space switches a field. Dictionaries and more: View ▸ Chinese input….'));
    },
  };
}

// ---- AI tools connection (desktop agent-setup.js through notecompleteAgents) ----

// The tools that would be connected by one press: installed (OpenCode only needs its config
// file), and not connected to this app's server yet.
export const toolsToConnect = (tools = []) => tools.filter((t) => !t.connected && (t.installed || t.elsewhere));

// The card's state from notecompleteAgents.status(): { server, tools: [{ id, label, installed,
// connected, elsewhere }] } (agent-setup.js status()).
export function agentsState(result, { bridge = true } = {}) {
  if (!bridge) return { state: 'desktop', detail: NEEDS_DESKTOP };
  if (!result) return { state: 'error', detail: 'Could not look for your AI tools.' };
  if (!result.server) return { state: 'unavailable', detail: 'This build has no note server' };
  const tools = result.tools || [];
  const connected = tools.filter((t) => t.connected).map((t) => t.label);
  const waiting = toolsToConnect(tools).map((t) => t.label);
  if (waiting.length) return { state: connected.length ? 'installed' : 'missing', detail: connected.length ? `Connected: ${connected.join(', ')} · not yet: ${waiting.join(', ')}` : `Found: ${waiting.join(', ')}`, action: 'Connect' };
  if (connected.length) return { state: 'installed', detail: `Connected: ${connected.join(', ')}` };
  return { state: 'unavailable', detail: 'No AI tools found (Claude Code, Codex, Antigravity, OpenCode)' };
}

export function agentsModule(api = globalThis.notecompleteAgents) {
  return {
    id: 'ai-tools', kind: 'install',
    icon: 'spark',
    name: 'AI tools connection',
    summary: 'Let Claude Code, Codex and others read and write your notes',
    async status() {
      if (!api) return agentsState(null, { bridge: false });
      try { return agentsState(await api.status()); } catch (e) { return { state: 'error', detail: e.message }; }
    },
    async install(onProgress = () => {}) {
      const tools = toolsToConnect((await api.status())?.tools);
      const failed = [];
      for (const [i, tool] of tools.entries()) {
        onProgress({ text: `Connecting ${tool.label}`, fraction: i / tools.length });
        try { await api.connect(tool.id); } catch (e) { failed.push(`${tool.label}: ${e.message}`); }
      }
      if (failed.length) throw Error(failed.join('\n'));
      // The dialog that offers this by itself (agents.js) need not ask again.
      try { globalThis.localStorage?.setItem('notecomplete-agents-asked', '1'); } catch { /* Optional. */ }
      return { ok: true, text: 'Connected: restart the tools to see NoteComplete' };
    },
  };
}

// The built-in cards, in the order the wizard shows them.
export function registerBuiltInModules({ rBridge = globalThis.notecompleteRBridge, office = globalThis.notecompleteOffice, agents = globalThis.notecompleteAgents, storage = globalThis.localStorage } = {}) {
  registry.clear();
  registerModule(mathModule({ rBridge }));
  registerModule(euroOfficeModule({ storage, bridge: office }));
  registerModule(chineseModule());
  registerModule(agentsModule(agents));
  return moduleList();
}

// Whether a card shows its settings now.
export const showsSettings = (module, status) => !!module.settings && (module.settingsAlways || status?.state === 'on' || status?.state === 'installed');

// What the card's button says and whether it can be pressed.
export function moduleButton(status = {}) {
  if (status.state === 'on' || status.state === 'off') return null;
  if (status.state === 'soon') return { label: 'Coming soon', disabled: true };
  if (status.state === 'desktop' || status.state === 'unavailable') return null;
  if (status.state === 'error') return { label: 'Check again', disabled: false, recheck: true };
  if (!status.action) return null;
  return { label: status.action, disabled: false };
}
