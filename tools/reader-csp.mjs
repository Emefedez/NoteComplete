// The reader's Content-Security-Policy, written once. apps/reader/index.html and tabs.html
// hold a literal copy in a <meta http-equiv> tag (the reader has no build step that could
// write it in); tools/reader-csp.test.mjs fails when a copy differs from `header` below.
// The meta tag is what delivers the policy, so the website, the desktop app
// (notecomplete://reader/), the Android app (http://127.0.0.1:8768), a sharing session
// (http://<lan address>:41237, https://<name>.trycloudflare.com) and the dev server all get
// it without knowing about it. After changing anything here:
//   node tools/reader-csp.mjs          prints the meta tag to paste into both pages
//   node --test tools/reader-csp.test.mjs
//
// A meta policy cannot carry frame-ancestors, report-uri or sandbox: `frameAncestors` is
// sent as a header by the sharing server (apps/desktop/collab-server.js) and the dev server.
//
// Workers started from the app's own files take their policy from their own response, or
// from this page in browsers that still hand the page's policy down. The policy is written
// so that both work: what the workers fetch and run is listed here too.

// HTML documents (html-view.js) are shown in a sandboxed <iframe srcdoc>. A srcdoc frame
// inherits this page's policy on top of its own `csp` attribute, and those documents are
// made of inline <script>, on…= handlers and sometimes eval (self-contained worksheets and
// exams; the storage stand-in and Dark Reader are inline too). So while html-view.js uses
// srcdoc, script-src here has to allow inline script and eval, which leaves the reader's own
// page open to injected inline script: the policy then limits where script, frames and
// plugins come from, and nothing more. To close it, html-view.js has to show the document
// from a file of the app (a small page with the document's own policy that receives the
// source by message) instead of srcdoc; then set this to false and paste the new meta tag.
// The test fails if this flag and html-view.js stop agreeing.
export const HTML_DOCUMENTS_INHERIT_POLICY = true;

// directive → [source, the feature that needs it]
const sources = {
  // Anything without a directive of its own (the web manifest among them): the app's files.
  'default-src': [
    ["'self'", 'the app loads its own files only, unless a directive below says otherwise'],
  ],
  'script-src': [
    ["'self'", 'app.js and its modules, vendor/ (pdf.js, Tesseract, Transformers, KaTeX, MathLive, TinyMDE, Mammoth, SheetJS, Yjs), pkg/ (the engine)'],
    ["'wasm-unsafe-eval'", 'WebAssembly: the engine (pkg/), Tesseract, ONNX Runtime (speech), pdf.js image decoders, WebLLM'],
    ['blob:', 'WebLLM (local-ai.js): downloaded from jsDelivr with fetch, run only if its SHA-256 is the pinned one, then imported from a blob: URL by the page and by local-ai-worker.js'],
    ['https://accounts.google.com/gsi/client', 'Google sign-in for Drive in a browser (drive-auth.js adds this one script)'],
  ],
  'style-src': [
    ["'self'", 'style.css, vendor/katex/katex.min.css, vendor/tinymde/tiny-mde.min.css'],
    ["'unsafe-inline'", 'the <style> block of tabs.html, style="…" attributes, <style> elements added by MathLive and pdf.js, KaTeX output, and HTML documents'],
    ['data:', 'HTML documents with an embedded stylesheet (the srcdoc frame inherits this policy)'],
    ['blob:', 'HTML documents, as above'],
    ['https://accounts.google.com/gsi/style', 'Google sign-in, if it shows its own interface'],
  ],
  'img-src': [
    ["'self'", "the app's own icons"],
    ['data:', 'page previews, crops and pasted pictures as data: URLs; pictures embedded in documents'],
    ['blob:', 'page images, covers, Drive thumbnails (fetched, then shown from a blob)'],
    ['https:', 'pictures in Markdown documents may come from any https address (rich-text.js keeps https: sources); Internet Archive covers (archive.org/services/img/…)'],
  ],
  'media-src': [
    ["'self'", 'none today; costs nothing'],
    ['blob:', 'recordings and audio attached to a note (audio.js)'],
    ['data:', 'HTML documents with embedded audio or video'],
  ],
  'font-src': [
    ["'self'", 'vendor/katex/fonts (KaTeX and MathLive)'],
    ['data:', 'fonts embedded in PDFs (pdf.js) and in HTML documents'],
    ['blob:', 'fonts pdf.js loads from a blob: URL'],
  ],
  // Connections go to hosts that cannot all be named: model weights are redirected to
  // storage hosts that have changed more than once (huggingface.co → cdn-lfs*.huggingface.co,
  // cdn-lfs*.hf.co, cas-bridge.xethub.hf.co), Drive thumbnails to *.googleusercontent.com or
  // *.google.com, Internet Archive downloads to ia*.us.archive.org, and a sharing session is
  // at a LAN address or a trycloudflare.com name. A list that misses one breaks a download
  // for everyone, and img-src already has to allow any https address, so a tight list here
  // would not stop a script that is already running from sending data out. The hosts the
  // app is known to use are in `inventory` below, and the test keeps that list complete.
  'connect-src': [
    ["'self'", "the app's own files (fetch), precache.json, site.json, the Android app's /incoming/… files"],
    ['https:', 'Google Drive, Internet Archive, jsDelivr (WebLLM, Tesseract language data, word lists), raw.githubusercontent.com, Hugging Face and its storage hosts, api.github.com: see `inventory`'],
    ['wss:', 'a sharing session over the internet (wss://<name>.trycloudflare.com)'],
    ['ws:', 'a sharing session on the local network (ws://<lan address>:41237, ws://127.0.0.1:41237 for the host)'],
    ['data:', 'fetch(dataUrl) turns pasted pictures into bytes (chat.js, quiz.js, study.js, explain.js, app.js)'],
    ['blob:', 'fetch(blobUrl) reads audio and images back (app.js)'],
  ],
  'worker-src': [
    ["'self'", 'worker.js (engine), transcript-worker.js, local-ai-worker.js, raster-encoder.js, vendor/pdfjs/build/pdf.worker.mjs, vendor/tesseract/worker.min.js, sw.js'],
    ['blob:', 'ONNX Runtime may start its threads from a blob: URL inside transcript-worker.js'],
  ],
  'frame-src': [
    ["'self'", 'tabs.html shows the reader in one frame per tab (tab-host.js). The HTML document frame is srcdoc, which frame-src does not govern; <webview> on the desktop is not a frame of this page'],
    ['https://accounts.google.com/gsi/', 'Google sign-in, if it shows its own interface'],
  ],
  'object-src': [["'none'", 'no plugins, <object> or <embed> anywhere']],
  'base-uri': [["'none'", 'no page has a <base>; an injected one would redirect every relative address']],
};

