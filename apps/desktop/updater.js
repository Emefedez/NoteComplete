// Version checks against GitHub Releases. Nothing is installed without the user's
// say-so: the reader shows what is available and asks. On Linux an AppImage updates
// itself (download beside it, check against SHA256SUMS.txt, swap, keep the old one as
// .previous) and the reader restarts it; elsewhere the release page opens.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, open, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn as spawnProcess } from 'node:child_process';
import { homedir } from 'node:os';

export const REPOSITORY = 'Emefedez/NoteComplete';
// Checks on open are skipped for an hour after one that found nothing (GitHub allows 60
// unauthenticated requests an hour).
export const CHECK_EVERY = 60 * 60 * 1000;

// "1.2.3" or "v1.2.3-beta.1" → comparable parts; a pre-release sorts before its release.
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

// The newest published release (pre-releases included: that is how this project ships).
export function latestRelease(releases) {
  return (releases || []).filter(r => !r.draft && parseVersion(r.tag_name)).sort((x, y) => (newer(x.tag_name, y.tag_name) ? -1 : newer(y.tag_name, x.tag_name) ? 1 : 0))[0] || null;
}

// The installer for this machine, named by electron-builder's artifactName.
export function pickAsset(release, platform, arch) {
  const assets = release?.assets || [];
  if (platform === 'linux') return assets.find(a => new RegExp(`-linux-${arch === 'x64' ? '(x64|x86_64)' : arch}\\.AppImage$`).test(a.name)) || null;
  if (platform === 'darwin') return assets.find(a => new RegExp(`-mac-${arch}\\.dmg$`).test(a.name)) || null;
  if (platform === 'win32') return assets.find(a => /\.exe$/.test(a.name)) || null;
  return null;
}

// "<sha256>  ./name" lines → Map(name → hash).
export function parseSums(text) {
  const sums = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/i);
    if (m) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}

