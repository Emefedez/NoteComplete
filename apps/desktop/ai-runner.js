// Runs the user's own AI command-line tools for the reader (flashcards, quiz,
// chat). They use their existing logins, so no API keys pass through
// NoteComplete. Page images go to a private temporary folder that the tool may
// read; every tool also gets the bundled `noteful mcp` server for the open
// note (Claude and Codex by flags, Antigravity as a plugin in the request's
// own temporary workspace, OpenCode through inline config in its environment,
// so global settings are untouched). Permissions stay minimal: Claude may only
// Read and use the note server, Codex runs read-only, Antigravity gets only the
// folder, OpenCode may not edit, run commands or fetch the web.
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

export const PROVIDERS = {
  claude: { label: 'Claude Code', names: ['claude'] },
  antigravity: { label: 'Antigravity', names: ['agy', 'antigravity'] },
  codex: { label: 'Codex', names: ['codex'] },
  opencode: { label: 'OpenCode', names: ['opencode'] },
};

// Desktop launchers often lack the shell's PATH (mise, npm, ~/.local/bin), so
// ask the user's login shell once where the tools are.
export function findTools(shell = process.env.SHELL || '/bin/bash') {
  const names = [...Object.values(PROVIDERS).flatMap(p => p.names), 'voxtype', 'ffmpeg'];
  const script = names.map(n => `printf '%s=%s\\n' ${n} "$(command -v ${n} 2>/dev/null)"`).join('; ');
  return new Promise(resolve => {
    execFile(shell, ['-lic', script], { timeout: 15000, env: { ...process.env, TERM: 'dumb' } }, (_error, stdout = '') => {
      const found = Object.fromEntries(stdout.split('\n').map(l => l.match(/^([\w-]+)=(\/\S+)$/)).filter(Boolean).map(m => [m[1], m[2]]));
      resolve({ ...Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, p.names.map(n => found[n]).find(Boolean) || null])), voxtype: found.voxtype || null, ffmpeg: found.ffmpeg || null });
    });
  });
}

// Streamed output, one JSON object per line: the text pieces of the answer as
// they are written (Claude Code stream events, Antigravity step updates) and
// the final answer.
export function streamLine(provider, line) {
  let value;
  try { value = JSON.parse(line); } catch { return {}; }
  if (provider === 'claude') {
    if (value.type === 'result') return { final: value.result };
    const e = value.type === 'stream_event' ? value.event : null;
    return e?.type === 'content_block_delta' && e.delta?.type === 'text_delta' ? { delta: e.delta.text } : {};
  }
  if (provider === 'antigravity') {
    if (value.event === 'result') return { final: value.result?.response };
    const step = value.event === 'step_update' ? value.step_update : null;
    return step?.step_type === 'agent_response' && typeof step.text_delta === 'string' ? { delta: step.text_delta } : {};
  }
  if (provider === 'opencode') {
    // OpenCode writes each text part whole once it ends; tool calls separate the
    // agent's working notes from its answer.
    if (value.type === 'text' && typeof value.part?.text === 'string') return { delta: value.part.text + '\n\n', part: value.part.text };
    if (value.type === 'tool_use') return { tool: true };
    if (value.type === 'error') return { error: String(value.error?.data?.message || value.error?.message || value.error?.name || 'unknown error') };
  }
  return {};
}
export const STREAMS = new Set(['claude', 'antigravity', 'opencode']);

// OpenCode's answer: the text written after its last tool call.
export function openCodeAnswer(out) {
  let parts = [];
  for (const line of out.split('\n')) {
    const { part, tool, error } = streamLine('opencode', line);
    if (error) throw Error(`OpenCode failed: ${error}`);
    if (tool) parts = [];
    else if (typeof part === 'string' && part.trim()) parts.push(part.trim());
  }
  return parts.join('\n\n');
}

// Config given to OpenCode for one request: the note server, and no edits,
// shell commands or web fetches (reading the request's folder stays allowed).
export function openCodeConfig(mcp) {
  const config = { permission: { edit: 'deny', bash: 'deny', webfetch: 'deny' } };
  if (mcp) config.mcp = { notecomplete: { type: 'local', command: [mcp, 'mcp'], enabled: true } };
  return JSON.stringify(config);
}

