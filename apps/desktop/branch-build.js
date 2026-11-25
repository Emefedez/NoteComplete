// Beta updates from a branch (Help → Update from a branch…). Instead of a release built by CI,
// this fetches one branch of the repository into a private clone, builds the AppImage on this
// machine with that branch's own tools/update_appimage.py --no-install, and swaps it in the way
// a release update does: the running copy stays beside it as .previous. Nothing is replaced
// unless the whole build succeeds, so a failed or cancelled build leaves the install as it was.
// Linux AppImage only: that is the one install that can replace itself.
import { spawn as spawnProcess } from 'node:child_process';
import { access, chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { REPOSITORY, parseVersion } from './updater.js';

export const REMOTE = `https://github.com/${REPOSITORY}.git`;
// Tools the build needs on PATH (wasm-bindgen is installed into the clone when missing).
export const NEEDED = ['git', 'cargo', 'node', 'npm', 'python3', 'mksquashfs'];
const ARCH = { arm64: 'arm64', x64: 'x64' };

// A branch name as git accepts it, without anything a command line could take for an option.
export function validBranch(name) {
  const b = String(name ?? '').trim();
  if (!b || b.length > 200 || b.startsWith('-') || b.startsWith('/') || b.endsWith('/') || b.endsWith('.') || b.endsWith('.lock')) return false;
  if (/\.\.|\/\/|@\{|\/\./.test(b)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(b);
}

// The version a branch build carries: the branch's own X.Y.Z, then "-branch.<name>.g<sha>", so
// it shows in Help and never passes for a release. Identifiers are semver-safe (no leading
// zeros: a numeric part gets a letter in front).
export function branchVersion(base, branch, sha) {
  const core = parseVersion(base)?.parts.join('.') || '0.0.0';
  const slug = String(branch).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(p => /^\d+$/.test(p) ? `n${p}` : p).join('.').slice(0, 48).replace(/\.+$/, '');
  return `${core}-branch.${slug || 'x'}.g${String(sha).slice(0, 7).toLowerCase()}`;
}
// "1.2.92-branch.claude.perf.g1a2b3c4" → { base: '1.2.92', sha: '1a2b3c4' }, null for a release.
export function branchOf(version) {
  const v = parseVersion(version);
  if (!v || !v.pre.startsWith('branch.')) return null;
  const m = v.pre.match(/\.g([0-9a-f]{7,40})$/);
  return { base: v.parts.join('.'), sha: m ? m[1] : '' };
}

// `git ls-remote --heads` output → [{ name, sha }].
export function parseHeads(text) {
  const heads = [];
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{40})\s+refs\/heads\/(.+)$/);
    if (m) heads.push({ name: m[2], sha: m[1] });
  }
  return heads.sort((a, b) => (a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name.localeCompare(b.name)));
}

// The environment for the build: without the AppImage's own mount (its libraries and helpers
// must not leak into cargo, node or electron-builder), with the user's login-shell PATH and the
// usual tool folders.
export function buildEnv(env, loginPath = '', home = homedir()) {
  const clean = { ...env };
  const mount = env.APPDIR || '';
  for (const name of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'NODE_OPTIONS', 'CHROME_DESKTOP']) delete clean[name];
  if (mount) {
    for (const [name, value] of Object.entries(clean)) {
      if (typeof value !== 'string' || !value.includes(mount)) continue;
      const kept = value.split(':').filter(part => part && !part.startsWith(mount));
      if (kept.length) clean[name] = kept.join(':'); else delete clean[name];
    }
  }
  const dirs = [...String(loginPath).split(':'), ...String(clean.PATH || '').split(':'), path.join(home, '.cargo/bin'), path.join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin']
    .filter(d => d && path.isAbsolute(d) && (!mount || !d.startsWith(mount)));
  clean.PATH = [...new Set(dirs)].join(':');
  return clean;
}

// Which of the needed tools are not on this PATH.
export async function missingTools(PATH, needed = NEEDED, exists = async f => { await access(f, fsConstants.X_OK); return true; }) {
  const missing = [];
  for (const tool of needed) {
    let found = false;
    for (const dir of String(PATH).split(':').filter(Boolean)) {
      try { if (await exists(path.join(dir, tool))) { found = true; break; } } catch { /* Not here. */ }
    }
    if (!found) missing.push(tool);
  }
  return missing;
}

// An AppImage is an ELF file with "AI\x02" at byte 8.
export async function looksLikeAppImage(file) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(11);
    await handle.read(head, 0, 11, 0);
    return head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02;
  } finally { await handle.close(); }
}

