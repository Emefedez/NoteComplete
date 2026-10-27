import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aiRunner, invocation } from './ai-runner.js';

test('each provider gets minimal permissions and its own output format', () => {
  const claude = invocation('claude', { prompt: 'Q', images: ['/t/01.png'], dir: '/t', model: '', mcp: '/app/noteful' });
  assert.deepEqual(claude.args.slice(0, 8), ['-p', '--output-format', 'json', '--add-dir', '/t', '--strict-mcp-config', '--allowedTools', 'Read']);
  assert.ok(claude.args.includes('mcp__notecomplete'));
  assert.match(claude.stdin, /\/t\/01\.png/);
  assert.equal(claude.parse('{"result":"ok"}'), 'ok');
  const agy = invocation('antigravity', { prompt: 'Q', images: [], dir: '/t', model: 'x' });
  assert.equal(agy.parse('{"response":"hi","status":"SUCCESS"}'), 'hi');
  assert.ok(!agy.args.includes('--dangerously-skip-permissions'));
  const codex = invocation('codex', { prompt: 'Q', images: ['/t/01.png'], dir: '/t', model: '' });
  assert.ok(codex.args.includes('read-only') && codex.args.includes('-i'));
  assert.throws(() => invocation('shell', { prompt: 'Q', images: [], dir: '/t' }));
});

test('runs a provider in a temporary folder, passes images and cleans up', async () => {
  // A fake "claude" that echoes the image list it was given as its JSON result.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\nprompt=$(cat)\nprintf \'{"result":"%s"}\' "$(printf %s "$prompt" | grep -c png) images in $(pwd | grep -c notecomplete-ai)"\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  assert.deepEqual((await runner.providers()).map(p => [p.id, p.available]), [['claude', true], ['antigravity', false], ['codex', false]]);
  const png = new Uint8Array([137, 80, 78, 71]);
  const { text } = await runner.run('w1', { provider: 'claude', prompt: 'Cards please', images: [{ bytes: png, type: 'image/png', label: 'p1' }, { bytes: png, type: 'image/png', label: 'p2' }] });
  assert.equal(text, '2 images in 1');
  await assert.rejects(runner.run('w1', { provider: 'antigravity', prompt: 'x' }), /not found/);
  await assert.rejects(runner.run('w1', { provider: 'claude', prompt: '' }), /Empty/);
  await assert.rejects(runner.run('w1', { provider: 'claude', prompt: 'x', images: [{ bytes: png, type: 'text/html' }] }), /Invalid page image/);
  await assert.rejects(runner.run('w1', { provider: 'claude', prompt: 'x', model: 'a; rm -rf' }), /Invalid model/);
});

test('requests run side by side and Stop cancels only its own tag', async () => {
  // A slow fake "claude": each request takes 0.4 s.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\ncat >/dev/null\nsleep 0.4\nprintf \'{"result":"done"}\'\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  const started = Date.now();
  const batches = [1, 2, 3].map(() => runner.run('w1', { provider: 'claude', prompt: 'x', tag: 'study' }));
  const chat = runner.run('w1', { provider: 'claude', prompt: 'x', tag: 'chat' });
  await assert.rejects(runner.run('w1', { provider: 'claude', prompt: 'x' }), /Too many/);
  await new Promise(r => setTimeout(r, 100));
  runner.cancel('w1', 'study');
  for (const r of await Promise.allSettled(batches)) assert.match(r.reason?.message, /stopped/);
  assert.equal((await chat).text, 'done');
  assert.ok(Date.now() - started < 1500, 'requests ran in parallel');
  await assert.rejects(runner.run('w1', { provider: 'claude', prompt: 'x', tag: 'a b' }), /Invalid request tag/);
});