// The command line for one request. `images` are absolute paths in `dir`.
export function invocation(provider, { prompt, images, dir, model, mcp, stream = false }) {
  const listed = images.length ? `\n\nAttached files (read them):\n${images.map(i => `- ${i}`).join('\n')}` : '';
  if (provider === 'claude') {
    const format = stream ? ['stream-json', '--verbose', '--include-partial-messages'] : ['json'];
    const args = ['-p', '--output-format', ...format, '--add-dir', dir, '--strict-mcp-config', '--allowedTools', 'Read'];
    if (mcp) args.push('--mcp-config', JSON.stringify({ mcpServers: { notecomplete: { command: mcp, args: ['mcp'] } } }), '--allowedTools', 'mcp__notecomplete');
    if (model) args.push('--model', model);
    return { args, stdin: prompt + listed, parse: out => (stream ? lastFinal(provider, out) : JSON.parse(out).result) };
  }
  if (provider === 'antigravity') {
    const args = ['-p', prompt + listed, '--output-format', stream ? 'stream-json' : 'json', '--add-dir', dir, '--print-timeout', '600s'];
    if (model) args.push('--model', model);
    // A workspace plugin: .agents/plugins/<name>/{plugin.json, mcp_config.json}.
    const files = mcp ? [
      ['.agents/plugins/notecomplete/plugin.json', JSON.stringify({ name: 'notecomplete', description: 'Read the open NoteComplete note' })],
      ['.agents/plugins/notecomplete/mcp_config.json', JSON.stringify({ mcpServers: { notecomplete: { command: mcp, args: ['mcp'] } } })],
    ] : [];
    return { args, stdin: null, files, parse: out => (stream ? lastFinal(provider, out) : JSON.parse(out).response) };
  }
  if (provider === 'codex') {
    const last = path.join(dir, 'answer.txt');
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', last];
    if (mcp) args.push('-c', `mcp_servers.notecomplete.command=${JSON.stringify(mcp)}`, '-c', 'mcp_servers.notecomplete.args=["mcp"]');
    if (model) args.push('-m', model);
    // Codex takes images as -i; other files (PDFs) are listed in the prompt for it to read.
    for (const image of images) if (/\.(png|jpe?g)$/i.test(image)) args.push('-i', image);
    args.push('-');
    return { args, stdin: prompt + (images.some(i => !/\.(png|jpe?g)$/i.test(i)) ? listed : ''), parse: async () => readFile(last, 'utf8') };
  }
  if (provider === 'opencode') {
    // The prompt goes on stdin (no length limit on the command line); images are
    // attached with -f, PDFs (often over its 10 MiB attachment limit) are listed.
    const args = ['run', '--format', 'json'];
    if (model) args.push('-m', model);
    for (const image of images) if (/\.(png|jpe?g)$/i.test(image)) args.push('-f', image);
    const others = images.some(i => !/\.(png|jpe?g)$/i.test(i));
    return {
      args,
      stdin: prompt + (others ? listed : ''),
      env: { OPENCODE_CONFIG_CONTENT: openCodeConfig(mcp), OPENCODE_DISABLE_AUTOUPDATE: '1' },
      parse: openCodeAnswer,
      failure: out => out.split('\n').map(l => streamLine('opencode', l).error).filter(Boolean).at(-1),
    };
  }
  throw Error('Unknown AI provider.');
}

