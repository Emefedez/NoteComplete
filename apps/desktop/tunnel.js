// Online access for a sharing session (docs/COLLABORATION.md): a Cloudflare quick tunnel
// gives the session a temporary https://….trycloudflare.com address that works from any
// network, like VS Code's port forwarding. No account is needed. `cloudflared` is
// downloaded once from Cloudflare's GitHub releases, pinned to one version and checked
// against the hashes below before it is ever run. Only notes guests can join through it
// (collab-hub.js); drawing tablets stay on the local network.
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawn as spawnProcess } from 'node:child_process';
import path from 'node:path';

export const CLOUDFLARED_VERSION = '2026.9.1';
const ASSETS = {
  'linux-x64': { name: 'cloudflared-linux-amd64', sha256: '03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc' },
  'linux-arm64': { name: 'cloudflared-linux-arm64', sha256: '3d97437c71848bd8df68041e12436b484a661d95073ea1937f01a845ce88faa3' },
  'darwin-x64': { name: 'cloudflared-darwin-amd64.tgz', sha256: 'ff0d3b51d5ff70eceef89d6b32145fee985018a2174596a5dbe405e2766e2ac4', tgz: true },
  'darwin-arm64': { name: 'cloudflared-darwin-arm64.tgz', sha256: 'c27ab8fd0aa489449e3d201eb02f957ef460a13b613662928b1b23394bf1bcfe', tgz: true },
  'win32-x64': { name: 'cloudflared-windows-amd64.exe', sha256: '2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712' },
};
export function assetFor(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) throw Error(`Online access is not available on ${platform} ${arch}.`);
  return { ...asset, url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.name}` };
}

// One file out of a .tar (the macOS download is a .tgz holding just `cloudflared`).
export function tarFile(tar, wanted) {
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (path.posix.basename(name) === wanted) return tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw Error(`${wanted} is missing from the download.`);
}

// The verified binary in `dir`, downloading it the first time. `progress(0..1)`.
export async function ensureCloudflared({ dir, fetch = globalThis.fetch, platform = process.platform, arch = process.arch, progress = () => {} }) {
  const asset = assetFor(platform, arch);
  const binary = path.join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const stamp = binary + '.sha256';
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  // Kept from before: used only if it is still exactly the program that was verified.
  const [release, verified] = (await readFile(stamp, 'utf8').catch(() => '')).trim().split(' ');
  if (release === asset.sha256 && verified) {
    const kept = await readFile(binary).catch(() => null);
    if (kept && sha(kept) === verified) return binary;
  }
  const response = await fetch(asset.url, { headers: { 'User-Agent': 'NoteComplete' } });
  if (!response.ok || !response.body) throw Error(`Could not download cloudflared (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0, chunks = [];
  let received = 0;
  for await (const chunk of response.body) { chunks.push(chunk); received += chunk.length; if (total) progress(received / total); }
  const bytes = Buffer.concat(chunks);
  if (sha(bytes) !== asset.sha256) throw Error('The cloudflared download does not match its checksum; not using it.');
  const program = asset.tgz ? tarFile(gunzipSync(bytes), 'cloudflared') : bytes;
  await mkdir(dir, { recursive: true });
  const temp = binary + '.download';
  await writeFile(temp, program);
  await chmod(temp, 0o755);
  await rm(binary, { force: true });
  await rename(temp, binary);
  await writeFile(stamp, `${asset.sha256} ${sha(program)}`);
  return binary;
}

export function tunnelAddress(text) {
  return String(text).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] || '';
}

// Starts a quick tunnel to `port` on this computer. Resolves {url, stop} once Cloudflare
// has given the address; `onExit` is told when the tunnel stops on its own.
export function startTunnel({ binary, port, spawn = spawnProcess, timeout = 30000, onExit = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = '', url = '', stopped = false;
    const stop = () => { stopped = true; try { child.kill(); } catch { /* Gone. */ } };
    const timer = setTimeout(() => { reject(Error('Cloudflare did not answer in time. Check the internet connection and try again.')); stop(); }, timeout);
    const read = (data) => {
      log = (log + data.toString()).slice(-8000);
      if (!url && (url = tunnelAddress(log))) { clearTimeout(timer); resolve({ url, stop }); }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!url) reject(Error(`The tunnel stopped (${code}): ${log.trim().split('\n').at(-1) || 'no output'}`));
      else if (!stopped) onExit(code);
    });
  });
}
