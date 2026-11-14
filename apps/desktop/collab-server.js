// The host's sharing server (docs/COLLABORATION.md): HTTP for the reader's own files, so a
// phone or another computer can open the guest or tablet page in a browser, and one WebSocket
// (/sync) carrying the session (collab-hub.js). Bound only while sharing, on port 41237 when
// it is free (one port to allow in a firewall), else on any free port.
import http from 'node:http';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import { CollabHub } from './collab-hub.js';
import { ensureCloudflared, startTunnel } from './tunnel.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.traineddata': 'application/octet-stream' };
// Pages that open the reader as a guest or as a drawing tablet; the invite is in the fragment.
const PAGES = new Set(['/join', '/tablet', '/send']);
// Text and WebAssembly shrink to a quarter or a third compressed; images and fonts do not.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.wasm', '.svg']);
const gzip = promisify(zlib.gzip), brotli = promisify(zlib.brotliCompress);

export const DEFAULT_PORT = 41237;
// Adapters a phone on the Wi-Fi cannot reach: containers, virtual machines, VPNs.
const VIRTUAL = /^(docker|br-|virbr|veth|vmnet|vboxnet|vnic|utun|tun|tap|tailscale|zt|wg|ham|llw|awdl|bridge|lxc|lxd|podman|cni|flannel|kube|vethernet|virtualbox|vmware|hyper-v)/i;
// The computer's addresses on the local network, best first: the one its default route
// uses (`preferred`), then Wi-Fi/Ethernet-looking private IPv4, virtual adapters last.
export function lanAddresses(interfaces = os.networkInterfaces(), preferred = '') {
  const all = Object.entries(interfaces).flatMap(([name, list]) => (list || [])
    .filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal)
    .map((i) => ({ name, address: i.address })));
  const rank = ({ name, address }) => (address === preferred ? -10 : 0) + (VIRTUAL.test(name) ? 10 : 0)
    + (/^192\.168\./.test(address) ? 0 : /^10\./.test(address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : /^169\.254\./.test(address) ? 4 : 3);
  return [...new Set(all.sort((a, b) => rank(a) - rank(b)).map((i) => i.address))];
}
export function lanAddress(interfaces = os.networkInterfaces(), preferred = '') {
  return lanAddresses(interfaces, preferred)[0] || '127.0.0.1';
}
// Linux firewalls that block incoming connections by default: which one runs (checked without
// root), and the command that lets phones reach `port`. null when none is found.
export async function firewallHint(port, { platform = process.platform, run = runQuiet } = {}) {
  if (platform !== 'linux') return null;
  if ((await run('systemctl', ['is-active', 'firewalld'])).trim() === 'active')
    return { name: 'firewalld', command: `sudo firewall-cmd --add-port=${port}/tcp && sudo firewall-cmd --permanent --add-port=${port}/tcp` };
  if ((await run('systemctl', ['is-active', 'ufw'])).trim() === 'active')
    return { name: 'ufw', command: `sudo ufw allow ${port}/tcp` };
  return null;
}
function runQuiet(file, args) {
  return new Promise((resolve) => execFile(file, args, { timeout: 2000 }, (error, stdout) => resolve(error && !stdout ? '' : String(stdout))));
}
// The local address of the default route (a UDP "connect" sends nothing); '' offline.
export function routeAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const done = (address) => { try { socket.close(); } catch { /* Closed. */ } resolve(address); };
    const timer = setTimeout(() => done(''), 1000);
    socket.on('error', () => { clearTimeout(timer); done(''); });
    try {
      socket.connect(53, '1.1.1.1', () => { clearTimeout(timer); try { done(socket.address().address); } catch { done(''); } });
    } catch { clearTimeout(timer); done(''); }
  });
}
// A reader file under root, or null: no dot files, no node_modules, nothing outside.
export function readerFile(root, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return null; }
  if (PAGES.has('/' + relative) || !relative) relative = 'index.html';
  if (relative.includes('\0') || relative.split(/[\\/]/).some((part) => part.startsWith('.') || part === 'node_modules')) return null;
  const file = path.resolve(root, relative);
  return file.startsWith(path.resolve(root) + path.sep) ? file : null;
}

