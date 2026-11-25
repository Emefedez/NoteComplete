// Desktop Euro-Office Bridge (docs/TABLES-AND-OFFICE.md phases 3c and 6):
// Manages the optional Euro-Office DocumentServer module on 127.0.0.1:
//   - Linux x64/arm64: rootless unshare + pasta (proven in the spike), or podman/docker when ready.
//   - Windows x64: WSL2 distribution (`wsl --import NoteComplete-EuroOffice`), no Docker Desktop.
//   - macOS arm64: Apple `container`, Podman, Docker Desktop, OrbStack, or Colima.
// Starts on demand on a random free 127.0.0.1 port with a generated JWT secret, serves documents
// and receives save callbacks over one-time random-token loopback endpoints, and stops when idle
// (~10 min with no editor open) or when NoteComplete quits.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICE_IMAGE, gunzipTo, imageArch, imageRef, pullImage } from './office-image.js';

export { OFFICE_IMAGE, imageArch, imageRef };

const CONTAINER_NAME = 'notecomplete-euro-office';
const WSL_DISTRO = 'NoteComplete-EuroOffice';
const PASTA_HOST_GW = '169.254.1.2';
const DEFAULT_IDLE_MS = 10 * 60 * 1000;
const CONVERTER_CONFIG = JSON.stringify({ FileConverter: { converter: { maxprocesscount: 0.1 } } }, null, 2) + '\n';

const FALLBACK_DOC_TYPE = {
  docx: 'word', docm: 'word', dotx: 'word', dotm: 'word', doc: 'word', dot: 'word',
  odt: 'word', ott: 'word', fodt: 'word', rtf: 'word', epub: 'word', fb2: 'word',
  pages: 'word', wps: 'word', wpt: 'word', hwp: 'word', hwpx: 'word', gdoc: 'word',
  xlsx: 'cell', xlsm: 'cell', xlsb: 'cell', xltx: 'cell', xltm: 'cell', xls: 'cell',
  xlt: 'cell', ods: 'cell', ots: 'cell', fods: 'cell', csv: 'cell', tsv: 'cell',
  numbers: 'cell', et: 'cell', ett: 'cell', gsheet: 'cell',
  pptx: 'slide', pptm: 'slide', ppsx: 'slide', ppsm: 'slide', potx: 'slide', potm: 'slide',
  ppt: 'slide', pot: 'slide', pps: 'slide', odp: 'slide', otp: 'slide', fodp: 'slide',
  odg: 'slide', key: 'slide', dps: 'slide', dpt: 'slide', gslides: 'slide',
  pdf: 'pdf', djvu: 'pdf', xps: 'pdf', oxps: 'pdf', docxf: 'pdf', oform: 'pdf',
  vsdx: 'diagram', vsdm: 'diagram', vssx: 'diagram', vssm: 'diagram', vstx: 'diagram', vstm: 'diagram',
};

export function defaultModuleDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.NOTECOMPLETE_OFFICE_MODULE_DIR) return path.resolve(env.NOTECOMPLETE_OFFICE_MODULE_DIR);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'NoteComplete', 'modules', 'euro-office');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'NoteComplete', 'modules', 'euro-office');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'NoteComplete', 'modules', 'euro-office');
}

export const defaultImageDir = (env = process.env) => (env.NOTECOMPLETE_OFFICE_IMAGE_DIR ? path.resolve(env.NOTECOMPLETE_OFFICE_IMAGE_DIR) : '');

export function defaultRunnerDir() {
  return fileURLToPath(new URL('./office-runner/', import.meta.url));
}

const b64url = (value) => Buffer.from(value).toString('base64url');

export function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function documentTypeFor(ext, formats = null) {
  const clean = String(ext || '').replace(/^\./, '').toLowerCase();
  if (Array.isArray(formats)) {
    const found = formats.find((f) => String(f?.name || '').toLowerCase() === clean && f?.type);
    if (found?.type) return found.type;
  }
  return FALLBACK_DOC_TYPE[clean] || 'word';
}

export function runProcess(cmd, args, { cwd, env, timeoutMs = 120000, maxBytes = 4 * 1024 * 1024, onStdoutLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out = [], err = [];
    let outLen = 0, errLen = 0, timedOut = false, lineBuf = '';
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500).unref?.();
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => {
      if (outLen < maxBytes) { out.push(chunk); outLen += chunk.length; }
      if (onStdoutLine) {
        lineBuf += chunk.toString('utf8');
        const lines = lineBuf.split(/\r?\n/);
        lineBuf = lines.pop() || '';
        for (const line of lines) onStdoutLine(line);
      }
    });
    child.stderr.on('data', (chunk) => { if (errLen < maxBytes) { err.push(chunk); errLen += chunk.length; } });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (onStdoutLine && lineBuf) onStdoutLine(lineBuf);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      else resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const safeReadText = async (file) => { try { return await readFile(file, 'utf8'); } catch { return ''; } };