export const MAX_PARALLEL = 4;
// Models offered per tool. Antigravity and OpenCode list their own; Claude
// Code takes its aliases; Codex has no listing, so the model set in its config
// is offered. Any other name can still be typed in the reader.
export function parseAgyModels(out) {
  return out.split('\n').map(l => l.match(/^([\w.:/-]+)\t(.+)$/)).filter(Boolean).map(m => ({ id: m[1], label: m[2].trim() }));
}
// `opencode models` prints one provider/model per line.
export function parseOpenCodeModels(out) {
  return out.split('\n').map(l => l.trim()).filter(l => MODEL.test(l) && l.includes('/')).map(id => ({ id, label: id }));
}
// Model names: aliases, provider/model paths, versions (@date) and variants (#high).
const MODEL = /^[\w.:/@#-]{1,120}$/;
const CLAUDE_MODELS = [{ id: 'opus', label: 'Opus (latest)' }, { id: 'sonnet', label: 'Sonnet (latest)' }, { id: 'haiku', label: 'Haiku (latest)' }];
async function listModels(provider, binary, home = homedir()) {
  if (provider === 'claude') return CLAUDE_MODELS;
  if (provider === 'codex') {
    const config = await readFile(path.join(home, '.codex', 'config.toml'), 'utf8').catch(() => '');
    const model = config.match(/^model\s*=\s*"([\w.:/-]+)"/m)?.[1];
    return model ? [{ id: model, label: `${model} (from Codex settings)` }] : [];
  }
  if (provider === 'antigravity') {
    return new Promise(resolve => execFile(binary, ['models'], { timeout: 30000, env: { ...process.env, NO_COLOR: '1' } }, (_e, stdout = '') => resolve(parseAgyModels(stdout))));
  }
  if (provider === 'opencode') {
    return new Promise(resolve => execFile(binary, ['models'], { timeout: 30000, maxBuffer: 4e6, env: { ...process.env, NO_COLOR: '1', OPENCODE_DISABLE_AUTOUPDATE: '1' } }, (_e, stdout = '') => resolve(parseOpenCodeModels(stdout))));
  }
  return [];
}

const lastFinal = (provider, out) => out.split('\n').map(l => streamLine(provider, l).final).filter(f => typeof f === 'string').at(-1);
const tail = text => text.trim().split('\n').slice(-4).join(' ').slice(0, 400);

// Stop a child process cleanly with SIGTERM, then escalate to SIGKILL if
// it hangs or deadlocks during shutdown.
function terminateProcess(child, graceMs = 4000) {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch {}
  const timer = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch {}
  }, graceMs);
  child.once('close', () => clearTimeout(timer));
}

