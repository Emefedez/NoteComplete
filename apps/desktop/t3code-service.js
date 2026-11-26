// Cross-Platform T3 Code Background Service & Installer for NoteComplete,
// modeled on R Commander Studio's t3code-service.js.
//
// Lifecycle:
//  - Detects existing T3 Code installations (Omarchy AUR, NoteComplete managed,
//    R Commander Studio managed, PATH, macOS .app, Windows .exe / WSL2).
//  - Starts the headless backend on 127.0.0.1:3773 on demand for AI document
//    generation or when the `t3code` harness is selected.
//  - Tracks whether NoteComplete started the backend (`_startedBy`) and keeps
//    an active-use refcount (`_activeUsers`). When all document-generation and
//    T3 requests finish (after a short grace window) or when the app quits, it
//    stops the backend ONLY if NoteComplete started it — never disturbing an
//    already-running T3 Code desktop app.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export const T3_REPO = 'pingdotgg/t3code';
export const DEFAULT_T3_HOST = '127.0.0.1';
export const DEFAULT_T3_PORT = 3773;
const DEFAULT_IDLE_CLOSE_MS = 15_000;

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeoutMs || 15000, ...opts }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? err.code || 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? err.message : null,
      });
    });
  });
}

export function httpGetJson(urlStr, { timeoutMs = 2500, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NoteComplete-T3Bridge',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(raw)); } catch { resolve({ ok: true, raw }); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

export function httpPostChat(urlStr, bodyObj, { timeoutMs = 10 * 60 * 1000, headers = {}, onDelta = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('The AI request was stopped.')); return; }
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const stream = !!onDelta && bodyObj.stream !== false;
    const payload = Buffer.from(JSON.stringify(stream ? { ...bodyObj, stream: true } : bodyObj), 'utf8');
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(value);
    };
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: stream ? 'text/event-stream, application/json' : 'application/json',
          'User-Agent': 'NoteComplete-T3Bridge',
          ...headers,
        },
      },
      (res) => {
        const ct = String(res.headers['content-type'] || '').toLowerCase();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const errChunks = [];
          res.on('data', (c) => errChunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(errChunks).toString('utf8');
            done(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
          });
          return;
        }
        if (stream && ct.includes('text/event-stream')) {
          let pending = '';
          let fullText = '';
          res.on('data', (chunk) => {
            pending += chunk.toString('utf8');
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta) {
                  fullText += delta;
                  onDelta(delta);
                }
              } catch { /* Ignore non-JSON SSE keepalives. */ }
            }
          });
          res.on('end', () => done(null, { text: fullText }));
          res.on('error', (err) => done(err));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const parsed = JSON.parse(raw);
            const text = parsed?.choices?.[0]?.message?.content ?? parsed?.text ?? parsed?.response ?? '';
            if (typeof text === 'string' && text && onDelta) onDelta(text);
            done(null, { text: String(text || '') });
          } catch {
            done(null, { text: raw });
          }
        });
        res.on('error', (err) => done(err));
      },
    );
    const onAbort = () => {
      req.destroy(new Error('The AI request was stopped.'));
      done(new Error('The AI request was stopped.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', () => {
      req.destroy(new Error('T3 Code request timed out.'));
      done(new Error('T3 Code request timed out.'));
    });
    req.on('error', (err) => done(err));
    req.write(payload);
    req.end();
  });
}

