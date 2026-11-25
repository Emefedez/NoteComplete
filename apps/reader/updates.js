// New versions (desktop app): a pill in the top bar says what is available and asks;
// nothing installs without Update. Linux AppImages update in place and restart on
// request; other installs open the release page. Help → Check for updates… asks now.
const $ = id => document.getElementById(id);

export function updateNotice({ bridge = globalThis.notecompleteUpdates, status }) {
  if (!bridge) return;
  $('updateItems').hidden = false;
  let offer = null;
  const hide = () => { $('updateChip').hidden = true; };
  const buttons = (go, later = true, skip = true) => {
    $('updateGo').textContent = go; $('updateGo').hidden = !go;
    $('updateLater').hidden = !later; $('updateSkip').hidden = !skip;
  };
  function show(result) {
    offer = result;
    $('updateText').textContent = `Version ${result.version}`;
    $('updateChip').title = `NoteComplete ${result.version} is available (this is ${result.current})`;
    buttons(result.install === 'appimage' ? 'Update' : 'Download');
    $('updateChip').hidden = false;
  }
  // Installed (a release or a branch build): the pill offers the restart.
  function offerRestart(version) {
    offer = { version, install: 'appimage' };
    $('updateText').textContent = `${version} installed`;
    $('updateChip').title = `NoteComplete ${version} is installed; it starts with the next restart`;
    $('updateGo').dataset.restart = '1';
    buttons('Restart now', true, false);
    $('updateLater').textContent = 'Later';
    $('updateChip').hidden = false;
  }
  const branch = branchDialog({ bridge, status, offerRestart, chip: (text) => {
    offer = { building: true };
    delete $('updateGo').dataset.restart;
    $('updateText').textContent = text;
    $('updateChip').title = 'A branch build is running (Help → Update from a branch…)';
    buttons('Details', true, false);
    $('updateChip').hidden = false;
  }, hide });
  $('updateGo').onclick = async () => {
    if (!offer) return;
    if ($('updateGo').dataset.restart) return bridge.restart();
    if (offer.building) return branch?.open();
    if (offer.install !== 'appimage') { await bridge.openPage(offer.page); return hide(); }
    buttons('', false, false);
    $('updateText').textContent = 'Downloading…';
    try {
      await bridge.install(p => { $('updateText').textContent = `Downloading ${Math.round(p * 100)}%`; });
      $('updateText').textContent = `${offer.version} installed`;
      $('updateGo').dataset.restart = '1';
      buttons('Restart now', true, false);
      $('updateLater').textContent = 'Later';
    } catch (error) {
      $('updateText').textContent = error.message;
      buttons('Download', true, false);
      offer = { ...offer, install: 'page' };
    }
  };
  $('updateLater').onclick = hide;
  $('updateSkip').onclick = async () => { if (offer) await bridge.skip(offer.version); hide(); status(`Version ${offer?.version} will not be offered again. Help → Check for updates… still finds it.`); };
  async function check(manual = false) {
    if (manual) status('Checking for updates…');
    try {
      const result = await bridge.check(manual);
      $('updateVersion').textContent = `This is version ${result.current}`;
      if (result.version && (manual || !result.skipped)) show(result);
      else if (manual) status(result.error ? `Could not check for updates: ${result.error}` : `NoteComplete ${result.current} is the latest version.`, Boolean(result.error));
    } catch (error) { if (manual) status(`Could not check for updates: ${error.message}`, true); }
  }
  $('updateCheck').onclick = () => { for (const m of document.querySelectorAll('details.menu')) m.open = false; check(true); };
  $('updateOnOpen').onclick = async () => {
    const on = $('updateOnOpen').getAttribute('aria-checked') !== 'true';
    $('updateOnOpen').setAttribute('aria-checked', String(on));
    await bridge.setCheckOnOpen(on);
  };
  bridge.settings().then(s => {
    $('updateOnOpen').setAttribute('aria-checked', String(s.checkOnOpen));
    $('updateVersion').textContent = `This is version ${s.current}`;
    if ($('homeVersion') && s.current) $('homeVersion').textContent = `v${s.current}`;
  }).catch(() => { /* Optional. */ });
  // On open: shortly after start, so it never slows the first paint.
  setTimeout(() => check(false), 3000);
  // Left open for days: look again every six hours (the offer stays until answered).
  setInterval(() => { if ($('updateChip').hidden) check(false); }, 6 * 60 * 60 * 1000);
}

