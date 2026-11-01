// The host's sharing server (docs/COLLABORATION.md): HTTP for the reader's own files, so a
// phone or another computer can open the guest or tablet page in a browser, and one WebSocket
// (/sync) carrying the session (collab-hub.js). Bound only while sharing, on a free port.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CollabHub } from './collab-hub.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.traineddata': 'application/octet-stream' };
// Pages that open the reader as a guest or as a drawing tablet; the invite is in the fragment.
const PAGES = new Set(['/join', '/tablet']);

// The computer's address on the local network: private IPv4 first (Wi-Fi/Ethernet).
export function lanAddress(interfaces = os.networkInterfaces()) {
  const all = Object.values(interfaces).flat().filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal);
  const rank = (a) => (/^192\.168\./.test(a) ? 0 : /^10\./.test(a) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : /^169\.254\./.test(a) ? 4 : 3);
  return all.map((i) => i.address).sort((a, b) => rank(a) - rank(b))[0] || '127.0.0.1';
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
export async function startServer({ root, notes = 'edit', host = '0.0.0.0', port = 0, address = lanAddress(), maxPeers = 10, onEnded = () => {}, hubOptions = {} }) {
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
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const peer = hub.connect({ send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason) });
      // A connection that never says hello is closed.
      const hello = setTimeout(() => { if (!hub.peers.get(peer.id)?.role) ws.close(1008, 'Say hello first'); }, 10000);
      ws.on('message', (data, binary) => peer.receive(binary ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data.toString(), binary));
      ws.on('close', () => { clearTimeout(hello); peer.closed(); });
      ws.on('error', () => ws.terminate());
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const origin = `http://${address}:${actualPort}`;
  function stop() {
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
    address,
    origin,
    // The host's own reader connects over loopback with the host token.
    hostUrl: `ws://127.0.0.1:${actualPort}/sync`,
    hostToken: hub.tokens.host,
    guestLink: notes ? `${origin}/join#${hub.id}.${hub.tokens.guest}` : '',
    tabletLink: () => `${origin}/tablet#${hub.id}.${hub.tokens.tablet}`,
    code: () => ({ code: hub.code.value, expires: hub.code.expires }),
    stop,
  };
}
