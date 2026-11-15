// Authentication only: listing/downloads use the same GET-only client on every platform.
export function nativeDriveIdentity() {
  if (window.notecompleteDrive) return { ...window.notecompleteDrive, native: true };
  if (!window.ReactNativeWebView) return null;
  let sequence = 0;
  const pending = new Map();
  function receive(event) {
    if (event.origin && event.origin !== location.origin) return;
    let message; try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (message?.type !== 'notecomplete-drive-auth-result') return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(Error(message.error)) : request.resolve(message.token);
  }
  window.addEventListener('message', receive);
  document.addEventListener('message', receive);
  const cancel = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error('Google sign-in cancelled.')); }
    pending.clear();
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'notecomplete-drive-cancel' }));
  };
  const requestAuth = (options = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Google sign-in timed out. Try again.')); }, 180000);
      pending.set(id, { resolve, reject, timer });
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'notecomplete-drive-auth',
          id,
          silent: options.silent === true,
          clearToken: typeof options.clearToken === 'string' ? options.clearToken : '',
        }));
      } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  };
  return {
    native: true, cancel,
    disconnect() { cancel(); window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'notecomplete-drive-disconnect' })); },
    signIn(options = {}) { return requestAuth(options); },
    refresh(options = {}) { return requestAuth({ ...options, silent: true }); },
  };
}
