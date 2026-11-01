// Connects the user's own AI tools (Claude Code, Codex, Antigravity, OpenCode)
// to NoteComplete's notes, with no separate install: the app ships the
// `noteful` MCP server, copies it to a stable place (an AppImage mounts at a new
// path on every launch) and registers it with each tool the way that tool
// expects: its own `mcp add` command, or OpenCode's config file. Nothing runs
// without the user asking, and the exact commands are shown so they can be run
// by hand instead.
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const SERVER = 'notecomplete';
export const TOOLS = {
  claude: { label: 'Claude Code' },
  codex: { label: 'Codex' },
  antigravity: { label: 'Antigravity' },
  opencode: { label: 'OpenCode' },
};

// The bundled server, copied where its path does not change between launches.
export async function stableBinary({ bundled, folder }) {
  const name = path.basename(bundled);
  const target = path.join(folder, name);
  const from = await stat(bundled);
  const to = await stat(target).catch(() => null);
  if (!to || to.size !== from.size || to.mtimeMs < from.mtimeMs) {
    await mkdir(folder, { recursive: true });
    // Copy beside it, then rename: a running agent may hold the old file open.
    const temp = `${target}.new`;
    await copyFile(bundled, temp);
    await chmod(temp, 0o755);
    await rename(temp, target);
  }
  return target;
}

// The command that registers the server with a tool (its program is the tool's own binary).
export function addCommand(tool, server) {
  if (tool === 'claude') return ['mcp', 'add', '-s', 'user', SERVER, '--', server, 'mcp'];
  if (tool === 'codex' || tool === 'antigravity') return ['mcp', 'add', SERVER, '--', server, 'mcp'];
  return null;
}
export function removeCommand(tool) {
  if (tool === 'claude') return ['mcp', 'remove', '-s', 'user', SERVER];
  if (tool === 'codex' || tool === 'antigravity') return ['mcp', 'remove', SERVER];
  return null;
}
const quote = (s) => (/^[\w./:@=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
// What the user could type instead, per tool.
export function manualSteps(tool, server, program = tool === 'antigravity' ? 'agy' : tool) {
  const args = addCommand(tool, server);
  if (args) return `${program} ${args.map(quote).join(' ')}`;
  return `Add to ~/.config/opencode/opencode.json:\n${JSON.stringify({ mcp: { [SERVER]: openCodeEntry(server) } }, null, 2)}`;
}
const openCodeEntry = (server) => ({ type: 'local', command: [server, 'mcp'], enabled: true });

// OpenCode keeps MCP servers in its JSON config; ours is set, the rest kept.
export async function connectOpenCode(server, home = homedir()) {
  const dir = path.join(home, '.config', 'opencode');
  const file = path.join(dir, 'opencode.json');
  const jsonc = await stat(path.join(dir, 'opencode.jsonc')).catch(() => null);
  let text = await readFile(file, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  if (text == null && jsonc) throw Error('OpenCode uses opencode.jsonc here; add the entry shown below to it by hand.');
  let config = {};
  if (text != null && text.trim()) {
    try { config = JSON.parse(text); } catch { throw Error('opencode.json has comments or is not plain JSON; add the entry shown below by hand.'); }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('opencode.json is not a JSON object.');
  } else {
    config = { $schema: 'https://opencode.ai/config.json' };
  }
  config.mcp = { ...(config.mcp && typeof config.mcp === 'object' ? config.mcp : {}), [SERVER]: openCodeEntry(server) };
  await mkdir(dir, { recursive: true });
  if (text != null) await writeFile(`${file}.bak`, text);
  await writeFile(`${file}.tmp`, JSON.stringify(config, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
  return file;
}
async function openCodeServer(home) {
  try {
    const config = JSON.parse(await readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
    return config?.mcp?.[SERVER]?.command?.[0] || null;
  } catch {
    return null;
  }
}
async function codexServer(home) {
  const text = await readFile(path.join(home, '.codex', 'config.toml'), 'utf8').catch(() => '');
  const section = text.split(/^\[/m).find((s) => s.startsWith(`mcp_servers.${SERVER}]`));
  return section?.match(/^command\s*=\s*"([^"]*)"/m)?.[1] ?? (section ? '' : null);
}

const run = (binary, args, timeout = 30000) => new Promise((resolve) => {
  execFile(binary, args, { timeout, env: { ...process.env, NO_COLOR: '1' } }, (error, stdout = '', stderr = '') =>
    resolve({ ok: !error, out: `${stdout}${stderr}`.trim() }));
});

export function agentSetup({ tools, server, home = homedir() }) {
  // Where a tool's registration points now: the path, '' when registered elsewhere or unknown, or null.
  async function registered(tool, binary) {
    if (tool === 'opencode') return openCodeServer(home);
    if (tool === 'codex') return codexServer(home);
    if (tool === 'claude') {
      const { ok, out } = await run(binary, ['mcp', 'get', SERVER]);
      return ok ? (out.match(/Command:\s*(\S+)/)?.[1] ?? '') : null;
    }
    const { ok, out } = await run(binary, ['mcp', 'list']);
    return ok && new RegExp(`\\b${SERVER}\\b`).test(out) ? (out.includes(server()) ? server() : '') : null;
  }
  return {
    // Each tool: installed?, connected (to this app's server)?, and the manual step.
    async status() {
      const found = await tools();
      const target = server();
      return Promise.all(Object.entries(TOOLS).map(async ([id, { label }]) => {
        const binary = found[id];
        const at = binary || id === 'opencode' ? await registered(id, binary) : null;
        return { id, label, installed: !!binary, connected: !!target && at === target, elsewhere: at != null && at !== target, manual: target ? manualSteps(id, target) : '' };
      }));
    },
    // Register (or re-point) this app's server with one tool.
    async connect(id) {
      if (!TOOLS[id]) throw Error('Unknown AI tool.');
      const target = server();
      if (!target) throw Error('This build has no bundled note server.');
      const binary = (await tools())[id];
      if (id === 'opencode') return { id, file: await connectOpenCode(target, home) };
      if (!binary) throw Error(`${TOOLS[id].label} was not found. Install it and sign in, then try again.`);
      // A server registered at another path (an older install) is replaced.
      if ((await registered(id, binary)) != null) await run(binary, removeCommand(id));
      const { ok, out } = await run(binary, addCommand(id, target), 60000);
      if (!ok) throw Error(`${TOOLS[id].label} could not add the server: ${out.split('\n').slice(-3).join(' ').slice(0, 300) || 'no reason given'}`);
      return { id };
    },
  };
}
