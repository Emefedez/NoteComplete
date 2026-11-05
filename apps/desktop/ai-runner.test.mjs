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
  // A PDF is listed for the tool to read; Codex gets only images as -i.
  const withPdf = invocation('codex', { prompt: 'Q', images: ['/t/01.png', '/t/02-source.pdf'], dir: '/t', model: '' });
  assert.equal(withPdf.args.filter(a => a === '-i').length, 1);
  assert.match(withPdf.stdin, /Attached files[\s\S]*02-source\.pdf/);
  assert.match(invocation('claude', { prompt: 'Q', images: ['/t/01-source.pdf'], dir: '/t', model: '' }).stdin, /01-source\.pdf/);
  assert.throws(() => invocation('shell', { prompt: 'Q', images: [], dir: '/t' }));
});

test('runs a provider in a temporary folder, passes images and cleans up', async () => {
  // A fake "claude" that echoes the image list it was given as its JSON result.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\nprompt=$(cat)\nprintf \'{"result":"%s"}\' "$(printf %s "$prompt" | grep -c png) images in $(pwd | grep -c notecomplete-ai)"\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  assert.deepEqual((await runner.providers()).map(p => [p.id, p.available]), [['claude', true], ['antigravity', false], ['codex', false], ['opencode', false]]);
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

test('closing a window stops all its requests at once and leaves nothing behind', async () => {
  // A "claude" that would run for a minute: closing the tab must not wait for it.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\ncat >/dev/null\nexec sleep 60\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  const started = Date.now();
  const runs = [runner.run('gone', { provider: 'claude', prompt: 'x', tag: 'study' }), runner.run('gone', { provider: 'claude', prompt: 'x', tag: 'chat' })];
  const other = runner.run('kept', { provider: 'claude', prompt: 'x' });
  other.catch(() => {});
  await new Promise(r => setTimeout(r, 200));
  assert.equal(runner.owners(), 2);
  runner.cancel('gone');
  for (const r of await Promise.allSettled(runs)) assert.match(r.reason?.message, /stopped/);
  assert.ok(Date.now() - started < 5000, 'the processes were killed, not waited for');
  assert.equal(runner.owners(), 1, 'the closed window is forgotten; the other keeps running');
  runner.cancel('kept');
  await assert.rejects(other, /stopped/);
  assert.equal(runner.owners(), 0);
});

test('processes that ignore SIGTERM are killed with SIGKILL on cancel', async () => {
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-unresponsive-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\ntrap "" TERM\ncat >/dev/null\nexec sleep 60\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  const run = runner.run('w1', { provider: 'claude', prompt: 'x' });
  await new Promise(r => setTimeout(r, 100));
  const started = Date.now();
  runner.cancel('w1');
  await assert.rejects(run, /stopped/);
  assert.ok(Date.now() - started < 6000, 'escalated to SIGKILL within grace period');
  assert.equal(runner.owners(), 0);
});

test('a provider that writes a complete answer before hanging or dying on exit is preserved', async () => {
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-exitcrash-'));
  const fake = path.join(bin, 'claude');
  await writeFile(fake, '#!/bin/sh\nprintf \'{"result":"recovered answer"}\\n\'\nexit 1\n');
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  const res = await runner.run('w1', { provider: 'claude', prompt: 'x' });
  assert.equal(res.text, 'recovered answer');
});

test('Antigravity model listing is parsed into ids and labels', async () => {
  const { parseAgyModels } = await import('./ai-runner.js');
  assert.deepEqual(parseAgyModels('Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n'),
    [{ id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' }, { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' }]);
  const runner = aiRunner({ tools: async () => ({ claude: '/bin/true', antigravity: null, codex: null }) });
  assert.equal((await runner.models('claude'))[0].id, 'opus');
  assert.deepEqual(await runner.models('antigravity'), []);
});

test('streamed answers arrive in pieces and end with the full answer', async () => {
  const { streamLine } = await import('./ai-runner.js');
  assert.deepEqual(streamLine('claude', '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"uno "}}}'), { delta: 'uno ' });
  assert.deepEqual(streamLine('claude', '{"type":"result","result":"uno dos"}'), { final: 'uno dos' });
  assert.deepEqual(streamLine('antigravity', '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"uno\\n"}}'), { delta: 'uno\n' });
  assert.deepEqual(streamLine('antigravity', '{"event":"result","result":{"response":"uno dos"}}'), { final: 'uno dos' });
  assert.deepEqual(streamLine('claude', 'not json'), {});
  // A fake streaming "claude" writing three pieces with pauses.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const fake = path.join(bin, 'claude');
  const piece = t => `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"${t}"}}}`;
  await writeFile(fake, `#!/bin/sh\ncat >/dev/null\necho '${piece('Hola ')}'\nsleep 0.2\necho '${piece('mundo')}'\nsleep 0.2\necho '{"type":"result","result":"Hola mundo"}'\n`);
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: fake, antigravity: null, codex: null }) });
  const seen = [];
  const { text } = await runner.run('w1', { provider: 'claude', prompt: 'x' }, d => seen.push([d, Date.now()]));
  assert.equal(text, 'Hola mundo');
  assert.deepEqual(seen.map(s => s[0]), ['Hola ', 'mundo']);
  assert.ok(seen[1][1] - seen[0][1] >= 150, 'pieces arrive as they are written');
});

