import test from 'node:test';
import assert from 'node:assert/strict';

// A storage like the browser's, also as the global one the feature settings read.
const memory = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
};
const shared = memory();
Object.defineProperty(globalThis, 'localStorage', { value: shared, configurable: true, writable: true });

const W = await import('./setup-wizard.js');
const M = await import('./setup-modules.js');
const O = await import('./open-with-pref.js');

const setting = (value) => ({ get: () => value, set: (v) => { value = v; } });

test('the steps, in order, and only those with something to set here', () => {
  const all = { theme: setting('system'), darkPages: setting(false), quality: setting({}), pressure: setting(true), menuBarAutoHide: setting(false) };
  const steps = W.buildSteps({ settings: all, modules: [{ id: 'x' }] });
  assert.deepEqual(steps.map((s) => s.id), ['look', 'performance', 'writing', 'ai', 'modules', 'prefs']);
  assert.deepEqual(steps.map((s) => s.label), ['Look', 'Performance', 'Writing', 'AI', 'Modules', 'Preferences']);
  assert.deepEqual(steps.filter((s) => s.optional).map((s) => s.id), ['ai']);
  for (const s of steps) assert.equal(typeof s.render, 'function');
  assert.deepEqual(steps.filter((s) => s.available()).map((s) => s.id), ['look', 'performance', 'writing', 'ai', 'modules', 'prefs']);
  // Nothing from the app: only AI is left (Modules needs a module).
  assert.deepEqual(W.buildSteps({ settings: {}, modules: [] }).filter((s) => s.available()).map((s) => s.id), ['ai']);
  // A setting that is not offered here (the website's welcome note, desktop update checks).
  const prefs = (extra) => W.buildSteps({ settings: extra, modules: [] }).find((s) => s.id === 'prefs').available();
  assert.equal(prefs({ welcome: { ...setting(true), available: () => false } }), false);
  assert.equal(prefs({ updateChecks: { ...setting(true), available: () => true } }), true);
});

test('state: opens until finished or skipped, then not again; automated browsers never', () => {
  const store = memory();
  assert.equal(W.readSetup(store), null);
  assert.equal(W.shouldOpen(W.readSetup(store)), true);
  assert.equal(W.shouldOpen(null, { automated: true }), false);
  // Moving between steps remembers where it was, and it still opens.
  W.saveSetup({ step: 'writing' }, store);
  assert.deepEqual(W.readSetup(store), { completed: false, skipped: false, version: W.SETUP_VERSION, step: 'writing' });
  assert.equal(W.shouldOpen(W.readSetup(store)), true);
  W.saveSetup({ skipped: true, step: 'ai' }, store);
  assert.equal(W.shouldOpen(W.readSetup(store)), false);
  assert.equal(W.readSetup(store).step, 'ai');
  // Finished with an older wizard: the new steps are shown once.
  assert.equal(W.shouldOpen({ completed: true, version: W.SETUP_VERSION - 1 }), true);
  assert.equal(W.shouldOpen({ completed: true, version: W.SETUP_VERSION }), false);
  // Broken or unreadable storage: it simply opens.
  const broken = { getItem: () => '{nope', setItem: () => { throw Error('full'); } };
  assert.equal(W.readSetup(broken), null);
  assert.equal(W.saveSetup({ completed: true }, broken).completed, true);
  assert.equal(JSON.parse(store.getItem(W.SETUP_KEY)).skipped, true);
});

test('performance suggestion: phones and tablets get Performance', () => {
  assert.equal(W.isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710)' }), true);
  assert.equal(W.isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true);
  assert.equal(W.isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true);
  assert.equal(W.isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), false);
  assert.equal(W.isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (X11; Linux aarch64)' }), false);
  assert.equal(W.suggestedPreset(true), 'performance');
  assert.equal(W.suggestedPreset(false), 'balanced');
});

test('AI choices: the tools found, the model in this app, then No AI', () => {
  const list = W.aiChoices([{ id: 'claude', label: 'Claude Code', available: true }, { id: 'codex', label: 'Codex', available: false }]);
  assert.deepEqual(list.map((c) => c.id), ['claude', 'codex', 'webllm', 'none']);
  assert.equal(list.find((c) => c.id === 'codex').tag, 'not found');
  assert.equal(list.find((c) => c.id === 'webllm').available, false);
  const withLocal = W.aiChoices([{ id: 'webllm', label: 'In this app (WebLLM)', available: true }]);
  assert.deepEqual(withLocal.map((c) => c.id), ['webllm', 'none']);
  assert.equal(withLocal[0].available, true);
  assert.equal(W.currentAi(list, 'claude'), 'claude');
  assert.equal(W.currentAi(list, 'gone'), 'claude');
  assert.equal(W.currentAi(list, '', true), 'none');
  assert.equal(W.currentAi(W.aiChoices([]), ''), 'none');
});

test('the end screen', () => {
  assert.equal(W.DONE.title, 'All done!');
  assert.match(W.DONE.text, /Help ▸ Setup wizard/);
  assert.equal(W.DONE.ok, 'OK');
  assert.equal(W.DONE.github, 'More of my projects on GitHub');
  assert.equal(W.DONE.url, 'https://github.com/Emefedez');
});