export function aiRunner({ tools = findTools, mcpBinary = null } = {}) {
  let found;
  // Several requests per window may run at once (study batches, chat); each
  // carries a tag so Stop cancels only its own.
  const running = new Map();
  const children = owner => running.get(owner) || running.set(owner, new Set()).get(owner);
  const models = new Map(), asking = new Set();
  return {
    tools: async () => (found ||= await tools()),
    // Windows with requests in flight (a window's entry is dropped when its last one ends).
    owners: () => running.size,
    async providers() {
      found ||= await tools();
      return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, available: !!found[id] }));
    },
    // The models a tool offers; an empty list when it is missing or says nothing.
    // `fresh` asks the tool again (the reader shows its kept list meanwhile); several
    // pickers opening at once share one request per tool.
    async models(provider, { fresh = false } = {}) {
      if (!PROVIDERS[provider]) throw Error('Unknown AI provider.');
      found ||= await tools();
      if (!found[provider]) return [];
      if (!models.has(provider) || (fresh && !asking.has(provider))) {
        const request = listModels(provider, found[provider]);
        models.set(provider, request);
        asking.add(provider);
        request.finally(() => asking.delete(provider));
      }
      const list = await models.get(provider);
      if (!list.length) models.delete(provider);
      return list;
    },
    cancel(owner, tag = '') {
      for (const r of running.get(owner) || []) if (!tag || r.tag === tag) {
        r.cancelled = true;
        terminateProcess(r.child);
      }
    },
    // One request: write images, run the tool in the temporary folder, return its answer.
    // `onDelta` receives the answer's text pieces while it is written (tools that stream).
    async run(owner, { provider, prompt, images = [], model = '', notePath = '', tag = '' }, onDelta = null) {
      if (!PROVIDERS[provider]) throw Error('Unknown AI provider.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 400_000) throw Error('Empty or oversized request.');
      if (images.length > 24) throw Error('Too many page images in one request.');
      if (typeof model !== 'string' || (model && !MODEL.test(model))) throw Error('Invalid model name.');
      if (typeof tag !== 'string' || !/^[\w-]{0,40}$/.test(tag)) throw Error('Invalid request tag.');
      found ||= await tools();
      const binary = found[provider];
      if (!binary) throw Error(`${PROVIDERS[provider].label} was not found. Install it and sign in, then restart NoteComplete.`);
      if (children(owner).size >= MAX_PARALLEL) throw Error('Too many AI requests are running.');
      // Hold the slot while images are written, so a cancel then still applies.
      const entry = { child: null, tag, cancelled: false };
      children(owner).add(entry);
      let dir = '';
      try {
        dir = await mkdtemp(path.join(tmpdir(), 'notecomplete-ai-'));
        const files = [];
        // Page images, and PDFs (the source PDF of a page) up to 60 MB.
        const kinds = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
        for (const [i, image] of images.entries()) {
          if (!(image?.bytes instanceof Uint8Array) || !kinds[image.type] || (image.type === 'application/pdf' && image.bytes.length > 60e6)) throw Error('Invalid page image.');
          const file = path.join(dir, `${String(i + 1).padStart(2, '0')}-${String(image.label || 'page').replace(/[^\w.-]+/g, '_').slice(0, 40)}.${kinds[image.type]}`);
          await writeFile(file, image.bytes);
          files.push(file);
        }
        const mcp = mcpBinary && notePath && path.isAbsolute(notePath) ? mcpBinary : null;
        const stream = !!onDelta && STREAMS.has(provider);
        const call = invocation(provider, { prompt: notePath && mcp ? `${prompt}\n\nThe note file is ${notePath}; the notecomplete MCP tools can read any of its pages.` : prompt, images: files, dir, model, mcp, stream });
        for (const [name, content] of call.files || []) {
          await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
          await writeFile(path.join(dir, name), content);
        }
        const output = await new Promise((resolve, reject) => {
          if (entry.cancelled) return reject(Error('The AI request was stopped.'));
          const child = spawn(binary, call.args, { cwd: dir, env: { ...process.env, NO_COLOR: '1', ...call.env }, stdio: ['pipe', 'pipe', 'pipe'] });
          entry.child = child;
          let out = '', err = '', pending = '';
          const timer = setTimeout(() => terminateProcess(child), 10 * 60 * 1000);
          child.stdout.on('data', d => {
            out += d;
            if (!stream) return;
            pending += d;
            const lines = pending.split('\n');
            pending = lines.pop();
            for (const line of lines) {
              const { delta } = streamLine(provider, line);
              if (delta) onDelta(delta);
            }
          });
          child.stderr.on('data', d => { err += d; });
          child.on('error', reject);
          child.on('close', async (code, signal) => {
            clearTimeout(timer);
            if (entry.cancelled) return reject(Error('The AI request was stopped.'));
            if (signal || code) {
              // If the process already produced the complete answer before hanging or
              // dying on shutdown, preserve its valid result.
              if (out.trim()) {
                try {
                  const text = await call.parse(out);
                  if (typeof text === 'string' && text.trim()) return resolve(out);
                } catch { /* Output was incomplete or invalid. */ }
              }
              if (signal) reject(Error('The AI request was stopped.'));
              else reject(Error(`${PROVIDERS[provider].label} failed: ${call.failure?.(out) || tail(err || out) || `exit ${code}`}`));
              return;
            }
            resolve(out);
          });
          // A tool that exits before reading its input (a crash, or an answer written and
          // then a failing exit) closes the pipe: writing the prompt then fails with EPIPE.
          // That is not the request's error; 'close' above decides from what it wrote.
          child.stdin.on('error', () => {});
          if (call.stdin != null) child.stdin.end(call.stdin);
          else child.stdin.end();
        });
        const text = await call.parse(output);
        if (typeof text !== 'string' || !text.trim()) throw Error(`${PROVIDERS[provider].label} returned no answer.`);
        return { text };
      } finally {
        children(owner).delete(entry);
        if (!children(owner).size) running.delete(owner);
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
