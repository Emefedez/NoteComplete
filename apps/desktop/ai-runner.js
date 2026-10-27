// Runs the user's own AI command-line tools for the reader (flashcards, quiz,
// chat). They use their existing logins, so no API keys pass through
// NoteComplete. Page images go to a private temporary folder that the tool may
// read; tools that can call MCP also get the bundled `noteful mcp` server for
// the open note. Permissions stay minimal: Claude may only Read and use the
// note server, Codex runs read-only, Antigravity gets only the folder.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const PROVIDERS = {
  claude: { label: 'Claude Code', names: ['claude'] },
  antigravity: { label: 'Antigravity', names: ['agy', 'antigravity'] },
  codex: { label: 'Codex', names: ['codex'] },
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

// The command line for one request. `images` are absolute paths in `dir`.
export function invocation(provider, { prompt, images, dir, model, mcp }) {
  const listed = images.length ? `\n\nPage images (read them):\n${images.map(i => `- ${i}`).join('\n')}` : '';
  if (provider === 'claude') {
    const args = ['-p', '--output-format', 'json', '--add-dir', dir, '--strict-mcp-config', '--allowedTools', 'Read'];
    if (mcp) args.push('--mcp-config', JSON.stringify({ mcpServers: { notecomplete: { command: mcp, args: ['mcp'] } } }), '--allowedTools', 'mcp__notecomplete');
    if (model) args.push('--model', model);
    return { args, stdin: prompt + listed, parse: out => JSON.parse(out).result };
  }
  if (provider === 'antigravity') {
    const args = ['-p', prompt + listed, '--output-format', 'json', '--add-dir', dir, '--print-timeout', '600s'];
    if (model) args.push('--model', model);
    return { args, stdin: null, parse: out => JSON.parse(out).response };
  }
  if (provider === 'codex') {
    const last = path.join(dir, 'answer.txt');
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', last];
    if (mcp) args.push('-c', `mcp_servers.notecomplete.command=${JSON.stringify(mcp)}`, '-c', 'mcp_servers.notecomplete.args=["mcp"]');
    if (model) args.push('-m', model);
    for (const image of images) args.push('-i', image);
    args.push('-');
    return { args, stdin: prompt, parse: async () => readFile(last, 'utf8') };
  }
  throw Error('Unknown AI provider.');
}

const tail = text => text.trim().split('\n').slice(-4).join(' ').slice(0, 400);

export function aiRunner({ tools = findTools, mcpBinary = null } = {}) {
  let found;
  const running = new Map();
  return {
    tools: async () => (found ||= await tools()),
    async providers() {
      found ||= await tools();
      return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, available: !!found[id] }));
    },
    cancel(owner) { running.get(owner)?.kill('SIGTERM'); },
    // One request: write images, run the tool in the temporary folder, return its answer.
    async run(owner, { provider, prompt, images = [], model = '', notePath = '' }) {
      if (!PROVIDERS[provider]) throw Error('Unknown AI provider.');
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 400_000) throw Error('Empty or oversized request.');
      if (images.length > 24) throw Error('Too many page images in one request.');
      if (typeof model !== 'string' || !/^[\w.:/-]{0,80}$/.test(model)) throw Error('Invalid model name.');
      found ||= await tools();
      const binary = found[provider];
      if (!binary) throw Error(`${PROVIDERS[provider].label} was not found. Install it and sign in, then restart NoteComplete.`);
      if (running.has(owner)) throw Error('Another AI request is still running.');
      const dir = await mkdtemp(path.join(tmpdir(), 'notecomplete-ai-'));
      try {
        const files = [];
        for (const [i, image] of images.entries()) {
          if (!(image?.bytes instanceof Uint8Array) || !['image/png', 'image/jpeg'].includes(image.type)) throw Error('Invalid page image.');
          const file = path.join(dir, `${String(i + 1).padStart(2, '0')}-${String(image.label || 'page').replace(/[^\w.-]+/g, '_').slice(0, 40)}.${image.type === 'image/png' ? 'png' : 'jpg'}`);
          await writeFile(file, image.bytes);
          files.push(file);
        }
        const mcp = mcpBinary && notePath && path.isAbsolute(notePath) ? mcpBinary : null;
        const call = invocation(provider, { prompt: notePath && mcp ? `${prompt}\n\nThe note file is ${notePath}; the notecomplete MCP tools can read any of its pages.` : prompt, images: files, dir, model, mcp });
        const output = await new Promise((resolve, reject) => {
          const child = spawn(binary, call.args, { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
          running.set(owner, child);
          let out = '', err = '';
          const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000);
          child.stdout.on('data', d => { out += d; });
          child.stderr.on('data', d => { err += d; });
          child.on('error', reject);
          child.on('close', (code, signal) => {
            clearTimeout(timer);
            running.delete(owner);
            if (signal) reject(Error('The AI request was stopped.'));
            else if (code) reject(Error(`${PROVIDERS[provider].label} failed: ${tail(err || out) || `exit ${code}`}`));
            else resolve(out);
          });
          if (call.stdin != null) child.stdin.end(call.stdin);
          else child.stdin.end();
        });
        const text = await call.parse(output);
        if (typeof text !== 'string' || !text.trim()) throw Error(`${PROVIDERS[provider].label} returned no answer.`);
        return { text };
      } finally {
        running.delete(owner);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
