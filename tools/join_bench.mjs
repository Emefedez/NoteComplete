// How long joining a shared session takes from another device (docs/COLLABORATION.md): the
// real sharing server, a host reader with a note open, and a drawing tablet or a notes guest
// in a fresh browser (cold) and then again in the same browser (warm), over a throttled link.
// Needs a web build (python tools/build_web.py) and Playwright with Chromium:
//   node tools/join_bench.mjs [--rate 20,5] [--latency 20] [--notes practice,examen]
//     [--roles tablet,guest] [--origins lan,secure] [--json out.json] [--cdp]
//
// The link is a TCP proxy in this script: the joining browser talks to it, it forwards to the
// server with the given bandwidth (Mbit/s, shared by every connection in each direction, as
// on Wi-Fi) and round-trip latency. It slows the page's files and the WebSocket alike, and
// counts every byte. --cdp instead checks whether Chromium's own throttling
// (Network.emulateNetworkConditions) slows WebSocket frames.
//
// Origins: `lan` is http://<lan address>:<port>, as a phone that scans the QR code sees it (not
// a secure context: no service worker). `secure` is a loopback alias, which browsers treat as
// secure, so the service worker installs as it does behind the online (https) link.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../apps/desktop/collab-server.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const rates = flag('--rate', '20,5').split(',').map(Number);
const latency = Number(flag('--latency', 20));
const NOTES = { practice: 'samples/Practice book (vol. 1).noteful', examen: 'samples/Examen wuolah.noteful' };
const notes = flag('--notes', 'practice,examen').split(',');
const roles = flag('--roles', 'tablet,guest').split(',');
const origins = flag('--origins', 'lan,secure').split(',');
const jsonOut = flag('--json', '');
const cdpCheck = args.includes('--cdp');
const root = fileURLToPath(new URL('../apps/reader/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (n) => (n / 1e6).toFixed(2);

// A non-loopback address of this machine, for the plain-http LAN origin.
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

// A throttled TCP link: listen on `listen`, forward to `target`.
function link({ listen, port, target, mbit, rtt }) {
  const rate = (mbit * 1e6) / 8 / 1000; // bytes per ms
  const dirs = { up: { busy: 0, bytes: 0 }, down: { busy: 0, bytes: 0 } };
  const sockets = new Set();
  const pipe = (from, to, dir) => {
    // Flow control, as TCP's: the sender waits while a window's worth is in flight, so the
    // server sees a slow link as a slow client (not as a response sent at once).
    const queue = [];
    let timer = null, ended = false, queued = 0;
    const drain = () => {
      timer = null;
      const now = performance.now();
      while (queue.length && queue[0].at <= now) { const { part } = queue.shift(); queued -= part.length; if (!to.destroyed) to.write(part); }
      if (queued < 64 * 1024 && from.isPaused()) from.resume();
      if (queue.length) timer = setTimeout(drain, Math.max(1, queue[0].at - now));
      else if (ended && !to.destroyed) to.end();
    };
    from.on('data', (chunk) => {
      dir.bytes += chunk.length;
      for (let i = 0; i < chunk.length; i += 8192) {
        const part = chunk.subarray(i, i + 8192);
        const start = Math.max(performance.now(), dir.busy);
        dir.busy = start + part.length / rate;
        queue.push({ part, at: dir.busy + rtt / 2 });
        queued += part.length;
      }
      if (queued > 256 * 1024) from.pause();
      if (!timer) drain();
    });
    from.on('end', () => { ended = true; if (!timer) drain(); });
  };
  const server = net.createServer((client) => {
    const upstream = net.connect(target, '127.0.0.1');
    for (const s of [client, upstream]) { s.setNoDelay(true); sockets.add(s); s.on('error', () => { client.destroy(); upstream.destroy(); }); s.on('close', () => sockets.delete(s)); }
    pipe(client, upstream, dirs.up);
    pipe(upstream, client, dirs.down);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, listen, () => resolve({
      bytes: () => dirs.up.bytes + dirs.down.bytes,
      down: () => dirs.down.bytes,
      close: () => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); },
    }));
  });
}

