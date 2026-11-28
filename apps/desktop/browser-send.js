// The setup wizard's Browser extension card (setup-modules.js browserSendModule): sets up the
// NoteComplete Send extension (github.com/Emefedez/NoteComplete-send) for Chromium-family
// browsers. Two parts:
//   - the native messaging host: send-host.cjs copied out of the app with its config and a
//     wrapper that runs it with this app's Electron as Node, and a host manifest in every
//     browser's NativeMessagingHosts folder (the registry on Windows) that lets only the
//     extension's id start it;
//   - the extension itself: the latest release of the repository, its `extension/` folder
//     unpacked into the app's settings folder, for chrome://extensions → Load unpacked.
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { HOST_NAME } from './send-hub.js';

export const EXTENSION_REPO = 'Emefedez/NoteComplete-send';
// Fixed by the "key" in the extension's manifest.json.
export const EXTENSION_ID = 'pigfplmpjmlimhhljlkjaoceecfpddei';

// Where each browser looks for host manifests (per user).
export function browserFolders(platform = process.platform, home = os.homedir()) {
  if (platform === 'linux') {
    const c = path.join(home, '.config');
    return [
      ['Chromium', path.join(c, 'chromium')], ['Google Chrome', path.join(c, 'google-chrome')],
      ['Chrome Beta', path.join(c, 'google-chrome-beta')], ['Brave', path.join(c, 'BraveSoftware', 'Brave-Browser')],
      ['Microsoft Edge', path.join(c, 'microsoft-edge')], ['Vivaldi', path.join(c, 'vivaldi')], ['Opera', path.join(c, 'opera')],
    ].map(([name, dir]) => ({ name, dir, hosts: path.join(dir, 'NativeMessagingHosts') }));
  }
  if (platform === 'darwin') {
    const s = path.join(home, 'Library', 'Application Support');
    return [
      ['Chromium', path.join(s, 'Chromium')], ['Google Chrome', path.join(s, 'Google', 'Chrome')],
      ['Brave', path.join(s, 'BraveSoftware', 'Brave-Browser')], ['Microsoft Edge', path.join(s, 'Microsoft Edge')], ['Vivaldi', path.join(s, 'Vivaldi')],
    ].map(([name, dir]) => ({ name, dir, hosts: path.join(dir, 'NativeMessagingHosts') }));
  }
  // Windows: registry keys, one manifest file.
  return [
    ['Google Chrome', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts'], ['Chromium', 'HKCU\\Software\\Chromium\\NativeMessagingHosts'],
    ['Microsoft Edge', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts'], ['Brave', 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts'],
  ].map(([name, key]) => ({ name, key: `${key}\\${HOST_NAME}` }));
}

export function hostManifest(wrapper, id = EXTENSION_ID) {
  return { name: HOST_NAME, description: 'NoteComplete Send: files from the browser into NoteComplete notebooks', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
}

// The wrapper the browser runs: this app's executable as Node, on the copied host script.
export function wrapperScript({ platform = process.platform, exe, script }) {
  if (platform === 'win32') return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`;
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${q(exe)} ${q(script)} "$@"\n`;
}

// A tar archive's regular files, as [{ name, bytes }] (ustar, with pax path headers, as GitHub
// makes them).
export function untar(buffer) {
  const out = [];
  let at = 0, paxPath = null;
  const text = (from, len) => buffer.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '');
  while (at + 512 <= buffer.length) {
    const header = buffer.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = text(at + 345, 155);
    let name = (prefix ? prefix + '/' : '') + text(at, 100);
    const body = buffer.subarray(at + 512, at + 512 + size);
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else if (type !== 'g') {
      if (paxPath) { name = paxPath; paxPath = null; }
      if (type === '0' || type === '\0') out.push({ name, bytes: Buffer.from(body) });
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export function browserSend({ userData, exe, hostSource, platform = process.platform, home = os.homedir(), fetchImpl = fetch, socketPath, targetsFile, launch }) {
  const hostDir = path.join(userData, 'send-host');
  const extDir = path.join(userData, 'browser-extension');
  const wrapper = path.join(hostDir, platform === 'win32' ? 'notecomplete-send-host.bat' : 'notecomplete-send-host');
  const manifestFile = path.join(hostDir, `${HOST_NAME}.json`);
  const reg = (args) => new Promise((resolve, reject) => execFile('reg', args, { windowsHide: true }, (e, so) => (e ? reject(e) : resolve(so))));

  async function installHost() {
    await mkdir(hostDir, { recursive: true });
    const script = path.join(hostDir, 'send-host.cjs');
    await writeFile(script, await readFile(hostSource));
    await writeFile(path.join(hostDir, 'host-config.json'), JSON.stringify({ socketPath, targetsFile, launch }, null, 2));
    await writeFile(wrapper, wrapperScript({ platform, exe, script }));
    if (platform !== 'win32') await chmod(wrapper, 0o755);
    const manifest = JSON.stringify(hostManifest(wrapper), null, 2);
    await writeFile(manifestFile, manifest);
    const browsers = [];
    for (const b of browserFolders(platform, home)) {
      if (platform === 'win32') {
        try { await reg(['add', b.key, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f']); browsers.push(b.name); } catch { /* not this one */ }
        continue;
      }
      // Only browsers that are installed (their profile folder exists).
      if (!(await stat(b.dir).catch(() => null))) continue;
      await mkdir(b.hosts, { recursive: true });
      await writeFile(path.join(b.hosts, `${HOST_NAME}.json`), manifest);
      browsers.push(b.name);
    }
    return browsers;
  }

  async function installExtension(onProgress = () => {}) {
    onProgress({ text: 'Looking for the latest release' });
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'NoteComplete' };
    const res = await fetchImpl(`https://api.github.com/repos/${EXTENSION_REPO}/releases/latest`, { headers });
    if (!res.ok) throw Error(`Could not find a release of ${EXTENSION_REPO} (HTTP ${res.status}).`);
    const release = await res.json();
    onProgress({ text: `Downloading ${release.tag_name || 'the extension'}` });
    const tar = await fetchImpl(release.tarball_url, { headers: { 'User-Agent': 'NoteComplete' } });
    if (!tar.ok) throw Error(`Could not download the extension (HTTP ${tar.status}).`);
    const files = untar(gunzipSync(Buffer.from(await tar.arrayBuffer())));
    const wanted = files.map((f) => ({ ...f, rel: f.name.split('/').slice(1).join('/') })).filter((f) => f.rel.startsWith('extension/'));
    if (!wanted.some((f) => f.rel === 'extension/manifest.json')) throw Error('The release has no extension folder.');
    await rm(extDir, { recursive: true, force: true });
    for (const f of wanted) {
      const to = path.join(extDir, ...f.rel.slice('extension/'.length).split('/'));
      if (!to.startsWith(extDir + path.sep)) continue;
      await mkdir(path.dirname(to), { recursive: true });
      await writeFile(to, f.bytes);
    }
    return release.tag_name || '';
  }

  async function extensionVersion() {
    try { return JSON.parse(await readFile(path.join(extDir, 'manifest.json'), 'utf8')).version || ''; } catch { return ''; }
  }
  async function hostBrowsers() {
    if (!(await stat(wrapper).catch(() => null))) return [];
    if (platform === 'win32') {
      const found = [];
      for (const b of browserFolders(platform, home)) { try { await reg(['query', b.key, '/ve']); found.push(b.name); } catch { /* none */ } }
      return found;
    }
    const found = [];
    for (const b of browserFolders(platform, home)) if (await stat(path.join(b.hosts, `${HOST_NAME}.json`)).catch(() => null)) found.push(b.name);
    return found;
  }

  return {
    extensionDir: extDir,
    extensionId: EXTENSION_ID,
    async status() {
      const [browsers, version] = await Promise.all([hostBrowsers(), extensionVersion()]);
      return { browsers, version, extensionDir: extDir, extensionId: EXTENSION_ID, installed: browsers.length > 0 && !!version };
    },
    async install(onProgress) {
      const version = await installExtension(onProgress);
      onProgress?.({ text: 'Registering with your browsers' });
      const browsers = await installHost();
      return { ok: true, version, browsers, extensionDir: extDir };
    },
    // The host again (after the app moved, or an update changed the executable's path).
    refreshHost: installHost,
    async uninstall() {
      for (const b of browserFolders(platform, home)) {
        if (platform === 'win32') await reg(['delete', b.key, '/f']).catch(() => {});
        else await rm(path.join(b.hosts, `${HOST_NAME}.json`), { force: true });
      }
      await rm(hostDir, { recursive: true, force: true });
      await rm(extDir, { recursive: true, force: true });
      return { ok: true };
    },
  };
}
