// Renderer for .html documents (self-contained exercises, worksheets, exams).
// The page runs in a sandboxed iframe with an opaque origin and no network access,
// so it cannot reach NoteComplete's storage, files or bridges. Pages that keep
// progress in localStorage/sessionStorage get an in-frame stand-in that this
// module persists per document on this device.

export const isHtmlName = (name) => /\.html?$/i.test(name || '');
const STORE = 'notecomplete-html-state:';
// Scripts and styles inline, images and fonts embedded; nothing is fetched.
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';";

// Runs first inside the page. Storage is seeded from the parent and reported back.
function shim(seed) {
  return `<script>(function(){var seed=${JSON.stringify(seed).replace(/</g, '\\u003c')};
function make(init,report){var d=Object.assign({},init);var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},
setItem:function(k,v){d[String(k)]=String(v);report(d)},removeItem:function(k){delete d[k];report(d)},clear:function(){d={};report(d)},
key:function(i){return Object.keys(d)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(d).length}});return s}
var t=0;function send(d){clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({noteCompleteHtmlState:d},'*')}catch(e){}},200)}
var ls=make(seed,send),ss=make({},function(){});
try{Object.defineProperty(window,'localStorage',{configurable:true,enumerable:true,get:function(){return ls}})}catch(e){try{Object.defineProperty(Window.prototype,'localStorage',{configurable:true,enumerable:true,get:function(){return ls}})}catch(e2){}}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,enumerable:true,get:function(){return ss}})}catch(e){try{Object.defineProperty(Window.prototype,'sessionStorage',{configurable:true,enumerable:true,get:function(){return ss}})}catch(e2){}}
})()</script>`;
}

// Put the shim before the page's own scripts without altering its content.
export function prepareHtml(source, seed = {}) {
  const tag = shim(seed);
  const head = /<head[^>]*>/i.exec(source);
  if (head) return source.slice(0, head.index + head[0].length) + tag + source.slice(head.index + head[0].length);
  const html = /<html[^>]*>/i.exec(source);
  if (html) return source.slice(0, html.index + html[0].length) + tag + source.slice(html.index + html[0].length);
  return tag + source;
}

export function htmlViewer({ root, frame, title, reload, clear, status }) {
  let key = '', source = '', currentTitle = '';
  const read = () => {
    try {
      return (typeof localStorage !== 'undefined' && JSON.parse(localStorage.getItem(STORE + key))) || {};
    } catch {
      return {};
    }
  };
  // Each render gets a new iframe. In Electron an iframe that existed before its sandboxed
  // page moved it to another process stays blank, so the element is never reused.
  const fresh = () => {
    if (!frame.replaceWith || !frame.ownerDocument) return frame;
    const next = frame.ownerDocument.createElement('iframe');
    for (const name of ['id', 'class', 'title', 'sandbox', 'csp']) {
      const value = frame.getAttribute(name);
      if (value !== null) next.setAttribute(name, value);
    }
    frame.replaceWith(next);
    return next;
  };
  const render = () => { frame = fresh(); frame.srcdoc = prepareHtml(source, read()); };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', (event) => {
      if (root.hidden || event.source !== frame.contentWindow || !key) return;
      const state = event.data?.noteCompleteHtmlState;
      if (!state || typeof state !== 'object') return;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORE + key, JSON.stringify(state));
      } catch { /* Progress is optional. */ }
    });
  }
  frame.setAttribute?.('sandbox', 'allow-scripts allow-modals allow-forms');
  frame.setAttribute?.('csp', CSP);
  if (reload) reload.onclick = render;
  if (clear) clear.onclick = () => {
    if (typeof confirm === 'function' && !confirm('Clear the answers and settings this page saved on this device?')) return;
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORE + key);
    } catch { /* Nothing stored. */ }
    render();
    status?.('Saved page state cleared.');
  };
  return {
    open({ text, fingerprint, name }) {
      key = fingerprint || name; source = text; currentTitle = name;
      if (title) title.textContent = name;
      root.hidden = false;
      render();
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { root.hidden = true; frame = fresh(); frame.srcdoc = ''; source = ''; key = ''; currentTitle = ''; },
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(source); },
    get name() { return currentTitle || title?.textContent || ''; },
  };
}
