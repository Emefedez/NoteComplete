import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRBridge, readBridgeInfo, studioPlatformSupport } from './r-bridge.js';

test('r-bridge connects to authenticated Studio HTTP server and rejects invalid tokens', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-rbridge-test-'));
  const token = 'a'.repeat(40);
  const discoveryFile = path.join(dir, 'r-bridge.json');
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      seen.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') {
        res.end(JSON.stringify({ ok: true, app: 'r-commander-studio', version: '0.1.0', rVersion: '4.6.2', svglite: false }));
      } else if (req.url === '/eval-figure') {
        res.end(JSON.stringify({ ok: true, svg: '<svg viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', stdout: '', warnings: [], elapsedMs: 12 }));
      } else if (req.url === '/open-script') {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.end(JSON.stringify({ ok: true, stdout: '[1] 42' }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await writeFile(discoveryFile, JSON.stringify({
      protocolVersion: 1,
      app: 'r-commander-studio',
      version: '0.1.0',
      port,
      token,
      pid: process.pid,
    }));

    const info = await readBridgeInfo(discoveryFile);
    assert.equal(info.port, port);

    const bridge = createRBridge({ discoveryFile });
    const st = await bridge.status();
    assert.equal(st.studioConnected, true);
    assert.equal(st.mode, 'studio');
    assert.equal(st.studioVersion, '0.1.0');

    const fig = await bridge.evalFigure({ rCode: 'plot(1:5)', width: 520, height: 340 });
    assert.equal(fig.ok, true);
    assert.equal(fig.backend, 'studio');
    assert.ok(fig.svg.startsWith('<svg'));

    const opened = await bridge.openInStudio({ title: 'Test.R', code: '1+1', kind: 'r' });
    assert.equal(opened.ok, true);
    assert.equal(opened.connected, true);
    assert.ok(seen.some((r) => r.url === '/open-script' && r.body.title === 'Test.R'));

    // Bad token in discovery file must not connect
    await writeFile(discoveryFile, JSON.stringify({ protocolVersion: 1, port, token: 'b'.repeat(40), pid: process.pid }));
    const badStatus = await bridge.status();
    assert.equal(badStatus.studioConnected, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('r-bridge falls back to local Rscript when Studio is not running', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-rbridge-local-'));
  try {
    const bridge = createRBridge({ discoveryFile: path.join(dir, 'missing.json') });
    const st = await bridge.status();
    if (!st.rAvailable) {
      t.skip('Rscript is not installed in this environment');
      return;
    }
    assert.equal(st.studioConnected, false);
    assert.equal(st.mode, 'rscript');
    const fig = await bridge.evalFigure({
      rCode: 'curve(dnorm(x), from = -3, to = 3, main = "Standard Normal")',
      width: 480,
      height: 300,
    });
    assert.equal(fig.ok, true);
    assert.equal(fig.backend, 'rscript');
    assert.ok(fig.svg.includes('<svg') && fig.svg.includes('</svg>'));

    const code = await bridge.evalCode({ rCode: 'cat(2 + 2)' });
    assert.equal(code.ok, true);
    assert.equal(code.stdout, '4');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('r-bridge detects platform installer support, creates single R/Rmd files and full R workspace folders, and installs from local dist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nc-rbridge-create-'));
  try {
    assert.equal(studioPlatformSupport('linux', 'x64').supported, true);
    assert.equal(studioPlatformSupport('linux', 'arm64').supported, true);
    assert.equal(studioPlatformSupport('win32', 'x64').supported, true);
    assert.equal(studioPlatformSupport('darwin', 'arm64').supported, true);

    const managedDir = path.join(dir, 'managed');
    const bridge = createRBridge({ discoveryFile: path.join(dir, 'missing.json'), managedDir });

    const singleR = await bridge.createRItem({ mode: 'file', name: 'my_script', parentDir: dir, kind: 'r' });
    assert.equal(singleR.ok, true);
    assert.equal(singleR.name, 'my_script.R');
    assert.ok(existsSync(singleR.filePath));

    const singleRmd = await bridge.createRItem({ mode: 'file', name: 'my_report', parentDir: dir, kind: 'rmd' });
    assert.equal(singleRmd.ok, true);
    assert.equal(singleRmd.name, 'my_report.Rmd');
    assert.ok(existsSync(singleRmd.filePath));

    const ws = await bridge.createRItem({ mode: 'workspace', name: 'stats_lab', parentDir: dir });
    assert.equal(ws.ok, true);
    assert.equal(ws.mode, 'workspace');
    for (const f of ws.files) assert.ok(existsSync(f), f);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
