// Expo Go hands generated files to the system share sheet; iOS Safari/PWA uses Web Share
// with a fresh-gesture prompt fallback; desktop browsers use attached <a download> links.
let sequence = 0;
const pending = new Map();
const REVOKE_DELAY_MS = 60_000;

function receive(event) {
  let message;
  try {
    message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (message?.type !== 'noteful-export-result') return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.error ? request.reject(Error(message.error)) : request.resolve();
}

if (typeof window !== 'undefined') window.addEventListener('message', receive);
if (typeof document !== 'undefined') document.addEventListener('message', receive);

export function isAppleMobile(nav = globalThis.navigator) {
  if (!nav) return false;
  const ua = nav.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1;
}

function isStandalonePwa(nav = globalThis.navigator, win = globalThis.window) {
  if (nav?.standalone) return true;
  try {
    return Boolean(win?.matchMedia?.('(display-mode: standalone)')?.matches);
  } catch {
    return false;
  }
}

export function shareableFile(blob, name, nav = globalThis.navigator) {
  if (typeof File !== 'function' || typeof nav?.canShare !== 'function') return null;
  const primaryType = blob.type || 'application/octet-stream';
  const candidates = primaryType === 'application/octet-stream'
    ? [primaryType]
    : [primaryType, 'application/octet-stream'];
  for (const mime of candidates) {
    try {
      const file = new File([blob], name, { type: mime });
      if (nav.canShare({ files: [file] })) return file;
    } catch {
      // Some WebKit versions throw on unrecognised MIME types; try octet-stream next.
    }
  }
  return null;
}

function scheduleRevoke(url, delay = REVOKE_DELAY_MS) {
  const timer = setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke errors in test environments.
    }
  }, delay);
  timer?.unref?.();
}

function triggerAnchorDownload(url, name, doc) {
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  if (link.style) link.style.display = 'none';
  const host = doc.body || doc.documentElement;
  host?.appendChild?.(link);
  link.click();
  link.remove?.();
  scheduleRevoke(url);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

// When async export prep expires transient iOS user activation, present a top-layer
// prompt so tapping Share or Download executes with a synchronous user gesture.
function promptAppleExport({ doc, url, name, blob, file, nav }) {
  if (!doc?.createElement || !(doc.body || doc.documentElement)) {
    triggerAnchorDownload(url, name, doc);
    return Promise.resolve({ shared: false });
  }
  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog');
    const useDialog = typeof dialog?.showModal === 'function';
    const box = useDialog ? dialog : doc.createElement('div');
    box.className = 'nc-ios-export';
    if (!useDialog) {
      box.setAttribute?.('role', 'dialog');
      box.setAttribute?.('aria-modal', 'true');
      if (box.style) {
        box.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:2147483647;max-width:420px;margin:0 auto;padding:16px;border-radius:12px;background:#1d2026;color:#f3f5f8;border:1px solid rgba(255,255,255,0.16);box-shadow:0 12px 32px rgba(0,0,0,0.45);font-family:system-ui,-apple-system,sans-serif;';
      }
    } else if (box.style) {
      box.style.cssText = 'max-width:420px;width:calc(100vw - 32px);padding:18px;border-radius:14px;border:1px solid rgba(128,128,128,0.3);box-shadow:0 16px 40px rgba(0,0,0,0.35);font-family:system-ui,-apple-system,sans-serif;';
    }

    const title = doc.createElement('div');
    title.textContent = 'File ready to export';
    if (title.style) title.style.cssText = 'font-weight:600;font-size:15px;margin-bottom:4px;';

    const meta = doc.createElement('div');
    meta.textContent = `${name} (${formatSize(blob.size)})`;
    if (meta.style) meta.style.cssText = 'font-size:13px;opacity:0.8;word-break:break-word;margin-bottom:12px;';

    const errNote = doc.createElement('div');
    errNote.hidden = true;
    if (errNote.style) errNote.style.cssText = 'font-size:12px;color:#f87171;margin-bottom:10px;';

    const actions = doc.createElement('div');
    if (actions.style) actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;';

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (useDialog && box.open) {
        try {
          box.close();
        } catch {
          // Ignore close errors.
        }
      }
      box.remove?.();
      scheduleRevoke(url);
      resolve(result);
    };

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cancel';
    if (closeBtn.style) closeBtn.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid rgba(128,128,128,0.35);background:transparent;color:inherit;cursor:pointer;';
    closeBtn.onclick = () => finish({ shared: false, cancelled: true });

    const dlLink = doc.createElement('a');
    dlLink.href = url;
    dlLink.download = name;
    dlLink.rel = 'noopener';
    dlLink.textContent = file ? 'Download directly' : 'Download file';
    if (dlLink.style) dlLink.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid rgba(128,128,128,0.35);color:inherit;text-decoration:none;font-size:14px;';
    dlLink.onclick = () => {
      setTimeout(() => finish({ shared: false }), 50);
    };

    actions.append(closeBtn, dlLink);

    if (file && typeof nav?.share === 'function') {
      const shareBtn = doc.createElement('button');
      shareBtn.type = 'button';
      shareBtn.textContent = 'Save / Share';
      if (shareBtn.style) shareBtn.style.cssText = 'padding:8px 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;';
      shareBtn.onclick = () => {
        errNote.hidden = true;
        Promise.resolve(nav.share({ files: [file], title: name })).then(
          () => finish({ shared: true }),
          (e) => {
            if (e?.name === 'AbortError') {
              finish({ shared: false, cancelled: true });
              return;
            }
            errNote.textContent = e?.message || 'Share failed; try Download directly.';
            errNote.hidden = false;
          },
        );
      };
      actions.append(shareBtn);
    }

    box.append(title, meta, errNote, actions);
    if (useDialog) {
      box.addEventListener?.('cancel', (e) => {
        e.preventDefault?.();
        finish({ shared: false, cancelled: true });
      });
    }
    (doc.body || doc.documentElement).appendChild(box);
    if (useDialog) box.showModal();
  });
}

export async function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  if (globalThis.window?.ReactNativeWebView) {
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const id = ++sequence;
    await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'noteful-export', id, name, mime: blob.type, base64: encoded }),
        );
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
    return { shared: true };
  }

  const nav = globalThis.navigator;
  const doc = globalThis.document;
  const win = globalThis.window;
  if (isAppleMobile(nav)) {
    const file = shareableFile(blob, name, nav);
    if (file && typeof nav?.share === 'function') {
      try {
        await nav.share({ files: [file], title: name });
        return { shared: true };
      } catch (err) {
        if (err?.name === 'AbortError') return { shared: false, cancelled: true };
        const url = URL.createObjectURL(blob);
        return promptAppleExport({ doc, url, name, blob, file, nav });
      }
    }
    const url = URL.createObjectURL(blob);
    if (isStandalonePwa(nav, win)) {
      return promptAppleExport({ doc, url, name, blob, file: null, nav });
    }
    triggerAnchorDownload(url, name, doc);
    return { shared: false };
  }

  const url = URL.createObjectURL(blob);
  triggerAnchorDownload(url, name, doc);
  return { shared: false };
}