test('modules: the registry and its cards', () => {
  const list = M.registerBuiltInModules({ rBridge: null, agents: null });
  assert.deepEqual(list.map((m) => m.id), ['math', 'euro-office', 'chinese', 'ai-tools']);
  for (const m of list) {
    assert.ok(m.name && m.summary && m.icon, m.id);
    assert.ok(['feature', 'install'].includes(m.kind), m.id);
    if (m.kind === 'feature') assert.equal(typeof m.setEnabled, 'function');
    else assert.equal(typeof m.install, 'function');
  }
  assert.deepEqual(list.find((m) => m.id === 'math').children.map((c) => c.id), ['r-studio']);
  assert.throws(() => M.registerModule({ id: '' }));
  M.registerModule({ id: 'later', kind: 'install', status: async () => ({ state: 'missing', action: 'Install' }), install: async () => ({ ok: true }) });
  assert.equal(M.moduleList().at(-1).id, 'later');
});

test('modules: features turn on and off through their own settings', async () => {
  const [math, , chinese] = M.registerBuiltInModules({ rBridge: null, agents: null });
  assert.deepEqual(await math.status(), { state: 'off' });
  math.setEnabled(true);
  assert.equal(shared.getItem('notecomplete-math-enabled'), 'true');
  assert.deepEqual(await math.status(), { state: 'on' });
  assert.deepEqual(await chinese.status(), { state: 'off' });
  chinese.setEnabled(true);
  assert.equal(shared.getItem('notecomplete-zh-used'), '1');
  assert.deepEqual(await chinese.status(), { state: 'on' });
  chinese.setEnabled(false);
  assert.deepEqual(await chinese.status(), { state: 'off' });
  assert.equal(M.moduleButton({ state: 'on' }), null);
  assert.equal(M.showsSettings(math, { state: 'on' }), true);
  assert.equal(M.showsSettings(math, { state: 'off' }), false);
});

test('modules: R Commander Studio states from the bridge', async () => {
  assert.deepEqual(M.rStudioState(null, { bridge: false }), { state: 'desktop', detail: M.NEEDS_DESKTOP });
  const base = { rAvailable: true, rVersion: '4.4.1', platformSupport: { supported: true, label: 'Linux ARM64 (AppImage)' } };
  assert.deepEqual(M.rStudioState({ ...base, studioInstalled: false }), { state: 'missing', detail: 'R 4.4.1 found', action: 'Install' });
  assert.deepEqual(M.rStudioState({ ...base, studioInstalled: true, studioConnected: true, studioVersion: '0.9.2' }), { state: 'installed', version: '0.9.2', detail: 'Running · R 4.4.1 found', action: 'Open' });
  assert.equal(M.rStudioState({ ...base, rAvailable: false, studioInstalled: true }).detail, 'R not found: install R to run it');
  assert.equal(M.rStudioState({ ...base, platformSupport: { supported: false, label: 'FreeBSD' } }).state, 'unavailable');
  assert.deepEqual(M.rStudioProgress({ phase: 'downloading', received: 50, total: 200, name: 'Studio.AppImage' }), { text: 'Downloading Studio.AppImage 25%', fraction: 0.25 });
  assert.equal(M.rStudioProgress({ phase: 'checking' }).fraction, undefined);
  // Install goes through the bridge and reports its progress.
  const seen = [];
  const bridge = {
    status: async () => ({ ...base, studioInstalled: false }),
    installStudio: async (onProgress) => { onProgress({ phase: 'downloading', received: 1, total: 2 }); return { ok: true, version: 'v1.0.0' }; },
  };
  const studio = M.rStudioModule(bridge);
  assert.equal((await studio.status()).action, 'Install');
  assert.deepEqual(await studio.install((p) => seen.push(p)), { ok: true, text: 'Installed v1.0.0' });
  assert.equal(seen[0].fraction, 0.5);
  await assert.rejects(M.rStudioModule({ installStudio: async () => ({ ok: false, error: 'No release' }) }).install(), /No release/);
  assert.deepEqual(await M.rStudioModule({ status: async () => { throw Error('down'); } }).status(), { state: 'error', detail: 'down' });
});

