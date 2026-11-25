import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validBranch, branchVersion, branchOf, parseHeads, buildEnv, missingTools, branchBuilder, looksLikeAppImage } from './branch-build.js';
import { newer, parseVersion, updater } from './updater.js';

test('branch names are checked before they reach git', () => {
  for (const ok of ['main', 'claude/speed-up-euro-office', 'feature_1.2', 'v1.2.93-beta']) assert.equal(validBranch(ok), true, ok);
  for (const bad of ['', '-x', '--upload-pack=evil', 'a..b', 'a//b', 'a/', '/a', 'a.lock', 'a@{1}', 'a b', 'a;rm', 'a/.b', null]) assert.equal(validBranch(bad), false, String(bad));
});

test('a branch build carries a version no release has, and reads back', () => {
  const v = branchVersion('1.2.92', 'claude/Speed-up 2', '0abcdef1234567890');
  assert.equal(v, '1.2.92-branch.claude.speed.up.n2.g0abcdef');
  assert.deepEqual(parseVersion(v), { parts: [1, 2, 92], pre: 'branch.claude.speed.up.n2.g0abcdef' });
  assert.deepEqual(branchOf(v), { base: '1.2.92', sha: '0abcdef' });
  assert.equal(branchOf('1.2.92'), null);
  assert.equal(branchOf('1.2.92-beta.1'), null);
  // Semver: dot-separated alphanumerics, no numeric part with a leading zero.
  assert.match(v, /^\d+\.\d+\.\d+-[0-9A-Za-z]+(\.(0|[1-9]\d*|\d*[A-Za-z][0-9A-Za-z]*))*$/);
});

test('ls-remote heads are listed with main first', () => {
  const sha = (c) => c.repeat(40);
  const heads = parseHeads(`${sha('a')}\trefs/heads/zeta\n${sha('b')}\trefs/heads/main\n${sha('c')}\trefs/heads/claude/perf\nnoise\n`);
  assert.deepEqual(heads.map(h => h.name), ['main', 'claude/perf', 'zeta']);
  assert.equal(heads[0].sha, sha('b'));
});

test('the build environment drops the AppImage mount and keeps the user\'s tools', () => {
  const env = buildEnv({ APPDIR: '/tmp/.mount_X', APPIMAGE: '/a.AppImage', PATH: '/tmp/.mount_X/usr/bin:/usr/bin', LD_LIBRARY_PATH: '/tmp/.mount_X/usr/lib', XDG_DATA_DIRS: '/tmp/.mount_X/share:/usr/share', HOME: '/h' }, '/h/.nvm/bin:/usr/bin', '/h');
  assert.equal(env.APPDIR, undefined);
  assert.equal(env.APPIMAGE, undefined);
  assert.equal(env.LD_LIBRARY_PATH, undefined);
  assert.equal(env.XDG_DATA_DIRS, '/usr/share');
  const dirs = env.PATH.split(':');
  assert.equal(dirs[0], '/h/.nvm/bin');
  assert.ok(dirs.includes('/h/.cargo/bin'));
  assert.ok(!dirs.some(d => d.startsWith('/tmp/.mount_X')));
  assert.equal(new Set(dirs).size, dirs.length);
});

test('missing tools are named', async () => {
  const have = new Set(['/usr/bin/git', '/h/.cargo/bin/cargo']);
  assert.deepEqual(await missingTools('/usr/bin:/h/.cargo/bin', ['git', 'cargo', 'node'], async f => have.has(f)), ['node']);
});

test('an AppImage is told apart from other files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-branch-'));
  const good = path.join(dir, 'good'), bad = path.join(dir, 'bad');
  await writeFile(good, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02]), Buffer.alloc(32)]));
  await writeFile(bad, 'not an AppImage at all');
  assert.equal(await looksLikeAppImage(good), true);
  assert.equal(await looksLikeAppImage(bad), false);
});

// A fake spawn: each command runs a handler that may write files, then exits with its code.
function fakeSpawn(handlers, calls) {
  return (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 0;
    const name = `${path.basename(cmd)} ${args[0] ?? ''}`.trim();
    calls.push({ name, args, cwd: options.cwd });
    setImmediate(async () => {
      let result = { code: 0, out: '' };
      for (const [match, handler] of handlers) if (name.startsWith(match)) { result = { code: 0, out: '', ...(await handler(args, options)) }; break; }
      if (result.out) child.stdout.emit('data', Buffer.from(result.out));
      child.emit('close', result.code, null);
    });
    return child;
  };
}

