// PlantUML diagrams (.puml, .plantuml, .pu, .iuml, .wsd) drawn as SVG by the PlantUML installed
// on this computer. Nothing is bundled or sent anywhere: without PlantUML (and Java) the reader
// shows the source and says what to install.
//
// `!include` reads files only from the document's folder (the opened folder holding it, when
// there is one): PlantUML's ALLOWLIST security profile, which also blocks includes from URLs.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MAX_SOURCE = 2 * 1048576;
const MAX_SVG = 40 * 1048576;
const TIMEOUT = 60000;

// Desktop launchers often lack the shell's PATH (~/.local/bin, mise, sdkman), which PlantUML's
// launcher also needs to find Java: ask the login shell once for both.
export function locatePlantuml(shell = process.env.SHELL || '/bin/bash') {
  if (process.platform === 'win32') return Promise.resolve({ binary: 'plantuml.bat', env: process.env });
  const script = `printf 'bin=%s\\n' "$(command -v plantuml 2>/dev/null)"; printf 'path=%s\\n' "$PATH"`;
  return new Promise(resolve => {
    execFile(shell, ['-lic', script], { timeout: 15000, env: { ...process.env, TERM: 'dumb' } }, (_error, stdout = '') => {
      const line = (key) => stdout.split('\n').find(l => l.startsWith(`${key}=`))?.slice(key.length + 1).trim() || '';
      const binary = line('bin');
      resolve({ binary: binary.startsWith('/') ? binary : null, env: { ...process.env, PATH: line('path') || process.env.PATH } });
    });
  });
}

// PlantUML's own error text ("Syntax Error? (line 12)…") without the noise around it.
export function plantumlError(stderr) {
  const lines = String(stderr || '').split('\n').map(l => l.trim()).filter(Boolean)
    .filter(l => !/^Some diagram description contains errors$/i.test(l) && !/^Picked up JAVA_TOOL_OPTIONS/.test(l));
  return lines.join('\n').slice(0, 2000) || 'PlantUML could not draw this diagram.';
}

// folderOf(file): the folder a local document may include from, or throws if the file was not
// opened from this device (library-files.js).
export function diagramRenderer({ folderOf, locate = locatePlantuml, run = runPlantuml }) {
  let found = null;
  return {
    // { svg } or { svg, error } (PlantUML draws its errors too) or { missing: true }.
    async plantuml(text, file = '') {
      if (typeof text !== 'string' || text.length > MAX_SOURCE) throw Error('The diagram is too large.');
      found ||= locate();
      const tool = await found;
      if (!tool.binary) { found = null; return { missing: true }; }
      let folder = '', scratch = '';
      if (file) folder = await folderOf(file);
      // A document from Drive or the web includes nothing: an empty folder of its own.
      if (!folder) folder = scratch = await mkdtemp(path.join(os.tmpdir(), 'notecomplete-uml-'));
      try {
        return await run(tool, text, folder);
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

export function runPlantuml({ binary, env }, text, folder) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-tsvg', '-pipe', '-charset', 'UTF-8', '-nometadata'], {
      cwd: folder,
      env: { ...env, PLANTUML_SECURITY_PROFILE: 'ALLOWLIST', PLANTUML_ALLOWLIST_PATH: folder, JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [], err = [];
    let size = 0, settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, Error('PlantUML took too long (over a minute).')); }, TIMEOUT);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SVG) { child.kill('SIGKILL'); finish(reject, Error('The drawn diagram is too large.')); return; }
      out.push(chunk);
    });
    child.stderr.on('data', chunk => { if (err.length < 64) err.push(chunk); });
    child.on('error', error => finish(reject, Error(`Could not start PlantUML: ${error.message}`)));
    child.on('close', code => {
      const svg = Buffer.concat(out).toString('utf8');
      if (!svg.includes('<svg')) return finish(reject, Error(plantumlError(Buffer.concat(err).toString('utf8'))));
      finish(resolve, code === 0 ? { svg } : { svg, error: plantumlError(Buffer.concat(err).toString('utf8')) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(text);
  });
}
