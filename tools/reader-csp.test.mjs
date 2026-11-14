// The reader's Content-Security-Policy cannot be tried in a browser by the tests, so these
// check what can be read: the pages carry the policy of reader-csp.mjs, they hold no inline
// script for it to refuse, and every address the reader's code names is in the inventory and
// allowed by its directive.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { HTML_DOCUMENTS_INHERIT_POLICY, policy, header, strictPolicy, strictHeader, reasons, frameAncestors, metaTag, inventory, allows } from './reader-csp.mjs';

const reader = new URL('../apps/reader/', import.meta.url);
const read = (name) => readFileSync(new URL(name, reader), 'utf8');
const PAGES = ['index.html', 'tabs.html'];
// The kinds of address the same files are served from.
const ORIGINS = ['https://example.github.io', 'http://localhost:8767', 'notecomplete://reader', 'http://127.0.0.1:8768', 'http://192.168.1.20:41237', 'https://example.trycloudflare.com'];
const tags = (html) => [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].map(([whole, name, attrs]) => ({ whole, name: name.toLowerCase(), attrs }));

test('index.html and tabs.html carry the policy of reader-csp.mjs, before anything loads', () => {
  for (const page of PAGES) {
    const html = read(page);
    const found = html.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g) || [];
    assert.equal(found.length, 1, `${page}: one policy meta tag`);
    assert.equal(found[0], metaTag, `${page}: the meta tag is not the one \`node tools/reader-csp.mjs\` prints`);
    // A meta policy governs only what comes after it.
    const first = html.search(/<(script|link|style|img|iframe)\b/i);
    assert.ok(html.indexOf(found[0]) < first, `${page}: the policy comes before the first script, style or link`);
  }
  // The header value sits in a double-quoted attribute and in an HTTP header.
  assert.doesNotMatch(header, /["<>\n,]/);
});

test('the pages have no inline script, no on…= handlers and no javascript: addresses', () => {
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\ssrc="\.\/[\w./-]+"/, `${page}: a script without a file of the app as src`);
      assert.equal(m[2].trim(), '', `${page}: a script with code written in the page`);
    }
    for (const tag of tags(html)) {
      assert.doesNotMatch(tag.attrs, /\son[a-z]+\s*=/i, `${page}: an event handler attribute in ${tag.whole.slice(0, 80)}`);
      assert.doesNotMatch(tag.attrs, /javascript:/i, `${page}: a javascript: address in ${tag.whole.slice(0, 80)}`);
      assert.ok(!['base', 'object', 'embed'].includes(tag.name), `${page}: <${tag.name}>`);
      // Scripts, styles and frames written in the page come from the app itself.
      if (tag.name === 'script' || tag.name === 'link' || tag.name === 'iframe') {
        const address = /\s(?:src|href)="([^"]*)"/.exec(tag.attrs)?.[1];
        if (address !== undefined) assert.match(address, /^\.\//, `${page}: ${tag.whole.slice(0, 80)} loads from outside the app`);
      }
    }
  }
});

test('script comes from the app and the hosts listed, and plugins and <base> are refused', () => {
  for (const [name, list] of [['in force', policy], ['aimed at', strictPolicy]]) {
    assert.deepEqual(list['object-src'], ["'none'"], name);
    assert.deepEqual(list['base-uri'], ["'none'"], name);
    assert.deepEqual(list['default-src'], ["'self'"], name);
    const script = list['script-src'];
    // No scheme-wide or wildcard script source; blob: is WebLLM's hash-checked copy.
    for (const source of script) assert.ok(source.startsWith("'") || source === 'blob:' || /^https:\/\/[a-z.]+\/[\w/]+$/.test(source), `${name}: script-src ${source}`);
    assert.ok(script.includes("'wasm-unsafe-eval'"), name);
    for (const origin of ORIGINS) {
      assert.ok(allows(script, './app.js', origin), `${name}: ${origin} runs its own app.js`);
      assert.ok(!allows(script, 'https://evil.example/x.js', origin), `${name}: ${origin} refuses script from elsewhere`);
      assert.ok(!allows(script, 'https://accounts.google.com/other.js', origin), `${name}: only the sign-in script from accounts.google.com`);
      assert.ok(!allows(list['frame-src'], 'https://evil.example/', origin), `${name}: ${origin} refuses frames from elsewhere`);
      assert.ok(allows(list['frame-src'], './index.html?tab=1', origin), `${name}: tabs.html frames the reader`);
      assert.ok(allows(list['worker-src'], './worker.js', origin) && !allows(list['worker-src'], 'https://evil.example/w.js', origin), name);
    }
  }
  // No directive allows http: as a scheme (a LAN session's pages are 'self').
  for (const [name, list] of Object.entries(policy)) assert.ok(!list.includes('http:') && !list.includes('*'), name);
  assert.equal(frameAncestors, "frame-ancestors 'self'");
  assert.ok(!header.includes('frame-ancestors') && !header.includes('report-uri') && !header.includes('sandbox'), 'a meta tag ignores these');
});

