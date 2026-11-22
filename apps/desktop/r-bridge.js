// Desktop R Bridge Coordinator (docs/R-PREFABS-PLAN.md):
// 1. Primary: connects over 127.0.0.1 with Bearer token to a running R Commander Studio
//    session discovered via ~/.config/notecomplete/r-bridge.json.
// 2. Fallback: spawns a timeout-guarded local `Rscript` process in an isolated temp folder
//    rendering vector SVG via svglite (if installed) or base grDevices::svg.
// 3. Companion lifecycle: auto-discovers or installs R Commander Studio for the current
//    platform (Linux x64/ARM64 AppImage, Windows x64, macOS ARM64), creates new R files
//    or workspace folders, and opens them in Studio's own window or zero-bloat embedded view.
// Security: never auto-executes R on note open; only invoked on explicit user action.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export const STUDIO_RELEASE_REPO = 'Emefedez/r-commander-studio';

export function bridgeDiscoveryPath(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'notecomplete', 'r-bridge.json');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'notecomplete', 'r-bridge.json');
  }
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'notecomplete', 'r-bridge.json');
}

export function managedStudioDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'NoteComplete', 'r-commander-studio');
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, 'NoteComplete', 'r-commander-studio');
  }
  const xdgData = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(xdgData, 'NoteComplete', 'r-commander-studio');
}

export function studioPlatformSupport(platform = process.platform, arch = process.arch) {
  if (platform === 'linux' && arch === 'arm64') {
    return {
      supported: true,
      platform,
      arch,
      label: 'Linux ARM64 (AppImage)',
      assetPattern: /(arm64|aarch64).*\.AppImage$/i,
      installMode: 'appimage',
    };
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'ia32')) {
    return {
      supported: true,
      platform,
      arch,
      label: 'Linux x86_64 (AppImage)',
      assetPattern: /(x86_64|x64|amd64).*\.AppImage$/i,
      installMode: 'appimage',
    };
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    return {
      supported: true,
      platform,
      arch,
      label: 'Windows x64 Installer (.exe)',
      assetPattern: /(x64|setup|portable|win).*\.exe$/i,
      installMode: 'installer',
    };
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      supported: true,
      platform,
      arch,
      label: 'macOS Apple Silicon (ARM64 DMG)',
      assetPattern: /(arm64|aarch64).*\.(dmg|zip)$/i,
      installMode: 'installer',
    };
  }
  return {
    supported: false,
    platform,
    arch,
    label: `${platform} (${arch})`,
    assetPattern: null,
    installMode: 'none',
  };
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

export async function readBridgeInfo(file = bridgeDiscoveryPath()) {
  try {
    const raw = await readFile(file, 'utf8');
    const info = JSON.parse(raw);
    if (!info || typeof info !== 'object') return null;
    if (!Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return null;
    if (typeof info.token !== 'string' || info.token.length < 16) return null;
    if (info.pid && !isPidAlive(info.pid)) return null;
    return info;
  } catch {
    return null;
  }
}

function httpJson(port, token, method, pathname, body = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total <= 16 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { ok: false, error: text || `HTTP ${res.statusCode}` }; }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(parsed?.error || `R Bridge HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('R Bridge request timed out.')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsGetBuffer(urlStr, { maxRedirects = 5, onProgress = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const visit = (target, left) => {
      const parsed = new URL(target);
      const mod = parsed.protocol === 'http:' ? http : https;
      const req = mod.get({
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        headers: { 'User-Agent': 'NoteComplete-RBridge', ...headers },
      }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume();
          visit(new URL(res.headers.location, target).href, left - 1);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Download failed (HTTP ${res.statusCode || 'unknown'})`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        const chunks = [];
        let received = 0;
        res.on('data', (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          onProgress?.({ received, total });
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
    };
    visit(urlStr, maxRedirects);
  });
}

function findExecutable(names, extraPaths = []) {
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [];
  for (const dir of [...pathDirs, ...extraPaths]) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  return candidates.find((p) => {
    try { return existsSync(p); } catch { return false; }
  }) || null;
}

export function findRscript() {
  const isWin = process.platform === 'win32';
  const names = isWin ? ['Rscript.exe', 'Rscript.bat'] : ['Rscript'];
  const extra = isWin
    ? []
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/Library/Frameworks/R.framework/Resources/bin'];
  return findExecutable(names, extra);
}