export function branchBuilder({
  app, stateFile, workDir = path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'notecomplete', 'branch-build'),
  appImage = process.env.APPIMAGE || '', platform = process.platform, arch = process.arch, env = process.env,
  spawn = spawnProcess, now = () => Date.now(), checkAppImage = looksLikeAppImage, minSize = 20e6, toolExists,
}) {
  const repo = path.join(workDir, 'NoteComplete');
  const logFile = path.join(workDir, 'build.log');
  let job = null; // { branch, child, cancelled, lines }
  let envCache = null;
  const state = async () => { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return {}; } };
  const remember = async patch => { await writeFile(stateFile, JSON.stringify({ ...(await state()), ...patch })).catch(() => {}); };
  const supported = () => platform === 'linux' && !!appImage && !!ARCH[arch];

  // One command; its output goes to the log and, line by line, to onLine. Resolves with stdout
  // when asked for, rejects on a non-zero exit or a cancel.
  function runCommand(cmd, args, { cwd = repo, capture = false, onLine = () => {}, quiet = false, track = false } = {}) {
    return new Promise((resolve, reject) => {
      if (track && job?.cancelled) return reject(Error('Build cancelled.'));
      if (!quiet) { const line = `+ ${[cmd, ...args].join(' ')}`; appendFile(logFile, line + '\n').catch(() => {}); onLine(line); }
      let child;
      try { child = spawn(cmd, args, { cwd, env: envCache, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { return reject(error); }
      if (track && job) job.child = child;
      let out = '', partial = '';
      const take = chunk => {
        const text = chunk.toString();
        if (capture) out += text;
        appendFile(logFile, text).catch(() => {});
        const parts = (partial + text).split(/\r?\n|\r/);
        partial = parts.pop();
        for (const part of parts) if (part.trim()) onLine(part);
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (track && job) job.child = null;
        if (partial.trim()) onLine(partial);
        if (track && job?.cancelled) return reject(Error('Build cancelled.'));
        if (code === 0) return resolve(out);
        reject(Error(`${path.basename(cmd)} ${args[0] ?? ''} failed (${signal || `exit ${code}`}).`));
      });
    });
  }
  async function prepareEnv() {
    if (envCache) return envCache;
    // The user's PATH as a login shell sets it (cargo and node are often only there when the
    // app was started from the desktop). `env` prints it the same way from any shell.
    let loginPath = '';
    const shell = env.SHELL && path.isAbsolute(env.SHELL) ? env.SHELL : '/bin/sh';
    envCache = buildEnv(env, '');
    try {
      const out = await Promise.race([
        runCommand(shell, ['-l', '-c', 'env'], { cwd: homedir(), capture: true, quiet: true }),
        new Promise((_, reject) => setTimeout(() => reject(Error('slow shell')), 8000)),
      ]);
      loginPath = (String(out).split('\n').find(l => l.startsWith('PATH=')) || '').slice(5);
    } catch { /* Fall back to the app's PATH. */ }
    envCache = buildEnv(env, loginPath);
    return envCache;
  }

  return {
    supported,
    logFile,
    // What the dialog shows first: whether this install can do it, what it runs now, the last
    // branch built, and a build in progress.
    async info() {
      const s = await state();
      return {
        supported: supported(), platform, appImage: !!appImage, current: app.getVersion(),
        running: branchOf(app.getVersion()), last: s.last || null, building: job ? job.branch : null,
      };
    },
    // Branches on GitHub, by git itself (no API rate limit).
    async branches() {
      await prepareEnv();
      const out = await runCommand('git', ['ls-remote', '--heads', REMOTE], { cwd: homedir(), capture: true, quiet: true });
      return parseHeads(out);
    },
    // A branch's newest commit and whether it differs from what was last built from it.
    async status(branch) {
      if (!validBranch(branch)) throw Error('That is not a branch name.');
      await prepareEnv();
      const out = await runCommand('git', ['ls-remote', '--heads', REMOTE, `refs/heads/${branch}`], { cwd: homedir(), capture: true, quiet: true });
      const head = parseHeads(out).find(h => h.name === branch);
      if (!head) throw Error(`There is no branch "${branch}" on GitHub.`);
      const s = await state();
      const running = branchOf(app.getVersion());
      const built = s.last?.branch === branch ? s.last.sha : '';
      return { branch, sha: head.sha, built, current: !!running && head.sha.startsWith(running.sha) && s.last?.branch === branch };
    },
    async missing() { return missingTools((await prepareEnv()).PATH, NEEDED, toolExists); },
    // Fetch, build, check and install. onLine gets each output line; onStep the stage.
    async build(branch, { onLine = () => {}, onStep = () => {} } = {}) {
      if (!supported()) throw Error('Branch builds need the Linux AppImage of NoteComplete.');
      if (!validBranch(branch)) throw Error('That is not a branch name.');
      if (job) throw Error(`A build of ${job.branch} is already running.`);
      job = { branch, child: null, cancelled: false };
      const started = now();
      const run = (cmd, args, options = {}) => runCommand(cmd, args, { track: true, ...options });
      try {
        await mkdir(workDir, { recursive: true });
        await writeFile(logFile, `NoteComplete branch build: ${branch}, ${new Date(started).toISOString()}\n`);
        const e = await prepareEnv();
        const missing = await missingTools(e.PATH, NEEDED, toolExists);
        if (missing.length) throw Error(`Install ${missing.join(', ')} first (the build runs them).`);
        onStep('Fetching the branch');
        await mkdir(repo, { recursive: true });
        try { await access(path.join(repo, '.git')); } catch { await run('git', ['init', '--quiet'], { onLine }); }
        await run('git', ['fetch', '--depth', '1', '--no-tags', REMOTE, `refs/heads/${branch}`], { onLine });
        await run('git', ['checkout', '--force', '--detach', 'FETCH_HEAD'], { onLine });
        // Build output kept from the last run (cargo's target, the wasm-bindgen install) makes the
        // next build faster; everything else comes from the branch alone.
        await run('git', ['clean', '-ffdxq', '-e', '/target/', '-e', '/work/'], { onLine });
        const sha = (await run('git', ['rev-parse', 'HEAD'], { capture: true, onLine })).trim();
        const script = path.join(repo, 'tools/update_appimage.py');
        try { await access(script); } catch { throw Error(`The branch ${branch} has no tools/update_appimage.py to build with.`); }
        const pkgFile = path.join(repo, 'apps/desktop/package.json');
        const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
        const version = branchVersion(pkg.version, branch, sha);
        pkg.version = version;
        await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
        onLine(`Building ${version}`);
        onStep('Preparing the Rust toolchain');
        if (!(await missingTools(e.PATH, ['rustup'], toolExists)).length) await run('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { onLine });
        const lock = await readFile(path.join(repo, 'Cargo.lock'), 'utf8');
        const bindgen = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1];
        if (bindgen) {
          let have = '';
          try { have = (await run(path.join(repo, 'work/wasm-tools/bin/wasm-bindgen'), ['--version'], { capture: true, quiet: true })).trim().split(/\s+/).pop(); } catch { /* Not yet. */ }
          if (have !== bindgen) {
            onStep(`Installing wasm-bindgen ${bindgen} (first build only)`);
            await run('cargo', ['install', 'wasm-bindgen-cli', '--version', bindgen, '--locked', '--root', 'work/wasm-tools'], { onLine });
          }
        }
        onStep('Installing the desktop packages');
        await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(repo, 'apps/desktop'), onLine });
        onStep('Building (this takes a while)');
        await run('python3', ['tools/update_appimage.py', '--no-install'], { onLine });
        onStep('Checking the build');
        const dist = path.join(repo, 'apps/desktop/dist');
        const name = `NoteComplete-${version}-linux-${ARCH[arch]}.AppImage`;
        const built = (await readdir(dist)).includes(name) ? path.join(dist, name) : null;
        if (!built) throw Error(`The build did not produce ${name}.`);
        const size = (await stat(built)).size;
        if (size < minSize || !(await checkAppImage(built))) throw Error('The build produced something that is not a working AppImage; not installing it.');
        if (job.cancelled) throw Error('Build cancelled.');
        onStep('Installing');
        // As a release update does: the new file next to the old, then two renames, so the
        // AppImage is never half written; the running copy stays as .previous.
        const next = `${appImage}.download`, previous = `${appImage}.previous`;
        await copyFile(built, next);
        await chmod(next, (await stat(appImage)).mode | 0o755);
        await rm(previous, { force: true });
        await rename(appImage, previous);
        await rename(next, appImage);
        const last = { branch, sha, version, builtAt: now(), seconds: Math.round((now() - started) / 1000) };
        await remember({ last });
        await appendFile(logFile, `Installed ${version} as ${appImage}; previous copy kept as ${path.basename(previous)}\n`).catch(() => {});
        return last;
      } catch (error) {
        await appendFile(logFile, `\nFAILED: ${error.message}\nThe installed copy was not changed.\n`).catch(() => {});
        throw error;
      } finally {
        job = null;
      }
    },
    // Stops the build: the whole process group (cargo and node spawn their own children).
    cancel() {
      if (!job) return false;
      job.cancelled = true;
      const child = job.child;
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* Gone. */ } }
        setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Gone. */ } }, 4000).unref?.();
      }
      return true;
    },
    get building() { return job?.branch || null; },
  };
}