// Removed from script-src when HTML documents no longer inherit this policy.
const inheritedByHtmlDocuments = [
  ["'unsafe-inline'", 'HTML documents (html-view.js): inline <script> and on…= handlers inside the srcdoc frame, which inherits this policy'],
  ["'unsafe-eval'", 'HTML documents (html-view.js): their own policy allows eval, and this one is applied on top'],
];

const build = (inherit) => Object.fromEntries(Object.entries(sources).map(([name, list]) => [
  name, [...list, ...(inherit && name === 'script-src' ? inheritedByHtmlDocuments : [])].map(([source]) => source),
]));
const text = (policy) => Object.entries(policy).map(([name, list]) => `${name} ${list.join(' ')}`).join('; ');

// The policy in force: directive → sources, and as the meta tag's content.
export const policy = build(HTML_DOCUMENTS_INHERIT_POLICY);
export const header = text(policy);
// The policy aimed at: no inline script, no eval. The dev server sends it as
// Content-Security-Policy-Report-Only, so the console shows what it would refuse.
export const strictPolicy = build(false);
export const strictHeader = text(strictPolicy);
// Why each source is there, for a reader of the policy.
export const reasons = Object.fromEntries(Object.entries(sources).map(([name, list]) => [
  name, Object.fromEntries([...list, ...(name === 'script-src' ? inheritedByHtmlDocuments : [])]),
]));
// Header only (ignored in a meta tag): the reader may be framed by itself (tabs.html), by
// nothing else.
export const frameAncestors = "frame-ancestors 'self'";
export const metaTag = `<meta http-equiv="Content-Security-Policy" content="${header}" />`;