export function findArf() {
  const names = process.platform === 'win32' ? ['arf.exe'] : ['arf'];
  const extra = [path.join(os.homedir(), '.cargo', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
  return findExecutable(names, extra);
}

export function findStudioApp({ managedDir = managedStudioDir(), devDir = path.join(os.homedir(), 'Work', 'r-commander-studio') } = {}) {
  // 1. Managed NoteComplete install directory
  const managedAppImage = path.join(managedDir, 'R-Commander-Studio.AppImage');
  if (process.platform === 'linux' && existsSync(managedAppImage)) {
    return { kind: 'binary', path: managedAppImage, source: 'managed' };
  }
  const managedExe = path.join(managedDir, 'R-Commander-Studio.exe');
  if (process.platform === 'win32' && existsSync(managedExe)) {
    return { kind: 'binary', path: managedExe, source: 'managed' };
  }
  // 2. Standard OS install locations & PATH
  if (process.platform === 'darwin') {
    const macApp = '/Applications/R Commander Studio.app/Contents/MacOS/R Commander Studio';
    if (existsSync(macApp)) return { kind: 'binary', path: macApp, source: 'system' };
  }
  const binNames = process.platform === 'win32' ? ['r-commander-studio.exe'] : ['r-commander-studio'];
  const fromPath = findExecutable(binNames, [path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']);
  if (fromPath) return { kind: 'binary', path: fromPath, source: 'path' };

  // 3. Local repo build / dev checkout
  if (existsSync(path.join(devDir, 'package.json'))) {
    const localElectron = path.join(devDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
    return { kind: 'dev', dir: devDir, electron: existsSync(localElectron) ? localElectron : null, source: 'dev' };
  }
  return null;
}

function runProcess(cmd, args, { cwd, timeoutMs = 10000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out = [], err = [];
    let outLen = 0, errLen = 0, timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1500).unref?.();
    }, timeoutMs);
    child.stdout.on('data', (c) => { if (outLen < maxBytes) { out.push(c); outLen += c.length; } });
    child.stderr.on('data', (c) => { if (errLen < maxBytes) { err.push(c); errLen += c.length; } });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) reject(new Error(`R timed out after ${Math.round(timeoutMs / 1000)}s.`));
      else resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function rQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function sanitizeBaseName(raw, fallback = 'Untitled') {
  const cleaned = String(raw ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/^\.+|\.+$/g, '').slice(0, 80);
  return cleaned || fallback;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRBridge({
  discoveryFile = bridgeDiscoveryPath(),
  rscriptPath = null,
  studio = null,
  managedDir = managedStudioDir(),
  releaseRepo = STUDIO_RELEASE_REPO,
  openPath = null,
  fetchBuffer = httpsGetBuffer,
} = {}) {
  const resolveRscript = () => rscriptPath || findRscript();
  const resolveStudio = () => studio || findStudioApp({ managedDir });

  async function probeLocalR() {
    const rscript = resolveRscript();
    if (!rscript) return { available: false, path: null, rVersion: '', packages: {} };
    const pkgs = ['svglite', 'ggplot2', 'RcmdrMisc', 'car', 'rmarkdown', 'knitr', 'languageserver'];
    const expr = [
      'cat("RVER=", as.character(getRversion()), "\\n", sep="")',
      `pkgs <- c(${pkgs.map(rQuote).join(',')})`,
      'for (p in pkgs) cat("PKG=", p, "=", nzchar(system.file(package=p)), "\\n", sep="")',
    ].join('; ');
    try {
      const res = await runProcess(rscript, ['--vanilla', '-e', expr], { timeoutMs: 6000 });
      let rVersion = '';
      const packages = {};
      for (const line of res.stdout.split(/\r?\n/)) {
        if (line.startsWith('RVER=')) rVersion = line.slice(5).trim();
        else if (line.startsWith('PKG=')) {
          const [, name, ok] = line.match(/^PKG=([^=]+)=(.+)$/) || [];
          if (name) packages[name] = ok.trim() === 'TRUE';
        }
      }
      return { available: res.code === 0, path: rscript, rVersion, packages };
    } catch (e) {
      return { available: false, path: rscript, rVersion: '', packages: {}, error: e.message };
    }
  }

  async function status() {
    const info = await readBridgeInfo(discoveryFile);
    let studioHealth = null;
    if (info) {
      try {
        studioHealth = await httpJson(info.port, info.token, 'GET', '/health', null, 3000);
      } catch {
        studioHealth = null;
      }
    }
    const localR = studioHealth ? { available: true, path: resolveRscript(), rVersion: studioHealth.rVersion || '', packages: studioHealth.packages || {} } : await probeLocalR();
    const arfPath = findArf();
    const studioApp = resolveStudio();
    const platformSupport = studioPlatformSupport();
    const mode = studioHealth?.ok ? 'studio' : localR.available ? 'rscript' : 'offline';
    const embedUrl = studioHealth?.ok && studioHealth?.embedPath
      ? `http://127.0.0.1:${info.port}${studioHealth.embedPath}?token=${encodeURIComponent(info.token)}`
      : null;
    return {
      mode,
      studioConnected: Boolean(studioHealth?.ok),
      studioVersion: studioHealth?.version || null,
      studioInstalled: Boolean(studioApp),
      studioPath: studioApp?.path || studioApp?.dir || null,
      embedUrl,
      platformSupport,
      rAvailable: localR.available,
      rPath: localR.path,
      rVersion: localR.rVersion || studioHealth?.rVersion || '',
      arfAvailable: Boolean(arfPath || studioHealth?.arfAvailable),
      packages: studioHealth?.packages || localR.packages || {},
      datasets: Array.isArray(studioHealth?.datasets) ? studioHealth.datasets : [],
    };
  }

  async function evalFigure({ rCode, width = 480, height = 320, bg = '#ffffff', timeoutMs = 10000, require: reqPkgs = [] } = {}) {
    const code = String(rCode ?? '').trim();
    if (!code) throw new Error('R code is empty.');
    const w = Math.max(160, Math.min(1600, Number(width) || 480));
    const h = Math.max(120, Math.min(1200, Number(height) || 320));
    const clampedTimeout = Math.max(1000, Math.min(30000, Number(timeoutMs) || 10000));
    const bgColor = /^#[0-9a-fA-F]{6}$/.test(String(bg || '')) ? String(bg) : '#ffffff';

    const info = await readBridgeInfo(discoveryFile);
    if (info) {
      try {
        const res = await httpJson(info.port, info.token, 'POST', '/eval-figure', {
          rCode: code, width: w, height: h, bg: bgColor, timeoutMs: clampedTimeout, require: reqPkgs,
        }, clampedTimeout + 2000);
        if (res?.ok && res.svg) return { ...res, backend: 'studio' };
        if (res && res.ok === false) throw new Error(res.error || 'R figure evaluation failed.');
      } catch (e) {
        if (!/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out|socket hang up/i.test(String(e?.message || ''))) {
          throw e;
        }
      }
    }

    const rscript = resolveRscript();
    if (!rscript) {
      throw new Error('R is not available. Install R (Rscript) or launch R Commander Studio.');
    }
    const started = Date.now();
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nc-rfig-'));
    try {
      const userFile = path.join(tmpDir, 'plot.R');
      const outSvg = path.join(tmpDir, 'out.svg');
      const driverFile = path.join(tmpDir, 'driver.R');
      await writeFile(userFile, `${code}\n`, 'utf8');
      const wIn = (w / 96).toFixed(4);
      const hIn = (h / 96).toFixed(4);
      const reqList = Array.isArray(reqPkgs) ? reqPkgs.filter((p) => /^[A-Za-z][A-Za-z0-9.]{0,40}$/.test(String(p))) : [];
      const driver = [
        'options(warn = 1)',
        reqList.length ? `for (p in c(${reqList.map(rQuote).join(',')})) suppressPackageStartupMessages(require(p, character.only = TRUE, quietly = TRUE))` : '',
        `out_file <- ${rQuote(outSvg)}`,
        `if (requireNamespace("svglite", quietly = TRUE)) {`,
        `  svglite::svglite(out_file, width = ${wIn}, height = ${hIn}, bg = ${rQuote(bgColor)}, standalone = TRUE)`,
        `} else {`,
        `  grDevices::svg(out_file, width = ${wIn}, height = ${hIn}, bg = ${rQuote(bgColor)}, onefile = FALSE)`,
        `}`,
        'on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)',
        `val <- source(${rQuote(userFile)}, local = new.env(parent = globalenv()), encoding = "UTF-8")$value`,
        'if (inherits(val, "ggplot") || inherits(val, "trellis")) print(val)',
      ].filter(Boolean).join('\n');
      await writeFile(driverFile, `${driver}\n`, 'utf8');
      const res = await runProcess(rscript, ['--vanilla', driverFile], { cwd: tmpDir, timeoutMs: clampedTimeout });
      if (res.code !== 0) {
        throw new Error(res.stderr.trim() || res.stdout.trim() || `Rscript exited with code ${res.code}`);
      }
      if (!existsSync(outSvg)) {
        throw new Error('R code ran without producing a plot.');
      }
      const svg = await readFile(outSvg, 'utf8');
      return {
        ok: true,
        backend: 'rscript',
        svg,
        stdout: res.stdout.trim(),
        warnings: res.stderr.trim() ? res.stderr.trim().split(/\r?\n/).slice(0, 12) : [],
        elapsedMs: Date.now() - started,
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function evalCode({ rCode, timeoutMs = 10000, require: reqPkgs = [] } = {}) {
    const code = String(rCode ?? '').trim();
    if (!code) throw new Error('R code is empty.');
    const clampedTimeout = Math.max(1000, Math.min(30000, Number(timeoutMs) || 10000));
    const info = await readBridgeInfo(discoveryFile);
    if (info) {
      try {
        const res = await httpJson(info.port, info.token, 'POST', '/eval-code', {
          rCode: code, timeoutMs: clampedTimeout, require: reqPkgs,
        }, clampedTimeout + 2000);
        if (res?.ok) return { ...res, backend: 'studio' };
        if (res && res.ok === false) throw new Error(res.error || 'R evaluation failed.');
      } catch (e) {
        if (!/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out|socket hang up/i.test(String(e?.message || ''))) {
          throw e;
        }
      }
    }
    const rscript = resolveRscript();
    if (!rscript) throw new Error('R is not available. Install R (Rscript) or launch R Commander Studio.');
    const started = Date.now();
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'nc-rcode-'));
    try {
      const userFile = path.join(tmpDir, 'eval.R');
      await writeFile(userFile, `${code}\n`, 'utf8');
      const res = await runProcess(rscript, ['--vanilla', userFile], { cwd: tmpDir, timeoutMs: clampedTimeout });
      if (res.code !== 0) throw new Error(res.stderr.trim() || `Rscript exited with code ${res.code}`);
      return {
        ok: true,
        backend: 'rscript',
        stdout: res.stdout.trim(),
        warnings: res.stderr.trim() ? res.stderr.trim().split(/\r?\n/).slice(0, 12) : [],
        elapsedMs: Date.now() - started,
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function spawnStudio(studioApp, cliArgs = []) {
    if (studioApp.kind === 'binary') {
      const child = spawn(studioApp.path, cliArgs, { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    if (studioApp.kind === 'dev' && studioApp.electron) {
      const child = spawn(studioApp.electron, ['.', ...cliArgs], { cwd: studioApp.dir, detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    }
    return false;
  }

  async function waitForBridge(timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await readBridgeInfo(discoveryFile);
      if (info) {
        try {
          const health = await httpJson(info.port, info.token, 'GET', '/health', null, 1500);
          if (health?.ok) return { info, health };
        } catch { /* Still booting. */ }
      }
      await delay(220);
    }
    return null;
  }

  async function openInStudio({ filePath = '', folderPath = '', title = 'NoteComplete.R', code = '', kind = 'r', embed = false } = {}) {
    const hasPath = Boolean(filePath || folderPath);
    const info = await readBridgeInfo(discoveryFile);
    if (info) {
      try {
        if (hasPath) {
          await httpJson(info.port, info.token, 'POST', '/open-path', {
            ...(filePath ? { filePath: String(filePath) } : {}),
            ...(folderPath ? { folderPath: String(folderPath) } : {}),
          }, 4000);
        } else if (code || title) {
          await httpJson(info.port, info.token, 'POST', '/open-script', {
            title: String(title || 'NoteComplete.R'),
            code: String(code || ''),
            kind: kind === 'rmd' ? 'rmd' : 'r',
          }, 4000);
        }
        const health = await httpJson(info.port, info.token, 'GET', '/health', null, 2000).catch(() => null);
        const embedUrl = health?.embedPath
          ? `http://127.0.0.1:${info.port}${health.embedPath}?token=${encodeURIComponent(info.token)}`
          : null;
        return { ok: true, launched: false, connected: true, embedUrl };
      } catch {
        // Studio bridge stale; fall through to launch below.
      }
    }
    const studioApp = resolveStudio();
    if (!studioApp) {
      return {
        ok: false,
        notInstalled: true,
        platformSupport: studioPlatformSupport(),
        error: 'R Commander Studio is not installed yet. Click Install R Commander Studio to download it for your platform.',
      };
    }
    const cliArgs = [];
    if (embed) cliArgs.push('--headless');
    if (folderPath) cliArgs.push(String(folderPath));
    if (filePath) cliArgs.push(String(filePath));
    const started = await spawnStudio(studioApp, cliArgs);
    if (!started) {
      return { ok: false, error: 'Found R Commander Studio source folder, run `npm install` inside it to launch.' };
    }
    if (embed || (!hasPath && code)) {
      const ready = await waitForBridge(9000);
      if (ready) {
        if (!hasPath && code) {
          await httpJson(ready.info.port, ready.info.token, 'POST', '/open-script', {
            title: String(title || 'NoteComplete.R'),
            code: String(code || ''),
            kind: kind === 'rmd' ? 'rmd' : 'r',
          }, 4000).catch(() => {});
        }
        const embedUrl = ready.health?.embedPath
          ? `http://127.0.0.1:${ready.info.port}${ready.health.embedPath}?token=${encodeURIComponent(ready.info.token)}`
          : null;
        return { ok: true, launched: true, connected: true, embedUrl };
      }
    }
    return { ok: true, launched: true, connected: false, embedUrl: null };
  }

  /**
   * Automatically downloads & installs R Commander Studio for the current OS/arch.
   * Uses a local prebuilt installer in ~/Work/r-commander-studio/dist/ when present,
   * otherwise fetches from GitHub Releases and verifies SHA256SUMS.txt if published.
   */
  async function installStudio({ onProgress = null, localDistDir = path.join(os.homedir(), 'Work', 'r-commander-studio', 'dist') } = {}) {
    const support = studioPlatformSupport();
    if (!support.supported || !support.assetPattern) {
      return { ok: false, error: `Automatic installation is not supported on ${support.label}.` };
    }
    await mkdir(managedDir, { recursive: true });

    // 1. Check local prebuilt dist folder first (instant offline install)
    if (localDistDir && existsSync(localDistDir)) {
      try {
        const entries = await readdir(localDistDir);
        const match = entries.find((f) => support.assetPattern.test(f));
        if (match) {
          onProgress?.({ phase: 'installing', received: 1, total: 1, name: match });
          const src = path.join(localDistDir, match);
          if (support.installMode === 'appimage') {
            const dest = path.join(managedDir, 'R-Commander-Studio.AppImage');
            await copyFile(src, dest);
            await chmod(dest, 0o755);
            return { ok: true, installedPath: dest, source: 'local', platform: support.label };
          }
          const dest = path.join(managedDir, match);
          await copyFile(src, dest);
          if (openPath) await openPath(dest);
          return { ok: true, installedPath: dest, source: 'local', platform: support.label, openedInstaller: Boolean(openPath) };
        }
      } catch { /* Fall through to GitHub Releases. */ }
    }

    // 2. Fetch latest release from GitHub Releases
    onProgress?.({ phase: 'checking', received: 0, total: 0 });
    const releasesRaw = await fetchBuffer(`https://api.github.com/repos/${releaseRepo}/releases?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    const releases = JSON.parse(releasesRaw.toString('utf8'));
    if (!Array.isArray(releases) || !releases.length) {
      throw new Error(`No published releases found at github.com/${releaseRepo}.`);
    }
    const release = releases.find((r) => Array.isArray(r.assets) && r.assets.some((a) => support.assetPattern.test(a.name)));
    if (!release) {
      throw new Error(`No release asset matched ${support.label} in github.com/${releaseRepo}.`);
    }
    const asset = release.assets.find((a) => support.assetPattern.test(a.name));
    onProgress?.({ phase: 'downloading', received: 0, total: asset.size || 0, name: asset.name });
    const bytes = await fetchBuffer(asset.browser_download_url, {
      onProgress: ({ received, total }) => onProgress?.({ phase: 'downloading', received, total: total || asset.size || 0, name: asset.name }),
    });

    // Optional SHA-256 verification against SHA256SUMS.txt
    const sumsAsset = release.assets.find((a) => /^SHA256SUMS\.txt$/i.test(a.name));
    if (sumsAsset) {
      onProgress?.({ phase: 'verifying', received: bytes.length, total: bytes.length, name: asset.name });
      const sumsText = (await fetchBuffer(sumsAsset.browser_download_url)).toString('utf8');
      const expectedLine = sumsText.split(/\r?\n/).find((l) => l.trim().endsWith(asset.name));
      if (expectedLine) {
        const expectedHex = expectedLine.trim().split(/\s+/)[0].toLowerCase();
        const actualHex = createHash('sha256').update(bytes).digest('hex').toLowerCase();
        if (expectedHex !== actualHex) {
          throw new Error(`Checksum mismatch for ${asset.name}. Download aborted.`);
        }
      }
    }

    onProgress?.({ phase: 'installing', received: bytes.length, total: bytes.length, name: asset.name });
    const targetName = support.installMode === 'appimage' ? 'R-Commander-Studio.AppImage' : path.basename(asset.name);
    const dest = path.join(managedDir, targetName);
    const tmp = `${dest}.${process.pid}.part`;
    await writeFile(tmp, bytes);
    if (support.installMode === 'appimage') await chmod(tmp, 0o755);
    await rename(tmp, dest);
    if (support.installMode === 'installer' && openPath) {
      await openPath(dest);
    }
    return {
      ok: true,
      installedPath: dest,
      version: release.tag_name || '',
      source: 'github',
      platform: support.label,
      openedInstaller: support.installMode === 'installer' && Boolean(openPath),
    };
  }

  /**
   * Creates either a single R/Rmd file or a full R Workspace folder on disk.
   */
  async function createRItem({ mode = 'file', name = 'analysis', parentDir, kind = 'r' } = {}) {
    if (!parentDir || !path.isAbsolute(String(parentDir))) {
      throw new Error('Choose a valid folder first.');
    }
    await mkdir(parentDir, { recursive: true });
    const safeName = sanitizeBaseName(name, mode === 'workspace' ? 'r-workspace' : 'analysis');

    if (mode === 'workspace') {
      let folderPath = path.join(parentDir, safeName);
      if (existsSync(folderPath)) {
        for (let i = 2; i < 100; i++) {
          const candidate = path.join(parentDir, `${safeName}-${i}`);
          if (!existsSync(candidate)) { folderPath = candidate; break; }
        }
      }
      await mkdir(path.join(folderPath, 'data'), { recursive: true });
      const base = path.basename(folderPath);
      const analysisPath = path.join(folderPath, 'analysis.R');
      const reportPath = path.join(folderPath, 'report.Rmd');
      const rprojPath = path.join(folderPath, `${base}.Rproj`);
      const readmePath = path.join(folderPath, 'README.md');
      await writeFile(analysisPath, `# ${base} — R Analysis\n\ndata(iris)\nsummary(iris)\n`, 'utf8');
      await writeFile(reportPath, `---\ntitle: "${base}"\noutput: html_document\n---\n\n\`\`\`{r setup, include=FALSE}\nknitr::opts_chunk$set(echo = TRUE)\n\`\`\`\n\n## Overview\n\n\`\`\`{r}\nsummary(cars)\nplot(cars)\n\`\`\`\n`, 'utf8');
      await writeFile(rprojPath, 'Version: 1.0\n\nRestoreWorkspace: Default\nSaveWorkspace: Default\nEncoding: UTF-8\n', 'utf8');
      await writeFile(readmePath, `# ${base}\n\nR workspace created from NoteComplete.\n`, 'utf8');
      return {
        ok: true,
        mode: 'workspace',
        name: base,
        folderPath,
        filePath: analysisPath,
        files: [analysisPath, reportPath, rprojPath, readmePath],
      };
    }

    const ext = kind === 'rmd' ? '.Rmd' : '.R';
    const stem = safeName.replace(/\.(r|rmd|qmd)$/i, '') || 'analysis';
    let filePath = path.join(parentDir, `${stem}${ext}`);
    if (existsSync(filePath)) {
      for (let i = 2; i < 100; i++) {
        const candidate = path.join(parentDir, `${stem}-${i}${ext}`);
        if (!existsSync(candidate)) { filePath = candidate; break; }
      }
    }
    const content = kind === 'rmd'
      ? `---\ntitle: "${stem}"\noutput: html_document\n---\n\n\`\`\`{r}\nsummary(cars)\nplot(cars)\n\`\`\`\n`
      : `# ${stem}.R\n\n`;
    await writeFile(filePath, content, 'utf8');
    const st = await stat(filePath);
    return {
      ok: true,
      mode: 'file',
      name: path.basename(filePath),
      filePath,
      folderPath: parentDir,
      size: st.size,
    };
  }

  return { status, evalFigure, evalCode, openInStudio, installStudio, createRItem };
}