// In every joining page: when the WebSocket opens, says welcome and delivers the snapshot,
// when the note is open and when its first page is drawn (Date.now(), as the server's clock).
function watchJoin() {
  const marks = (window.__join = { start: Date.now() });
  const mark = (name) => { marks[name] ??= Date.now(); };
  const Real = window.WebSocket;
  window.WebSocket = class extends Real {
    constructor(...a) {
      super(...a);
      mark('wsCreated');
      this.addEventListener('open', () => mark('wsOpen'));
      this.addEventListener('message', ({ data }) => {
        if (typeof data === 'string') { if (data.includes('"t":"welcome"')) mark('welcome'); }
        else if (new Uint8Array(data)[0] === 2) { mark('snapshotReceived'); marks.snapshotBytes = data.byteLength; }
      });
    }
  };
  const poll = () => {
    if (document.readyState !== 'loading') mark('domReady');
    const sheets = document.querySelectorAll('.sheet').length;
    if (sheets && !document.querySelector('.tablet-loader') && !document.body.classList.contains('tablet-waiting')) mark('opened');
    if (document.querySelector('.sheet[data-page="0"] .render canvas, .sheet[data-page="0"] [data-background] image')) mark('drawn');
    if (!marks.drawn) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  addEventListener('load', () => mark('load'));
}

async function hostSession(browser, server, note) {
  const info = { hostUrl: server.hostUrl, hostToken: server.hostToken, guestLink: server.guestLink, tabletLink: server.tabletLink(), address: server.address, port: server.port, ...server.code() };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((info) => {
    window.notecompleteCollab = { start: async () => info, info: async () => info, stop: async () => {}, minimize: async () => {}, onEnded() {} };
  }, info);
  const host = await context.newPage();
  host.on('pageerror', (e) => console.error('host error:', e.message));
  await host.goto(`http://127.0.0.1:${server.port}/`);
  await host.waitForFunction(() => !document.getElementById('open').disabled);
  await host.setInputFiles('#file', fileURLToPath(new URL('../' + note, import.meta.url)));
  await host.waitForFunction(() => document.querySelector('.sheet .render svg'), null, { timeout: 60000 });
  await host.evaluate(() => document.getElementById('shareSession').click());
  await host.click('#collabDialog button.primary');
  await host.waitForSelector('#collabTablet svg');
  await host.click('#collabDialog .dialog-actions button.primary');
  return { context, host, sheets: await host.evaluate(() => document.querySelectorAll('.sheet').length) };
}

// The hub's side: when the snapshot is asked of the host, and when it goes to the joiner.
function watchHub(hub) {
  const log = [];
  const request = hub.requestSnapshot.bind(hub);
  hub.requestSnapshot = (peer) => { log.push({ at: Date.now(), what: 'snapshotRequested', peer: peer.id }); return request(peer); };
  const snapshot = hub.snapshot.bind(hub);
  hub.snapshot = (peer, frame) => { const r = snapshot(peer, frame); log.push({ at: Date.now(), what: 'snapshotSent', bytes: frame.byteLength }); return r; };
  return log;
}

async function join(context, url, role, hubLog, proxy, sheets) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`${role} error:`, e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map();
  let http = 0, cached = 0, notModified = 0, count = 0;
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    requests.set(requestId, response);
    if (response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache) cached++;
  });
  // A revalidated file shows as a 200 from the cache; the wire saw a 304.
  cdp.on('Network.responseReceivedExtraInfo', ({ statusCode }) => { if (statusCode === 304) notModified++; });
  const sizes = [];
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => { count++; http += encodedDataLength; sizes.push([encodedDataLength, requests.get(requestId)?.url]); });
  const bytes0 = proxy.bytes(), hub0 = hubLog.length, t0 = Date.now();
  await page.goto(url);
  if (role === 'guest') page.waitForSelector('.collab-name input', { timeout: 120000 }).then(() => page.press('.collab-name input', 'Enter')).catch(() => {});
  await page.waitForFunction((n) => window.__join?.drawn && document.querySelectorAll('.sheet').length === n, sheets, { timeout: Number(process.env.JOIN_TIMEOUT || 300000), polling: 100 }).catch(async (e) => {
    console.error('join did not finish:', await page.evaluate(() => ({ marks: window.__join, status: document.getElementById('status')?.textContent, sheets: document.querySelectorAll('.sheet').length, html: document.querySelector('.sheet[data-page="0"]')?.innerHTML.slice(0, 300) })));
    throw e;
  });
  const bytesJoined = proxy.bytes() - bytes0;
  const marks = await page.evaluate(() => window.__join);
  const hub = hubLog.slice(hub0);
  // What else the page keeps downloading after the join (the service worker's install).
  let last = -1, quiet = 0, settled = Date.now();
  for (const deadline = Date.now() + 300000; Date.now() < deadline && quiet < 3;) {
    await sleep(500);
    const now = proxy.bytes();
    if (now === last) quiet++; else { quiet = 0; settled = Date.now(); }
    last = now;
  }
  const sw = await page.evaluate(async () => {
    if (!('caches' in window)) return 'unavailable';
    let files = 0;
    for (const key of await caches.keys()) files += (await (await caches.open(key)).keys()).length;
    return `${navigator.serviceWorker?.controller ? 'controlling' : 'not controlling'}, ${files} files cached`;
  }).catch((e) => e.message);
  if (process.env.VERBOSE) console.log(sizes.sort((a, b) => b[0] - a[0]).slice(0, 12).map(([n, u]) => `  ${MB(n)} MB ${u}`).join('\n'));
  const at = (t) => (t ? t - t0 : null);
  const result = {
    domReady: at(marks.domReady), load: at(marks.load), wsOpen: at(marks.wsOpen), welcome: at(marks.welcome),
    snapshotRequested: at(hub.find((h) => h.what === 'snapshotRequested')?.at), snapshotSent: at(hub.find((h) => h.what === 'snapshotSent')?.at),
    snapshotReceived: at(marks.snapshotReceived), opened: at(marks.opened), drawn: at(marks.drawn),
    snapshotRequests: hub.filter((h) => h.what === 'snapshotRequested').length, snapshotBytes: marks.snapshotBytes || 0,
    bytesJoined, bytesSettled: last - bytes0, settledAfter: settled - t0, requests: count, httpBytes: http, fromCache: cached, notModified, serviceWorker: sw,
  };
  await cdp.detach().catch(() => {});
  await page.close();
  return result;
}

