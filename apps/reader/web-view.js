// Web links (Notion pages, course sites…) opened as documents. The desktop app shows them in
// an Electron <webview>: a separate, sandboxed page in its own session (logins are kept there),
// with no access to NoteComplete; main.js enforces that when the webview attaches. Elsewhere
// the link opens in the browser.
export const WEB_SESSION = 'persist:notecomplete-web';

export function normalizeLink(text) {
  let value = String(text || '').trim();
  if (!value) return null;
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url.href : null;
  } catch { return null; }
}

export const linkTitle = (url) => { try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`.replace(/\/$/, ''); } catch { return url; } };

export function webViewer({ root, host, title, address, back, reload, external, fallback, onTitle = () => {}, status = () => {} }) {
  let view = null, url = '', name = '', zoom = 1, dark = false, darkScript = null;
  const desktop = Boolean(globalThis.notecompleteFiles);
  async function applyDark() {
    if (!view || !darkScript) return;
    const script = await darkScript().catch(() => null);
    if (!script || !view) return;
    const on = dark ? 'DarkReader.enable({ brightness: 100, contrast: 100, sepia: 0, darkSchemeBackgroundColor: "#15171b", darkSchemeTextColor: "#e5e8ed" })' : 'DarkReader.disable()';
    // Runs inside the web page: Dark Reader is added there once, then switched.
    view.executeJavaScript(`${dark ? `if (!window.DarkReader) { ${script} }` : ''};window.DarkReader && ${on};`).catch(() => {});
  }
  function create() {
    view = document.createElement('webview');
    view.className = 'web-frame';
    view.setAttribute('partition', WEB_SESSION);
    view.setAttribute('allowpopups', '');
    view.addEventListener('page-title-updated', (event) => { name = event.title || name; title.textContent = name; onTitle(name, url); });
    view.addEventListener('did-navigate', (event) => { url = event.url; address.textContent = linkTitle(url); address.title = url; back.disabled = !view.canGoBack(); });
    view.addEventListener('did-navigate-in-page', (event) => { if (event.isMainFrame) { url = event.url; address.textContent = linkTitle(url); } });
    view.addEventListener('dom-ready', () => { view.setZoomFactor(zoom); if (dark) applyDark(); back.disabled = !view.canGoBack(); });
    view.addEventListener('did-fail-load', (event) => { if (event.isMainFrame && event.errorCode !== -3) status(`${linkTitle(event.validatedURL)} could not be loaded: ${event.errorDescription}`, true); });
  }
  back.onclick = () => view?.canGoBack() && view.goBack();
  reload.onclick = () => view?.reload();
  external.onclick = () => url && window.open(url, '_blank', 'noopener');
  return {
    open({ url: link, name: shown, darkReader }) {
      url = link; name = shown || linkTitle(link); darkScript = darkReader;
      title.textContent = name;
      address.textContent = linkTitle(link);
      address.title = link;
      root.hidden = false;
      back.disabled = true;
      if (!desktop) {
        host.replaceChildren();
        fallback.hidden = false;
        return;
      }
      fallback.hidden = true;
      create();
      // src before it is attached: main.js only lets a webview attach with a web address.
      view.setAttribute('src', link);
      host.replaceChildren(view);
    },
    setZoom(value) { zoom = value; if (view) try { view.setZoomFactor(zoom); } catch { /* Not attached yet: dom-ready applies it. */ } },
    setDark(on) { dark = Boolean(on); applyDark(); },
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    close() { root.hidden = true; host.replaceChildren(); view = null; url = ''; name = ''; },
    get visible() { return !root.hidden; },
    get hasDocument() { return Boolean(url); },
    get name() { return name; },
    get url() { return url; },
  };
}
