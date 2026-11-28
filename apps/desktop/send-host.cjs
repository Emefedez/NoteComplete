// The native messaging host of the NoteComplete Send browser extension (send-hub.js has the
// protocol). The browser starts it (through the wrapper the setup wizard writes next to it, which
// runs NoteComplete's own Electron as Node) and talks to it over stdin/stdout: each message a
// 32-bit length in the machine's byte order, then that much JSON. This relays every request to
// the running app's socket and every reply back; a send while the app is closed starts it and
// waits for it. While the app is closed, `targets` answers from the Recent list the app last
// wrote (send-targets.json), so the menu still offers those notebooks.
//   config (host-config.json beside this file): { socketPath, targetsFile, launch: [command, ...args] }
'use strict';
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const config = JSON.parse(fs.readFileSync(process.env.NOTECOMPLETE_SEND_CONFIG || path.join(__dirname, 'host-config.json'), 'utf8'));
const LAUNCH_WAIT_MS = 45_000;

// ---- browser side: length-prefixed JSON ----
let input = Buffer.alloc(0);
function toBrowser(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < 4 + length) break;
    const body = input.subarray(4, 4 + length);
    input = input.subarray(4 + length);
    let message;
    try { message = JSON.parse(body.toString('utf8')); } catch { toBrowser({ id: null, ok: false, error: 'Bad message' }); continue; }
    fromBrowser(message);
  }
});
process.stdin.on('end', () => process.exit(0));

// ---- app side: newline-delimited JSON over the socket ----
let socket = null, connecting = null, subscribed = false, wantSubscribe = false;
const waiting = new Map(); // request id → true (replies are matched by id in the browser)
function connect() {
  if (socket) return Promise.resolve(socket);
  connecting ||= new Promise((resolve, reject) => {
    const s = net.connect(config.socketPath);
    s.setEncoding('utf8');
    let buffered = '';
    s.once('connect', () => { socket = s; connecting = null; resolve(s); });
    s.once('error', (e) => { connecting = null; if (socket === s) socket = null; reject(e); });
    s.on('data', (chunk) => {
      buffered += chunk;
      for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
        const line = buffered.slice(0, at); buffered = buffered.slice(at + 1);
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id != null) waiting.delete(m.id); toBrowser(m); } catch { /* skip */ }
      }
    });
    s.on('close', () => {
      if (socket === s) socket = null;
      subscribed = false;
      for (const id of waiting.keys()) toBrowser({ id, ok: false, error: 'NoteComplete closed.' });
      waiting.clear();
      if (wantSubscribe) { toBrowser({ event: 'targets', ...offlineTargets() }); watch(); }
    });
  });
  return connecting;
}
function offlineTargets() {
  try {
    const kept = JSON.parse(fs.readFileSync(config.targetsFile, 'utf8'));
    return { open: [], recent: Array.isArray(kept.recent) ? kept.recent : [], default: null, running: false };
  } catch { return { open: [], recent: [], default: null, running: false }; }
}
function relay(socketNow, message) {
  if (message.id != null) waiting.set(message.id, true);
  socketNow.write(JSON.stringify(message) + '\n');
}
let launched = 0;
function launchApp() {
  if (Date.now() - launched < LAUNCH_WAIT_MS) return;
  launched = Date.now();
  const [command, ...args] = config.launch || [];
  if (!command) throw Error('NoteComplete is not running, and this helper does not know how to start it. Run the setup wizard again.');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(command, args, { detached: true, stdio: 'ignore', env }).unref();
}
async function connectStarting() {
  try { return await connect(); } catch { /* not running */ }
  launchApp();
  const until = Date.now() + LAUNCH_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    try { return await connect(); } catch { /* still starting */ }
  }
  throw Error('NoteComplete did not start in time.');
}
let watching = 0;
function watch() {
  clearInterval(watching);
  watching = setInterval(async () => {
    try { const s = await connect(); clearInterval(watching); subscribe(s); } catch { /* still closed */ }
  }, 3000);
}
function subscribe(s) {
  if (subscribed) return;
  subscribed = true;
  s.write(JSON.stringify({ id: null, op: 'subscribe' }) + '\n');
}
async function fromBrowser(message) {
  const id = message?.id ?? null;
  try {
    if (message?.op === 'subscribe') {
      wantSubscribe = true;
      try { subscribe(await connect()); } catch { toBrowser({ event: 'targets', ...offlineTargets() }); watch(); }
      return toBrowser({ id, ok: true });
    }
    if (message?.op === 'targets' || message?.op === 'hello') {
      let s = null;
      try { s = await connect(); } catch { /* closed */ }
      if (!s) return toBrowser(message.op === 'hello' ? { id, ok: true, app: 'NoteComplete', running: false } : { id, ok: true, ...offlineTargets() });
      return relay(s, message);
    }
    if (message?.op === 'send') return relay(await connectStarting(), message);
    toBrowser({ id, ok: false, error: `Unknown request: ${message?.op}` });
  } catch (e) {
    toBrowser({ id, ok: false, error: e?.message || String(e) });
  }
}
