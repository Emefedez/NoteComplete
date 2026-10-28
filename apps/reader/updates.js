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
  $('updateGo').onclick = async () => {
    if (!offer) return;
    if ($('updateGo').dataset.restart) return bridge.restart();
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
    try {
      const result = await bridge.check(manual);
      $('updateVersion').textContent = `This is version ${result.current}`;
      if (result.version && (manual || !result.skipped)) show(result);
      else if (manual) status(result.error ? `Could not check for updates: ${result.error}` : `NoteComplete ${result.current} is the latest version.`);
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
  }).catch(() => {});
  // On open: shortly after start, so it never slows the first paint.
  setTimeout(() => check(false), 3000);
}
