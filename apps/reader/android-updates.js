// Updates for the Android app: the same bridge as the desktop's (notecompleteUpdates, used by
// updates.js), made in the reader, since the Android wrapper has no updater of its own. The
// wrapper says its version (window.notecompleteApp, App.js); the reader asks GitHub for the
// newest release (pre-releases included, as the desktop does) and offers its APK, which
// Download opens in the system browser to download and install (an app cannot replace itself
// without asking). "Check when it opens" and skipped versions are kept on the device.
export const REPOSITORY = 'Emefedez/NoteComplete';
export const APK = 'NoteComplete-android.apk';

// Version order, as apps/desktop/updater.js has it (keep the two in step).
export function parseVersion(text) {
  const m = String(text || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  return m ? { parts: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null;
}
export function newer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
}
export function latestRelease(releases) {
  return (releases || []).filter((r) => !r.draft && parseVersion(r.tag_name)).sort((x, y) => (newer(x.tag_name, y.tag_name) ? -1 : newer(y.tag_name, x.tag_name) ? 1 : 0))[0] || null;
}

const KEY = 'notecomplete-android-updates';
export function androidUpdates({ app, fetch = globalThis.fetch, storage = globalThis.localStorage, open = (url) => location.assign(url) }) {
  const current = String(app?.version || '').replace(/^v/i, '');
  const read = () => { try { return { checkOnOpen: true, skipped: [], ...JSON.parse(storage.getItem(KEY) || '{}') }; } catch { return { checkOnOpen: true, skipped: [] }; } };
  const write = (change) => { try { storage.setItem(KEY, JSON.stringify({ ...read(), ...change })); } catch { /* Optional. */ } };
  return {
    async settings() { return { current, checkOnOpen: read().checkOnOpen }; },
    async setCheckOnOpen(on) { write({ checkOnOpen: on === true }); },
    async skip(version) { write({ skipped: [...new Set([...read().skipped, String(version)])] }); },
    // Same answer as the desktop bridge: { current, version?, page, install, skipped, error? }.
    async check(manual = false) {
      if (!manual && !read().checkOnOpen) return { current };
      if (!parseVersion(current)) return { current, error: 'this copy does not say its version' };
      let releases;
      try {
        const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=10`, { headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) return { current, error: `GitHub answered ${response.status}` };
        releases = await response.json();
      } catch (error) { return { current, error: error.message || 'no connection' }; }
      const release = latestRelease(releases);
      const version = release?.tag_name?.replace(/^v/i, '');
      if (!release || !newer(version, current)) return { current };
      const apk = (release.assets || []).find((a) => a.name === APK)?.browser_download_url;
      return { current, version, page: apk || release.html_url, install: apk ? 'apk' : 'page', skipped: read().skipped.includes(version) };
    },
    // Download: the APK (or the release page) in the system browser (App.js opens web links there).
    async openPage(url) { open(url); },
    async install() { throw new Error('Install from the downloaded APK'); },
    restart() {},
  };
}