// Every address outside the app that the reader's code reaches, with the directive that
// has to allow it. `literal: false` marks hosts that are not written in the reader's own
// source (a library's default, or where a server redirects to).
export const inventory = [
  { url: 'https://accounts.google.com/gsi/client', directive: 'script-src', feature: 'Google sign-in in a browser (drive-auth.js)' },
  { url: 'https://accounts.google.com/gsi/style', directive: 'style-src', feature: 'Google sign-in, if it shows its own interface (loaded by the sign-in script)', literal: false },
  { url: 'https://accounts.google.com/gsi/button', directive: 'frame-src', feature: 'Google sign-in, if it shows its own interface (loaded by the sign-in script)', literal: false },
  { url: 'https://www.googleapis.com/drive/v3/', directive: 'connect-src', feature: 'Google Drive listing and download (drive-client.js)' },
  { url: 'https://www.googleapis.com/upload/drive/v3/files/', directive: 'connect-src', feature: 'Saving back to Google Drive (drive-client.js)' },
  { url: 'https://lh3.googleusercontent.com/', directive: 'connect-src', feature: 'Drive thumbnails: thumbnailLink is fetched and redirects are followed (drive-client.js)', literal: false },
  { url: 'https://archive.org/metadata/', directive: 'connect-src', feature: 'Internet Archive item listing (archive-client.js)' },
  { url: 'https://archive.org/cors/', directive: 'connect-src', feature: 'Internet Archive download in a browser (archive-client.js)' },
  { url: 'https://archive.org/download/', directive: 'connect-src', feature: 'Internet Archive download (archive-client.js)' },
  { url: 'https://ia800100.us.archive.org/', directive: 'connect-src', feature: 'Internet Archive download: where archive.org redirects to', literal: false },
  { url: 'https://archive.org/services/img/', directive: 'img-src', feature: 'Internet Archive covers (archive-browser.js)' },
  { url: 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@', directive: 'connect-src', feature: 'WebLLM, fetched and hash-checked before it runs (local-ai.js)' },
  { url: 'https://cdn.jsdelivr.net/npm/', directive: 'connect-src', feature: 'Word lists for text recognition (ocr-dictionary.js)' },
  { url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/', directive: 'connect-src', feature: 'Tesseract language data, fetched by its worker (vendor/tesseract/worker.min.js)', literal: false },
  { url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/', directive: 'connect-src', feature: 'Word frequencies for text recognition (ocr-dictionary.js)' },
  { url: 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/', directive: 'connect-src', feature: 'WebLLM model code (WebAssembly), fetched by WebLLM', literal: false },
  { url: 'https://huggingface.co/', directive: 'connect-src', feature: 'Whisper models (Transformers.js in transcript-worker.js) and WebLLM model weights', literal: false },
  { url: 'https://cas-bridge.xethub.hf.co/', directive: 'connect-src', feature: 'Hugging Face storage: where huggingface.co redirects to (also cdn-lfs*.huggingface.co, cdn-lfs*.hf.co)', literal: false },
  { url: 'https://api.github.com/repos/', directive: 'connect-src', feature: 'Update check in the Android app (android-updates.js); the desktop app checks from its main process' },
  { url: 'ws://192.168.1.20:41237/', directive: 'connect-src', feature: 'Sharing on the local network (sync.js)', literal: false },
  { url: 'ws://127.0.0.1:41237/', directive: 'connect-src', feature: "Sharing: the host's own reader (sync.js)", literal: false },
  { url: 'wss://example.trycloudflare.com/', directive: 'connect-src', feature: 'Sharing over the internet (sync.js)', literal: false },
];

// Whether a list of sources allows `url` for a page at `self` (an origin). Enough of CSP's
// matching for the tests: schemes, 'self', hosts with a leading *. and an optional path.
export function allows(list, url, self = 'https://example.github.io') {
  const target = new URL(url, self.endsWith('/') ? self : self + '/');
  const sameOrigin = (a, b) => a.protocol === b.protocol && a.host === b.host;
  return list.some((source) => {
    if (source === "'none'" || (source.startsWith("'") && source !== "'self'")) return false;
    if (source === "'self'") {
      const own = new URL(self);
      // 'self' also covers the same host over ws/wss, as browsers do.
      return sameOrigin(own, target) || (own.host === target.host && { 'http:': 'ws:', 'https:': 'wss:' }[own.protocol] === target.protocol);
    }
    if (/^[a-z][a-z\d+.-]*:$/i.test(source)) return target.protocol === source.toLowerCase();
    let allowed;
    try { allowed = new URL(source.replace('://*.', '://wildcard.')); } catch { return false; }
    if (allowed.protocol !== target.protocol || allowed.port !== target.port) return false;
    const wild = source.includes('://*.');
    const host = wild ? allowed.hostname.slice('wildcard'.length) : allowed.hostname;
    if (wild ? !target.hostname.endsWith(host) : target.hostname !== host) return false;
    if (allowed.pathname === '/' && !/^[^/]+:\/\/[^/]+\//.test(source)) return true;
    return allowed.pathname.endsWith('/') ? target.pathname.startsWith(allowed.pathname) : target.pathname === allowed.pathname;
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) console.log(metaTag);
