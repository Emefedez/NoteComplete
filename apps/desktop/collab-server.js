// The host's sharing server (docs/COLLABORATION.md): HTTP for the reader's own files, so a
// phone or another computer can open the guest or tablet page in a browser, and one WebSocket
// (/sync) carrying the session (collab-hub.js). Bound only while sharing, on port 41237 when
// it is free (one port to allow in a firewall), else on any free port.
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CollabHub } from './collab-hub.js';
import { ensureCloudflared, startTunnel } from './tunnel.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.traineddata': 'application/octet-stream' };
// Pages that open the reader as a guest or as a drawing tablet; the invite is in the fragment.
const PAGES = new Set(['/join', '/tablet']);

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

// Starts a session. Returns its links and tokens, `stop()`, and the hub.
export async function startServer({ root, notes = 'edit', host = '0.0.0.0', port = DEFAULT_PORT, address, maxPeers = 10, onEnded = () => {}, hubOptions = {} }) {
  const addresses = address ? [address] : lanAddresses(undefined, await routeAddress());
  address = addresses[0] || '127.0.0.1';
  let stopping = null;
  const hub = new CollabHub({ notes, maxPeers, ...hubOptions, onEnded: (result) => { onEnded(result); stop(); } });
  const server = http.createServer(async (req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Referrer-Policy': 'no-referrer' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers); return res.end(); }
    const file = readerFile(root, new URL(req.url, 'http://x').pathname);
    try {
      if (!file || !(await stat(file)).isFile()) throw Error('missing');
      res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });
  // Only the host sends big messages; the hub enforces the guests' limit (maxMessage).
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/sync' || stopping) return socket.destroy();
    const remote = cameFromTunnel(req);
    // Online access off: nothing from outside this network gets a session.
    if (remote && !tunnel) return socket.destroy();
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const peer = hub.connect({ send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason) }, { remote });
      // A connection that never says hello is closed.
      const hello = setTimeout(() => { if (!hub.peers.get(peer.id)?.role) ws.close(1008, 'Say hello first'); }, 10000);
      ws.on('message', (data, binary) => peer.receive(binary ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data.toString(), binary));
      ws.on('close', () => { clearTimeout(hello); peer.closed(); });
      ws.on('error', () => ws.terminate());
    });
  });
  const listen = (at) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, host, () => { server.off('error', reject); resolve(); });
  });
  // The usual port when it is free, so a firewall rule keeps working; else any.
  await listen(port).catch((error) => { if (port && error.code === 'EADDRINUSE') return listen(0); throw error; });
  const actualPort = server.address().port;
  // A request is local only when it names this computer as it is known here (loopback or
  // a LAN address) and did not come through Cloudflare; anything else is online.
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', ...addresses].map((h) => `${h}:${actualPort}`));
  const cameFromTunnel = (req) => !localHosts.has(String(req.headers.host || '').toLowerCase()) || 'cf-connecting-ip' in req.headers || 'cf-ray' in req.headers;
  let tunnel = null, onlineLink = '';
  const origin = () => `http://${address}:${actualPort}`;
  // Online access (tunnel.js): a Cloudflare quick tunnel and a separate guest invite.
  async function goOnline({ dir, fetch, spawn, progress, onExit = () => {}, binary } = {}) {
    if (tunnel) return onlineLink;
    binary ||= await ensureCloudflared({ dir, fetch, progress });
    if (stopping) throw Error('The session ended.');
    const started = await startTunnel({ binary, port: actualPort, spawn, onExit: (code) => { tunnel = null; onlineLink = ''; hub.closeOnline(); onExit(code); } });
    if (stopping) { started.stop(); throw Error('The session ended.'); }
    tunnel = started;
    onlineLink = `${started.url}/join#${hub.id}.${hub.allowOnline()}`;
    return onlineLink;
  }
  function stopOnline() {
    tunnel?.stop();
    tunnel = null;
    onlineLink = '';
    hub.closeOnline();
  }
  function stop() {
    stopOnline();
    stopping ||= new Promise((resolve) => {
      hub.dispose();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
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
    get guestLink() { return notes ? `${origin()}/join#${hub.id}.${hub.tokens.guest}` : ''; },
    tabletLink: () => `${origin()}/tablet#${hub.id}.${hub.tokens.tablet}`,
    code: () => ({ code: hub.code.value, expires: hub.code.expires }),
    stop,
  };
}