test('Antigravity gets the note server as a plugin in its own workspace', () => {
  const agy = invocation('antigravity', { prompt: 'Q', images: [], dir: '/t', model: '', mcp: '/app/noteful' });
  const [manifest, config] = agy.files;
  assert.equal(manifest[0], '.agents/plugins/notecomplete/plugin.json');
  assert.deepEqual(JSON.parse(config[1]).mcpServers.notecomplete, { command: '/app/noteful', args: ['mcp'] });
  assert.deepEqual(invocation('antigravity', { prompt: 'Q', images: [], dir: '/t', model: '' }).files, []);
});

test('models are kept, asked again when fresh, and opening several pickers asks once', async () => {
  // A fake "agy" that counts how often it was asked and lists a model with that count.
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-agy-'));
  const fake = path.join(bin, 'agy'), count = path.join(bin, 'count');
  await writeFile(count, '0');
  await writeFile(fake, `#!/bin/sh\nn=$(($(cat ${count}) + 1)); echo $n > ${count}; sleep 0.2\nprintf 'gemini-%s\\tGemini %s\\n' $n $n\n`);
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: null, antigravity: fake, codex: null }) });
  assert.deepEqual(await runner.models('antigravity'), [{ id: 'gemini-1', label: 'Gemini 1' }]);
  assert.deepEqual(await runner.models('antigravity'), [{ id: 'gemini-1', label: 'Gemini 1' }], 'kept without fresh');
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => runner.models('antigravity', { fresh: true })));
  assert.deepEqual([a[0].id, b[0].id, c[0].id], ['gemini-2', 'gemini-2', 'gemini-2'], 'one request for pickers opening together');
  assert.equal((await runner.models('antigravity', { fresh: true }))[0].id, 'gemini-3');
});

test('OpenCode gets the prompt on stdin, images as files and the note server in its inline config', async () => {
  const { openCodeAnswer, parseOpenCodeModels } = await import('./ai-runner.js');
  const call = invocation('opencode', { prompt: 'Q', images: ['/t/01.png', '/t/02-source.pdf'], dir: '/t', model: 'anthropic/claude-sonnet-5-5', mcp: '/app/noteful' });
  assert.deepEqual(call.args, ['run', '--format', 'json', '-m', 'anthropic/claude-sonnet-5-5', '-f', '/t/01.png']);
  assert.match(call.stdin, /^Q[\s\S]*Attached files[\s\S]*02-source\.pdf/);
  const config = JSON.parse(call.env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.mcp.notecomplete, { type: 'local', command: ['/app/noteful', 'mcp'], enabled: true });
  assert.deepEqual(config.permission, { edit: 'deny', bash: 'deny', webfetch: 'deny' });
  assert.equal(JSON.parse(invocation('opencode', { prompt: 'Q', images: [], dir: '/t' }).env.OPENCODE_CONFIG_CONTENT).mcp, undefined);
  // The answer is what it wrote after its last tool call.
  const text = t => JSON.stringify({ type: 'text', part: { type: 'text', text: t } });
  const out = [text('Let me read page 2.'), '{"type":"tool_use","part":{"tool":"notecomplete_page_text"}}', text('Mitosis has'), text('four phases.'), '{"type":"step_finish"}'].join('\n');
  assert.equal(openCodeAnswer(out), 'Mitosis has\n\nfour phases.');
  assert.equal(openCodeAnswer(text('Hi')), 'Hi');
  assert.throws(() => openCodeAnswer('{"type":"error","error":{"name":"ProviderAuthError","data":{"message":"no key"}}}'), /no key/);
  assert.equal(call.failure('{"type":"error","error":{"message":"Model not found"}}\n'), 'Model not found');
  assert.deepEqual(parseOpenCodeModels('anthropic/claude-opus-5-5\nopenrouter/meta/llama-4:free\n\nnot a model\nvertex/claude@2026#high\n').map(m => m.id),
    ['anthropic/claude-opus-5-5', 'openrouter/meta/llama-4:free', 'vertex/claude@2026#high']);
});

test('a fake OpenCode streams its text parts and its error message reaches the reader', async () => {
  const bin = await mkdtemp(path.join(tmpdir(), 'nc-oc-'));
  const fake = path.join(bin, 'opencode');
  // Echoes back whether the config arrived and the prompt it read on stdin.
  await writeFile(fake, `#!/bin/sh
prompt=$(cat)
case "$prompt" in fail*) echo '{"type":"error","error":{"name":"UnknownError","data":{"message":"Model not found: x/y"}}}'; exit 1;; esac
echo '{"type":"text","part":{"text":"Reading."}}'
sleep 0.2
echo '{"type":"tool_use","part":{}}'
printf '{"type":"text","part":{"text":"%s %s"}}\\n' "$prompt" "$(printf %s "$OPENCODE_CONFIG_CONTENT" | grep -c deny)"
`);
  await chmod(fake, 0o755);
  const runner = aiRunner({ tools: async () => ({ claude: null, antigravity: null, codex: null, opencode: fake }) });
  assert.ok((await runner.providers()).find(p => p.id === 'opencode').available);
  const seen = [];
  const { text } = await runner.run('w1', { provider: 'opencode', prompt: 'Hola', model: 'anthropic/claude-haiku-5-5' }, d => seen.push(d));
  assert.equal(text, 'Hola 1');
  assert.deepEqual(seen, ['Reading.\n\n', 'Hola 1\n\n']);
  await assert.rejects(runner.run('w1', { provider: 'opencode', prompt: 'fail' }), /OpenCode failed: Model not found: x\/y/);
});
