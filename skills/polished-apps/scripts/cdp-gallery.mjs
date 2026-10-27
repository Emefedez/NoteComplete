#!/usr/bin/env node
// Screenshot every state of a web UI in light and dark through Chromium's DevTools protocol.
// Usage: node cdp-gallery.mjs <url> <steps.json> <out-dir> [--inject bridge.js] [--size 1280x860]
// steps.json: [{ "name": "home" }, { "name": "palette", "js": "document.querySelector('.bar-command').click()", "wait": 300,
//               "file": { "selector": "#file", "path": "/abs/doc.pdf" }, "reset": true }]
// Each step runs `file` (sets a file input), then `js`, waits, screenshots <out>/<scheme>-<name>.png.
// "reset": true closes open dialogs and menubar menus before the step.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const [url, stepsFile, out] = process.argv.slice(2);
const opt = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
if (!url || !stepsFile || !out) { console.error('usage: cdp-gallery.mjs <url> <steps.json> <out-dir> [--inject file.js] [--size WxH]'); process.exit(2); }
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const inject = opt('--inject') ? readFileSync(opt('--inject'), 'utf8') : '';
const [width, height] = (opt('--size') || '1280x860').split('x').map(Number);
const browser = process.env.CHROMIUM || '/usr/bin/chromium';
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(out, { recursive: true });

for (const scheme of ['light', 'dark']) {
  const port = 9400 + Math.floor(Math.random() * 400), profile = `${out}/.profile-${scheme}`;
  const chrome = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pending = new Map(), errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
  };
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) errors.push(`${expression.slice(0, 50)} → ${r.exceptionDetails.exception?.description?.split('\n')[0]}`); };
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  if (inject) await send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
  await send('Page.navigate', { url });
  await sleep(2500);
  for (const step of steps) {
    if (step.reset) await run(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); for (const m of document.querySelectorAll('details.menu[open], [role="menubar"] details[open]')) m.open = false;`);
    if (step.file) {
      const doc = await send('DOM.getDocument');
      const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: step.file.selector });
      await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [step.file.path] });
    }
    if (step.js) await run(step.js);
    await sleep(step.wait ?? 400);
    const shot = await send('Page.captureScreenshot', step.clip ? { clip: { ...step.clip, scale: 1 } } : {});
    writeFileSync(`${out}/${scheme}-${step.name}.png`, Buffer.from(shot.data, 'base64'));
  }
  console.log(`${scheme}: ${steps.length} screenshots${errors.length ? `, page errors:\n  ${errors.join('\n  ')}` : ', no page errors'}`);
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(0);
