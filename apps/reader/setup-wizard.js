// First-run setup (Help ▸ Setup wizard…), shaped like R Commander Studio's: a title, a stepper
// of numbered tabs that tick once passed, one section per step, Skip / Step n of N / Back /
// Next, and an "All done!" screen. Each choice is applied at once through the app's own
// setter (app.js passes them in as `settings`), so a setting has one source and Skip keeps
// whatever was already chosen. A step is { id, label, optional, available(), render(section,
// draft) }; `draft` is the wizard's memory while it is open (lists it looked up, module cards).
// Opens by itself once (state in `notecomplete-setup`), existing users included.
import { icon } from './icons.js';
import { presets, presetOf } from './quality.js';
import { LOCAL_ID, LOCAL_LABEL } from './local-ai.js';
import { moduleButton, registerBuiltInModules, showsSettings } from './setup-modules.js';
import { buildPackTree, renderPrefabsStep, hasPrefabChanges, applyPrefabDraft } from './setup-prefabs.js';

export const SETUP_KEY = 'notecomplete-setup';
// Raised when steps are added that everyone should see once.
export const SETUP_VERSION = 1;
export const GITHUB_URL = 'https://github.com/Emefedez';
const CLAIM_KEY = 'notecomplete-setup-claim';
const AI_KEY = 'notecomplete-ai-provider';

// ---- State (pure, tested) ----

export function readSetup(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(SETUP_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
export function saveSetup(patch, storage = globalThis.localStorage) {
  const next = { completed: false, skipped: false, version: SETUP_VERSION, step: '', ...readSetup(storage), ...patch };
  try { storage?.setItem(SETUP_KEY, JSON.stringify(next)); } catch { /* It shows again next time. */ }
  return next;
}
// Opens by itself until finished or skipped once (for this wizard version), never in
// automated browsers (the e2e checks drive the reader with navigator.webdriver set).
export function shouldOpen(state, { automated = false } = {}) {
  if (automated) return false;
  if (!state) return true;
  return !((state.completed || state.skipped) && (state.version || 0) >= SETUP_VERSION);
}
// A phone or tablet (iPadOS says Macintosh but has touch points): Performance is suggested.
export function isPhoneOrTablet({ userAgent = '', maxTouchPoints = 0, coarse = false } = {}) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  return coarse;
}
export const suggestedPreset = (mobile) => (mobile ? 'performance' : 'balanced');

// The AI step's rows: the tools found, the model in this app (listed even where this browser
// cannot run it, so the choice is explained), then "No AI".
export function aiChoices(providers = []) {
  const list = (Array.isArray(providers) ? providers : []).map((p) => ({ id: p.id, label: p.label, available: p.available !== false, tag: p.available === false ? 'not found' : '' }));
  if (!list.some((p) => p.id === LOCAL_ID)) list.push({ id: LOCAL_ID, label: LOCAL_LABEL, available: false, tag: 'needs WebGPU' });
  for (const p of list) if (p.id === LOCAL_ID && p.available) p.tag = 'downloads a small model on first use';
  list.push({ id: 'none', label: 'No AI', available: true, tag: 'AI features stay in the menus' });
  return list;
}
// The row chosen now: the saved tool, "No AI" when that was the answer, else the first found.
export function currentAi(choices, saved, none = false) {
  if (saved && choices.some((c) => c.id === saved)) return saved;
  if (none) return 'none';
  return (choices.find((c) => c.available && c.id !== 'none') || { id: 'none' }).id;
}

// The end screen's words and links.
export const DONE = {
  title: 'All done!',
  text: 'NoteComplete is ready. You can reopen this wizard anytime from Help ▸ Setup wizard.',
  ok: 'OK',
  github: 'More of my projects on GitHub',
  url: GITHUB_URL,
};

// ---- DOM helpers ----

const make = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return el;
};
const optionalTag = () => make('span', { className: 'wizard-optional', textContent: '(Optional)' });

function section(parent, title, hint, optional = false) {
  const wrap = make('section', { className: 'wizard-section' },
    make('h3', { className: 'wizard-heading' }, title, optional ? ' ' : '', optional ? optionalTag() : null),
    hint ? make('p', { className: 'wizard-hint', textContent: hint }) : null);
  parent.append(wrap);
  return wrap;
}
const label = (text) => make('div', { className: 'wizard-label', textContent: text });