function downloadBuffer(urlStr, { onProgress = null, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const visit = (target, left) => {
      const u = new URL(target);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(
        {
          hostname: u.hostname,
          port: u.port || undefined,
          path: `${u.pathname}${u.search}`,
          headers: { 'User-Agent': 'NoteComplete-T3Installer' },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
            res.resume();
            visit(new URL(res.headers.location, target).href, left - 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Download failed (HTTP ${res.statusCode})`));
            return;
          }
          const total = Number(res.headers['content-length'] || 0);
          const chunks = [];
          let received = 0;
          res.on('data', (chunk) => {
            chunks.push(chunk);
            received += chunk.length;
            if (onProgress) onProgress({ received, total });
          });
          res.on('end', () => resolve(Buffer.concat(chunks)));
        },
      );
      req.on('error', reject);
    };
    visit(urlStr, maxRedirects);
  });
}

function findExecutableOnPath(names, extraDirs = []) {
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of [...pathDirs, ...extraDirs]) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch { /* ignore */ }
    }
  }
  return null;
}

export class T3CodeService {
  constructor({ host = DEFAULT_T3_HOST, port = DEFAULT_T3_PORT, idleCloseMs = DEFAULT_IDLE_CLOSE_MS } = {}) {
    this.host = host;
    this.port = port;
    this.idleCloseMs = idleCloseMs;
    this._daemonProc = null;
    this._startedBy = null;
    this._activeUsers = 0;
    this._idleTimer = null;
    this._lastStatus = null;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  get owned() {
    return !!this._startedBy;
  }

  get activeUsers() {
    return this._activeUsers;
  }

  managedInstallDir() {
    const home = os.homedir();
    if (process.platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'notecomplete-desktop', 't3code');
    }
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return path.join(localAppData, 'notecomplete-desktop', 't3code');
    }
    const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(xdgData, 'notecomplete', 't3code');
  }

  _rcsManagedInstallDir() {
    const home = os.homedir();
    if (process.platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', 'r-commander-studio', 't3code');
    }
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      return path.join(localAppData, 'r-commander-studio', 't3code');
    }
    const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return path.join(xdgData, 'r-commander-studio', 't3code');
  }

  findT3Installation() {
    const home = os.homedir();
    const managedDirs = [
      { dir: this.managedInstallDir(), source: 'managed' },
      { dir: this._rcsManagedInstallDir(), source: 'r-commander-studio' },
    ];

    if (process.platform === 'linux') {
      // 1. Omarchy / AUR payload installations
      const omarchyBase = path.join(home, '.local', 'share', 'omarchy', 'aur-apps', 't3code-bin');
      if (fs.existsSync(omarchyBase)) {
        try {
          const versions = fs.readdirSync(omarchyBase).sort().reverse();
          for (const v of versions) {
            const bin = path.join(omarchyBase, v, 'payload', 't3code');
            const serverEntry = path.join(omarchyBase, v, 'payload', 'resources', 'app.asar', 'apps', 'server', 'dist', 'bin.mjs');
            if (fs.existsSync(bin)) {
              return { kind: 'unpacked', bin, serverEntry: fs.existsSync(serverEntry) ? serverEntry : null, source: 'omarchy' };
            }
          }
        } catch { /* ignore */ }
      }

      // 2. Managed install dirs (NoteComplete or R Commander Studio)
      for (const { dir, source } of managedDirs) {
        const payloadBin = path.join(dir, 'payload', 't3code');
        const serverEntry = path.join(dir, 'payload', 'resources', 'app.asar', 'apps', 'server', 'dist', 'bin.mjs');
        if (fs.existsSync(payloadBin)) {
          return { kind: 'unpacked', bin: payloadBin, serverEntry: fs.existsSync(serverEntry) ? serverEntry : null, source };
        }
        const appImage = path.join(dir, 'T3-Code.AppImage');
        if (fs.existsSync(appImage)) {
          return { kind: 'appimage', bin: appImage, serverEntry: null, source };
        }
      }

      // 3. System / PATH
      const sysBin = findExecutableOnPath(['t3code', 't3-code'], [
        path.join(home, '.local', 'bin'),
        '/usr/local/bin',
        '/usr/bin',
        '/opt/T3 Code',
        '/opt/t3code',
      ]);
      if (sysBin) {
        const optServer = '/opt/T3 Code/resources/app.asar/apps/server/dist/bin.mjs';
        return { kind: 'system', bin: sysBin, serverEntry: fs.existsSync(optServer) ? optServer : null, source: 'system' };
      }
    }

    if (process.platform === 'darwin') {
      const candidates = [
        '/Applications/T3 Code.app/Contents/MacOS/T3 Code',
        path.join(home, 'Applications', 'T3 Code.app', 'Contents', 'MacOS', 'T3 Code'),
        ...managedDirs.map(({ dir }) => path.join(dir, 'T3 Code.app', 'Contents', 'MacOS', 'T3 Code')),
      ];
      for (const bin of candidates) {
        if (fs.existsSync(bin)) {
          const serverEntry = path.resolve(path.dirname(bin), '..', 'Resources', 'app.asar', 'apps', 'server', 'dist', 'bin.mjs');
          return { kind: 'macos', bin, serverEntry: fs.existsSync(serverEntry) ? serverEntry : null, source: 'macos' };
        }
      }
    }

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const candidates = [
        path.join(localAppData, 'Programs', 't3code', 'T3 Code.exe'),
        path.join(localAppData, 'Programs', 'T3 Code', 'T3 Code.exe'),
        ...managedDirs.map(({ dir }) => path.join(dir, 'T3 Code.exe')),
      ];
      for (const bin of candidates) {
        if (fs.existsSync(bin)) {
          const serverEntry = path.join(path.dirname(bin), 'resources', 'app.asar', 'apps', 'server', 'dist', 'bin.mjs');
          return { kind: 'win32', bin, serverEntry: fs.existsSync(serverEntry) ? serverEntry : null, source: 'win32' };
        }
      }
    }

    return null;
  }

  readConnectionToken() {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.config', 't1code', 't3-connection.json'),
      path.join(home, '.t3', 'connection.json'),
      path.join(this.managedInstallDir(), 't3-connection.json'),
      path.join(this._rcsManagedInstallDir(), 't3-connection.json'),
    ];
    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) {
          const data = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (data && typeof data.token === 'string' && data.token.trim()) return data.token.trim();
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  async probeHttpBackend() {
    try {
      const env = await httpGetJson(`${this.baseUrl}/.well-known/t3/environment`, { timeoutMs: 1800 });
      return { running: true, environment: env };
    } catch {
      return { running: false, environment: null };
    }
  }

  async probeWslStatus() {
    if (process.platform !== 'win32') return { applicable: false, installed: false, t3InWsl: false };
    const statusRes = await execFileAsync('wsl.exe', ['--status'], { timeoutMs: 5000 });
    if (!statusRes.ok) return { applicable: true, installed: false, t3InWsl: false };
    const checkT3 = await execFileAsync(
      'wsl.exe',
      ['-e', 'bash', '-lic', 'test -x "$HOME/.local/share/notecomplete/t3code/payload/t3code" || test -x "$HOME/.local/share/r-commander-studio/t3code/payload/t3code" || command -v t3code >/dev/null 2>&1'],
      { timeoutMs: 6000 },
    );
    return { applicable: true, installed: true, t3InWsl: checkT3.ok };
  }

  async getStatus() {
    const probe = await this.probeHttpBackend();
    const install = this.findT3Installation();
    const wsl = await this.probeWslStatus();
    const token = this.readConnectionToken();

    let lmdeckRunning = false;
    try {
      await httpGetJson('http://127.0.0.1:11434/v1/models', { timeoutMs: 1000 });
      lmdeckRunning = true;
    } catch {
      lmdeckRunning = false;
    }

    this._lastStatus = {
      ok: true,
      platform: process.platform,
      arch: process.arch,
      t3Running: probe.running,
      t3Environment: probe.environment,
      t3Url: this.baseUrl,
      t3Installed: Boolean(install || wsl.t3InWsl),
      t3InstallInfo: install,
      ownedByApp: Boolean(this._startedBy),
      activeUsers: this._activeUsers,
      hasToken: Boolean(token),
      lmdeckRunning,
      wsl,
    };
    return this._lastStatus;
  }

  /**
   * Acquires T3 Code for an active document generation or T3 harness request.
   * Cancels any pending idle shutdown and starts the backend on demand if installed.
   */
  async acquire() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    this._activeUsers += 1;
    const started = await this.startBackend().catch((e) => ({ ok: false, error: e?.message || String(e) }));
    return started;
  }

  /**
   * Releases an active T3 Code usage slot. When no requests remain and NoteComplete
   * started the backend itself, schedules an automatic stop so T3 never lingers idle.
   */
  release({ immediate = false } = {}) {
    this._activeUsers = Math.max(0, this._activeUsers - 1);
    if (this._activeUsers > 0 || !this._startedBy) return;
    clearTimeout(this._idleTimer);
    if (immediate || this.idleCloseMs <= 0) {
      this._idleTimer = null;
      void this.stopBackendIfOwned();
    } else {
      this._idleTimer = setTimeout(() => {
        this._idleTimer = null;
        if (this._activeUsers === 0) void this.stopBackendIfOwned();
      }, this.idleCloseMs);
      this._idleTimer.unref?.();
    }
  }

  /**
   * Stops the T3 Code backend, but ONLY if NoteComplete started it. A backend that
   * was already running (e.g. the user's T3 Code desktop app) is left untouched.
   */
  async stopBackendIfOwned() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
    const how = this._startedBy;
    this._startedBy = null;
    if (!how) return { stopped: false };
    try {
      if (how === 'systemd') {
        await execFileAsync('systemctl', ['--user', 'stop', 't3code-backend.service'], { timeoutMs: 8000 });
      } else if (how === 'spawn' && this._daemonProc?.pid) {
        try { process.kill(this._daemonProc.pid, 'SIGTERM'); } catch { /* already exited */ }
      } else if (how === 'wsl' && process.platform === 'win32') {
        await execFileAsync('wsl.exe', ['-e', 'bash', '-lic', 'pkill -f "apps/server/dist/bin.mjs serve" || true'], { timeoutMs: 5000 });
      }
      this._daemonProc = null;
      return { stopped: true, via: how };
    } catch {
      this._daemonProc = null;
      return { stopped: false };
    }
  }

  async startBackend() {
    const initial = await this.probeHttpBackend();
    if (initial.running) {
      return { ok: true, alreadyRunning: true, url: this.baseUrl, environment: initial.environment };
    }

    // 1. On Linux, try systemd user service `t3code-backend.service` first
    if (process.platform === 'linux') {
      await execFileAsync('systemctl', ['--user', 'start', 't3code-backend.service'], { timeoutMs: 5000 });
      await new Promise((r) => setTimeout(r, 900));
      const afterSystemd = await this.probeHttpBackend();
      if (afterSystemd.running) {
        this._startedBy = 'systemd';
        return { ok: true, startedVia: 'systemd', url: this.baseUrl, environment: afterSystemd.environment };
      }
    }

    // 2. Direct headless spawn if T3 Code is installed locally
    const install = this.findT3Installation();
    if (install) {
      const baseDir = path.join(os.homedir(), '.t3');
      await fsp.mkdir(baseDir, { recursive: true });
      const env = { ...process.env };
      let args = [];
      if (install.serverEntry) {
        env.ELECTRON_RUN_AS_NODE = '1';
        args = [
          install.serverEntry,
          'serve',
          '--host', this.host,
          '--port', String(this.port),
          '--base-dir', baseDir,
          '--no-browser',
        ];
      } else {
        args = ['--headless', '--host', this.host, '--port', String(this.port), '--no-browser'];
      }

      try {
        const child = spawn(install.bin, args, { detached: true, stdio: 'ignore', env });
        child.unref();
        this._daemonProc = child;
      } catch { /* fall through */ }

      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const check = await this.probeHttpBackend();
        if (check.running) {
          this._startedBy = 'spawn';
          return { ok: true, startedVia: install.source, url: this.baseUrl, environment: check.environment };
        }
      }
    }

    // 3. On Windows, try starting T3 Code backend inside WSL2
    if (process.platform === 'win32') {
      const wsl = await this.probeWslStatus();
      if (wsl.installed && wsl.t3InWsl) {
        const wslCmd =
          'BASE="$HOME/.local/share/notecomplete/t3code"; ' +
          '[ -x "$BASE/payload/t3code" ] || BASE="$HOME/.local/share/r-commander-studio/t3code"; ' +
          'nohup env ELECTRON_RUN_AS_NODE=1 "$BASE/payload/t3code" ' +
          '"$BASE/payload/resources/app.asar/apps/server/dist/bin.mjs" ' +
          'serve --host 127.0.0.1 --port 3773 --base-dir "$HOME/.t3" --no-browser >/dev/null 2>&1 &';
        await execFileAsync('wsl.exe', ['-e', 'bash', '-lic', wslCmd], { timeoutMs: 8000 });
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 450));
          const check = await this.probeHttpBackend();
          if (check.running) {
            this._startedBy = 'wsl';
            return { ok: true, startedVia: 'wsl', url: this.baseUrl, environment: check.environment };
          }
        }
      }
    }

    return {
      ok: false,
      notInstalled: !install,
      error: 'T3 Code backend is not installed or could not be started on 127.0.0.1:3773.',
    };
  }

  async installT3Code({ onProgress = null, preferWsl = true } = {}) {
    const report = (phase, detail = '', pct = 0) => {
      if (onProgress) onProgress({ phase, detail, pct });
    };

    const existing = this.findT3Installation();
    if (existing) {
      report('starting', `Found existing T3 Code (${existing.source}), verifying backend…`, 85);
      const started = await this.startBackend();
      if (started.ok && this._activeUsers === 0) await this.stopBackendIfOwned();
      report('done', 'T3 Code is installed and ready.', 100);
      return {
        ok: true,
        installedPath: existing.bin,
        source: existing.source,
        t3Running: started.ok,
        url: this.baseUrl,
      };
    }

    if (process.platform === 'win32' && preferWsl) {
      const wsl = await this.probeWslStatus();
      if (!wsl.installed) {
        report('wsl-install', 'Installing Windows Subsystem for Linux (WSL2)…', 20);
        const wslInstall = await execFileAsync('wsl.exe', ['--install', '-d', 'Ubuntu'], { timeoutMs: 180000 });
        if (!wslInstall.ok) {
          return {
            ok: false,
            needsRebootOrAdmin: true,
            error: 'WSL installation was triggered (`wsl.exe --install`). Accept the administrator prompt and restart if asked, then click Install T3 Code again.',
          };
        }
      }
      report('wsl-t3-install', 'Installing T3 Code headless backend inside WSL…', 45);
      const wslScript = [
        'set -e',
        'DEST="$HOME/.local/share/notecomplete/t3code"',
        'mkdir -p "$DEST"',
        'ARCH=$(uname -m)',
        'if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then PAT="arm64.*AppImage"; else PAT="(x86_64|x64).*AppImage"; fi',
        'URL=$(curl -fsSL https://api.github.com/repos/pingdotgg/t3code/releases | grep -Eo "https://[^\\"]+\\.AppImage" | grep -Ei "$PAT" | head -n 1)',
        'if [ -z "$URL" ]; then echo "No T3 Code AppImage found"; exit 1; fi',
        'curl -fL "$URL" -o "$DEST/T3-Code.AppImage"',
        'chmod +x "$DEST/T3-Code.AppImage"',
        'cd "$DEST" && ./T3-Code.AppImage --appimage-extract >/dev/null 2>&1 || true',
        'if [ -d "$DEST/squashfs-root" ]; then rm -rf "$DEST/payload" && mv "$DEST/squashfs-root" "$DEST/payload"; fi',
      ].join('; ');
      const wslRun = await execFileAsync('wsl.exe', ['-e', 'bash', '-lic', wslScript], { timeoutMs: 240000 });
      if (wslRun.ok) {
        report('done', 'T3 Code installed inside WSL and ready.', 100);
        return {
          ok: true,
          installedPath: 'WSL:~/.local/share/notecomplete/t3code',
          source: 'wsl',
          t3Running: false,
          url: this.baseUrl,
        };
      }
    }

    report('checking', `Checking latest releases at github.com/${T3_REPO}…`, 10);
    const releases = await httpGetJson(`https://api.github.com/repos/${T3_REPO}/releases?per_page=8`, { timeoutMs: 12000 });
    if (!Array.isArray(releases) || !releases.length) {
      throw new Error(`Could not fetch releases from github.com/${T3_REPO}`);
    }

    let assetPattern = null;
    if (process.platform === 'linux') {
      assetPattern = process.arch === 'arm64'
        ? /(arm64|aarch64).*\.AppImage$/i
        : /(x86_64|x64|amd64).*\.AppImage$/i;
    } else if (process.platform === 'darwin') {
      assetPattern = process.arch === 'arm64'
        ? /(arm64|aarch64).*\.(zip|dmg)$/i
        : /(x64|x86_64|universal).*\.(zip|dmg)$/i;
    } else if (process.platform === 'win32') {
      assetPattern = /\.exe$/i;
    }

    let matchedRelease = null;
    let matchedAsset = null;
    for (const rel of releases) {
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const found = assets.find((a) => assetPattern && assetPattern.test(a.name));
      if (found) {
        matchedRelease = rel;
        matchedAsset = found;
        break;
      }
    }
    if (!matchedAsset) {
      throw new Error(`No matching T3 Code release asset found for ${process.platform} (${process.arch}).`);
    }

    const managed = this.managedInstallDir();
    await fsp.mkdir(managed, { recursive: true });

    report('downloading', `Downloading ${matchedAsset.name}…`, 25);
    const buf = await downloadBuffer(matchedAsset.browser_download_url, {
      onProgress: ({ received, total }) => {
        const pct = total ? Math.round(25 + (received / total) * 50) : 50;
        report('downloading', `Downloading ${matchedAsset.name} (${Math.round(received / 1024 / 1024)} MB)…`, pct);
      },
    });

    if (process.platform === 'linux') {
      const appImagePath = path.join(managed, 'T3-Code.AppImage');
      await fsp.writeFile(appImagePath, buf);
      await fsp.chmod(appImagePath, 0o755);

      report('extracting', 'Extracting T3 Code payload for headless background daemon…', 80);
      await execFileAsync(appImagePath, ['--appimage-extract'], { cwd: managed, timeoutMs: 60000 });
      const squashRoot = path.join(managed, 'squashfs-root');
      const payloadDir = path.join(managed, 'payload');
      if (fs.existsSync(squashRoot)) {
        await fsp.rm(payloadDir, { recursive: true, force: true });
        await fsp.rename(squashRoot, payloadDir);
      }

      report('done', 'T3 Code installed and ready (starts on demand for AI documents).', 100);
      return {
        ok: true,
        version: matchedRelease.tag_name,
        installedPath: fs.existsSync(payloadDir) ? path.join(payloadDir, 't3code') : appImagePath,
        source: 'github',
        t3Running: false,
        url: this.baseUrl,
      };
    }

    const destPath = path.join(managed, matchedAsset.name);
    await fsp.writeFile(destPath, buf);
    if (process.platform !== 'win32') await fsp.chmod(destPath, 0o755);
    if (process.platform === 'darwin' && /\.zip$/i.test(destPath)) {
      report('extracting', 'Unpacking T3 Code.app…', 82);
      await execFileAsync('ditto', ['-x', '-k', destPath, managed], { timeoutMs: 60000 });
    }

    report('done', 'T3 Code installed and ready.', 100);
    return {
      ok: true,
      version: matchedRelease.tag_name,
      installedPath: destPath,
      source: 'github',
      t3Running: false,
      url: this.baseUrl,
    };
  }

  async listModels() {
    const models = [];
    const seen = new Set();
    const push = (id, label) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      models.push({ id, label });
    };
    const token = this.readConnectionToken();
    for (const [url, tag] of [
      [`${this.baseUrl}/v1/models`, 'T3 Code'],
      ['http://127.0.0.1:11434/v1/models', 'Local'],
    ]) {
      try {
        const res = await httpGetJson(url, {
          timeoutMs: 1200,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res?.models) ? res.models : [];
        for (const m of list) {
          const id = typeof m === 'string' ? m : m?.id || m?.name;
          if (id) push(id, `${id} (${tag})`);
        }
      } catch { /* endpoint offline */ }
    }
    return models;
  }

  /**
   * Executes a chat completion request against T3 Code's local OpenAI-compatible
   * endpoint (`:3773/v1/chat/completions`, with fallback to `:11434`).
   */
  async runChat({ prompt, images = [], model = '', onDelta = null, onActivity = null, signal = null } = {}) {
    onActivity?.('Starting T3 Code…');
    await this.acquire();
    try {
      const token = this.readConnectionToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const chosenModel = model || 'default';

      let userContent = prompt;
      const imageParts = [];
      for (const img of images || []) {
        if (img?.bytes instanceof Uint8Array && /^image\/(png|jpe?g)$/i.test(img.type || '')) {
          const b64 = Buffer.from(img.bytes).toString('base64');
          imageParts.push({ type: 'image_url', image_url: { url: `data:${img.type};base64,${b64}` } });
        }
      }
      if (imageParts.length) {
        userContent = [{ type: 'text', text: prompt }, ...imageParts];
      }

      const body = {
        model: chosenModel,
        messages: [{ role: 'user', content: userContent }],
      };

      onActivity?.('T3 Code generating…');
      let lastErr = null;
      for (const url of [`${this.baseUrl}/v1/chat/completions`, 'http://127.0.0.1:11434/v1/chat/completions']) {
        try {
          const res = await httpPostChat(url, body, { headers, onDelta, signal });
          if (typeof res?.text === 'string' && res.text.trim()) {
            return { text: res.text };
          }
        } catch (err) {
          if (signal?.aborted) throw err;
          lastErr = err;
        }
      }
      throw lastErr || new Error('T3 Code backend did not return a response.');
    } finally {
      this.release();
    }
  }
}