// HTML documents are the one reason the policy in force allows inline script and eval. When
// html-view.js stops showing them in a srcdoc frame, this fails until the flag is turned off
// (and with the flag off, the meta tags must be pasted again: the first test says so).
test('inline script and eval are allowed only while HTML documents are shown with srcdoc', () => {
  const inherits = /\.srcdoc\s*=/.test(read('html-view.js'));
  assert.equal(HTML_DOCUMENTS_INHERIT_POLICY, inherits, inherits
    ? 'html-view.js shows documents in a srcdoc frame, which inherits the page policy: HTML_DOCUMENTS_INHERIT_POLICY must be true'
    : 'html-view.js no longer uses srcdoc: set HTML_DOCUMENTS_INHERIT_POLICY to false in tools/reader-csp.mjs and paste the new meta tag');
  const extra = policy['script-src'].filter((source) => !strictPolicy['script-src'].includes(source));
  assert.deepEqual(extra, HTML_DOCUMENTS_INHERIT_POLICY ? ["'unsafe-inline'", "'unsafe-eval'"] : []);
  for (const name of Object.keys(policy)) if (name !== 'script-src') assert.deepEqual(policy[name], strictPolicy[name], name);
  assert.doesNotMatch(strictHeader, /script-src[^;]*'unsafe-(inline|eval)'/);
  // What the frame's own policy allows has to be allowed here too, or documents lose it.
  const own = /const CSP = "([^"]+)"/.exec(read('html-view.js'))?.[1];
  assert.ok(own, 'the document policy in html-view.js');
  if (HTML_DOCUMENTS_INHERIT_POLICY) for (const part of own.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...list] = part.split(/\s+/);
    if (name === 'default-src') continue;
    for (const source of list) if (source !== "'none'") assert.ok(policy[name]?.includes(source), `HTML documents use ${name} ${source}; the page policy would take it away`);
  }
});

test('every source has a reason, and no nonce or hash switches unsafe-inline off', () => {
  for (const [name, list] of Object.entries(policy)) for (const source of list) {
    assert.ok((reasons[name][source] || '').length > 10, `${name} ${source} has no reason`);
    assert.doesNotMatch(source, /^'(nonce|sha\d+)-|strict-dynamic/, `${name} ${source}`);
  }
});

// Strings in the reader's source that look like addresses and are never requested.
const NOT_REQUESTED = [
  ['http://www.w3.org/2000/svg', 'XML namespace of createElementNS'],
  ['http://www.w3.org/1999/xhtml', 'XML namespace (math-boxes.js)'],
  ['https://www.googleapis.com/auth/drive', 'OAuth scope names (drive-client.js), not addresses that are fetched'],
  ['https://archive.org/details/', 'example text and placeholders: the address a person pastes (archive-client.js, index.html)'],
  ['https://drive.google.com/drive/folders/', 'placeholder text in index.html'],
  ['http://host', 'a comment in sync.js describing an invite link'],
  ['https://…', 'example text shown to the person (index.html, collab.js)'],
  ['http://${text}', 'sync.js parses a typed invite; the connection it makes is ws: or wss:'],
  ['https://${value}', 'web-view.js completes a typed link, opened in <webview> or the browser, never fetched by the page'],
];

test('every address named in the reader\'s code is in the inventory and allowed', () => {
  for (const entry of inventory) {
    assert.ok(policy[entry.directive], `${entry.url}: no directive ${entry.directive}`);
    for (const origin of ORIGINS) assert.ok(allows(policy[entry.directive], entry.url, origin), `${entry.directive} does not allow ${entry.url} (${entry.feature}) at ${origin}`);
    assert.ok(allows(strictPolicy[entry.directive], entry.url), `the strict policy does not allow ${entry.url}`);
  }
  const files = [...readdirSync(reader).filter((name) => name.endsWith('.js') && !name.includes('.test.')), ...PAGES];
  const literal = inventory.filter((entry) => entry.literal !== false);
  const unknown = [], seen = new Set();
  for (const name of files) {
    // The policy's own meta tag names sources, not requests.
    for (const [address] of read(name).replace(metaTag, '').matchAll(/\b(?:https?|wss?):\/\/[^\s'"`<>)]+/g)) {
      if (NOT_REQUESTED.some(([prefix]) => address.startsWith(prefix))) continue;
      const entry = literal.find((e) => address.startsWith(e.url));
      if (entry) seen.add(entry.url); else unknown.push(`${name}: ${address}`);
    }
  }
  assert.deepEqual(unknown, [], 'addresses that are neither in the inventory of tools/reader-csp.mjs (with the directive that must allow them) nor in NOT_REQUESTED');
  // An entry said to be written in the source really is, so the list does not go stale.
  assert.deepEqual(literal.map((e) => e.url).filter((url) => !seen.has(url)), [], 'inventory entries no longer found in the source: remove them or mark them literal: false');
});

test('the matcher used above follows the rules it claims', () => {
  assert.ok(allows(['https:'], 'https://a.example/x'));
  assert.ok(!allows(['https:'], 'http://a.example/x'));
  assert.ok(allows(["'self'"], 'ws://192.168.1.20:41237/', 'http://192.168.1.20:41237'));
  assert.ok(!allows(["'self'"], 'ws://192.168.1.21:41237/', 'http://192.168.1.20:41237'));
  assert.ok(allows(['https://*.archive.org'], 'https://ia800100.us.archive.org/1/items/x.pdf'));
  assert.ok(!allows(['https://*.archive.org'], 'https://archive.org.evil.example/'));
  assert.ok(allows(['https://accounts.google.com/gsi/'], 'https://accounts.google.com/gsi/button'));
  assert.ok(!allows(['https://accounts.google.com/gsi/client'], 'https://accounts.google.com/gsi/client2'));
  assert.ok(!allows(["'none'"], './app.js'));
  assert.ok(!allows(["'unsafe-inline'", "'wasm-unsafe-eval'"], './app.js'));
});

test('the sharing server limits framing with a header', () => {
  const source = readFileSync(new URL('../apps/desktop/collab-server.js', import.meta.url), 'utf8');
  assert.ok(source.includes(`'Content-Security-Policy': "${frameAncestors}"`));
});