// Cards picked one of (theme, preset, format): `options` [{ value, title, sub, badge, swatch, disabled }].
function choiceGrid(options, current, pick, columns = options.length) {
  const grid = make('div', { className: 'wizard-choice-grid' });
  grid.style.setProperty('--cols', String(columns));
  grid.setAttribute('role', 'radiogroup');
  for (const opt of options) {
    const button = make('button', { type: 'button', className: 'wizard-choice', disabled: !!opt.disabled },
      opt.swatch || null,
      make('span', { className: 'wizard-choice-title' }, opt.title, opt.badge ? make('span', { className: 'wizard-badge', textContent: opt.badge }) : null),
      opt.sub ? make('span', { className: 'wizard-choice-sub', textContent: opt.sub }) : null);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(opt.value === current));
    button.dataset.value = opt.value;
    button.onclick = () => {
      for (const b of grid.children) b.setAttribute('aria-checked', String(b === button));
      pick(opt.value);
    };
    grid.append(button);
  }
  return grid;
}
// A row of small buttons picked one of (tool bar side, office opener).
function segmented(name, options, current, pick) {
  const group = make('div', { className: 'wizard-segmented' });
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', name);
  for (const opt of options) {
    const b = make('button', { type: 'button', disabled: !!opt.disabled, title: opt.title || '' }, opt.icon ? icon(opt.icon) : null, opt.label);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(opt.value === current));
    b.onclick = () => { for (const x of group.children) x.setAttribute('aria-checked', String(x === b)); pick(opt.value); };
    group.append(b);
  }
  return group;
}
// An on/off setting through its getter and setter.
function toggle(setting, title, hint) {
  const box = make('input', { type: 'checkbox', checked: !!setting.get() });
  box.onchange = () => { setting.set(box.checked); box.checked = !!setting.get(); };
  return make('label', { className: 'wizard-check' }, box,
    make('span', {}, make('strong', { textContent: title }), hint ? make('span', { className: 'wizard-check-hint', textContent: hint }) : null));
}
const has = (settings, ...keys) => keys.some((k) => settings[k] && (settings[k].available?.() ?? true));

// A small picture of the app in a theme, for the theme cards.
function themeSwatch(kind) {
  const swatch = make('span', { className: `wizard-swatch ${kind}` });
  swatch.setAttribute('aria-hidden', 'true');
  swatch.innerHTML = '<span class="bar"></span><span class="page"><i></i><i></i><i></i></span>';
  return swatch;
}

// ---- Steps ----