export async function detectLinuxRunner({
  run = runProcess,
  readText = safeReadText,
  env = process.env,
  user = os.userInfo().username,
  uid = typeof process.getuid === 'function' ? process.getuid() : 1000,
  preferRootless = false,
} = {}) {
  const checkCmd = async (cmd, args) => {
    try { return await run(cmd, args, { timeoutMs: 5000 }); }
    catch { return { code: -1, stdout: '', stderr: '' }; }
  };

  // Prefer podman or docker when present and usable without sudo, unless rootless is explicitly preferred
  // (e.g. when a local unpacked image cache is provided in dev/test).
  if (!preferRootless) {
    const podman = await checkCmd('podman', ['info', '--format', '{{.Host.Arch}}']);
    if (podman.code === 0) return { runner: 'podman', ready: true, hostAlias: 'host.containers.internal', detail: 'Using Podman', missing: [] };
    const docker = await checkCmd('docker', ['info', '--format', '{{.OSType}}']);
    if (docker.code === 0) return { runner: 'docker', ready: true, hostAlias: 'host.docker.internal', detail: 'Using Docker', missing: [] };
  }

  // Rootless runner (unshare --map-auto + pasta + newuidmap + python3).
  const apparmor = (await readText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')).trim();
  if (apparmor === '1') {
    return {
      runner: 'rootless',
      ready: false,
      apparmorRestricted: true,
      hostAlias: PASTA_HOST_GW,
      missing: ['apparmor-userns'],
      detail: 'Ubuntu AppArmor restricts unprivileged user namespaces. Install Podman or Docker, or allow user namespaces with: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0',
    };
  }
  const missing = [];
  const unshareHelp = await checkCmd('unshare', ['--help']);
  if (unshareHelp.code !== 0 || !unshareHelp.stdout.includes('--map-auto')) missing.push('unshare (--map-auto, util-linux 2.40+)');
  const pasta = await checkCmd('pasta', ['--version']);
  if (pasta.code !== 0) missing.push('pasta (package passt)');
  const py = await checkCmd('python3', ['--version']);
  if (py.code !== 0) missing.push('python3');
  const newuid = await checkCmd('sh', ['-c', 'command -v newuidmap']);
  if (newuid.code !== 0) missing.push('newuidmap (package uidmap)');
  const subuid = await readText('/etc/subuid');
  const hasSubuid = subuid.split(/\r?\n/).some((line) => line.startsWith(`${user}:`) || line.startsWith(`${uid}:`));
  if (!hasSubuid) missing.push(`subuid range in /etc/subuid for ${user}`);

  if (missing.length) {
    return {
      runner: 'rootless',
      ready: false,
      hostAlias: PASTA_HOST_GW,
      missing,
      detail: `Missing on this system: ${missing.join(', ')}. Install them (or Podman / Docker) to run Euro-Office.`,
    };
  }
  return { runner: 'rootless', ready: true, hostAlias: PASTA_HOST_GW, detail: 'Built-in rootless runner', missing: [] };
}

export async function detectWindowsRunner({ run = runProcess, runnerDir = defaultRunnerDir() } = {}) {
  const ps1 = path.join(runnerDir, 'windows', 'euro-office.ps1');
  try {
    const res = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Action', 'Check'], { timeoutMs: 15000 });
    const parsed = JSON.parse(res.stdout.trim().split(/\r?\n/).pop() || '{}');
    if (parsed.rebootNeeded) {
      return { runner: 'wsl', ready: false, rebootNeeded: true, hostAlias: '127.0.0.1', missing: ['reboot'], detail: 'Restart Windows to finish enabling WSL2, then install Euro-Office.' };
    }
    if (!parsed.wsl || !parsed.version2) {
      return { runner: 'wsl', ready: true, needsEnable: true, distro: false, hostAlias: '127.0.0.1', missing: [], detail: 'Installing will enable WSL2 (asks for administrator permission once and may need a restart).' };
    }
    return { runner: 'wsl', ready: true, needsEnable: false, distro: Boolean(parsed.distro), hostAlias: '127.0.0.1', missing: [], detail: 'Using WSL2' };
  } catch (e) {
    return { runner: 'wsl', ready: false, hostAlias: '127.0.0.1', missing: ['wsl2'], detail: `Could not check WSL2: ${e.message}` };
  }
}

export async function detectMacRunner({ run = runProcess, runnerDir = defaultRunnerDir() } = {}) {
  const script = path.join(runnerDir, 'macos', 'euro-office.sh');
  try {
    const res = await run('sh', [script, 'check'], { timeoutMs: 15000 });
    const parsed = JSON.parse(res.stdout.trim().split(/\r?\n/).pop() || '{}');
    if (!parsed.runtime || parsed.runtime === 'none') {
      return { runner: 'none', ready: false, hostAlias: '', missing: ['container-runtime'], detail: parsed.detail || 'Install Podman, Docker Desktop, OrbStack, Colima, or Apple container (macOS 26+).' };
    }
    return { runner: parsed.runtime, ready: Boolean(parsed.ready), hostAlias: parsed.hostAlias || 'host.docker.internal', missing: parsed.ready ? [] : [parsed.runtime], detail: parsed.detail || `Using ${parsed.runtime}` };
  } catch (e) {
    return { runner: 'none', ready: false, hostAlias: '', missing: ['container-runtime'], detail: `Could not check container runtimes: ${e.message}` };
  }
}

export function createOfficeBridge({
  moduleDir = defaultModuleDir(),
  imageDir = defaultImageDir(),
  runnerDir = defaultRunnerDir(),
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  image = OFFICE_IMAGE,
  run = runProcess,
  spawnProcess = spawn,
  readText = safeReadText,
  fetch = globalThis.fetch,
  idleMs = DEFAULT_IDLE_MS,
  onSaved = () => {},
  onLog = () => {},
} = {}) {
  const targetArch = imageArch(arch);
  const pin = targetArch ? image.arch[targetArch] : null;
  const manifestFile = path.join(moduleDir, 'module.json');
  const secretFile = path.join(moduleDir, 'jwt_secret');
  const stateDir = path.join(moduleDir, 'state');
  const dataDir = path.join(moduleDir, 'data');
  const configDir = path.join(moduleDir, 'config');
  const configFile = path.join(configDir, 'local-production-linux.json');
  const versionDir = path.join(moduleDir, 'versions', image.tag);
  const rootfsDir = path.join(versionDir, 'rootfs');
  const imageCacheDir = path.join(versionDir, 'image');

  let running = null; // { port, runner, hostAlias, child? }
  let starting = null;
  let installing = null;
  let idleTimer = null;
  let cbServer = null;
  let cbPort = 0;
  const sessions = new Map(); // sessionId -> session
  const docTokens = new Map(); // docToken -> sessionId
  const cbTokens = new Map(); // cbToken -> sessionId

  async function readModuleMeta() {
    try {
      const raw = await readFile(manifestFile, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch { return null; }
  }

  async function writeModuleMeta(meta) {
    await mkdir(moduleDir, { recursive: true });
    await writeFile(manifestFile, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  }

  async function ensureSecret() {
    await mkdir(moduleDir, { recursive: true });
    try {
      const existing = (await readFile(secretFile, 'utf8')).trim();
      if (existing.length >= 32) return existing;
    } catch { /* Generate below. */ }
    const secret = randomBytes(32).toString('hex');
    await writeFile(secretFile, secret + '\n', { mode: 0o600 });
    await chmod(secretFile, 0o600).catch(() => {});
    return secret;
  }

  async function ensureConverterConfig() {
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, CONVERTER_CONFIG, 'utf8');
    return configFile;
  }

  async function detectRunner() {
    if (platform === 'linux') {
      const preferRootless = env.NOTECOMPLETE_OFFICE_RUNNER === 'rootless' || Boolean(imageDir);
      return detectLinuxRunner({ run, readText, env, preferRootless });
    }
    if (platform === 'win32') return detectWindowsRunner({ run, runnerDir });
    if (platform === 'darwin') return detectMacRunner({ run, runnerDir });
    return { runner: 'none', ready: false, hostAlias: '', missing: [platform], detail: `Euro-Office is not supported on ${platform}.` };
  }

  async function status() {
    if (!targetArch || !pin) {
      return {
        installed: false, state: 'unavailable', platform, arch,
        detail: `No Euro-Office image is published for ${platform} (${arch}).`,
        downloadBytes: 0, diskBytes: image.diskBytes,
        licence: image.licence, sourceUrl: image.sourceUrl,
      };
    }
    const meta = await readModuleMeta();
    const runnerInfo = await detectRunner();
    const installed = Boolean(meta?.version && (
      meta.runner !== 'rootless' || existsSync(path.join(moduleDir, 'versions', meta.tag || image.tag, 'rootfs', 'entrypoint.sh'))
    ));
    const state = installed ? 'installed' : runnerInfo.ready ? 'missing' : 'unavailable';
    return {
      installed,
      state,
      version: meta?.version || image.version,
      tag: meta?.tag || image.tag,
      digest: meta?.digest || pin.digest,
      arch: targetArch,
      platform,
      runner: meta?.runner || runnerInfo.runner,
      running: Boolean(running),
      port: running?.port || 0,
      downloadBytes: pin.bytes,
      diskBytes: image.diskBytes,
      licence: meta?.licence || image.licence,
      notice: meta?.notice || '',
      sourceUrl: meta?.sourceUrl || image.sourceUrl,
      formats: installed && Array.isArray(meta?.formats) ? meta.formats : null,
      detail: installed ? (running ? `Running (${meta.runner})` : `Ready (${meta.runner})`) : runnerInfo.detail,
      missing: runnerInfo.missing || [],
      rebootNeeded: Boolean(runnerInfo.rebootNeeded),
      apparmorRestricted: Boolean(runnerInfo.apparmorRestricted),
      needsEnable: Boolean(runnerInfo.needsEnable),
    };
  }

  async function install(onProgress = () => {}) {
    if (installing) return installing;
    installing = (async () => {
      if (!targetArch || !pin) throw Error(`No Euro-Office image is published for ${platform} (${arch}).`);
      const runnerInfo = await detectRunner();
      if (!runnerInfo.ready) throw Error(runnerInfo.detail || 'System requirements for Euro-Office are not met.');

      await mkdir(moduleDir, { recursive: true });
      await mkdir(dataDir, { recursive: true });
      await ensureSecret();
      await ensureConverterConfig();

      let formats = [];
      let notice = '';

      if (platform === 'linux' && runnerInfo.runner === 'rootless') {
        onProgress({ phase: 'downloading', text: imageDir ? 'Reading cached image' : 'Downloading Euro-Office (~1 GB)', received: 0, total: pin.bytes, fraction: 0 });
        await pullImage({
          arch: targetArch,
          dir: imageCacheDir,
          image,
          fetch,
          localDir: imageDir,
          onProgress: (p) => {
            const fraction = p.total > 0 ? Math.min(1, p.received / p.total) * 0.75 : undefined;
            onProgress({ ...p, fraction, text: p.phase === 'verifying' ? 'Verifying image layers' : `Downloading Euro-Office (${Math.round((p.received / (p.total || 1)) * 100)}%)` });
          },
        });
        onProgress({ phase: 'unpacking', text: 'Unpacking Euro-Office rootfs', fraction: 0.8 });
        const unpackPy = path.join(runnerDir, 'linux', 'unpack.py');
        const res = await run('unshare', ['--map-auto', '--map-root-user', '--', 'python3', '-I', unpackPy, imageCacheDir, rootfsDir], { timeoutMs: 300000 });
        if (res.code !== 0) throw Error(`Unpacking Euro-Office failed: ${res.stderr.trim() || res.stdout.trim()}`);
        // Write 1-worker converter config inside the rootfs so it survives restarts.
        const destConf = path.join(rootfsDir, 'etc', 'euro-office', 'documentserver', 'local-production-linux.json');
        await mkdir(path.dirname(destConf), { recursive: true });
        await copyFile(configFile, destConf);
        // Extract formats manifest & NOTICE from the unpacked image.
        const formatsRaw = await readText(path.join(rootfsDir, 'var', 'www', 'euro-office', 'documentserver', 'document-formats', 'onlyoffice-docs-formats.json'));
        try { const parsed = JSON.parse(formatsRaw); if (Array.isArray(parsed)) formats = parsed; } catch { /* Fallback to built-in list. */ }
        notice = (await readText(path.join(rootfsDir, 'var', 'www', 'euro-office', 'documentserver', 'NOTICE'))).trim();
        // Remove the downloaded layer cache to save ~1 GB on disk once unpacked.
        await rm(imageCacheDir, { recursive: true, force: true }).catch(() => {});
      } else if (platform === 'linux' && (runnerInfo.runner === 'podman' || runnerInfo.runner === 'docker')) {
        const ref = imageRef(targetArch, image);
        onProgress({ phase: 'downloading', text: `Pulling Euro-Office with ${runnerInfo.runner} (~1 GB)`, fraction: 0.1 });
        const pull = await run(runnerInfo.runner, ['pull', ref], { timeoutMs: 600000 });
        if (pull.code !== 0) throw Error(`${runnerInfo.runner} pull failed: ${pull.stderr.trim() || pull.stdout.trim()}`);
        onProgress({ phase: 'verifying', text: 'Reading module manifest', fraction: 0.9 });
        const fmts = await run(runnerInfo.runner, ['run', '--rm', '--entrypoint', 'cat', ref, '/var/www/euro-office/documentserver/document-formats/onlyoffice-docs-formats.json'], { timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
        try { const parsed = JSON.parse(fmts.stdout); if (Array.isArray(parsed)) formats = parsed; } catch {}
        const ntc = await run(runnerInfo.runner, ['run', '--rm', '--entrypoint', 'cat', ref, '/var/www/euro-office/documentserver/NOTICE'], { timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
        if (ntc.code === 0) notice = ntc.stdout.trim();
      } else if (platform === 'win32') {
        const ps1 = path.join(runnerDir, 'windows', 'euro-office.ps1');
        if (runnerInfo.needsEnable) {
          onProgress({ phase: 'enabling', text: 'Enabling WSL2 (approve administrator prompt)', fraction: 0.05 });
          const en = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Action', 'Enable'], { timeoutMs: 300000 });
          const parsed = JSON.parse(en.stdout.trim().split(/\r?\n/).pop() || '{}');
          if (!parsed.ok) throw Error(parsed.error || 'Could not enable WSL2.');
          if (parsed.rebootNeeded) return { ok: false, rebootNeeded: true, text: 'WSL2 enabled. Restart Windows and click Install again.' };
        }
        onProgress({ phase: 'downloading', text: 'Downloading Euro-Office (~1 GB)', received: 0, total: pin.bytes, fraction: 0.1 });
        const pulled = await pullImage({
          arch: targetArch, dir: imageCacheDir, image, fetch, localDir: imageDir,
          onProgress: (p) => onProgress({ ...p, fraction: p.total > 0 ? 0.1 + (p.received / p.total) * 0.65 : undefined, text: `Downloading Euro-Office (${Math.round((p.received / (p.total || 1)) * 100)}%)` }),
        });
        onProgress({ phase: 'unpacking', text: 'Importing into WSL2', fraction: 0.8 });
        const baseTar = path.join(versionDir, 'base.tar');
        await gunzipTo(pulled.layers[0], baseTar);
        const restLayers = pulled.layers.slice(1).join(';');
        const applySh = path.join(runnerDir, 'windows', 'apply-layer.sh');
        const wslDir = path.join(versionDir, 'wsl');
        const imp = await run('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
          '-Action', 'Import', '-Distro', WSL_DISTRO, '-InstallDir', wslDir, '-BaseTar', baseTar, '-Layers', restLayers, '-ApplyScript', applySh,
        ], { timeoutMs: 600000 });
        await rm(baseTar, { force: true }).catch(() => {});
        await rm(imageCacheDir, { recursive: true, force: true }).catch(() => {});
        if (imp.code !== 0) throw Error(`WSL import failed: ${imp.stderr.trim() || imp.stdout.trim()}`);
        const fmts = await run('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', '--', 'cat', '/var/www/euro-office/documentserver/document-formats/onlyoffice-docs-formats.json'], { timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
        try { const parsed = JSON.parse(fmts.stdout); if (Array.isArray(parsed)) formats = parsed; } catch {}
        const ntc = await run('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', '--', 'cat', '/var/www/euro-office/documentserver/NOTICE'], { timeoutMs: 30000 }).catch(() => ({ code: 1, stdout: '' }));
        if (ntc.code === 0) notice = ntc.stdout.trim();
      } else if (platform === 'darwin') {
        const script = path.join(runnerDir, 'macos', 'euro-office.sh');
        const ref = imageRef(targetArch, image);
        onProgress({ phase: 'downloading', text: `Pulling Euro-Office with ${runnerInfo.runner} (~1 GB)`, fraction: 0.1 });
        const pull = await run('sh', [script, 'pull', ref, runnerInfo.runner], { timeoutMs: 600000 });
        if (pull.code !== 0) throw Error(`Pulling image failed: ${pull.stderr.trim() || pull.stdout.trim()}`);
        onProgress({ phase: 'verifying', text: 'Reading module manifest', fraction: 0.9 });
        const metaDir = path.join(versionDir, 'meta');
        await run('sh', [script, 'inspect', ref, metaDir, runnerInfo.runner], { timeoutMs: 60000 }).catch(() => {});
        try { const parsed = JSON.parse(await readText(path.join(metaDir, 'formats.json'))); if (Array.isArray(parsed)) formats = parsed; } catch {}
        notice = (await readText(path.join(metaDir, 'NOTICE'))).trim();
      }

      const meta = {
        version: image.version,
        tag: image.tag,
        digest: pin.digest,
        arch: targetArch,
        runner: runnerInfo.runner,
        installedAt: new Date().toISOString(),
        fontsGenerated: false,
        formats,
        licence: image.licence,
        notice,
        sourceUrl: image.sourceUrl,
      };
      await writeModuleMeta(meta);
      onProgress({ phase: 'done', text: `Installed Euro-Office ${image.version}`, fraction: 1 });
      return { ok: true, version: image.version, tag: image.tag, runner: runnerInfo.runner };
    })().finally(() => { installing = null; });
    return installing;
  }

  async function uninstall({ keepData = false } = {}) {
    await stop();
    const meta = await readModuleMeta();
    const versionsPath = path.join(moduleDir, 'versions');
    if (platform === 'linux') {
      if (meta?.runner === 'podman' || meta?.runner === 'docker') {
        if (targetArch && pin) await run(meta.runner, ['rmi', imageRef(targetArch, image)], { timeoutMs: 60000 }).catch(() => {});
      }
      if (existsSync(versionsPath)) {
        // Subuid-owned files in the rootfs must be removed inside the user namespace.
        const r = await run('unshare', ['--map-auto', '--map-root-user', 'rm', '-rf', versionsPath], { timeoutMs: 120000 }).catch(() => ({ code: 1 }));
        if (r.code !== 0) await rm(versionsPath, { recursive: true, force: true }).catch(() => {});
      }
    } else if (platform === 'win32') {
      const ps1 = path.join(runnerDir, 'windows', 'euro-office.ps1');
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Action', 'Remove', '-Distro', WSL_DISTRO], { timeoutMs: 60000 }).catch(() => {});
      await rm(versionsPath, { recursive: true, force: true }).catch(() => {});
    } else if (platform === 'darwin') {
      const script = path.join(runnerDir, 'macos', 'euro-office.sh');
      if (targetArch && pin) await run('sh', [script, 'remove', imageRef(targetArch, image), CONTAINER_NAME, meta?.runner || ''], { timeoutMs: 60000 }).catch(() => {});
      await rm(versionsPath, { recursive: true, force: true }).catch(() => {});
    }
    await rm(manifestFile, { force: true }).catch(() => {});
    await rm(secretFile, { force: true }).catch(() => {});
    await rm(stateDir, { recursive: true, force: true }).catch(() => {});
    await rm(configDir, { recursive: true, force: true }).catch(() => {});
    if (!keepData) {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await rm(moduleDir, { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true };
  }

  async function waitForHealth(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthcheck`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const text = (await res.text()).trim();
          if (text === 'true') return true;
        }
      } catch { /* Still booting. */ }
      await delay(500);
    }
    return false;
  }

  async function ensureCallbackServer(secret) {
    if (cbServer && cbPort) return cbPort;
    cbServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        // One-time document fetch by the Document Server.
        if (req.method === 'GET' && url.pathname.startsWith('/doc/')) {
          const token = url.pathname.slice(5);
          const sessionId = docTokens.get(token);
          const session = sessionId ? sessions.get(sessionId) : null;
          if (!session) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': session.bytes.length });
          res.end(session.bytes);
          return;
        }
        // Save callback from the Document Server.
        if (req.method === 'POST' && url.pathname.startsWith('/cb/')) {
          const token = url.pathname.slice(4);
          const sessionId = cbTokens.get(token);
          const session = sessionId ? sessions.get(sessionId) : null;
          if (!session) { res.writeHead(404); res.end('{"error":1}'); return; }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const hdr = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          const claims = verifyJwt(body.token || hdr, secret);
          if (!claims) {
            onLog(`[office] callback rejected: invalid JWT for ${session.name}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end('{"error":1}');
            return;
          }
          const data = claims.payload || claims;
          const st = Number(data.status);
          onLog(`[office] callback status=${st} file=${session.name} hasUrl=${Boolean(data.url)}`);
          if ((st === 2 || st === 6) && data.url) {
            const dl = await fetch(data.url);
            if (!dl.ok) throw Error(`Failed to download saved file (HTTP ${dl.status})`);
            const savedBytes = Buffer.from(await dl.arrayBuffer());
            session.bytes = savedBytes;
            // New key for any future open of the updated version.
            const nextKey = `nc_${randomBytes(12).toString('hex')}`;
            if (st === 2) session.key = nextKey;
            const filetype = String(data.filetype || session.ext).toLowerCase();
            await Promise.resolve(onSaved({
              sessionId: session.sessionId,
              ownerId: session.ownerId,
              status: st,
              bytes: savedBytes,
              ext: filetype,
              name: session.name,
              key: nextKey,
            }));
            if (session.saveWaiter) { session.saveWaiter(); session.saveWaiter = null; }
          } else if (st === 4 && session.saveWaiter) {
            session.saveWaiter(); session.saveWaiter = null;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"error":0}');
          return;
        }
        res.writeHead(404);
        res.end();
      } catch (e) {
        onLog(`[office] callback error: ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":1}');
      }
    });
    await new Promise((resolve, reject) => {
      cbServer.once('error', reject);
      cbServer.listen(0, '127.0.0.1', () => {
        const addr = cbServer.address();
        cbPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    return cbPort;
  }

  function armIdleTimer() {
    clearTimeout(idleTimer);
    if (sessions.size > 0 || !running || idleMs <= 0) return;
    idleTimer = setTimeout(() => {
      if (sessions.size === 0 && running) {
        onLog('[office] idle timeout reached, stopping Euro-Office');
        void stop();
      }
    }, idleMs);
    idleTimer.unref?.();
  }

  async function start() {
    if (running) return running;
    if (starting) return starting;
    starting = (async () => {
      const meta = await readModuleMeta();
      if (!meta) throw Error('Euro-Office is not installed. Install it from Help ▸ Setup wizard ▸ Modules.');
      const secret = await ensureSecret();
      await ensureConverterConfig();
      const port = await getFreePort();
      const generateFonts = meta.fontsGenerated ? 'false' : 'true';
      let hostAlias = PASTA_HOST_GW;
      let child = null;

      if (platform === 'linux' && meta.runner === 'rootless') {
        const runSh = path.join(runnerDir, 'linux', 'run.sh');
        const res = await run('sh', [runSh, rootfsDir, stateDir, String(port), PASTA_HOST_GW], {
          env: { JWT_SECRET: secret, GENERATE_FONTS: generateFonts },
          timeoutMs: 30000,
        });
        if (res.code !== 0) throw Error(`Could not start Euro-Office: ${res.stderr.trim() || res.stdout.trim()}`);
        hostAlias = PASTA_HOST_GW;
      } else if (platform === 'linux' && (meta.runner === 'podman' || meta.runner === 'docker')) {
        const ref = imageRef(targetArch, image);
        hostAlias = meta.runner === 'podman' ? 'host.containers.internal' : 'host.docker.internal';
        await run(meta.runner, ['rm', '-f', CONTAINER_NAME], { timeoutMs: 15000 }).catch(() => {});
        const args = [
          'run', '-d', '--rm', '--name', CONTAINER_NAME,
          '-p', `127.0.0.1:${port}:80`,
          ...(meta.runner === 'docker' ? ['--add-host=host.docker.internal:host-gateway'] : []),
          '-e', 'JWT_ENABLED=true',
          '-e', `JWT_SECRET=${secret}`,
          '-e', 'ALLOW_PRIVATE_IP_ADDRESS=true',
          '-e', `GENERATE_FONTS=${generateFonts}`,
          '-e', 'PLUGINS_ENABLED=false',
          '-v', `${configFile}:/etc/euro-office/documentserver/local-production-linux.json:ro`,
          '-v', `${dataDir}:/var/www/euro-office/Data`,
          ref,
        ];
        const res = await run(meta.runner, args, { timeoutMs: 30000 });
        if (res.code !== 0) throw Error(`Could not start Euro-Office (${meta.runner}): ${res.stderr.trim() || res.stdout.trim()}`);
      } else if (platform === 'win32') {
        hostAlias = '127.0.0.1';
        const startSh = path.join(runnerDir, 'windows', 'start.sh').replace(/\\/g, '/');
        const confUnix = configFile.replace(/\\/g, '/');
        const wslStart = (await run('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', '--', 'wslpath', '-a', startSh], { timeoutMs: 10000 })).stdout.trim();
        const wslConf = (await run('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', '--', 'wslpath', '-a', confUnix], { timeoutMs: 10000 })).stdout.trim();
        child = spawnProcess('wsl.exe', ['-d', WSL_DISTRO, '-u', 'root', '--', 'sh', wslStart, String(port), wslConf], {
          env: { ...process.env, JWT_SECRET: secret, GENERATE_FONTS: generateFonts, WSLENV: 'JWT_SECRET:GENERATE_FONTS' },
          stdio: 'ignore',
          windowsHide: true,
        });
      } else if (platform === 'darwin') {
        const script = path.join(runnerDir, 'macos', 'euro-office.sh');
        const ref = imageRef(targetArch, image);
        hostAlias = meta.runner === 'podman' ? 'host.containers.internal' : 'host.docker.internal';
        const res = await run('sh', [script, 'start', ref, String(port), dataDir, configFile, CONTAINER_NAME, meta.runner], {
          env: { JWT_SECRET: secret, GENERATE_FONTS: generateFonts },
          timeoutMs: 30000,
        });
        if (res.code !== 0) throw Error(`Could not start Euro-Office (${meta.runner}): ${res.stderr.trim() || res.stdout.trim()}`);
      }

      const healthy = await waitForHealth(port, meta.fontsGenerated ? 60000 : 120000);
      if (!healthy) {
        running = { port, runner: meta.runner, hostAlias, child };
        await stop();
        throw Error('Euro-Office did not become ready in time.');
      }
      if (!meta.fontsGenerated) {
        meta.fontsGenerated = true;
        await writeModuleMeta(meta).catch(() => {});
      }
      await ensureCallbackServer(secret);
      running = { port, url: `http://127.0.0.1:${port}`, runner: meta.runner, hostAlias, child, secret };
      armIdleTimer();
      return running;
    })().finally(() => { starting = null; });
    return starting;
  }

  async function stop() {
    clearTimeout(idleTimer);
    idleTimer = null;
    const current = running;
    running = null;
    sessions.clear();
    docTokens.clear();
    cbTokens.clear();
    if (cbServer) {
      const srv = cbServer;
      cbServer = null;
      cbPort = 0;
      await new Promise((resolve) => srv.close(() => resolve()));
    }
    if (!current) return;
    if (platform === 'linux' && current.runner === 'rootless') {
      const stopSh = path.join(runnerDir, 'linux', 'stop.sh');
      await run('sh', [stopSh, stateDir], { timeoutMs: 40000 }).catch(() => {});
    } else if (platform === 'linux' && (current.runner === 'podman' || current.runner === 'docker')) {
      await run(current.runner, ['stop', '-t', '15', CONTAINER_NAME], { timeoutMs: 25000 }).catch(() => {});
      await run(current.runner, ['rm', '-f', CONTAINER_NAME], { timeoutMs: 10000 }).catch(() => {});
    } else if (platform === 'win32') {
      await run('wsl.exe', ['--terminate', WSL_DISTRO], { timeoutMs: 20000 }).catch(() => {});
      try { current.child?.kill('SIGTERM'); } catch {}
    } else if (platform === 'darwin') {
      const script = path.join(runnerDir, 'macos', 'euro-office.sh');
      await run('sh', [script, 'stop', CONTAINER_NAME, current.runner], { timeoutMs: 25000 }).catch(() => {});
    }
  }

  async function openDocument({ bytes, name, mode = 'edit', theme = 'dark', lang = 'en', user = { id: 'nc-owner', name: 'NoteComplete' }, ownerId = 0 } = {}) {
    if (!name) throw Error('Document name is required.');
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    const srv = await start();
    clearTimeout(idleTimer);
    const meta = await readModuleMeta();
    const ext = (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    const sessionId = `eo_${randomBytes(10).toString('hex')}`;
    const docToken = randomBytes(24).toString('hex');
    const cbToken = randomBytes(24).toString('hex');
    const key = `nc_${randomBytes(12).toString('hex')}`;
    const editable = mode !== 'view';

    const config = {
      document: {
        fileType: ext,
        key,
        title: path.basename(String(name)),
        url: `http://${srv.hostAlias}:${cbPort}/doc/${docToken}`,
        permissions: { edit: editable, download: true, print: true, review: editable, comment: editable },
      },
      documentType: documentTypeFor(ext, meta?.formats),
      type: 'desktop',
      editorConfig: {
        mode: editable ? 'edit' : 'view',
        lang: String(lang || 'en').split('-')[0] || 'en',
        callbackUrl: `http://${srv.hostAlias}:${cbPort}/cb/${cbToken}`,
        user: { id: String(user?.id || 'nc-owner'), name: String(user?.name || 'NoteComplete') },
        customization: {
          uiTheme: theme === 'dark' ? 'theme-dark' : 'theme-light',
          forcesave: true,
          autosave: true,
          compactHeader: true,
        },
      },
    };
    config.token = signJwt(config, srv.secret);

    const session = { sessionId, ownerId, name: path.basename(String(name)), ext, bytes: buf, mode, key, docToken, cbToken, saveWaiter: null };
    sessions.set(sessionId, session);
    docTokens.set(docToken, sessionId);
    cbTokens.set(cbToken, sessionId);

    return {
      sessionId,
      apiUrl: `${srv.url}/web-apps/apps/api/documents/api.js`,
      serverUrl: srv.url,
      config,
      key,
      mode,
    };
  }

  async function forcesave(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !running) return { ok: false, error: 4 };
    const payload = { c: 'forcesave', key: session.key };
    const token = signJwt(payload, running.secret);
    const res = await fetch(`${running.url}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    });
    const parsed = await res.json().catch(() => ({ error: -1 }));
    return { ok: parsed.error === 0, error: parsed.error, response: parsed };
  }

  async function closeDocument(sessionId, { save = true } = {}) {
    const session = sessions.get(sessionId);
    if (!session) return { ok: true };
    if (save && running && session.mode !== 'view') {
      const wait = new Promise((resolve) => {
        session.saveWaiter = resolve;
        setTimeout(resolve, 3500).unref?.();
      });
      const fs = await forcesave(sessionId).catch(() => ({ ok: false }));
      if (fs.ok) await wait;
      session.saveWaiter = null;
    }
    sessions.delete(sessionId);
    docTokens.delete(session.docToken);
    cbTokens.delete(session.cbToken);
    armIdleTimer();
    return { ok: true };
  }

  async function closeOwner(ownerId) {
    const ids = [...sessions.values()].filter((s) => s.ownerId === ownerId).map((s) => s.sessionId);
    for (const id of ids) await closeDocument(id, { save: false });
  }

  return {
    status,
    install,
    uninstall,
    start,
    stop,
    openDocument,
    forcesave,
    closeDocument,
    closeOwner,
    get moduleDir() { return moduleDir; },
    get running() { return Boolean(running); },
    get openSessions() { return sessions.size; },
  };
}