test('modules: Euro-Office states (desktop-only, missing with size, unavailable, installed with remove & licence) and open-with prefs', async () => {
  const webOffice = M.euroOfficeModule({ storage: memory(), bridge: null });
  const webStatus = await webOffice.status();
  assert.equal(webStatus.state, 'desktop');
  assert.equal(webStatus.detail, M.NEEDS_DESKTOP);
  assert.equal(M.moduleButton(webStatus), null);
  assert.equal(M.showsSettings(webOffice, webStatus), true);
  await assert.rejects(webOffice.install(), /desktop app/);

  // Desktop missing state shows ~1 GB download size and Install action.
  const missing = M.euroOfficeState({ installed: false, state: 'missing', version: '9.3.8', tag: 'v9.3.8', downloadBytes: 1036902674, diskBytes: 3.2e9, detail: 'Built-in rootless runner' });
  assert.equal(missing.state, 'missing');
  assert.equal(missing.action, 'Install');
  assert.match(missing.detail, /Download ~1\.0 GB \(~3\.2 GB on disk\)/);

  // Unavailable state surfaces platform guidance (e.g. Ubuntu AppArmor or missing macOS runtime).
  const unavail = M.euroOfficeState({ installed: false, state: 'unavailable', detail: 'Install Podman' });
  assert.equal(unavail.state, 'unavailable');
  assert.equal(unavail.detail, 'Install Podman');

  // Installed state carries version, licence, NOTICE, sourceUrl, and canRemove.
  const installed = M.euroOfficeState({ installed: true, state: 'installed', version: '9.3.8', tag: 'v9.3.8', detail: 'Ready (rootless)', notice: 'NOTICE text', sourceUrl: 'https://github.com/Euro-Office/DocumentServer/tree/v9.3.8' });
  assert.equal(installed.state, 'installed');
  assert.equal(installed.version, '9.3.8');
  assert.equal(installed.canRemove, true);
  assert.equal(installed.notice, 'NOTICE text');

  // Install & uninstall delegate to the desktop bridge and forward progress.
  const seen = [];
  const office = M.euroOfficeModule({
    storage: memory(),
    bridge: {
      status: async () => ({ installed: false, state: 'missing', version: '9.3.8', downloadBytes: 1e9, diskBytes: 3.2e9 }),
      install: async (onProgress) => { onProgress({ phase: 'downloading', received: 50, total: 100 }); return { ok: true, version: '9.3.8' }; },
      uninstall: async () => ({ ok: true }),
    },
  });
  assert.deepEqual(await office.install((p) => seen.push(p)), { ok: true, text: 'Installed Euro-Office 9.3.8' });
  assert.equal(seen[0].fraction, 0.5);
  assert.deepEqual(await office.uninstall(), { ok: true, text: 'Euro-Office removed' });

  const store = memory();
  assert.deepEqual(O.openWithPrefs(store), { documents: 'text', spreadsheets: 'text', presentations: 'text' });
  O.setOpenWith('spreadsheets', 'ask', store);
  O.setOpenWith('documents', 'nonsense', store);
  O.setOpenWith('slides', 'ask', store);
  assert.equal(O.openWith('spreadsheets', store), 'ask');
  assert.equal(O.openWith('documents', store), 'text');
  assert.deepEqual(JSON.parse(store.getItem(O.OPEN_WITH_KEY)), { documents: 'text', spreadsheets: 'ask', presentations: 'text' });
  store.setItem(O.OPEN_WITH_KEY, '{broken');
  assert.equal(O.openWith('presentations', store), 'text');
});

test('modules: AI tools connection states and connecting', async () => {
  assert.equal(M.agentsState(null, { bridge: false }).state, 'desktop');
  assert.equal(M.agentsState({ server: null, tools: [] }).state, 'unavailable');
  const tools = [
    { id: 'claude', label: 'Claude Code', installed: true, connected: true },
    { id: 'codex', label: 'Codex', installed: true, connected: false },
    { id: 'antigravity', label: 'Antigravity', installed: false, connected: false },
  ];
  assert.deepEqual(M.agentsState({ server: '/x', tools }), { state: 'installed', detail: 'Connected: Claude Code · not yet: Codex', action: 'Connect' });
  assert.deepEqual(M.agentsState({ server: '/x', tools: [tools[1]] }), { state: 'missing', detail: 'Found: Codex', action: 'Connect' });
  assert.deepEqual(M.agentsState({ server: '/x', tools: [tools[0]] }), { state: 'installed', detail: 'Connected: Claude Code' });
  assert.equal(M.agentsState({ server: '/x', tools: [tools[2]] }).state, 'unavailable');
  const connected = [];
  const api = { status: async () => ({ server: '/x', tools }), connect: async (id) => { connected.push(id); } };
  assert.equal((await M.agentsModule(api).install()).ok, true);
  assert.deepEqual(connected, ['codex']);
  assert.equal(shared.getItem('notecomplete-agents-asked'), '1');
  const failing = { status: async () => ({ server: '/x', tools }), connect: async () => { throw Error('no login'); } };
  await assert.rejects(M.agentsModule(failing).install(), /Codex: no login/);
});

test('module buttons by state', () => {
  assert.equal(M.moduleButton({ state: 'desktop' }), null);
  assert.equal(M.moduleButton({ state: 'unavailable' }), null);
  assert.deepEqual(M.moduleButton({ state: 'missing', action: 'Install' }), { label: 'Install', disabled: false });
  assert.deepEqual(M.moduleButton({ state: 'installed', action: 'Open' }), { label: 'Open', disabled: false });
  assert.equal(M.moduleButton({ state: 'installed' }), null);
  assert.deepEqual(M.moduleButton({ state: 'error' }), { label: 'Check again', disabled: false, recheck: true });
});