export function buildSteps(env) {
  const s = env.settings || {};
  const storage = env.storage ?? globalThis.localStorage;
  return [
    {
      id: 'look', label: 'Look', optional: false,
      available: () => has(s, 'theme', 'darkPages', 'uiSize'),
      render(sec) {
        const body = section(sec, 'How NoteComplete looks', 'Changes show at once. They are also in the View menu.');
        if (s.theme) {
          body.append(label('Theme'), choiceGrid([
            { value: 'light', title: 'Light', sub: 'Always light', swatch: themeSwatch('light') },
            { value: 'dark', title: 'Dark', sub: 'Always dark', swatch: themeSwatch('dark') },
            { value: 'system', title: 'Follow the system', sub: 'Light or dark as the system is', swatch: themeSwatch('system') },
          ], s.theme.get(), (v) => s.theme.set(v)));
        }
        if (s.darkPages) body.append(toggle(s.darkPages, 'Dark pages', 'Pages and their previews are shown inverted, for reading at night (exports keep their colours). D switches it.'));
        if (s.uiSize) {
          const value = make('output', { className: 'wizard-size-value' });
          const show = (z) => { value.textContent = Number.isFinite(z) ? `${Math.round(z * 100)}%` : ''; };
          const step = async (n) => show(await s.uiSize.step(n));
          show(s.uiSize.get());
          const smaller = make('button', { type: 'button', title: 'Smaller (Ctrl Shift −)' }, icon('minus'));
          const larger = make('button', { type: 'button', title: 'Larger (Ctrl Shift +)' }, icon('plus'));
          const reset = make('button', { type: 'button', textContent: '100%', title: 'Back to 100% (Ctrl Shift 0)' });
          smaller.setAttribute('aria-label', 'Interface smaller');
          larger.setAttribute('aria-label', 'Interface larger');
          smaller.onclick = () => step(-1); larger.onclick = () => step(1); reset.onclick = () => step(0);
          body.append(label('Interface size'), make('div', { className: 'wizard-inline-row' }, smaller, value, larger, reset,
            make('span', { className: 'wizard-hint', textContent: 'Menus, bars and dialogs; the pages zoom on their own.' })));
        }
      },
    },
    {
      id: 'performance', label: 'Performance', optional: false,
      available: () => has(s, 'quality'),
      render(sec) {
        const body = section(sec, 'Display quality', env.mobile
          ? 'Phones and tablets have less memory: Performance keeps pages quick there.'
          : 'Sharper pages use more memory. Display quality… in the View menu fine-tunes it.');
        const { quality } = s.quality.get();
        const suggested = suggestedPreset(env.mobile);
        const current = presetOf(quality);
        body.append(choiceGrid([
          { value: 'performance', title: 'Performance', sub: 'Quickest pages, least memory', badge: suggested === 'performance' ? 'Suggested' : '' },
          { value: 'balanced', title: 'Balanced', sub: 'Sharp text at a normal cost', badge: suggested === 'balanced' ? 'Suggested' : '' },
          { value: 'sharp', title: 'Sharp', sub: 'Most detail, for big screens' },
        ], current, (v) => s.quality.set(presets[v], s.quality.get().detail)));
        if (!current) body.append(make('p', { className: 'wizard-hint', textContent: 'Now: your own settings from Display quality…. Picking a preset replaces them.' }));
        body.append(toggle({ get: () => s.quality.get().detail, set: (on) => s.quality.set(s.quality.get().quality, on) }, 'Fast zoom sharpening',
          'Zoomed PDF pages sharpen sooner by drawing only what is on screen.'));
      },
    },
    {
      id: 'writing', label: 'Writing', optional: false,
      available: () => has(s, 'pressure', 'smoothing', 'toolNames', 'newFormat'),
      render(sec) {
        const body = section(sec, 'Writing and new notes', 'How the pen draws and what a new note is saved as.');
        if (s.pressure) body.append(toggle(s.pressure, 'Pen pressure', 'A stylus draws thicker when pressed harder. Off: an even line.'));
        if (s.smoothing) body.append(toggle(s.smoothing, 'Pen smoothing', 'Smooths strokes while you write. Off: the line follows the pen exactly.'));
        if (s.toolNames) body.append(toggle(s.toolNames, 'Tool names under the icons', 'Off: the tool bar shows icons only (names stay in the tooltips).'));
        if (s.newFormat) {
          body.append(label('New notes are saved as'), choiceGrid([
            { value: 'project', title: 'NoteComplete (.nfedit)', sub: 'Undo history, Markdown notes, quizzes and flashcards' },
            { value: 'noteful', title: 'Noteful (.noteful)', sub: 'Opens in Noteful on the iPad' },
          ], s.newFormat.get(), (v) => s.newFormat.set(v), 2));
        }
      },
    },
    {
      id: 'ai', label: 'AI', optional: true,
      available: () => true,
      render(sec, draft, refresh) {
        const body = section(sec, 'AI assistant', 'Ask AI, flashcards, quizzes, exams and fact checks use an AI tool installed on this computer, or a small model that runs inside this app. Skip this if you do not want AI.', true);
        if (!draft.ai) {
          draft.ai = { state: 'loading', choices: [] };
          Promise.resolve(env.ai?.providers?.()).catch(() => []).then((list) => {
            draft.ai = { state: 'loaded', choices: aiChoices(list || []) };
            refresh('ai');
          });
        }
        if (draft.ai.state !== 'loaded') { body.append(make('p', { className: 'wizard-hint', textContent: 'Looking for AI tools…' })); return; }
        let saved = '';
        try { saved = storage?.getItem(AI_KEY) || ''; } catch { /* Optional. */ }
        const current = currentAi(draft.ai.choices, saved, readSetup(storage)?.ai === 'none');
        const list = make('div', { className: 'wizard-provider-list' });
        for (const p of draft.ai.choices) {
          const radio = make('input', { type: 'radio', name: 'wizardAi', value: p.id, checked: p.id === current, disabled: !p.available });
          radio.onchange = () => {
            try { p.id === 'none' ? storage?.removeItem(AI_KEY) : storage?.setItem(AI_KEY, p.id); } catch { /* Optional. */ }
            saveSetup({ ai: p.id === 'none' ? 'none' : '' }, storage);
          };
          list.append(make('label', { className: `wizard-provider${p.available ? '' : ' unavailable'}` }, radio,
            make('span', { className: 'wizard-provider-name', textContent: p.label }),
            p.tag ? make('span', { className: 'wizard-provider-tag', textContent: p.tag }) : null));
        }
        body.append(label('Default assistant'), list,
          make('p', { className: 'wizard-hint', textContent: 'Each AI window can still pick another one. To let your AI tools read and write your notes, see Modules.' }));
      },
    },
    {
      id: 'modules', label: 'Modules', optional: false,
      available: () => (env.modules || []).length > 0,
      render(sec, draft) {
        const body = section(sec, 'Modules', 'Optional features: turn on the ones you want, or install the ones that come separately. All of them can be changed later here (Help ▸ Setup wizard…).');
        draft.modules ||= {};
        const list = make('div', { className: 'wizard-modules' });
        for (const module of env.modules) list.append(moduleCard(module, draft.modules, env));
        body.append(list);
      },
    },
    {
      id: 'prefabs', label: 'Prefabs', optional: true,
      available: () => env.prefabs !== false && (env.prefabs?.packs ? env.prefabs.packs().length > 0 : buildPackTree().length > 0),
      render(sec, draft, refresh) {
        const body = section(sec, 'Prefab packs', 'Choose which prefab packs and figures are installed on this device. Essentials stay installed; anything else can be downloaded later from Insert prefab.', true);
        renderPrefabsStep(body, draft, { ...env, storage }, refresh);
      },
    },
    {
      id: 'prefs', label: 'Preferences', optional: false,
      available: () => has(s, 'menuBarAutoHide', 'dock', 'spread', 'welcome', 'updateChecks'),
      render(sec) {
        const body = section(sec, 'Preferences', 'Sensible defaults are already set. All of these are also in the menus.');
        if (s.dock) {
          body.append(label('Tool bar'), segmented('Tool bar position', [
            { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
          ], s.dock.get(), (v) => s.dock.set(v)),
          make('p', { className: 'wizard-hint', textContent: 'Where the page row and the tools sit (a phone held upright keeps them at the bottom).' }));
        }
        if (s.menuBarAutoHide) body.append(toggle(s.menuBarAutoHide, 'Hide the menu bar', 'File, Edit, View… slide away and come back when the pointer reaches the top edge.'));
        if (s.spread) body.append(toggle(s.spread, 'Side-by-side pages', 'Two pages next to each other, like an open book.'));
        if (s.welcome && (s.welcome.available?.() ?? true)) body.append(toggle(s.welcome, 'Open the welcome note at start', 'This site opens its welcome note in a tab each time it starts.'));
        if (s.updateChecks && (s.updateChecks.available?.() ?? true)) body.append(toggle(s.updateChecks, 'Check for updates on open', 'Looks for a new version when NoteComplete opens; it always asks before installing.'));
      },
    },
  ];
}

// The controls a module's settings are drawn with (setup-modules.js settings(el, ui)).
const moduleUi = {
  toggle: (setting, title, hint) => toggle(setting, title, hint),
  segmented,
  hint: (text) => make('p', { className: 'wizard-hint', textContent: text }),
  row: (title, control, hint) => make('div', { className: 'wizard-office-row' },
    make('span', {}, make('strong', { textContent: title }), hint ? make('span', { className: 'wizard-check-hint', textContent: hint }) : null), control),
};

// One module's card: icon, name and version, summary, state, and its switch or button (with
// progress); its settings and smaller cards inside it when it is on or installed.
function moduleCard(module, memory, env, sub = false) {
  const card = make('div', { className: 'wizard-module' });
  card.dataset.module = module.id;
  const mem = (memory[module.id] ||= { status: null, busy: false, progress: null, error: '', note: '' });
  const check = async () => {
    mem.status = null; draw();
    mem.status = await module.status().catch((e) => ({ state: 'error', detail: e.message }));
    draw();
  };
  function draw() {
    const st = mem.status;
    const feature = module.kind === 'feature';
    const tone = mem.error ? 'err' : !st ? '' : st.state === 'installed' || st.state === 'on' ? 'ok' : st.state === 'missing' ? 'warn' : st.state === 'error' ? 'err' : 'idle';
    card.className = `wizard-module wizard-status-card${sub ? ' sub' : ''}${tone ? ` ${tone}` : ''}`;
    const picture = /\.(svg|png)$/.test(module.icon || '')
      ? make('img', { src: module.icon, alt: '', width: sub ? 28 : 36, height: sub ? 28 : 36 })
      : make('span', { className: 'wizard-module-glyph' }, icon(module.icon || 'note'));
    const stateText = mem.busy ? (mem.progress?.text || 'Working…')
      : !st ? 'Checking…'
      : st.state === 'on' ? 'On'
      : st.state === 'off' ? 'Off'
      : st.state === 'installed' ? `Installed${st.version ? ` · ${st.version}` : ''}`
      : st.state === 'missing' ? 'Not installed'
      : st.state === 'unavailable' ? 'Not available on this device'
      : st.state === 'desktop' ? 'Needs the desktop app'
      : st.state === 'soon' ? 'Not released yet'
      : 'Could not check';
    const stateIcon = !st || mem.busy || feature ? null : icon(st.state === 'installed' ? 'check' : st.state === 'error' ? 'warn' : st.state === 'missing' ? 'down' : 'clock');
    const detail = st?.detail && st.detail !== stateText ? st.detail : '';
    let action = null;
    if (feature && st) {
      const box = make('input', { type: 'checkbox', className: 'wizard-switch', checked: st.state === 'on' });
      box.setAttribute('role', 'switch');
      box.setAttribute('aria-label', module.name);
      box.onchange = async () => { await module.setEnabled(box.checked); await check(); };
      action = box;
    } else {
      const button = mem.busy ? null : moduleButton(st || {});
      const primary = button ? make('button', { type: 'button', className: button.recheck || button.disabled ? '' : 'primary', textContent: button.label, disabled: button.disabled }) : null;
      if (primary && !button.disabled) primary.onclick = () => (button.recheck ? check() : run());
      const remove = !mem.busy && st?.canRemove && typeof module.uninstall === 'function'
        ? make('button', { type: 'button', textContent: 'Remove', title: `Remove ${module.name}` })
        : null;
      if (remove) remove.onclick = () => removeModule();
      action = primary && remove ? make('span', { className: 'wizard-module-actions' }, primary, remove) : (primary || remove);
    }
    const inside = st && showsSettings(module, st) ? make('div', { className: 'wizard-module-settings' }) : null;
    if (inside) module.settings(inside, moduleUi, st);
    const children = st && (st.state === 'on' || st.state === 'installed') && module.children?.length
      ? make('div', { className: 'wizard-module-children' }, ...module.children.map((child) => moduleCard(child, memory, env, true)))
      : null;
    card.replaceChildren(...[
      make('div', { className: 'wizard-module-head' }, picture,
        make('div', { className: 'wizard-module-text' },
          make('strong', { className: 'wizard-module-name', textContent: module.name }),
          make('span', { className: 'wizard-module-summary', textContent: module.summary }),
          make('span', { className: 'wizard-status-line' }, stateIcon ? make('span', { className: 'ico' }, stateIcon) : null,
            make('span', { textContent: stateText + (detail ? ` · ${detail}` : '') }))),
        action),
      mem.busy ? progressBar(mem.progress?.fraction) : null,
      mem.note && !mem.busy && !mem.error ? make('div', { className: 'wizard-mono', textContent: mem.note }) : null,
      mem.error ? make('pre', { className: 'wizard-mono wizard-error', textContent: mem.error }) : null,
      inside, children].filter(Boolean));
  }
  async function run() {
    mem.busy = true; mem.error = ''; mem.note = ''; mem.progress = { text: mem.status?.action === 'Open' ? 'Opening…' : 'Starting…' }; draw();
    try {
      const res = await module.install((p) => { mem.progress = p; draw(); }, mem.status || {});
      mem.note = res?.text || '';
      env.status?.(`${module.name}: ${res?.text || 'done'}`);
    } catch (e) { mem.error = e.message || String(e); }
    mem.busy = false;
    await check();
  }
  async function removeModule() {
    mem.busy = true; mem.error = ''; mem.note = ''; mem.progress = { text: 'Removing…' }; draw();
    try {
      const res = await module.uninstall();
      mem.note = res?.text || 'Removed';
      env.status?.(`${module.name}: ${mem.note}`);
    } catch (e) { mem.error = e.message || String(e); }
    mem.busy = false;
    await check();
  }
  draw();
  if (!mem.status && !mem.busy) check();
  return card;
}
function progressBar(fraction) {
  const bar = make('div', { className: 'wizard-progress' }, make('span'));
  if (Number.isFinite(fraction)) { bar.classList.add('known'); bar.firstChild.style.width = `${Math.round(fraction * 100)}%`; }
  bar.setAttribute('role', 'progressbar');
  if (Number.isFinite(fraction)) bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  return bar;
}

// ---- The wizard ----

export function setupWizard(env = {}) {
  const storage = env.storage ?? globalThis.localStorage;
  const modules = env.modules || registerBuiltInModules();
  const all = buildSteps({ ...env, modules, storage });
  let steps = [], index = 0, done = false, draft = {}, dialog = null, claimTimer = 0;
  let els = {};

  function build() {
    dialog = make('dialog', { className: 'setup-wizard' });
    dialog.setAttribute('aria-labelledby', 'wizardTitle');
    els = {
      title: make('h2', { id: 'wizardTitle', className: 'wizard-title', textContent: 'Welcome to NoteComplete' }),
      sub: make('div', { className: 'wizard-sub', textContent: 'A quick setup to get you started. Everything can be changed later in the menus.' }),
      steps: make('nav', { className: 'wizard-steps' }),
      body: make('div', { className: 'wizard-body' }),
      skip: make('button', { type: 'button', className: 'wizard-skip', textContent: 'Skip setup' }),
      counter: make('span', { className: 'wizard-counter' }),
      back: make('button', { type: 'button', textContent: 'Back' }),
      next: make('button', { type: 'button', className: 'primary', textContent: 'Next' }),
    };
    els.steps.setAttribute('aria-label', 'Setup steps');
    dialog.append(
      make('div', { className: 'wizard-head' }, els.title, els.sub, els.steps),
      els.body,
      make('div', { className: 'wizard-foot' }, els.skip, make('span', { className: 'spacer' }), els.counter, els.back, els.next));
    els.skip.onclick = () => skip();
    els.back.onclick = () => go(index - 1);
    els.next.onclick = () => (index >= steps.length - 1 ? finish() : go(index + 1));
    // Escape skips (the choices made so far stay), or closes the end screen.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done ? close() : skip(); });
    // The app's single-key shortcuts (D, N, …) must not act behind the wizard.
    dialog.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.append(dialog);
  }

  function open(at = '') {
    if (!dialog) build();
    steps = all.filter((step) => step.available());
    draft = {};
    done = false;
    const saved = at || readSetup(storage)?.step || '';
    index = Math.max(0, steps.findIndex((step) => step.id === saved));
    if (!dialog.open) dialog.showModal();
    claim();
    render();
    els.next.focus();
  }
  function close() {
    clearInterval(claimTimer);
    try { storage?.removeItem(CLAIM_KEY); } catch { /* Optional. */ }
    dialog?.close();
  }
  // While it is open here, other tabs leave it alone (autoOpen).
  function claim() {
    const mark = () => { try { storage?.setItem(CLAIM_KEY, String(Date.now())); } catch { /* Optional. */ } };
    mark();
    clearInterval(claimTimer);
    claimTimer = setInterval(() => (dialog?.open ? mark() : clearInterval(claimTimer)), 20000);
  }
  function go(i) {
    if (done) return;
    index = Math.max(0, Math.min(steps.length - 1, i));
    saveSetup({ step: steps[index].id }, storage);
    render();
  }
  function skip() {
    saveSetup({ skipped: true, version: SETUP_VERSION, step: steps[index]?.id || '' }, storage);
    close();
    env.status?.('Setup skipped. Help ▸ Setup wizard… opens it again.');
  }
  async function finish() {
    if (hasPrefabChanges(draft)) {
      els.back.disabled = els.next.disabled = els.skip.disabled = true;
      els.next.textContent = 'Applying…';
      const statusLine = make('p', { className: 'wizard-hint', textContent: 'Applying prefab packs…' });
      const barWrap = make('div', { className: 'wizard-prefab-applying' }, statusLine, progressBar(0));
      els.body.append(barWrap);
      try {
        const errors = await applyPrefabDraft(draft, (p) => {
          statusLine.textContent = p?.text || 'Applying prefab packs…';
          barWrap.replaceChildren(statusLine, progressBar(p?.fraction));
        });
        if (errors.length) env.status?.(`Some prefab packs could not be updated: ${errors.join('; ')}`, true);
      } catch (e) {
        env.status?.(e.message || 'Could not apply prefab packs.', true);
      } finally {
        els.back.disabled = els.next.disabled = els.skip.disabled = false;
      }
    }
    saveSetup({ completed: true, skipped: false, version: SETUP_VERSION, step: '' }, storage);
    done = true;
    render();
  }
  // Re-draws a step when something it waited for arrives, if it is still the one shown.
  function refresh(id) { if (dialog?.open && !done && steps[index]?.id === id) render(); }

  function render() {
    dialog.classList.toggle('is-done', done);
    els.back.hidden = index === 0 || done;
    els.skip.hidden = els.counter.hidden = els.next.hidden = done;
    els.next.textContent = index >= steps.length - 1 ? 'Finish' : 'Next';
    els.counter.textContent = `Step ${index + 1} of ${steps.length}`;
    els.steps.replaceChildren(...steps.map((step, i) => {
      const passed = done || i < index, active = !done && i === index;
      const b = make('button', { type: 'button', className: `wizard-step${active ? ' active' : passed ? ' done' : ''}` },
        make('span', { className: 'wizard-step-num' }, passed ? icon('check') : String(i + 1)),
        make('span', { className: 'wizard-step-label' }, step.label, step.optional ? ' ' : '', step.optional ? optionalTag() : null));
      if (active) b.setAttribute('aria-current', 'step');
      b.onclick = () => go(i);
      return b;
    }));
    // The step shown stays in sight in the stepper (narrow windows scroll it sideways).
    const active = els.steps.querySelector('.active');
    if (active) els.steps.scrollLeft = Math.max(0, active.offsetLeft - (els.steps.clientWidth - active.offsetWidth) / 2);
    els.body.replaceChildren();
    els.body.scrollTop = 0;
    if (done) { renderDone(); return; }
    els.body.dataset.step = steps[index].id;
    steps[index].render(els.body, draft, refresh);
  }
  function renderDone() {
    els.body.dataset.step = 'done';
    const ok = make('button', { type: 'button', className: 'wizard-ok', textContent: DONE.ok });
    const github = make('button', { type: 'button', className: 'wizard-github' }, icon('github'), make('span', { textContent: DONE.github }));
    ok.onclick = () => close();
    github.onclick = () => (env.openExternal ? env.openExternal(DONE.url) : window.open(DONE.url, '_blank', 'noopener,noreferrer'));
    const badge = make('div', { className: 'wizard-done-badge' }, icon('check'));
    els.body.append(make('section', { className: 'wizard-done' }, badge,
      make('h3', { className: 'wizard-done-title', textContent: DONE.title }),
      make('p', { className: 'wizard-hint wizard-done-text', textContent: DONE.text }),
      make('div', { className: 'wizard-done-actions' }, ok, github)));
    ok.focus();
  }

  return {
    open, close,
    get isOpen() { return !!dialog?.open; },
    get steps() { return all.filter((step) => step.available()).map((step) => step.id); },
  };
}

// Opens the wizard by itself once, in the tab in front: the website opens two tabs at start
// (the welcome note and Home) and each runs the reader, so the first one in front claims it.
// Tries again for a while when another dialog is open or this tab is behind another.
export function autoOpen(wizard, {
  storage = globalThis.localStorage,
  automated = !!globalThis.navigator?.webdriver,
  isFront = () => {
    if (document.hidden) return false;
    try { return !window.frameElement?.hidden; } catch { return true; }
  },
  busy = () => !!document.querySelector('dialog[open]'),
  delay = 1200, tries = 30,
} = {}) {
  if (!shouldOpen(readSetup(storage), { automated })) return;
  let left = tries;
  const attempt = () => {
    if (!shouldOpen(readSetup(storage), { automated }) || wizard.isOpen) return;
    let claimed = 0;
    try { claimed = Number(storage?.getItem(CLAIM_KEY)) || 0; } catch { /* Optional. */ }
    const taken = Date.now() - claimed < 60000;
    if (!taken && isFront() && !busy()) { wizard.open(); return; }
    if (--left > 0) setTimeout(attempt, 2000);
  };
  setTimeout(attempt, delay);
}
