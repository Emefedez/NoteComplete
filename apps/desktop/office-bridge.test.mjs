import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  OFFICE_IMAGE,
  createOfficeBridge,
  defaultImageDir,
  defaultModuleDir,
  detectLinuxRunner,
  detectMacRunner,
  detectWindowsRunner,
  documentTypeFor,
  signJwt,
  verifyJwt,
} from './office-bridge.js';

test('defaultModuleDir resolves per platform and honours dev overrides', () => {
  assert.equal(defaultModuleDir({}, 'linux', '/home/u'), '/home/u/.local/share/NoteComplete/modules/euro-office');
  assert.equal(defaultModuleDir({ XDG_DATA_HOME: '/data' }, 'linux', '/home/u'), '/data/NoteComplete/modules/euro-office');
  assert.equal(defaultModuleDir({ LOCALAPPDATA: 'C:/Users/u/AppData/Local' }, 'win32', 'C:/Users/u'), path.join('C:/Users/u/AppData/Local', 'NoteComplete', 'modules', 'euro-office'));
  assert.equal(defaultModuleDir({}, 'darwin', '/Users/u'), '/Users/u/Library/Application Support/NoteComplete/modules/euro-office');
  assert.equal(defaultModuleDir({ NOTECOMPLETE_OFFICE_MODULE_DIR: '/tmp/custom-eo' }, 'linux', '/home/u'), '/tmp/custom-eo');
  assert.equal(defaultImageDir({ NOTECOMPLETE_OFFICE_IMAGE_DIR: '/tmp/img' }), '/tmp/img');
  assert.equal(defaultImageDir({}), '');
});

test('JWT HS256 signing and verification reject tampered tokens', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const tok = signJwt({ key: 'abc', status: 6 }, secret);
  assert.deepEqual(verifyJwt(tok, secret), { key: 'abc', status: 6 });
  assert.equal(verifyJwt(tok + 'x', secret), null);
  assert.equal(verifyJwt(tok, 'wrong-secret'), null);
  assert.equal(verifyJwt('not-a-jwt', secret), null);
});

test('documentTypeFor uses manifest when available and falls back cleanly', () => {
  assert.equal(documentTypeFor('docx'), 'word');
  assert.equal(documentTypeFor('.xlsx'), 'cell');
  assert.equal(documentTypeFor('pptx'), 'slide');
  assert.equal(documentTypeFor('vsdx'), 'diagram');
  assert.equal(documentTypeFor('xyz', [{ name: 'xyz', type: 'cell' }]), 'cell');
});