// Help → Update from a branch (beta)…: one branch of the repository built on this computer and
// installed in place of this copy (desktop branch-build.js); Linux AppImage only.
const BRANCH_KEY = 'notecomplete-update-branch';
function branchDialog({ bridge, status, offerRestart, chip, hide }) {
  const b = bridge.branch, dialog = $('branchDialog');
  if (!b || !dialog || !$('branchOpen')) { if ($('branchOpen')) $('branchOpen').hidden = true; return null; }
  const log = $('branchLog'), say = (text) => { $('branchState').textContent = text; };
  let busy = false;
  const stored = () => { try { return localStorage.getItem(BRANCH_KEY) || ''; } catch { return ''; } };
  const store = (name) => { try { localStorage.setItem(BRANCH_KEY, name); } catch { /* Optional. */ } };
  b.onLine((lines) => {
    log.hidden = false;
    log.textContent = (log.textContent + lines.join('\n') + '\n').slice(-30000);
    log.scrollTop = log.scrollHeight;
  });
  b.onStep((step) => { say(`${step}…`); if (busy) chip(`Building ${$('branchName').value.trim()}: ${step.toLowerCase()}`); });
  function setBusy(on) {
    busy = on;
    for (const id of ['branchBuild', 'branchName', 'branchStable']) $(id).disabled = on;
    $('branchCancel').hidden = !on;
  }
  async function refresh() {
    const info = await b.info();
    $('branchRunning').textContent = info.running
      ? `This copy is a branch build: ${info.current}${info.last?.version === info.current ? `, from ${info.last.branch}` : ''}.`
      : `This copy is release ${info.current}.`;
    $('branchStable').hidden = !info.running;
    if (!info.supported) {
      $('branchBuild').disabled = true;
      say('Branch builds need the Linux AppImage of NoteComplete: other installs cannot replace themselves. From a checkout of the repository, python3 tools/update_appimage.py (Linux) or npm run dist in apps/desktop builds one by hand.');
      return info;
    }
    if (info.building) { $('branchName').value = info.building; setBusy(true); return info; }
    setBusy(false);
    if (!$('branchName').value) $('branchName').value = stored() || info.last?.branch || '';
    b.list().then((heads) => {
      $('branchList').replaceChildren(...heads.map((h) => Object.assign(document.createElement('option'), { value: h.name })));
    }).catch(() => { /* Typing a name still works. */ });
    const missing = await b.missing().catch(() => []);
    if (missing.length) say(`Install ${missing.join(', ')} on this computer first: the build runs them.`);
    else await describe();
    return info;
  }
  async function describe() {
    const name = $('branchName').value.trim();
    if (!name || busy) return;
    say(`Looking up ${name}…`);
    try {
      const s = await b.status(name);
      const sha = s.sha.slice(0, 7);
      say(s.current ? `This copy is already the newest commit of ${name} (${sha}); building again reinstalls it.`
        : `Newest commit of ${name}: ${sha}${s.built && s.built !== s.sha ? `, last built here: ${s.built.slice(0, 7)}` : ''}.`);
    } catch (error) { say(error.message); }
  }
  async function open() {
    for (const m of document.querySelectorAll('details.menu')) m.open = false;
    if (!dialog.open) dialog.showModal();
    try { await refresh(); } catch (error) { say(error.message); }
  }
  $('branchOpen').onclick = open;
  $('branchName').onchange = describe;
  $('branchBuild').onclick = async () => {
    if ($('branchBuild').dataset.restart) return bridge.restart();
    const name = $('branchName').value.trim();
    if (!name) { say('Type the name of a branch (the list has the ones on GitHub).'); return; }
    store(name);
    log.textContent = ''; log.hidden = false;
    setBusy(true);
    say('Starting…');
    chip(`Building ${name}…`);
    try {
      const done = await b.build(name);
      const minutes = Math.max(1, Math.round((done.seconds || 0) / 60));
      say(`Installed ${done.version} (built in about ${minutes} min). It starts with the next restart; the copy you had is kept as NoteComplete.AppImage.previous.`);
      $('branchBuild').dataset.restart = '1';
      $('branchBuild').textContent = 'Restart now';
      offerRestart(done.version);
      status(`Branch ${name} built and installed: restart NoteComplete to use it.`);
    } catch (error) {
      say(`${error.message} This copy was not changed; Build log has the details.`);
      hide();
      if (!dialog.open) status(`Branch build failed: ${error.message}`, true);
    } finally {
      setBusy(false);
      if ($('branchBuild').dataset.restart) $('branchBuild').disabled = false;
    }
  };
  $('branchCancel').onclick = () => { b.cancel(); say('Stopping the build…'); };
  $('branchLogOpen').onclick = () => b.openLog();
  $('branchClose').onclick = () => dialog.close();
  $('branchStable').onclick = async () => {
    setBusy(true);
    try {
      const release = await bridge.stable();
      if (release.install !== 'appimage') { await bridge.openPage(release.page); return; }
      say(`Downloading ${release.version}…`);
      await bridge.install((p) => say(`Downloading ${release.version}: ${Math.round(p * 100)}%`));
      say(`Release ${release.version} installed; it starts with the next restart.`);
      $('branchBuild').dataset.restart = '1';
      $('branchBuild').textContent = 'Restart now';
      offerRestart(release.version);
    } catch (error) { say(error.message); }
    finally { setBusy(false); if ($('branchBuild').dataset.restart) $('branchBuild').disabled = false; }
  };
  return { open };
}
