// Renderer for .html documents (self-contained exercises, worksheets, exams).
// The page runs in a sandboxed iframe with an opaque origin and no network access,
// so it cannot reach NoteComplete's storage, files or bridges. Pages that keep
// progress in localStorage/sessionStorage get an in-frame stand-in that this
// module persists per document on this device. In the dark theme, pages with only a
// light design are darkened by Dark Reader (vendored, loaded on first use) inside the frame.
// Edit shows the page's HTML source in the plain editor (text-view.js's, not TinyMDE,
// whose toolbar writes Markdown); leaving Edit renders the page again, and the app
// saves the source (onChange reports every edit).

export const isHtmlName = (name) => /\.html?$/i.test(name || '');
const STORE = 'notecomplete-html-state:';
// Scripts and styles inline, images and fonts embedded; nothing is fetched.
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';";

// Runs first inside the page. Storage is seeded from the parent and reported back.
function shim(seed, zoom = 1) {
  return `<script>(function(){var seed=${JSON.stringify(seed).replace(/</g, '\\u003c')},zoom=${Number(zoom) || 1};
function z(){document.documentElement.style.zoom=zoom}z();
addEventListener('message',function(e){if(e.source===parent&&e.data&&typeof e.data.noteCompleteZoom==='number'){zoom=e.data.noteCompleteZoom;z()}});
function make(init,report){var d=Object.assign({},init);var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},
setItem:function(k,v){d[String(k)]=String(v);report(d)},removeItem:function(k){delete d[k];report(d)},clear:function(){d={};report(d)},
key:function(i){return Object.keys(d)[i]||null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(d).length}});return s}
var t=0;function send(d){clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({noteCompleteHtmlState:d},'*')}catch(e){}},200)}
var ls=make(seed,send),ss=make({},function(){});
try{Object.defineProperty(window,'localStorage',{configurable:true,enumerable:true,get:function(){return ls}})}catch(e){try{Object.defineProperty(Window.prototype,'localStorage',{configurable:true,enumerable:true,get:function(){return ls}})}catch(e2){}}
try{Object.defineProperty(window,'sessionStorage',{configurable:true,enumerable:true,get:function(){return ss}})}catch(e){try{Object.defineProperty(Window.prototype,'sessionStorage',{configurable:true,enumerable:true,get:function(){return ss}})}catch(e2){}}
})()</script>`;
}

// Dark Reader plus a switch the parent flips by message. Pages that are already dark
// (their own design, or prefers-color-scheme following the app) are left as they are.
function darkener({ script, on, colors }) {
  return `<script>${script.replace(/<\/script/gi, '<\\/script')}</script><script>(function(){var want=${Boolean(on)},colors=${JSON.stringify(colors || {}).replace(/</g, '\\u003c')},own=null;
function bg(e){var m=e&&getComputedStyle(e).backgroundColor.match(/[\\d.]+/g);return m&&(m.length<4||+m[3]>0.5)?m:null}
function apply(){var D=window.DarkReader;if(!D||document.readyState==='loading')return;
if(own===null){var c=bg(document.body)||bg(document.documentElement);own=!!c&&(0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255<0.4;try{parent.postMessage({noteCompleteOwnDark:own},'*')}catch(e){}}
if(want&&!own)D.enable(colors);else if(D.isEnabled())D.disable()}
document.addEventListener('DOMContentLoaded',apply);
addEventListener('message',function(e){if(e.source===parent&&e.data&&typeof e.data.noteCompleteDark==='boolean'){want=e.data.noteCompleteDark;apply()}});
})()</script>`;
}

// Put the shim before the page's own scripts without altering its content.
export function prepareHtml(source, seed = {}, dark = null, zoom = 1) {
  const tag = shim(seed, zoom) + (dark?.script ? darkener(dark) : '');
  const head = /<head[^>]*>/i.exec(source);
  if (head) return source.slice(0, head.index + head[0].length) + tag + source.slice(head.index + head[0].length);
  const html = /<html[^>]*>/i.exec(source);
  if (html) return source.slice(0, html.index + html[0].length) + tag + source.slice(html.index + html[0].length);
  return tag + source;
}

export function htmlViewer({ root, frame, title, reload, clear, status, darkScript = null, darkColors = () => ({}), onOwnDark = () => {}, editorHost = null, edit = null, onChange = () => {} }) {
  let key = '', source = '', currentTitle = '', dark = false, darkInFrame = false, renders = 0, zoom = 1, editing = false;
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
    next.hidden = frame.hidden;
    frame.replaceWith(next);
    return next;
  };
  const paint = (script) => {
    frame = fresh();
    darkInFrame = Boolean(script);
    frame.srcdoc = prepareHtml(source, read(), script ? { script, on: dark, colors: darkColors() } : null, zoom);
  };
  const render = () => {
    const token = ++renders;
    onOwnDark(null);
    if (!dark || !darkScript) return paint('');
    darkScript().then((script) => token === renders && paint(script), () => token === renders && paint(''));
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('message', (event) => {
      if (root.hidden || event.source !== frame.contentWindow || !key) return;
      if (typeof event.data?.noteCompleteOwnDark === 'boolean') return onOwnDark(event.data.noteCompleteOwnDark);
      const state = event.data?.noteCompleteHtmlState;
      if (!state || typeof state !== 'object') return;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORE + key, JSON.stringify(state));
      } catch { /* Progress is optional. */ }
    });
  }
  function startEditing() {
    if (!editorHost || !source) return;
    editing = true;
    edit?.setAttribute('aria-pressed', 'true');
    frame.hidden = true;
    const area = editorHost.ownerDocument.createElement('textarea');
    area.className = 'doc-editor-plain';
    area.spellcheck = false;
    area.value = source;
    area.oninput = () => { source = area.value; onChange(source); };
    editorHost.replaceChildren(area);
    editorHost.hidden = false;
    area.focus();
  }
  function stopEditing() {
    if (!editing) return;
    editing = false;
    edit?.setAttribute('aria-pressed', 'false');
    editorHost.replaceChildren();
    editorHost.hidden = true;
    frame.hidden = false;
    if (source) render();
  }
  if (edit) edit.onclick = () => (editing ? stopEditing() : startEditing());
  frame.setAttribute?.('sandbox', 'allow-scripts allow-modals allow-forms');
  frame.setAttribute?.('csp', CSP);
  if (reload) reload.onclick = () => (editing ? stopEditing() : render());
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
      stopEditing();
      key = fingerprint || name; source = text; currentTitle = name;
      if (title) title.textContent = name;
      root.hidden = false;
      render();
    },
    // Pages rendered with Dark Reader switch in place; others render again with it.
    setDark(on) {
      if (dark === Boolean(on)) return;
      dark = Boolean(on);
      if (!source) return;
      if (darkInFrame) frame.contentWindow?.postMessage({ noteCompleteDark: dark }, '*');
      else if (dark) render();
    },
    // Page zoom inside the frame, so the frame itself keeps its size.
    setZoom(value) {
      zoom = value;
      if (source) frame.contentWindow?.postMessage({ noteCompleteZoom: zoom }, '*');
    },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { stopEditing(); renders++; root.hidden = true; frame = fresh(); frame.srcdoc = ''; darkInFrame = false; source = ''; key = ''; currentTitle = ''; },
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(source); },
    get editing() { return editing; },
    get text() { return source; },
    get name() { return currentTitle || title?.textContent || ''; },
  };
}
