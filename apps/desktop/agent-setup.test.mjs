import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agentSetup, addCommand, connectOpenCode, manualSteps, stableBinary } from './agent-setup.js';

test('the bundled server is copied once to a stable folder and refreshed when it changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-agents-'));
  const bundled = path.join(dir, 'noteful');
  await writeFile(bundled, 'v1');
  const target = await stableBinary({ bundled, folder: path.join(dir, 'mcp') });
  assert.equal(target, path.join(dir, 'mcp', 'noteful'));
  assert.equal(await readFile(target, 'utf8'), 'v1');
  assert.ok((await stat(target)).mode & 0o100, 'executable');
  await writeFile(bundled, 'version 2');
  await stableBinary({ bundled, folder: path.join(dir, 'mcp') });
  assert.equal(await readFile(target, 'utf8'), 'version 2');
});

test('commands for each tool, and the manual steps', () => {
  assert.deepEqual(addCommand('claude', '/s/noteful'), ['mcp', 'add', '-s', 'user', 'notecomplete', '--', '/s/noteful', 'mcp']);
  assert.deepEqual(addCommand('codex', '/s/noteful'), ['mcp', 'add', 'notecomplete', '--', '/s/noteful', 'mcp']);
  assert.equal(addCommand('opencode', '/s'), null);
  assert.equal(manualSteps('claude', '/My Apps/noteful'), "claude mcp add -s user notecomplete -- '/My Apps/noteful' mcp");
  assert.match(manualSteps('antigravity', '/s/noteful'), /^agy mcp add notecomplete/);
  assert.match(manualSteps('opencode', '/s/noteful'), /"command": \[\s*"\/s\/noteful",\s*"mcp"/);
});

test('OpenCode keeps its other settings and gets a backup', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'nc-home-'));
  const dir = path.join(home, '.config', 'opencode');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'opencode.json'), JSON.stringify({ model: 'anthropic/x', mcp: { other: { type: 'local', command: ['o'] } } }));
  await connectOpenCode('/s/noteful', home);
  const config = JSON.parse(await readFile(path.join(dir, 'opencode.json'), 'utf8'));
  assert.equal(config.model, 'anthropic/x');
  assert.deepEqual(config.mcp.other, { type: 'local', command: ['o'] });
  assert.deepEqual(config.mcp.notecomplete, { type: 'local', command: ['/s/noteful', 'mcp'], enabled: true });
  assert.ok(await stat(path.join(dir, 'opencode.json.bak')));
  await writeFile(path.join(dir, 'opencode.json'), '{ // a comment\n}');
  await assert.rejects(connectOpenCode('/s/noteful', home), /by hand/);
  const fresh = await mkdtemp(path.join(tmpdir(), 'nc-home-'));
  await connectOpenCode('/s/noteful', fresh);
  assert.ok(JSON.parse(await readFile(path.join(fresh, '.config', 'opencode', 'opencode.json'), 'utf8')).mcp.notecomplete);
});

test('status and connect drive the tools own commands, replacing an old registration', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nc-fake-'));
  const log = path.join(dir, 'log');
  // A fake claude: `mcp get` reports what was last added; `mcp add` remembers it.
  const claude = path.join(dir, 'claude');
  await writeFile(claude, `#!/bin/sh\necho "$@" >> ${log}\nstate=${dir}/claude-state\ncase "$2" in\n get) [ -f $state ] && echo "notecomplete:\\n  Command: $(cat $state)" && exit 0; exit 1;;\n add) echo "$7" > $state;;\n remove) rm -f $state;;\nesac\n`);
  await chmod(claude, 0o755);
  const home = path.join(dir, 'home');
  let server = '/old/noteful';
  const agents = agentSetup({ tools: async () => ({ claude, codex: null, antigravity: null, opencode: null }), server: () => server, home });
  await agents.connect('claude');
  let s = await agents.status();
  assert.deepEqual(s.find((t) => t.id === 'claude'), { id: 'claude', label: 'Claude Code', installed: true, connected: true, elsewhere: false, manual: "claude mcp add -s user notecomplete -- /old/noteful mcp" });
  assert.equal(s.find((t) => t.id === 'codex').installed, false);
  server = '/new/noteful';
  s = await agents.status();
  assert.equal(s.find((t) => t.id === 'claude').elsewhere, true, 'registered at another path');
  await agents.connect('claude');
  assert.equal((await agents.status()).find((t) => t.id === 'claude').connected, true);
  assert.match(await readFile(log, 'utf8'), /mcp remove -s user notecomplete/);
  await assert.rejects(agents.connect('codex'), /not found/);
  await assert.rejects(agents.connect('shell'), /Unknown/);
  // OpenCode needs no binary to be configured.
  await agents.connect('opencode');
  assert.equal((await agents.status()).find((t) => t.id === 'opencode').connected, true);
});