test('detectLinuxRunner prefers podman/docker when ready, falls back to rootless, detects AppArmor userns restriction', async () => {
  const podman = await detectLinuxRunner({
    run: async (cmd) => (cmd === 'podman' ? { code: 0, stdout: 'arm64', stderr: '' } : { code: 1, stdout: '', stderr: '' }),
  });
  assert.equal(podman.runner, 'podman');
  assert.equal(podman.ready, true);
  assert.equal(podman.hostAlias, 'host.containers.internal');

  const docker = await detectLinuxRunner({
    run: async (cmd) => (cmd === 'docker' ? { code: 0, stdout: 'linux', stderr: '' } : { code: 1, stdout: '', stderr: '' }),
  });
  assert.equal(docker.runner, 'docker');
  assert.equal(docker.hostAlias, 'host.docker.internal');

  // Ubuntu AppArmor userns restriction detected with clear message.
  const apparmor = await detectLinuxRunner({
    run: async () => ({ code: 1, stdout: '', stderr: '' }),
    readText: async (p) => (p.includes('apparmor_restrict_unprivileged_userns') ? '1\n' : ''),
  });
  assert.equal(apparmor.ready, false);
  assert.equal(apparmor.apparmorRestricted, true);
  assert.match(apparmor.detail, /AppArmor/i);

  // Rootless ready when all tools and subuid are present.
  const rootless = await detectLinuxRunner({
    preferRootless: true,
    user: 'alice',
    uid: 1000,
    run: async (cmd, args) => {
      if (cmd === 'unshare' && args[0] === '--help') return { code: 0, stdout: '--map-auto', stderr: '' };
      if (cmd === 'pasta' || cmd === 'python3' || cmd === 'sh') return { code: 0, stdout: 'ok', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    },
    readText: async (p) => (p === '/etc/subuid' ? 'alice:100000:65536\n' : '0\n'),
  });
  assert.equal(rootless.runner, 'rootless');
  assert.equal(rootless.ready, true);
  assert.equal(rootless.hostAlias, '169.254.1.2');
});

test('detectWindowsRunner parses WSL2 check states (needsEnable, rebootNeeded, ready)', async () => {
  const needsEnable = await detectWindowsRunner({
    run: async (cmd, args) => {
      assert.equal(cmd, 'powershell.exe');
      assert.ok(args.includes('-Action') && args.includes('Check'));
      return { code: 0, stdout: '{"ok":true,"wsl":true,"version2":false,"distro":false,"rebootNeeded":false}\n', stderr: '' };
    },
  });
  assert.equal(needsEnable.runner, 'wsl');
  assert.equal(needsEnable.needsEnable, true);
  assert.equal(needsEnable.ready, true);

  const reboot = await detectWindowsRunner({
    run: async () => ({ code: 0, stdout: '{"ok":true,"wsl":true,"version2":false,"distro":false,"rebootNeeded":true}\n', stderr: '' }),
  });
  assert.equal(reboot.ready, false);
  assert.equal(reboot.rebootNeeded, true);
});

test('detectMacRunner parses container runtime availability', async () => {
  const none = await detectMacRunner({
    run: async (cmd, args) => {
      assert.equal(cmd, 'sh');
      assert.equal(args[1], 'check');
      return { code: 0, stdout: '{"ok":true,"runtime":"none","ready":false,"hostAlias":"","detail":"Install Podman"}\n', stderr: '' };
    },
  });
  assert.equal(none.ready, false);
  assert.equal(none.runner, 'none');

  const apple = await detectMacRunner({
    run: async () => ({ code: 0, stdout: '{"ok":true,"runtime":"container","ready":true,"hostAlias":"host.docker.internal","detail":"Using container"}\n', stderr: '' }),
  });
  assert.equal(apple.ready, true);
  assert.equal(apple.runner, 'container');
});

test('officeBridge lifecycle: start, openDocument, JWT callback save, forcesave, idle stop, uninstall', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nc-office-bridge-'));
  // Fake DocumentServer HTTP server to answer /healthcheck, /command, and saved file download.
  let fakeDsPort = 0;
  const savedPayload = Buffer.from('PK-edited-docx-bytes');
  const dsCalls = [];
  const fakeDs = http.createServer(async (req, res) => {
    dsCalls.push(`${req.method} ${req.url}`);
    if (req.url === '/healthcheck') { res.writeHead(200); res.end('true'); return; }
    if (req.url === '/saved.docx') { res.writeHead(200); res.end(savedPayload); return; }
    if (req.url === '/command' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"error":0}');
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fakeDs.listen(0, '127.0.0.1', () => { fakeDsPort = fakeDs.address().port; r(); }));

  try {
    // Prepare a pre-installed rootless module dir.
    const rootfs = path.join(tmp, 'versions', OFFICE_IMAGE.tag, 'rootfs');
    await mkdir(rootfs, { recursive: true });
    await writeFile(path.join(rootfs, 'entrypoint.sh'), '#!/bin/sh\n');
    await writeFile(path.join(tmp, 'module.json'), JSON.stringify({
      version: OFFICE_IMAGE.version,
      tag: OFFICE_IMAGE.tag,
      digest: OFFICE_IMAGE.arch.arm64.digest,
      arch: 'arm64',
      runner: 'rootless',
      fontsGenerated: false,
      formats: [{ name: 'docx', type: 'word', actions: ['view', 'edit'], mime: [] }],
      licence: OFFICE_IMAGE.licence,
      notice: 'Test NOTICE',
      sourceUrl: OFFICE_IMAGE.sourceUrl,
    }));

    const spawned = [];
    const savedEvents = [];
    const bridge = createOfficeBridge({
      moduleDir: tmp,
      platform: 'linux',
      arch: 'arm64',
      idleMs: 120,
      run: async (cmd, args, opts) => {
        spawned.push({ cmd, args, env: opts?.env });
        if (cmd === 'unshare' && args[0] === '--help') return { code: 0, stdout: '--map-auto', stderr: '' };
        if (cmd === 'pasta' || cmd === 'python3') return { code: 0, stdout: 'ok', stderr: '' };
        if (cmd === 'sh' && args[0] === '-c') return { code: 0, stdout: '/usr/bin/newuidmap', stderr: '' };
        if (cmd === 'sh' && String(args[0]).endsWith('run.sh')) return { code: 0, stdout: 'started', stderr: '' };
        if (cmd === 'sh' && String(args[0]).endsWith('stop.sh')) return { code: 0, stdout: 'stopped', stderr: '' };
        if (cmd === 'unshare' && args.includes('rm')) {
          await rm(args.at(-1), { recursive: true, force: true });
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 1, stdout: '', stderr: '' };
      },
      readText: async (p) => (p === '/etc/subuid' ? `${os.userInfo().username}:100000:65536\n` : '0\n'),
      // Redirect 127.0.0.1:<randomPort> healthcheck & command requests to our fakeDsPort.
      fetch: async (url, init) => {
        const u = new URL(url);
        if (u.hostname === '127.0.0.1' && (u.pathname === '/healthcheck' || u.pathname === '/command' || u.pathname === '/saved.docx')) {
          u.port = String(fakeDsPort);
          return globalThis.fetch(u.href, init);
        }
        return globalThis.fetch(url, init);
      },
      onSaved: (ev) => savedEvents.push(ev),
    });

    const st = await bridge.status();
    assert.equal(st.installed, true);
    assert.equal(st.state, 'installed');
    assert.equal(st.notice, 'Test NOTICE');
    assert.equal(st.formats.length, 1);

    const opened = await bridge.openDocument({ bytes: Buffer.from('original'), name: 'notes.docx', mode: 'edit', theme: 'dark', lang: 'es-ES', ownerId: 7 });
    assert.ok(opened.sessionId);
    assert.equal(opened.config.documentType, 'word');
    assert.equal(opened.config.editorConfig.lang, 'es');
    assert.equal(opened.config.editorConfig.customization.uiTheme, 'theme-dark');
    assert.equal(opened.config.editorConfig.customization.forcesave, true);
    assert.equal(bridge.running, true);
    assert.equal(bridge.openSessions, 1);

    // First start ran with GENERATE_FONTS=true and updated module.json fontsGenerated=true.
    const runCall = spawned.find((s) => s.cmd === 'sh' && String(s.args[0]).endsWith('run.sh'));
    assert.equal(runCall.env.GENERATE_FONTS, 'true');
    const updatedMeta = JSON.parse(await readFile(path.join(tmp, 'module.json'), 'utf8'));
    assert.equal(updatedMeta.fontsGenerated, true);

    // jwt_secret was created with 0600 permissions.
    const secStat = await stat(path.join(tmp, 'jwt_secret'));
    assert.equal(secStat.mode & 0o777, 0o600);
    const secret = (await readFile(path.join(tmp, 'jwt_secret'), 'utf8')).trim();

    // Verify document endpoint serves the document bytes (swap pasta hostAlias -> 127.0.0.1 to test locally).
    const docUrl = opened.config.document.url.replace('169.254.1.2', '127.0.0.1');
    const fetchedDoc = await globalThis.fetch(docUrl);
    assert.equal(await fetchedDoc.text(), 'original');

    // Callback with invalid JWT is rejected with 403.
    const cbUrl = opened.config.editorConfig.callbackUrl.replace('169.254.1.2', '127.0.0.1');
    const badCb = await globalThis.fetch(cbUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 6, token: 'bad' }) });
    assert.equal(badCb.status, 403);

    // Callback with valid JWT downloads saved file and notifies onSaved.
    const payload = { status: 6, key: opened.key, url: `http://127.0.0.1:${fakeDsPort}/saved.docx`, filetype: 'docx' };
    const goodCb = await globalThis.fetch(cbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, token: signJwt(payload, secret) }),
    });
    assert.equal(goodCb.status, 200);
    assert.equal(savedEvents.length, 1);
    assert.deepEqual(savedEvents[0].bytes, savedPayload);
    assert.equal(savedEvents[0].status, 6);
    assert.notEqual(savedEvents[0].key, opened.key);

    // Closing the last document triggers idle stop after idleMs.
    await bridge.closeDocument(opened.sessionId, { save: false });
    assert.equal(bridge.openSessions, 0);
    await new Promise((r) => setTimeout(r, 220));
    assert.equal(bridge.running, false);
    assert.ok(spawned.some((s) => s.cmd === 'sh' && String(s.args[0]).endsWith('stop.sh')));

    // Uninstall removes versions/ and module.json.
    await bridge.uninstall();
    assert.equal((await bridge.status()).installed, false);
  } finally {
    await new Promise((r) => fakeDs.close(() => r()));
    await rm(tmp, { recursive: true, force: true });
  }
});