async function setup({ buildCode = 0, produce = true, minSize } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-branch-'));
  const appImage = path.join(dir, 'NoteComplete.AppImage');
  await writeFile(appImage, 'old copy', { mode: 0o755 });
  const workDir = path.join(dir, 'work');
  const repo = path.join(workDir, 'NoteComplete');
  const sha = '1234567890abcdef1234567890abcdef12345678';
  const calls = [];
  const handlers = [
    ['sh -l', () => ({ out: 'HOME=/h\nPATH=/usr/bin\n' }), ],
    ['git init', async () => { await mkdir(path.join(repo, '.git'), { recursive: true }); }],
    ['git checkout', async () => {
      await mkdir(path.join(repo, 'tools'), { recursive: true });
      await mkdir(path.join(repo, 'apps/desktop'), { recursive: true });
      await writeFile(path.join(repo, 'tools/update_appimage.py'), '');
      await writeFile(path.join(repo, 'apps/desktop/package.json'), JSON.stringify({ version: '1.2.93' }));
      await writeFile(path.join(repo, 'Cargo.lock'), '[[package]]\nname = "wasm-bindgen"\nversion = "0.2.128"\n');
    }],
    ['git rev-parse', () => ({ out: `${sha}\n` })],
    ['git ls-remote', () => ({ out: `${sha}\trefs/heads/claude/perf\n` })],
    ['wasm-bindgen', () => ({ out: 'wasm-bindgen 0.2.128\n' })],
    ['python3 tools/update_appimage.py', async () => {
      if (buildCode) return { code: buildCode, out: 'error: compile failed\n' };
      if (!produce) return {};
      const pkg = JSON.parse(await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'));
      await mkdir(path.join(repo, 'apps/desktop/dist'), { recursive: true });
      await writeFile(path.join(repo, `apps/desktop/dist/NoteComplete-${pkg.version}-linux-arm64.AppImage`), 'new build');
      return {};
    }],
  ];
  let version = '1.2.92';
  const builder = branchBuilder({
    app: { getVersion: () => version }, stateFile: path.join(dir, 'branch.json'), workDir, appImage, platform: 'linux', arch: 'arm64',
    env: { SHELL: '/bin/sh', PATH: '/usr/bin', HOME: '/h' }, spawn: fakeSpawn(handlers, calls), checkAppImage: async () => true, toolExists: async () => true, ...(minSize ? { minSize } : {}),
  });
  // Every tool is "installed".
  return { dir, appImage, repo, sha, calls, builder, setVersion: v => { version = v; } };
}

test('a branch builds in its own clone and replaces the AppImage, keeping the old one', async () => {
  const { appImage, repo, sha, calls, builder, setVersion } = await setup();
  const lines = [], steps = [];
  // The fake build is tiny: the size check refuses it.
  await assert.rejects(builder.build('claude/perf', { onLine: l => lines.push(l), onStep: s => steps.push(s) }), /not a working AppImage/);
  // The install is untouched after a rejected build.
  assert.equal(await readFile(appImage, 'utf8'), 'old copy');
  const names = calls.map(c => c.name);
  assert.ok(names.includes('git fetch'));
  const fetch = calls.find(c => c.name === 'git fetch');
  assert.deepEqual(fetch.args.slice(-1), ['refs/heads/claude/perf']);
  assert.ok(names.includes('npm ci'));
  assert.ok(names.includes('python3 tools/update_appimage.py'));
  assert.ok(!names.includes('cargo install'), 'wasm-bindgen already matches');
  // The version was stamped into the branch's package.json.
  const pkg = JSON.parse(await readFile(path.join(repo, 'apps/desktop/package.json'), 'utf8'));
  assert.equal(pkg.version, `1.2.93-branch.claude.perf.g${sha.slice(0, 7)}`);
  assert.ok(steps.includes('Fetching the branch'));
  assert.ok(lines.some(l => l.startsWith('Building 1.2.93-branch')));
  setVersion(pkg.version);
});

test('a successful build is installed and remembered', async () => {
  const { appImage, sha, builder, setVersion } = await setup({ minSize: 1 });
  const done = await builder.build('claude/perf');
  assert.equal(done.branch, 'claude/perf');
  assert.equal(done.sha, sha);
  assert.equal(await readFile(appImage, 'utf8'), 'new build');
  assert.equal(await readFile(`${appImage}.previous`, 'utf8'), 'old copy');
  assert.ok((await stat(appImage)).mode & 0o100);
  assert.equal((await builder.info()).last.version, done.version);
  setVersion(done.version);
  assert.equal((await builder.status('claude/perf')).current, true);
  assert.equal((await builder.info()).running.sha, sha.slice(0, 7));
});

test('a failed build leaves the install as it was and says so in the log', async () => {
  const { appImage, builder } = await setup({ buildCode: 1 });
  await assert.rejects(builder.build('claude/perf'), /update_appimage\.py failed|python3/);
  assert.equal(await readFile(appImage, 'utf8'), 'old copy');
  assert.match(await readFile(builder.logFile, 'utf8'), /FAILED[\s\S]*not changed/);
  assert.equal((await builder.info()).building, null);
});

test('bad names and unsupported installs are refused before anything runs', async () => {
  const { builder, calls } = await setup();
  await assert.rejects(builder.build('--upload-pack=x'), /not a branch name/);
  const other = branchBuilder({ app: { getVersion: () => '1.0.0' }, stateFile: '/nonexistent/x.json', appImage: '', platform: 'linux', arch: 'arm64', spawn: () => { throw Error('ran'); } });
  await assert.rejects(other.build('main'), /Linux AppImage/);
  assert.equal(calls.length, 0);
});

test('release checks on a branch build compare against its base version', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-branch-upd-'));
  const releases = [{ tag_name: 'v1.2.93', html_url: 'https://github.com/Emefedez/NoteComplete/releases/tag/v1.2.93', assets: [{ name: 'NoteComplete-1.2.93-linux-arm64.AppImage' }] }];
  const fetch = async () => ({ ok: true, json: async () => releases });
  let version = '1.2.93-branch.claude.perf.g1234567';
  const u = updater({ app: { getVersion: () => version }, fetch, stateFile: path.join(dir, 'u.json'), appImage: '/x.AppImage', platform: 'linux', arch: 'arm64' });
  assert.equal((await u.check({ manual: true })).version, undefined, 'the same number is not offered over a beta');
  assert.equal(newer('1.2.93', version), true, 'though it would sort above it as a plain pre-release');
  version = '1.2.92-branch.claude.perf.g1234567';
  assert.equal((await u.check({ manual: true })).version, '1.2.93');
  // Back to the release explicitly, whatever the numbers.
  version = '1.2.93-branch.claude.perf.g1234567';
  const back = await u.stable();
  assert.equal(back.version, '1.2.93');
  assert.equal(back.install, 'appimage');
});