// The encoding to send a file in: brotli where the browser offers it (Chromium offers it only
// over https, so behind the online link), else gzip (a plain-http page on the LAN), else none.
export function pickEncoding(accept = '') {
  const offered = new Map(String(accept).toLowerCase().split(',').map((part) => {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return [name.trim(), q ? Number(q.slice(2)) : 1];
  }));
  for (const name of ['br', 'gzip']) if (offered.get(name) > 0) return name;
  return '';
}
// Compressed copies of the reader's files, made once per file version (size and time) and kept
// in memory while the session runs. zlib works off the main thread, so the session does not
// stall while a large file is compressed.
export function compressedFiles() {
  const copies = new Map();
  return function compressed(file, info, encoding) {
    const key = `${file}\0${encoding}`, version = `${info.size}-${info.mtimeMs}`;
    const kept = copies.get(key);
    if (kept?.version === version) return kept.bytes;
    const bytes = readFile(file).then((data) => encoding === 'br'
      ? brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
      : gzip(data, { level: 6 }));
    copies.set(key, { version, bytes });
    bytes.catch(() => copies.delete(key));
    return bytes;
  };
}
// The app shell (precache.json, tools/build_web.py), compressed one file at a time as soon as
// sharing starts, so the first device that joins does not wait for it.
async function warm(root, compressed, stopped) {
  try {
    const { shell = [] } = JSON.parse(await readFile(path.join(root, 'precache.json'), 'utf8'));
    for (const name of shell) {
      const file = readerFile(root, '/' + name);
      if (stopped()) return;
      if (!file || !COMPRESSIBLE.has(path.extname(file))) continue;
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && info.size > 1024) await compressed(file, info, 'gzip').catch(() => {});
    }
  } catch { /* No manifest (a development tree): files are compressed when first asked for. */ }
}
// A file's validator: a browser that has it sends it back and gets 304 Not Modified.
const etag = (info, encoding) => `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}${encoding ? '-' + encoding : ''}"`;
const matches = (header, tag) => !!header && String(header).split(',').some((t) => t.trim().replace(/^W\//, '') === tag);

// The most the host may send in one message: a whole note as a snapshot.
export const HOST_MAX_PAYLOAD = 1024 * 1024 * 1024;
// Whether a new connection may send messages of the host's size: only one that can still
// become the host. The host's reader connects from this computer (loopback), not through
// the tunnel (cloudflared also connects from loopback), and there is one host at a time.
export function hostSized({ from, remote, hostPresent }) {
  const address = String(from || '').replace(/^::ffff:/i, '');
  return !remote && !hostPresent && (address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address));
}

// Starts a session. Returns its links and tokens, `stop()`, and the hub.
export async function startServer({ root, notes = 'edit', host = '0.0.0.0', port = DEFAULT_PORT, address, maxPeers = 10, onEnded = () => {}, hubOptions = {} }) {
  const addresses = address ? [address] : lanAddresses(undefined, await routeAddress());
  address = addresses[0] || '127.0.0.1';
  let stopping = null;
  const hub = new CollabHub({ notes, maxPeers, ...hubOptions, onEnded: (result) => { onEnded(result); stop(); } });
  const compressed = compressedFiles();
  const server = http.createServer(async (req, res) => {
    // The reader's pages carry their Content-Security-Policy in a meta tag (tools/reader-csp.mjs),
    // which cannot say who may frame them: no other site may show a session's page in a frame.
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "frame-ancestors 'self'" };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); return res.end(); }
    const file = readerFile(root, new URL(req.url, 'http://x').pathname);
    let info;
    try {
      if (!file || !(info = await stat(file)).isFile()) throw Error('missing');
    } catch {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    // Kept by the browser but checked on every use (a 304 costs a round trip, no bytes): a
    // device that joined before loads the app again from its cache, and a rebuilt app still
    // arrives. Without this, every join downloaded the whole app again.
    const ext = path.extname(file);
    const encoding = COMPRESSIBLE.has(ext) && info.size > 1024 ? pickEncoding(req.headers['accept-encoding']) : '';
    const tag = etag(info, encoding);
    Object.assign(headers, { 'Cache-Control': 'no-cache', ETag: tag, 'Last-Modified': info.mtime.toUTCString(), 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';
    if (matches(req.headers['if-none-match'], tag)) { res.writeHead(304, headers); return res.end(); }
    try {
      if (encoding) {
        const body = await compressed(file, info, encoding);
        res.writeHead(200, { ...headers, 'Content-Encoding': encoding, 'Content-Length': body.length });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end();
    }
  });
  // Only the host sends big messages (snapshots, images it places), so only its connection
  // may: `ws` holds a whole message in memory before the hub sees it, and with one large
  // limit for all any device on the network could make this computer allocate it before
  // saying hello. Everyone else gets the hub's own limit (counted in characters there, so
  // up to three bytes each here); the hub still applies it to whoever is not the host.
  const socketOptions = { noServer: true, perMessageDeflate: false };
  const guestSockets = new WebSocketServer({ ...socketOptions, maxPayload: hub.maxMessage * 3 });
  const hostSockets = new WebSocketServer({ ...socketOptions, maxPayload: HOST_MAX_PAYLOAD });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/sync' || stopping) return socket.destroy();
    const remote = cameFromTunnel(req);
    // Online access off: nothing from outside this network gets a session.
    if (remote && !tunnel) return socket.destroy();
    const sockets = hostSized({ from: req.socket.remoteAddress, remote, hostPresent: !!hub.host }) ? hostSockets : guestSockets;
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const peer = hub.connect({ send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason), buffered: () => ws.bufferedAmount }, { remote });
      // A connection that never says hello is closed.
      const hello = setTimeout(() => { if (!hub.peers.get(peer.id)?.role) ws.close(1008, 'Say hello first'); }, 10000);
      // A device that went away without saying so (Wi-Fi power saving, a lost link) is noticed and
      // dropped, so the host does not see a ghost; it resumes from the edit log when it is back.
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      const sweep = setInterval(() => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch { /* Closing. */ } }, 20000);
      sweep.unref?.();
      ws.on('close', () => clearInterval(sweep));
      ws.on('message', (data, binary) => { ws.alive = true; peer.receive(binary ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data.toString(), binary); });
      ws.on('close', () => { clearTimeout(hello); peer.closed(); });
      ws.on('error', () => ws.terminate());
    });
  });
  const listen = (at) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, host, () => { server.off('error', reject); resolve(); });
  });
  // The usual port when it is free, so a firewall rule keeps working and the address stays the
  // same from one session to the next (a browser keeps its cache, and its service worker, per
  // address and port); else one of the next few, else any.
  await listen(port).catch(async (error) => {
    if (!port || error.code !== 'EADDRINUSE') throw error;
    for (let next = port + 1; next < port + 10; next++) {
      try { return await listen(next); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
    }
    return listen(0);
  });
  const actualPort = server.address().port;
  warm(root, compressed, () => !!stopping);
  // A request is local only when it names this computer as it is known here (loopback or
  // a LAN address) and did not come through Cloudflare; anything else is online.
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', ...addresses].map((h) => `${h}:${actualPort}`));
  const cameFromTunnel = (req) => !localHosts.has(String(req.headers.host || '').toLowerCase()) || 'cf-connecting-ip' in req.headers || 'cf-ray' in req.headers;
  let tunnel = null, onlineLink = '', onlineUrl = '';
  const origin = () => `http://${address}:${actualPort}`;
  // Online access (tunnel.js): a Cloudflare quick tunnel and a separate guest invite.
  async function goOnline({ dir, fetch, spawn, progress, onExit = () => {}, binary } = {}) {
    if (tunnel) return onlineLink;
    binary ||= await ensureCloudflared({ dir, fetch, progress });
    if (stopping) throw Error('The session ended.');
    const started = await startTunnel({ binary, port: actualPort, spawn, onExit: (code) => { tunnel = null; onlineLink = ''; onlineUrl = ''; hub.closeOnline(); onExit(code); } });
    if (stopping) { started.stop(); throw Error('The session ended.'); }
    tunnel = started;
    const tokens = hub.allowOnline();
    onlineUrl = started.url;
    onlineLink = tokens.guest ? `${started.url}/join#${hub.id}.${tokens.guest}` : '';
    return onlineLink;
  }
  function stopOnline() {
    tunnel?.stop();
    tunnel = null;
    onlineLink = '';
    onlineUrl = '';
    hub.closeOnline();
  }
  function stop() {
    stopOnline();
    stopping ||= new Promise((resolve) => {
      hub.dispose();
      for (const sockets of [guestSockets, hostSockets]) {
        for (const ws of sockets.clients) ws.terminate();
        sockets.close();
      }
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    return stopping;
  }
  return {
    hub,
    port: actualPort,
    get address() { return address; },
    addresses,
    // Another of this computer's addresses for the links (a phone on another adapter's network).
    useAddress(next) { if (addresses.includes(next)) address = next; return address; },
    get origin() { return origin(); },
    // The host's own reader connects over loopback with the host token.
    hostUrl: `ws://127.0.0.1:${actualPort}/sync`,
    hostToken: hub.tokens.host,
    goOnline,
    stopOnline,
    get onlineLink() { return onlineLink; },
    // A drawing tablet on another network (the online tablet invite; the code stays local).
    get onlineTabletLink() { return onlineUrl && hub.tokens.onlineTablet ? `${onlineUrl}/tablet#${hub.id}.${hub.tokens.onlineTablet}` : ''; },
    // Where another NoteComplete sends study material (scan it, or open it): a send-only invite.
    sendLink: () => `${origin()}/send#${hub.id}.${hub.tokens.send}`,
    get onlineSendLink() { return onlineUrl && hub.tokens.onlineSend ? `${onlineUrl}/send#${hub.id}.${hub.tokens.onlineSend}` : ''; },
    get online() { return !!tunnel; },
    get guestLink() { return notes ? `${origin()}/join#${hub.id}.${hub.tokens.guest}` : ''; },
    tabletLink: () => `${origin()}/tablet#${hub.id}.${hub.tokens.tablet}`,
    code: () => ({ code: hub.code.value, expires: hub.code.expires }),
    stop,
  };
}