const results = [];
async function scenario(browser, { note, role, origin, mbit }) {
  const address = origin === 'lan' ? lanIp : '127.0.0.2';
  const server = await startServer({ root, host: '127.0.0.1', address, notes: 'edit' });
  const proxy = await link({ listen: address, port: server.port, target: server.port, mbit, rtt: latency });
  const hubLog = watchHub(server.hub);
  const { context: hostContext, sheets } = await hostSession(browser, server, NOTES[note]);
  const device = role === 'tablet' ? { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1100, height: 800 } };
  const context = await browser.newContext(device);
  await context.addInitScript(watchJoin);
  const url = role === 'tablet' ? server.tabletLink() : server.guestLink;
  try {
    for (const run of ['cold', 'warm']) {
      const r = { note, role, origin, mbit, rtt: latency, run, ...await join(context, url, role, hubLog, proxy, sheets) };
      results.push(r);
      console.log(`${note} ${role} ${origin} ${mbit} Mbit/s ${run}: drawn ${(r.drawn / 1000).toFixed(1)} s, ${MB(r.bytesJoined)} MB by then, ${MB(r.bytesSettled)} MB in all (settled at ${(r.settledAfter / 1000).toFixed(1)} s); ` +
        `page ${r.load} ms, ws ${r.wsOpen}, welcome ${r.welcome}, snapshot asked ${r.snapshotRequested}, sent ${r.snapshotSent}, received ${r.snapshotReceived} (${MB(r.snapshotBytes)} MB, ${r.snapshotRequests}×), opened ${r.opened}; ` +
        `${r.requests} requests, ${r.fromCache} from cache, ${r.notModified} not modified; service worker ${r.serviceWorker}`);
    }
  } finally {
    await context.close();
    await hostContext.close();
    await proxy.close();
    await server.stop();
  }
}

// Does Chromium's own network throttling slow WebSocket frames? A 5 Mbit/s throttle on the
// tablet's page, then how long the snapshot took to arrive compared with its size.
async function checkCdp(browser) {
  const server = await startServer({ root, host: '127.0.0.1', address: '127.0.0.1', notes: 'edit' });
  const hubLog = watchHub(server.hub);
  const { context: hostContext, sheets } = await hostSession(browser, server, NOTES.practice);
  const context = await browser.newContext();
  await context.addInitScript(watchJoin);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 5e6 / 8, uploadThroughput: 5e6 / 8 });
  await page.goto(server.tabletLink());
  await page.waitForFunction((n) => window.__join?.drawn && document.querySelectorAll('.sheet').length === n, sheets, { timeout: 300000 });
  const marks = await page.evaluate(() => window.__join);
  const sent = hubLog.find((h) => h.what === 'snapshotSent').at;
  const took = marks.snapshotReceived - sent, expected = (marks.snapshotBytes * 8) / 5e6 * 1000;
  console.log(`CDP throttle at 5 Mbit/s: the ${MB(marks.snapshotBytes)} MB snapshot arrived ${took} ms after the hub sent it (${expected.toFixed(0)} ms if throttled): WebSocket frames ${took > expected / 2 ? 'are' : 'are NOT'} throttled.`);
  await context.close(); await hostContext.close(); await server.stop();
}

// No proxy from the environment (Chromium would send ws:// to one): pages talk to the link.
const browser = await chromium.launch({ args: ['--proxy-server=direct://', '--proxy-bypass-list=*'] });
try {
  if (cdpCheck) await checkCdp(browser);
  else for (const mbit of rates) for (const note of notes) for (const role of roles) for (const origin of origins) await scenario(browser, { note, role, origin, mbit });
} finally {
  await browser.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2) + '\n');
process.exit(0);