export function updater({ app, fetch = globalThis.fetch, stateFile, appImage = process.env.APPIMAGE || '', platform = process.platform, arch = process.arch, now = () => Date.now(), spawn = spawnProcess, pid = process.pid, env = process.env }) {
  let found = null;
  const state = async () => { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return {}; } };
  const remember = async patch => { await writeFile(stateFile, JSON.stringify({ ...(await state()), ...patch })).catch(() => {}); };
  const api = async path => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NoteComplete' } });
    if (!response.ok) throw Error(`GitHub answered ${response.status}`);
    return response.json();
  };
  // Fallback when GitHub REST API hits its unauthenticated rate limit (403/429):
  // releases.atom + releases/expanded_assets/<tag> are not subject to the REST quota.
  async function webReleases() {
    const atom = await fetch(`https://github.com/${REPOSITORY}/releases.atom`, { headers: { Accept: 'application/atom+xml, text/xml', 'User-Agent': 'NoteComplete' } });
    if (!atom.ok) throw Error(`GitHub answered ${atom.status}`);
    const xml = await atom.text();
    const tags = [], seen = new Set();
    for (const m of xml.matchAll(/\/releases\/tag\/([^"<\s/&]+)/g)) {
      const tag = decodeURIComponent(m[1]);
      if (!seen.has(tag) && parseVersion(tag)) { seen.add(tag); tags.push({ tag_name: tag, html_url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`, draft: false, assets: [] }); }
    }
    const top = latestRelease(tags);
    if (!top) return [];
    const page = await fetch(`https://github.com/${REPOSITORY}/releases/expanded_assets/${encodeURIComponent(top.tag_name)}`, { headers: { 'User-Agent': 'NoteComplete' } });
    if (page.ok) {
      const html = await page.text();
      const assets = [];
      for (const m of html.matchAll(/href="(\/[^"]+\/releases\/download\/[^"/]+\/([^"?#]+))"/g)) {
        assets.push({ name: decodeURIComponent(m[2]), browser_download_url: `https://github.com${m[1]}`, size: 0 });
      }
      top.assets = assets;
    }
    return [top];
  }
  const fetchReleases = () => api('releases?per_page=10').catch(async (err) => {
    try { return await webReleases(); } catch { throw err; }
  });
  // What the reader shows: current version, the newer one (if any), and how it installs.
  async function check({ manual = false } = {}) {
    const s = await state();
    if (!manual && s.checkOnOpen === false) return { current: app.getVersion(), disabled: true };
    if (!manual && s.lastCheck && now() - s.lastCheck < CHECK_EVERY && !s.available) return { current: app.getVersion(), recent: true };
    const release = latestRelease(await fetchReleases());
    await remember({ lastCheck: now() });
    const current = app.getVersion();
    if (!release || !newer(release.tag_name, current)) { found = null; await remember({ available: null }); return { current }; }
    const asset = pickAsset(release, platform, arch);
    const version = release.tag_name.replace(/^v/i, '');
    found = { release, asset };
    await remember({ available: version });
    // Self-update only for an AppImage with a matching installer, in a folder this user can
    // write to (the new file goes beside it and takes its place).
    const why = platform !== 'linux' || !appImage ? 'not an AppImage' : !asset ? 'no AppImage for this machine in the release' : await writable(appImage);
    return {
      current, version, page: release.html_url, skipped: !manual && s.skip === version,
      install: why ? 'page' : 'appimage', ...(why ? { reason: why } : {}),
    };
  }
  // Null when the AppImage's folder can be written to, else why not.
  async function writable(file) {
    try { await access(path.dirname(file), constants.W_OK); return null; } catch { return `cannot write to ${path.dirname(file)}`; }
  }
  async function install(progress = () => {}) {
    if (platform !== 'linux' || !appImage) throw Error('This copy cannot update itself; download the new version from the release page.');
    // What the offer was made from can be gone (a later check failed or this window asked
    // before another): look again rather than give up.
    if (!found?.asset) await check({ manual: true });
    if (!found?.asset) throw Error('The newest release has no AppImage for this machine.');
    const { release, asset } = found;
    const headers = { 'User-Agent': 'NoteComplete' };
    const sumsAsset = release.assets.find(a => a.name === 'SHA256SUMS.txt');
    if (!sumsAsset) throw Error('The release has no checksums; not installing it.');
    const sumsResponse = await fetch(sumsAsset.browser_download_url, { headers });
    if (!sumsResponse.ok) throw Error(`Could not read the checksums (${sumsResponse.status}).`);
    const expected = parseSums(await sumsResponse.text()).get(asset.name);
    if (!expected) throw Error(`The checksums do not list ${asset.name}; not installing it.`);
    const response = await fetch(asset.browser_download_url, { headers });
    if (!response.ok || !response.body) throw Error(`Download failed (${response.status}).`);
    // Streamed to a file beside the AppImage (same file system, so the swap is a rename),
    // hashed on the way: the image is ~150 MB and need not sit in memory.
    const next = `${appImage}.download`, previous = `${appImage}.previous`;
    const total = Number(response.headers.get('content-length')) || asset.size || 0, hash = createHash('sha256');
    let received = 0, out;
    try {
      out = await open(next, 'w', 0o755);
      for await (const chunk of response.body) {
        hash.update(chunk);
        await out.write(chunk);
        received += chunk.length;
        progress(total ? Math.min(received / total, 1) : 0);
      }
      await out.close();
      out = null;
      if (hash.digest('hex') !== expected) throw Error('The download does not match its checksum; not installing it.');
      await chmod(next, (await stat(appImage)).mode | 0o755);
      await rm(previous, { force: true });
      await rename(appImage, previous);
      try { await rename(next, appImage); } catch (error) { await rename(previous, appImage).catch(() => {}); throw error; }
    } catch (error) {
      await out?.close().catch(() => {});
      await rm(next, { force: true });
      if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS') throw Error(`Cannot replace ${appImage}: ${error.code}. Move the AppImage to a folder you own and update again.`);
      throw error;
    }
    progress(1);
    await remember({ available: null, installed: release.tag_name });
    return { version: release.tag_name.replace(/^v/i, '') };
  }
  return {
    check, install,
    skip: version => remember({ skip: version }),
    setCheckOnOpen: on => remember({ checkOnOpen: !!on }),
    settings: async () => ({ checkOnOpen: (await state()).checkOnOpen !== false, current: app.getVersion() }),
    // The old process still holds the single-instance lock while it exits: free it, or the
    // relaunched app takes itself for a second copy and quits at once.
    // An AppImage is not relaunched with app.relaunch: its helper runs from the AppImage's
    // FUSE mount, which goes away with this process, so the helper died and the app just
    // closed. A shell outside the mount waits for this process to end (10 s at most) and
    // starts the new AppImage, without the old mount's variables.
    restart: () => {
      app.releaseSingleInstanceLock?.();
      if (platform === 'linux' && appImage) {
        const clean = { ...env };
        for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete clean[name];
        const wait = 'i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.2; i=$((i+1)); done; exec "$0"';
        spawn('/bin/sh', ['-c', wait, appImage, String(pid)], { detached: true, stdio: 'ignore', env: clean, cwd: homedir() }).unref();
      } else app.relaunch();
      app.exit(0);
    },
  };
}
